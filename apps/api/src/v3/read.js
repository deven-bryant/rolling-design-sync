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
const { fileSettings } = require('../nodeService');
const { attachmentsByOwner } = require('./attachments');
const { withScreens } = require('./screens');

/** Open notes (with screenshots) and screen state on `nodes`. */
async function withNotes(store, fileKey, nodes, options) {
  await withNotesOnly(store, fileKey, nodes, options);
  await withScreens(store, fileKey, nodes);
  return nodes;
}

const TOKENS_SCOPE_NAME = 'Design tokens';
const TOKENS_TYPE = 'TOKENS';

const isAbsolute = n => !!n.attrs && n.attrs.layoutPositioning === 'ABSOLUTE';

const FILTER_KEYS = ['state', 'under', 'depth', 'type', 'changeType', 'changed', 'category', 'component', 'instance', 'name', 'since', 'claimed', 'worker', 'library', 'hasNotes'];
const CLAIMED = ['true', 'false', 'mine'];
const BOOLEANS = ['true', 'false'];

const csv = v => String(v).split(',').map(s => s.trim()).filter(Boolean);
/** Most subtree roots one `under` may name. */
const MAX_UNDER = 50;

/** The `under` ids (one, or a comma-separated list), in the order given. */
function parseUnder(value) {
  const ids = csv(value);
  if (!ids.length) throw invalid('under', 'needs a node id.', 'Pass under=<nodeId>, or several comma-separated: under=1:2,1:5.');
  if (ids.length > MAX_UNDER) throw invalid('under', `at most ${MAX_UNDER} node ids (got ${ids.length}).`, `Pass up to ${MAX_UNDER} subtree roots, or a common ancestor of them.`);
  return ids;
}

/** 400 for a feature that needs exactly one subtree root, given several. */
function singleRoot(param, detail) {
  return invalid(param, detail, 'Pass one under, or group by component.');
}

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
  const hasNotes = p.hasNotes === undefined ? [] : [...new Set(oneOf('hasNotes', csv(p.hasNotes), BOOLEANS))];
  return {
    states: states.includes('all') ? ['dirty', 'clean', 'blocked'] : [...new Set(states)],
    under: p.under === undefined ? null : parseUnder(p.under),
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
    library: p.library === undefined ? null : /** @type {'include' | 'exclude' | 'only'} */ (oneOf('library', [String(p.library).trim()], schemas.LIBRARY_MODES)[0]),
    hasNotes: hasNotes.length === 1 ? hasNotes[0] === 'true' : null,
  };
}

/**
 * Annotates `rows` with their open `notes` (newest first) — and, with
 * `resolved`, `notesResolved` (how many clears resolved) — from one batched
 * read; returns `rows`.
 *
 * @param {import('../store/types').Store} store
 */
async function withNotesOnly(store, fileKey, rows, { resolved = false } = {}) {
  const live = rows.filter(Boolean);
  if (!live.length) return rows;
  const ids = [...new Set(live.map(n => n.nodeId))];
  const byNode = new Map();
  const open = await store.listNotes(fileKey, ids, { status: 'open' });
  const shots = await attachmentsByOwner(store, fileKey, 'note', open.map(n => n.noteId));
  for (const note of /** @type {any[]} */ (open)) {
    note.attachments = shots.get(note.noteId) || [];
    if (!byNode.has(note.nodeId)) byNode.set(note.nodeId, []);
    byNode.get(note.nodeId).push(note);
  }
  const counts = resolved ? new Map((await store.noteCounts(fileKey, ids)).map(c => [c.nodeId, c.resolved])) : null;
  for (const n of live) {
    n.notes = byNode.get(n.nodeId) || [];
    if (counts) n.notesResolved = counts.get(n.nodeId) || 0;
  }
  return rows;
}

/** Sets an unset `filter.library` to the file's default: include library nodes when it tracks them, else exclude them. */
function applyLibraryDefault(filter, file) {
  if (filter.library === null) filter.library = fileSettings(file).trackLibraryComponents ? 'include' : 'exclude';
  return filter;
}

const COMPONENT_TYPES = ['COMPONENT', 'COMPONENT_SET'];

/**
 * Annotates the library rows of `rows` with `libraryRef` (`{ key, type,
 * fileKey, nodeId, resolved }`): the component key of their nearest
 * COMPONENT / COMPONENT_SET ancestor-or-self and, with a Figma token, where it
 * lives in the library file (library.js). One batched read for missing
 * ancestors; returns `rows`.
 *
 * @param {import('../store/types').Store} store
 * @param {import('../library').LibraryLinks | null | undefined} links
 */
async function withLibraryRefs(store, links, fileKey, rows) {
  const lib = rows.filter(n => n && n.library);
  if (!lib.length) return rows;
  const byId = new Map(rows.filter(Boolean).map(n => [n.nodeId, n]));
  const missing = [...new Set(lib.flatMap(n => pathNodeIds(n.path)))].filter(id => !byId.has(id));
  for (const n of missing.length ? await store.getNodes(fileKey, missing) : []) byId.set(n.nodeId, n);
  const ownerOf = n => {
    const ids = pathNodeIds(n.path);
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const a = byId.get(ids[i]);
      if (a && COMPONENT_TYPES.includes(a.nodeType) && a.attrs?.componentReference?.key) return a;
    }
    return null;
  };
  const owners = new Map(lib.map(n => [n.nodeId, ownerOf(n)]));
  const refs = [...owners.values()].filter(Boolean).map(o => ({ key: o.attrs.componentReference.key, type: o.nodeType }));
  const cached = links ? await links.lookup(refs) : new Map();
  for (const n of lib) {
    const owner = owners.get(n.nodeId);
    const key = owner ? owner.attrs.componentReference.key : null;
    const hit = key ? cached.get(key) : null;
    const resolved = !!(hit && !hit.error && hit.fileKey && hit.nodeId);
    n.libraryRef = { key, type: owner ? owner.nodeType : null, resolved, fileKey: resolved ? hit.fileKey : null, nodeId: resolved ? hit.nodeId : null };
  }
  return rows;
}

/** A variable token node (`token:<variableKey>`). */
const isVariableToken = n => !!n && typeof n.nodeId === 'string' && n.nodeId.startsWith('token:');

/**
 * Sets `usage: { layers }` on the variable token rows of `rows` — the live
 * layers whose `attrs.resolvedVariables` has an entry with the token's
 * variable key (`token:<variableKey>`), whichever imported id they bound —
 * from one store query; returns `rows`.
 * @param {import('../store/types').Store} store
 */
async function withUsage(store, fileKey, rows) {
  const tokens = rows.filter(isVariableToken);
  if (!tokens.length) return rows;
  const keyOf = n => n.nodeId.slice('token:'.length);
  const counts = new Map((await store.tokenUsage(fileKey, [...new Set(tokens.map(keyOf))])).map(u => [u.variableKey, u.layers]));
  for (const n of tokens) n.usage = { layers: counts.get(keyOf(n)) ?? 0 };
  return rows;
}

/** The `include=` values (comma-separated) among `allowed`. */
const parseInclude = (value, allowed) => (value === undefined ? [] : [...new Set(oneOf('include', csv(value), allowed))]);

/** A library node's or item's `library` field from its `libraryRef`. */
const libraryOut = ref => ({ key: ref ? ref.key ?? null : null, ...(ref && ref.resolved ? { fileKey: ref.fileKey } : {}), resolved: !!(ref && ref.resolved) });
/** The Figma link of a node: its own file's, or for a library node its library file's (null until resolved). */
const nodeUrl = (fileKey, n) => (core.isTokenNodeId(n.nodeId) ? null : !n.library ? core.link(fileKey, n.nodeId)
  : n.libraryRef && n.libraryRef.resolved ? core.link(n.libraryRef.fileKey, n.libraryRef.nodeId) : null);

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

/** The expansionEdges region key of scope root `i` (`''` for the first; mains use their node ids). */
const scopeKey = i => (i === 0 ? '' : `#${i}`);

/**
 * Orders the reachable mains (`expansionReach`) breadth-first: level by level,
 * each main after the region (a scope root — `scopeKey(i)` — or an earlier main)
 * holding its first instance, then by that instance's document order. Keeps the
 * first `limit`. `scopePaths` is the scope root path, or a list of them (one
 * null: the whole file). Returns `{ regions, vias, meta, scopes }`: the first
 * `scopes` regions are the scope roots' paths in order, then each synced
 * component's path; `vias[i]` annotates region i.
 */
function planExpansion(scopePaths, reach, edges, limit) {
  const scopes = Array.isArray(scopePaths) ? scopePaths : [scopePaths];
  const byMain = new Map();
  for (const e of edges) {
    if (!byMain.has(e.mainComponentId)) byMain.set(e.mainComponentId, []);
    byMain.get(e.mainComponentId).push(e);
  }
  const ordinal = new Map(scopes.map((_, i) => [scopeKey(i), i]));
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
    regions: [...scopes, ...components.map(c => c.path)],
    vias: [...scopes.map(() => null), ...components.map(c => c.via)],
    scopes: scopes.length,
    meta: {
      components: components.length,
      truncated,
      unresolved: kept.filter(c => !c.path).map(c => c.mainComponentId),
      ...(truncated ? { hint: `Expansion stopped at ${limit} components. Narrow the scope (under=<a smaller frame>) or lower expandDepth.` } : {}),
    },
  };
}

/** Merges the expansionReach of several scope roots: each main once, at its fewest hops from any root. */
function mergeReach(reaches) {
  const byMain = new Map();
  for (const r of reaches.flat()) {
    const seen = byMain.get(r.mainComponentId);
    if (!seen || r.depth < seen.depth) byMain.set(r.mainComponentId, r);
  }
  return [...byMain.values()];
}

/**
 * The expansion of a scope over instance → main edges, starting from every root
 * of `scopeNodes` (a node or a list of nodes, in order; null or empty: the whole
 * file); see planExpansion.
 */
async function expandScope(store, fileKey, scopeNodes, expand) {
  const nodes = scopeNodes === null ? [] : Array.isArray(scopeNodes) ? scopeNodes : [scopeNodes];
  const scopes = nodes.length ? nodes.map(n => n.path) : [null];
  const reach = scopes.length === 1
    ? await store.expansionReach(fileKey, { scope: scopes[0], maxDepth: expand.depth })
    : mergeReach(await Promise.all(scopes.map(scope => store.expansionReach(fileKey, { scope, maxDepth: expand.depth }))));
  const edges = reach.length
    ? await store.expansionEdges(fileKey, {
      regions: [...scopes.map((path, i) => ({ key: scopeKey(i), path, depth: 0 })), ...reach.filter(r => r.path).map(r => ({ key: r.mainComponentId, path: r.path, depth: r.depth }))],
      mains: reach.map(r => ({ mainComponentId: r.mainComponentId, depth: r.depth })),
    })
    : [];
  return planExpansion(scopes, reach, edges, schemas.EXPANSION_LIMIT);
}

/**
 * The stored nodes for the `under` ids (in order, each once), or a
 * node_not_found problem naming the first unknown id. `find(fileKey, raw)` is
 * the route's single-id lookup.
 */
async function resolveUnder(fileKey, ids, find) {
  const out = [];
  for (const raw of ids) {
    const node = await find(fileKey, raw);
    if (!out.some(n => n.nodeId === node.nodeId)) out.push(node);
  }
  return out;
}

// --- cursors -----------------------------------------------------------------
/** A fingerprint of the query a cursor belongs to (filter without the clock, and sort). */
function queryFingerprint(filter, sort) {
  const { now, ...rest } = filter;
  if (Array.isArray(rest.under) && rest.under.length === 1) rest.under = rest.under[0];
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
async function outlineNodes(store, fileKey, rows, expansion, at, sort, roots = []) {
  // Store regions: the scope roots (0 … scopes - 1), then the components. Outline regions: 0 = every scope root, then the components.
  const scopes = expansion ? expansion.scopes ?? 1 : Math.max(roots.length, 1);
  const rootOrd = n => roots.findIndex(r => n.path && isDescendant(n.path, r.path));
  const regionOf = ord => (ord < scopes ? 0 : ord - scopes + 1);
  const viaOf = region => expansion.vias[region + scopes - 1];
  const keyOf = n => (sort === 'path' ? n.path : documentSortKey(n));
  const rootKey = (ord, key) => (scopes > 1 && ord < scopes ? `${String(ord).padStart(4, '0')} ${key}` : key);
  const out = rows.map(n => {
    const ord = expansion ? n.expandOrd ?? 0 : scopes > 1 ? Math.max(rootOrd(n), 0) : 0;
    return { node: nodeFields(fileKey, n, at, 'names'), path: n.path, key: rootKey(ord, keyOf(n)), absolute: isAbsolute(n), region: regionOf(ord) };
  });
  const byId = new Map(rows.map(n => [n.nodeId, n]));
  const hostIds = expansion ? [...new Set(out.filter(r => r.region > 0).map(r => viaOf(r.region).instanceId))] : [];
  const mainIds = [...new Set(out.map(r => r.node.mainComponentId).filter(Boolean))];
  const missing = [...new Set([...hostIds, ...mainIds])].filter(id => !byId.has(id));
  for (const n of missing.length ? await store.getNodes(fileKey, missing) : []) byId.set(n.nodeId, n);
  const attach = new Map();
  for (const r of new Set(out.map(o => o.region))) {
    if (r === 0) continue;
    const via = viaOf(r);
    const host = byId.get(via.instanceId);
    const hostPath = host ? host.path : null;
    const hostOrd = hostPath ? expansion.regions.findIndex(p => p !== null && isDescendant(hostPath, p)) : -1;
    attach.set(r, { mainId: via.mainComponentId, hostId: via.instanceId, hostPath, hostKey: host ? rootKey(hostOrd, keyOf(host)) : null, hostRegion: hostOrd < 0 ? null : regionOf(hostOrd) });
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
    figmaUrl: nodeUrl(fileKey, n),
    library: n.library ? libraryOut(n.libraryRef) : null,
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
  if (n.notes) {
    out.notes = n.notes.map(note => ({
      noteId: note.noteId, body: note.body, author: note.author, createdAt: note.createdAt,
      ...(note.source && note.source !== 'user' ? { source: note.source } : {}),
      ...(note.attachments && note.attachments.length ? { attachments: note.attachments } : {}),
    }));
  }
  if (n.notesResolved !== undefined) out.notesResolved = n.notesResolved;
  if (n.screen) out.screen = n.screen;
  if (n.descendants) out.descendants = n.descendants;
  if (n.usage) out.usage = n.usage;
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

/** A scope's name and type; the design-tokens scope reads as "Design tokens" (TOKENS) even before its root row is stored. */
const scopeIdentity = s => (s.nodeId === core.TOKENS_ROOT_ID
  ? { name: s.name ?? TOKENS_SCOPE_NAME, type: s.nodeType ?? TOKENS_TYPE }
  : { name: s.name, type: s.nodeType });
const withClean = c => ({ total: c.total, dirty: c.dirty, clean: c.total - c.dirty - c.blocked, blocked: c.blocked });
const fileOut = f => ({ fileKey: f.fileKey, name: f.name ?? null, lastSyncAt: f.lastSyncAt ?? null, createdAt: f.createdAt ?? null, settings: fileSettings(f), counts: withClean(f.counts) });

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerReadRoutes(app, { store, now, libraryLinks = null }) {
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
    const kinds = new Map((await store.listScopeKinds(fileKey)).map(k => [k.nodeId, k.kind]));
    return {
      fileKey,
      scopes: scopes.map(s => ({
        nodeId: s.nodeId, ...scopeIdentity(s), deleted: s.deleted, figmaUrl: core.isTokenNodeId(s.nodeId) ? null : core.link(fileKey, s.nodeId),
        lastSyncAt: s.lastSyncAt, lastSyncCounts: s.lastSyncCounts, counts: withClean(s.counts), kind: kinds.get(s.nodeId) || 'none',
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
    const include = parseInclude(query.include, schemas.LISTING_INCLUDES);
    const counts = include.includes('counts') || (fields !== null && fields.includes('descendants'));
    const usage = include.includes('usage') || (fields !== null && fields.includes('usage'));
    const { sort, desc } = parseSort(query.sort);
    if (fmt === 'outline' && ((sort !== 'document' && sort !== 'path') || desc)) {
      throw invalid('sort', 'format=outline is always in tree order.', 'Drop sort (or use sort=document or sort=path) with format=outline.');
    }
    const outline = fmt === 'outline';
    const limit = outline ? format.STREAM_PAGE : format.pageSize(fmt, query.limit, schemas.DEFAULT_LIMIT);
    const fp = queryFingerprint(filter, { sort, desc, fields, view, counts, changes, ...(usage ? { usage } : {}), ...(expand ? { expand } : {}), ...(outline ? { format: fmt } : {}) });
    const pos = decodeOutlineCursor(outline ? query.cursor : undefined, fp);
    const after = outline ? pos.after : query.cursor === undefined ? null : decodeCursor(query.cursor, fp);

    applyLibraryDefault(filter, await trackedFile(fileKey));
    const underNodes = filter.under === null ? null : await resolveUnder(fileKey, filter.under, findNode);
    if (underNodes) filter.under = underNodes.map(n => n.nodeId);
    const expansion = expand ? await expandScope(store, fileKey, underNodes, expand) : null;
    if (expansion) filter.regions = expansion.regions;

    const list = async options => {
      const r = await store.listNodes(fileKey, filter, options);
      await withLibraryRefs(store, libraryLinks, fileKey, r.nodes);
      await withNotes(store, fileKey, r.nodes);
      if (usage) await withUsage(store, fileKey, r.nodes);
      return r;
    };
    const result = await list({ sort, desc, limit, after, counts });
    const base = view === 'full' ? schemas.FULL_FIELDS : schemas.COMPACT_FIELDS;
    const keys = fields ?? (expansion ? [...base, 'via'] : base);
    const withCounts = counts && !keys.includes('descendants') ? [...keys, 'descendants'] : keys;
    const shown = usage && !withCounts.includes('usage') ? [...withCounts, 'usage'] : withCounts;
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
        const r = await list({ sort, desc, limit: Math.min(format.OUTLINE_LINES - rows.length, format.STREAM_PAGE), after: next, counts });
        rows.push(...r.nodes);
        next = r.next;
      }
      const shownTo = pos.offset + rows.length;
      return format.sendOutline(reply, await outlineNodes(store, fileKey, rows, expansion, at, sort, expansion ? [] : underNodes || []), {
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
        fetch: async next => { const r = await list({ sort, desc, limit, after: next, counts }); return { rows: r.nodes, next: r.next }; },
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
    await withLibraryRefs(store, libraryLinks, fileKey, [node]);
    await withNotes(store, fileKey, [node], { resolved: true });
    await withUsage(store, fileKey, [node]);
    const all = { fileKey, ...nodeFields(fileKey, node, nowIso(), changes) };
    return fields ? pick(all, ['fileKey', ...fields]) : pick(all, ['fileKey', ...schemas.DETAIL_FIELDS, 'descendants', 'usage']);
  });

  app.get('/resolve', { schema: schemas.resolve }, async (/** @type {import('./types').V3Request<'/v3/resolve', 'get'>} */ request) => address.parseUrl(request.query.url));
}

module.exports = {
  registerReadRoutes, parseQ, filterParams, buildFilter, applyLibraryDefault, withLibraryRefs, withNotes, withUsage, parseInclude, isVariableToken, libraryOut, nodeUrl, parseChanges, nodeFields, truncateChanges, pick, FILTER_KEYS, MAX_UNDER,
  singleRoot, resolveUnder, mergeReach, queryFingerprint, encodeCursor, decodeCursor, encodeOutlineCursor, decodeOutlineCursor, offsetAfter, parseExpand, planExpansion, expandScope, isAbsolute,
};
