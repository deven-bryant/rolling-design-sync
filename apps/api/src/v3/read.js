'use strict';

/*
 * v3 read routes (docs/api-v3-design.md, "Resource model" and "Listing"):
 * files, scopes, the node listing, one node, and link resolution.
 */
const core = require('@rolling-design-sync/core');
const { pathNodeIds, isDescendant } = require('../ltree');
const { problem } = require('./problem');
const address = require('./address');
const schemas = require('./schemas');
const format = require('./format');
const { documentSortKey } = require('../documentOrder');

const isAbsolute = n => !!n.attrs && n.attrs.layoutPositioning === 'ABSOLUTE';

const FILTER_KEYS = ['state', 'under', 'depth', 'type', 'changeType', 'changed', 'category', 'component', 'instance', 'name', 'since', 'claimed', 'worker'];
const CLAIMED = ['true', 'false', 'mine'];
const BOOLEANS = ['true', 'false'];

const csv = v => String(v).split(',').map(s => s.trim()).filter(Boolean);

function invalid(param, detail, hint) {
  return problem('invalid_parameter', `${param}: ${detail}`, { hint });
}

function oneOf(param, values, allowed) {
  const bad = values.filter(v => !allowed.includes(v));
  if (bad.length) throw invalid(param, `unknown value${bad.length > 1 ? 's' : ''} ${bad.map(v => `'${v}'`).join(', ')}.`, `Use one or more of: ${allowed.join(', ')} (comma-separated).`);
  return values;
}

const Q_TOKEN = /\s*([A-Za-z]+):(?:"([^"]*)"|(\S*))/y;

/** `q` → `{ key: value }`; a key repeated within `q` ORs its values. */
function parseQ(q) {
  const out = {};
  Q_TOKEN.lastIndex = 0;
  const text = String(q);
  let m;
  while (Q_TOKEN.lastIndex < text.length && text.slice(Q_TOKEN.lastIndex).trim()) {
    const at = Q_TOKEN.lastIndex;
    m = Q_TOKEN.exec(text);
    if (!m) throw invalid('q', `cannot parse '${text.slice(at).trim()}'.`, 'Write space-separated key:value pairs, e.g. q=state:dirty under:1:2 changed:fills; quote values with spaces: name:"Button Primary".');
    const [, key, quoted, bare] = m;
    if (!FILTER_KEYS.includes(key)) {
      throw invalid('q', `unknown key '${key}'.`, `q keys are the filter parameters: ${FILTER_KEYS.join(', ')}.`);
    }
    const value = quoted !== undefined ? quoted : bare;
    out[key] = out[key] === undefined ? value : `${out[key]},${value}`;
  }
  return out;
}

/** Filter parameters from the query string merged with `q`; a key may come from only one of them. */
function filterParams(query) {
  const params = {};
  for (const k of FILTER_KEYS) if (query[k] !== undefined) params[k] = query[k];
  if (query.q !== undefined) {
    for (const [k, v] of Object.entries(parseQ(query.q))) {
      if (params[k] !== undefined) throw invalid('q', `'${k}' is given both in q and as a parameter.`, `Pass '${k}' once: either ?${k}= or q=${k}:….`);
      params[k] = k === 'depth' ? Number(v) : v;
    }
  }
  return params;
}

function parseChanged(values) {
  const changedExact = [], changedPrefixes = [];
  for (const v of values) {
    const star = v.indexOf('*');
    if (star === -1) changedExact.push(v);
    else if (star === v.length - 1 && v.length > 1) changedPrefixes.push(v.slice(0, -1));
    else throw invalid('changed', `'${v}' has a '*' that is not a trailing wildcard.`, 'Use exact property names (fills) or a prefix with a trailing * (padding*).');
  }
  return { changedExact, changedPrefixes };
}

/** A store filter (docs: "Store interface") from the listing parameters; `under` is still the caller's id. */
/** @returns {import('../store/types').V3Filter} */
function buildFilter(p, nowIso) {
  const states = p.state === undefined ? ['dirty'] : oneOf('state', csv(p.state), schemas.STATES);
  const depth = p.depth === undefined ? null : p.depth;
  if (depth !== null && (!Number.isInteger(depth) || depth < 0)) throw invalid('depth', 'must be a non-negative integer.', 'depth=1 lists the direct children of `under`.');
  if (depth !== null && p.under === undefined) throw invalid('depth', 'needs under.', 'Pass under=<nodeId> (or ?url= with a node-id) with depth.');
  const claimed = p.claimed === undefined ? [] : oneOf('claimed', csv(p.claimed), CLAIMED);
  const worker = p.worker === undefined ? null : String(p.worker).trim() || null;
  if (claimed.includes('mine') && !worker) throw invalid('claimed', "'mine' needs worker.", 'Pass worker=<your worker id> with claimed=mine.');
  let since = null;
  if (p.since !== undefined) {
    const t = Date.parse(p.since);
    if (Number.isNaN(t)) throw invalid('since', `'${p.since}' is not a date.`, 'Use ISO 8601, e.g. 2026-09-28T00:00Z.');
    since = new Date(t).toISOString();
  }
  const instance = p.instance === undefined ? [] : [...new Set(oneOf('instance', csv(p.instance), BOOLEANS))];
  return {
    states: states.includes('all') ? ['dirty', 'clean', 'blocked'] : [...new Set(states)],
    under: p.under === undefined ? null : String(p.under),
    depth,
    types: p.type === undefined ? [] : csv(p.type).map(t => t.toUpperCase()),
    changeTypes: p.changeType === undefined ? [] : oneOf('changeType', csv(p.changeType), schemas.CHANGE_TYPES),
    ...parseChanged(p.changed === undefined ? [] : csv(p.changed)),
    categories: p.category === undefined ? [] : oneOf('category', csv(p.category), schemas.CATEGORIES),
    components: p.component === undefined ? [] : csv(p.component).map(address.normalizeNodeId),
    instance: instance.length === 1 ? instance[0] === 'true' : null,
    names: p.name === undefined ? [] : csv(p.name),
    since,
    claimed,
    worker,
    now: nowIso,
  };
}

function parseSort(sort = 'document') {
  const desc = sort.startsWith('-');
  return { sort: desc ? sort.slice(1) : sort, desc };
}

const parseChanges = (value, fallback) => (value === undefined ? fallback : oneOf('changes', [String(value)], schemas.CHANGES_MODES)[0]);

function parseFields(value, allowed = schemas.NODE_FIELDS) {
  if (value === undefined) return null;
  return oneOf('fields', csv(value), allowed);
}

// --- expand=instances ----------------------------------------------------------
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `{ depth }` for `expand=instances` (null without it); rejects `expandDepth` alone and `depth` with it. */
function parseExpand(query, filter) {
  if (query.expand === undefined) {
    if (query.expandDepth !== undefined) throw invalid('expandDepth', 'needs expand=instances.', 'Pass expand=instances with expandDepth, or drop expandDepth.');
    return null;
  }
  if (filter.depth !== null) {
    throw invalid('depth', 'cannot be combined with expand=instances.', 'depth counts levels below under, which expanded components are not in; limit instance → main hops with expandDepth instead, or drop expand.');
  }
  return { depth: query.expandDepth ?? schemas.DEFAULT_EXPAND_DEPTH };
}

/**
 * Orders the reachable mains (`expansionReach`) breadth-first: level by level,
 * each main after the region (scope = '', or an earlier main) holding its first
 * instance, then by that instance's document order. Keeps the first `limit`.
 * Returns `{ regions, vias, meta }`: `regions[0]` is the scope path (null: the
 * whole file), then each synced component's path; `vias[i]` annotates region i.
 */
function planExpansion(scopePath, reach, edges, limit) {
  const byMain = new Map();
  for (const e of edges) {
    if (!byMain.has(e.mainComponentId)) byMain.set(e.mainComponentId, []);
    byMain.get(e.mainComponentId).push(e);
  }
  const ordinal = new Map([['', 0]]);
  const order = (a, b) => a.o - b.o || cmp(a.e.instanceKey ?? a.e.instancePath, b.e.instanceKey ?? b.e.instancePath) || cmp(a.e.instanceId, b.e.instanceId);
  const found = [];
  const maxDepth = reach.reduce((m, r) => Math.max(m, r.depth), 0);
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const level = [];
    for (const r of reach) {
      if (r.depth !== depth) continue;
      let best = null;
      for (const e of byMain.get(r.mainComponentId) || []) {
        if (!ordinal.has(e.region)) continue;
        const c = { o: ordinal.get(e.region), e };
        if (!best || order(c, best) < 0) best = c;
      }
      if (best) level.push({ r, ...best });
    }
    level.sort((a, b) => order(a, b) || cmp(a.r.mainComponentId, b.r.mainComponentId));
    for (const { r, e } of level) {
      ordinal.set(r.mainComponentId, ordinal.size);
      found.push({ path: r.path, mainComponentId: r.mainComponentId, via: { instanceId: e.instanceId, mainComponentId: r.mainComponentId, depth } });
    }
  }
  const kept = found.slice(0, limit);
  const components = kept.filter(c => c.path);
  const truncated = found.length > limit;
  return {
    regions: [scopePath, ...components.map(c => c.path)],
    vias: [null, ...components.map(c => c.via)],
    meta: {
      components: components.length,
      truncated,
      unresolved: kept.filter(c => !c.path).map(c => c.mainComponentId),
      ...(truncated ? { hint: `Expansion stopped at ${limit} components. Narrow the scope (under=<a smaller frame>) or lower expandDepth.` } : {}),
    },
  };
}

/** The expansion of a scope (`scopeNode`, or the whole file when null) over instance → main edges; see planExpansion. */
async function expandScope(store, fileKey, scopeNode, expand) {
  const scope = scopeNode ? scopeNode.path : null;
  const reach = await store.expansionReach(fileKey, { scope, maxDepth: expand.depth });
  const edges = reach.length
    ? await store.expansionEdges(fileKey, {
      regions: [{ key: '', path: scope, depth: 0 }, ...reach.filter(r => r.path).map(r => ({ key: r.mainComponentId, path: r.path, depth: r.depth }))],
      mains: reach.map(r => ({ mainComponentId: r.mainComponentId, depth: r.depth })),
    })
    : [];
  return planExpansion(scope, reach, edges, schemas.EXPANSION_LIMIT);
}

// --- cursors -----------------------------------------------------------------
/** A fingerprint of the query a cursor belongs to (filter without the clock, and sort). */
function queryFingerprint(filter, sort) {
  const { now, ...rest } = filter;
  return core.sha256(core.stable({ rest, sort })).slice(0, 16);
}

/** `offset`: how many rows come before the cursor (for `… N more`), when known. */
const encodeCursor = (next, fp, offset = null) => Buffer.from(JSON.stringify({ k: next.k, id: next.id, f: fp, ...(offset === null ? {} : { o: offset }) }), 'utf8').toString('base64url');

function decodeCursor(cursor, fp) {
  let parsed;
  try { parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.k !== 'string' || typeof parsed.id !== 'string') {
    throw problem('invalid_cursor', 'The cursor is not one this API issued.', { hint: "Pass the previous page's nextCursor unchanged, or drop cursor to start over." });
  }
  if (parsed.f !== fp) {
    throw problem('invalid_cursor', 'The cursor belongs to a different query.', { hint: 'Keep every filter, sort and q parameter the same across pages, or drop cursor to start over.' });
  }
  return { k: parsed.k, id: parsed.id, offset: Number.isInteger(parsed.o) && parsed.o >= 0 ? parsed.o : null };
}

/**
 * A format=outline cursor: `line` of the outline rendered from the row after
 * `after` (null: the first), `offset` rows before that row.
 * @param {string} fp
 * @param {{ after?: { k: string, id: string } | null, offset?: number, line?: number }} position
 */
const encodeOutlineCursor = (fp, { after = null, offset = 0, line = 0 }) =>
  Buffer.from(JSON.stringify({ f: fp, l: line, o: offset, ...(after ? { k: after.k, id: after.id } : {}) }), 'utf8').toString('base64url');

/** The position of an outline `cursor` (the start when undefined); same problems as decodeCursor. */
function decodeOutlineCursor(cursor, fp) {
  if (cursor === undefined) return { after: null, offset: 0, line: 0 };
  let parsed;
  try { parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')); } catch { parsed = null; }
  const issued = parsed && typeof parsed === 'object' && typeof parsed.f === 'string';
  if (issued && parsed.f !== fp) {
    throw problem('invalid_cursor', 'The cursor belongs to a different query.', { hint: 'Keep every filter, sort and q parameter the same across pages, or drop cursor to start over.' });
  }
  const at = issued && Number.isInteger(parsed.l) && parsed.l >= 0 && Number.isInteger(parsed.o) && parsed.o >= 0
    && (parsed.k === undefined ? parsed.id === undefined : typeof parsed.k === 'string' && typeof parsed.id === 'string');
  if (!at) {
    throw problem('invalid_cursor', 'The cursor is not one this API issued.', { hint: "Pass the previous response's X-RDS-Next-Cursor header unchanged, or drop cursor to start over." });
  }
  return { after: parsed.k === undefined ? null : { k: parsed.k, id: parsed.id }, offset: parsed.o, line: parsed.l };
}

/** Rows before the cursor `after` plus `count` (null when unknown). */
const offsetAfter = (after, count) => (after === null ? count : after.offset === null ? null : after.offset + count);

/**
 * The format=outline lines for listing rows (store shape, with `expandOrd` when
 * `expansion`): each expanded region is attached to its host instance, found
 * among the rows or read from the store.
 */
async function outlineNodes(store, fileKey, rows, expansion, at, sort) {
  const keyOf = n => (sort === 'path' ? n.path : documentSortKey(n));
  const out = rows.map(n => ({ node: nodeFields(fileKey, n, at, 'names'), path: n.path, key: keyOf(n), absolute: isAbsolute(n), region: expansion ? n.expandOrd ?? 0 : 0 }));
  const byId = new Map(rows.map(n => [n.nodeId, n]));
  const hostIds = expansion ? [...new Set(out.filter(r => r.region > 0).map(r => expansion.vias[r.region].instanceId))] : [];
  const mainIds = [...new Set(out.map(r => r.node.mainComponentId).filter(Boolean))];
  const missing = [...new Set([...hostIds, ...mainIds])].filter(id => !byId.has(id));
  for (const n of missing.length ? await store.getNodes(fileKey, missing) : []) byId.set(n.nodeId, n);
  const attach = new Map();
  for (const r of new Set(out.map(o => o.region))) {
    if (r === 0) continue;
    const via = expansion.vias[r];
    const host = byId.get(via.instanceId);
    const hostPath = host ? host.path : null;
    const hostRegion = hostPath ? expansion.regions.findIndex(p => p !== null && isDescendant(hostPath, p)) : -1;
    attach.set(r, { mainId: via.mainComponentId, hostId: via.instanceId, hostPath, hostKey: host ? keyOf(host) : null, hostRegion: hostRegion < 0 ? null : hostRegion });
  }
  const mainNames = new Map(mainIds.filter(id => byId.has(id) && byId.get(id).name).map(id => [id, byId.get(id).name]));
  return format.outlineTree(out, { attach, mainNames });
}

// --- representation ------------------------------------------------------------
const stateOf = n => (n.blockedAt ? 'blocked' : n.dirty ? 'dirty' : 'clean');

function changeTypeOf(n) {
  if (!n.dirty) return null;
  if (n.changeType) return n.changeType;
  if (n.deletedAt) return 'deleted';
  return n.implementedHash === null || n.implementedHash === undefined ? 'added' : 'modified';
}

/**
 * `{ changes, changesKnown }`: the property diff against what was built, when it is known.
 * `mode` (`changes=`): `diff` always has `changes`; `auto` leaves it out for added nodes; `names` never has it.
 */
function changesOf(n, changeType, mode = 'diff') {
  const built = n.implementedAttrs ?? null;
  const implemented = n.implementedHash !== null && n.implementedHash !== undefined;
  const changesKnown = !n.dirty || changeType === 'added' || !implemented || !!built;
  if (mode === 'names' || (mode === 'auto' && changeType === 'added')) return { changesKnown };
  if (!n.dirty) return { changes: {}, changesKnown };
  if (changeType === 'added') return { changes: core.diffAttrs(null, n.attrs ?? {}).changes, changesKnown };
  if (!changesKnown) return { changes: null, changesKnown };
  return { changes: core.diffAttrs(built, changeType === 'deleted' ? null : n.attrs ?? {}).changes, changesKnown: true };
}

function claimOf(n, nowIso) {
  if (!n.claimedBy || !n.claimExpiresAt || Date.parse(n.claimExpiresAt) <= Date.parse(nowIso)) return null;
  return { claimId: n.claimId ?? null, worker: n.claimedBy, label: n.claimLabel ?? null, expiresAt: n.claimExpiresAt };
}

/** Every representable field of a stored node (the v3 node shape is a subset of this); `changes` per `changesOf`'s mode. */
function nodeFields(fileKey, n, nowIso, changes = 'diff') {
  const changeType = changeTypeOf(n);
  /** @type {Record<string, any>} */
  const out = {
    nodeId: n.nodeId,
    name: n.name ?? null,
    type: n.nodeType ?? null,
    parentId: n.parentId ?? null,
    isInstance: !!n.isInstance,
    mainComponentId: n.mainComponentId ?? null,
    component: n.attrs?.componentReference ?? null,
    state: stateOf(n),
    changeType,
    changedProps: n.dirty ? [...(n.changedProps ?? [])].sort() : [],
    ...changesOf(n, changeType, changes),
    contentHash: n.contentHash ?? null,
    figmaUrl: core.link(fileKey, n.nodeId),
    claim: claimOf(n, nowIso),
    blocked: n.blockedAt ? { reason: n.blockedReason ?? null, by: n.blockedBy ?? null, at: n.blockedAt } : null,
    attrs: n.attrs ?? {},
    implementedAttrs: n.implementedAttrs ?? null,
    path: pathNodeIds(n.path),
    deleted: !!n.deletedAt,
    history: {
      createdAt: n.createdAt ?? null,
      updatedAt: n.updatedAt ?? null,
      implementedAt: n.implementedAt ?? null,
      implementedCommit: n.implementedCommit ?? null,
      implementedHash: n.implementedHash ?? null,
      deletedAt: n.deletedAt ?? null,
    },
  };
  if (n.descendants) out.descendants = n.descendants;
  return out;
}

const jsonBytes = v => (v === undefined ? 0 : Buffer.byteLength(JSON.stringify(v), 'utf8'));

/**
 * Compact responses: every change side (`built` / `now`) whose JSON is over
 * MAX_CHANGE_SIDE_BYTES becomes `{ truncated: true, bytes }`. Returns the node
 * (a copy when anything was cut) and whether anything was.
 */
function truncateChanges(node) {
  if (!node.changes) return { node, truncated: false };
  let truncated = false;
  const changes = {};
  for (const [prop, change] of Object.entries(node.changes)) {
    const next = { ...change };
    for (const side of ['built', 'now']) {
      const bytes = jsonBytes(change[side]);
      if (bytes > schemas.MAX_CHANGE_SIDE_BYTES) { next[side] = { truncated: true, bytes }; truncated = true; }
    }
    changes[prop] = next;
  }
  return truncated ? { node: { ...node, changes }, truncated } : { node, truncated };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

const withClean = c => ({ total: c.total, dirty: c.dirty, clean: c.total - c.dirty - c.blocked, blocked: c.blocked });
const fileOut = f => ({ fileKey: f.fileKey, name: f.name ?? null, lastSyncAt: f.lastSyncAt ?? null, createdAt: f.createdAt ?? null, counts: withClean(f.counts) });

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerReadRoutes(app, { store, now }) {
  const nowIso = () => now().toISOString();

  async function trackedFile(fileKey) {
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
    return file;
  }

  /** The stored node for a caller-supplied id (`1:2` or `1-2`), or a node_not_found problem. */
  async function findNode(fileKey, raw, options) {
    for (const id of address.nodeIdCandidates(raw)) {
      const node = await store.getNodeV3(fileKey, id, options);
      if (node) return node;
    }
    throw address.nodeNotFound(fileKey, raw);
  }

  app.get('/files', { schema: schemas.listFiles }, async () => ({ files: (await store.listFiles()).map(fileOut) }));

  app.get('/files/:fileKey', { schema: schemas.getFile }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}', 'get'>} */ request) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    return fileOut(await trackedFile(fileKey));
  });

  app.get('/files/:fileKey/scopes', { schema: schemas.listScopes }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/scopes', 'get'>} */ request) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    await trackedFile(fileKey);
    const scopes = await store.listScopes(fileKey);
    return {
      fileKey,
      scopes: scopes.map(s => ({
        nodeId: s.nodeId, name: s.name, type: s.nodeType, deleted: s.deleted, figmaUrl: core.link(fileKey, s.nodeId),
        lastSyncAt: s.lastSyncAt, lastSyncCounts: s.lastSyncCounts, counts: withClean(s.counts),
      })),
    };
  });

  app.get('/files/:fileKey/nodes', { schema: format.withFormat(schemas.listNodes, { outline: 'node' }) }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/nodes', 'get'>} */ request, reply) => {
    const { query } = request;
    const fmt = query.format ?? 'json';
    const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, query.url);
    const params = filterParams(query);
    if (params.under === undefined && urlNodeId) params.under = urlNodeId;
    const at = nowIso();
    const filter = buildFilter(params, at);
    const expand = parseExpand(query, filter);
    const fields = parseFields(query.fields, schemas.LISTING_FIELDS);
    if (!expand && fields !== null && fields.includes('via')) throw invalid('fields', "'via' needs expand=instances.", 'Pass expand=instances, or drop via from fields.');
    const changes = parseChanges(query.changes, 'auto');
    const view = query.view ?? 'compact';
    const counts = query.include === 'counts' || (fields !== null && fields.includes('descendants'));
    const { sort, desc } = parseSort(query.sort);
    if (fmt === 'outline' && ((sort !== 'document' && sort !== 'path') || desc)) {
      throw invalid('sort', 'format=outline is always in tree order.', 'Drop sort (or use sort=document or sort=path) with format=outline.');
    }
    const outline = fmt === 'outline';
    const limit = outline ? format.STREAM_PAGE : format.pageSize(fmt, query.limit, schemas.DEFAULT_LIMIT);
    const fp = queryFingerprint(filter, { sort, desc, fields, view, counts, changes, ...(expand ? { expand } : {}), ...(outline ? { format: fmt } : {}) });
    const pos = decodeOutlineCursor(outline ? query.cursor : undefined, fp);
    const after = outline ? pos.after : query.cursor === undefined ? null : decodeCursor(query.cursor, fp);

    await trackedFile(fileKey);
    const underNode = filter.under === null ? null : await findNode(fileKey, filter.under);
    if (underNode) filter.under = underNode.nodeId;
    const expansion = expand ? await expandScope(store, fileKey, underNode, expand) : null;
    if (expansion) filter.regions = expansion.regions;

    const result = await store.listNodes(fileKey, filter, { sort, desc, limit, after, counts });
    const base = view === 'full' ? schemas.FULL_FIELDS : schemas.COMPACT_FIELDS;
    const keys = fields ?? (expansion ? [...base, 'via'] : base);
    const shown = counts && !keys.includes('descendants') ? [...keys, 'descendants'] : keys;
    let truncated = false;
    const toObject = n => {
      const all = nodeFields(fileKey, n, at, changes);
      if (expansion) all.via = expansion.vias[n.expandOrd] ?? null;
      const node = pick(all, shown);
      if (view === 'full') return node;
      const cut = truncateChanges(node);
      truncated = truncated || cut.truncated;
      return cut.node;
    };
    if (outline) {
      const rows = [...result.nodes];
      let { next } = result;
      while (next && rows.length < format.OUTLINE_LINES) {
        const r = await store.listNodes(fileKey, filter, { sort, desc, limit: Math.min(format.OUTLINE_LINES - rows.length, format.STREAM_PAGE), after: next, counts });
        rows.push(...r.nodes);
        next = r.next;
      }
      const shownTo = pos.offset + rows.length;
      return format.sendOutline(reply, await outlineNodes(store, fileKey, rows, expansion, at, sort), {
        from: pos.line,
        limit: query.limit ?? null,
        cursorAt: line => encodeOutlineCursor(fp, { after, offset: pos.offset, line }),
        more: next ? Math.max(result.total - shownTo, 1) : 0,
        moreCursor: next ? encodeOutlineCursor(fp, { after: next, offset: shownTo }) : null,
        total: result.total,
      });
    }
    if (fmt !== 'json') {
      return format.stream(reply, fmt, {
        first: { rows: result.nodes, next: result.next },
        fetch: async next => { const r = await store.listNodes(fileKey, filter, { sort, desc, limit, after: next, counts }); return { rows: r.nodes, next: r.next }; },
        cap: query.limit ?? null,
        total: result.total,
        toObject,
        toLine: n => format.nodeLine(nodeFields(fileKey, n, at)),
      });
    }
    const nodes = result.nodes.map(toObject);
    return {
      fileKey,
      nodes,
      nextCursor: result.next ? encodeCursor(result.next, fp, offsetAfter(after, nodes.length)) : null,
      total: result.total,
      ...(truncated ? { truncated } : {}),
      ...(expansion ? { expansion: expansion.meta } : {}),
    };
  });

  app.get('/files/:fileKey/nodes/:nodeId', { schema: schemas.getNode }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/nodes/{nodeId}', 'get'>} */ request) => {
    const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, request.query.url);
    const raw = address.resolveNodeParam(request.params.nodeId, urlNodeId);
    const fields = parseFields(request.query.fields);
    const changes = parseChanges(request.query.changes, 'diff');
    await trackedFile(fileKey);
    const node = await findNode(fileKey, raw, { counts: true });
    const all = { fileKey, ...nodeFields(fileKey, node, nowIso(), changes) };
    return fields ? pick(all, ['fileKey', ...fields]) : pick(all, ['fileKey', ...schemas.DETAIL_FIELDS, 'descendants']);
  });

  app.get('/resolve', { schema: schemas.resolve }, async (/** @type {import('./types').V3Request<'/v3/resolve', 'get'>} */ request) => address.parseUrl(request.query.url));
}

module.exports = {
  registerReadRoutes, parseQ, filterParams, buildFilter, parseChanges, nodeFields, truncateChanges, pick, FILTER_KEYS,
  queryFingerprint, encodeCursor, decodeCursor, encodeOutlineCursor, decodeOutlineCursor, offsetAfter, parseExpand, planExpansion, expandScope, isAbsolute,
};
