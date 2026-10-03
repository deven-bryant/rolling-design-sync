'use strict';

/*
 * v3 insights (docs/api-v3-phase2.md, "2. Summaries and work items"): counts of
 * the nodes a listing filter matches, and those nodes bundled into work items
 * by component or by frame. Both take every listing filter (default
 * `state=dirty`) and aggregate in the store.
 */
const { problem } = require('./problem');
const address = require('./address');
const schemas = require('./schemas');
const format = require('./format');
const {
  filterParams, buildFilter, parseChanges, nodeFields, truncateChanges, queryFingerprint, encodeCursor, decodeCursor, encodeOutlineCursor, decodeOutlineCursor, offsetAfter, FILTER_KEYS,
  parseExpand, expandScope, isAbsolute,
} = require('./read');

const GROUPS = ['component', 'frame', 'set'];
/** `nodeIds` of a work item holds at most this many ids; `more` counts the rest. */
const MAX_ITEM_NODE_IDS = 50;

// --- schemas -------------------------------------------------------------------
const { security, tags } = schemas.listNodes;
const { agentOp } = schemas;
const listQuery = schemas.listNodes.querystring.properties;
const filterQuery = Object.fromEntries([...FILTER_KEYS, 'q', 'url'].map(k => [k, listQuery[k]]));
const { expansion } = schemas;
const problems = Object.fromEntries([400, 401, 403, 404].map(s => [s, { ...schemas.getFile.response[404] }]));
const counts = keys => ({ type: 'object', properties: Object.fromEntries(keys.map(k => [k, { type: 'integer' }])) });
const countMap = description => ({ type: 'object', additionalProperties: { type: 'integer' }, description });
const nullableString = { type: ['string', 'null'] };

const summary = {
  summary: 'Summarize changes',
  description: 'Counts of the nodes the `list_nodes` filters match (default: dirty) by state, change type, change category and node type — a cheap overview before listing or planning work. With `under` (e.g. a page), `byFrame` also counts per child frame of it. '
    + 'With `expand=instances` the counts cover everything the scope uses — its nodes plus the main components its instances reach, transitively (`byFrame` still counts only nodes under `under`): how big is this screen, components included? Returns no nodes; use `list_nodes` or `list_work_items` for those.',
  tags, security,
  ...agentOp('summarize', 'summary'),
  params: schemas.getFile.params,
  querystring: { type: 'object', properties: { ...filterQuery, ...schemas.expandQuery } },
  response: {
    200: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        total: { type: 'integer' },
        byState: counts(['dirty', 'clean', 'blocked']),
        byChangeType: { ...counts(schemas.CHANGE_TYPES), description: 'Dirty nodes only.' },
        byCategory: { ...counts(schemas.CATEGORIES), description: 'A node counts once per change category it has.' },
        byType: countMap('Node type → count.'),
        byFrame: {
          type: 'array',
          items: { type: 'object', properties: { nodeId: { type: 'string' }, name: nullableString, count: { type: 'integer' } } },
        },
        expansion,
      },
    },
    ...problems,
  },
};

const workItem = {
  type: 'object',
  properties: {
    key: { ...nullableString, description: 'The component or frame node id; with group=set, the Figma set key (id when no key is available). Standalone components retain their node id; null for nodes with none.' },
    name: nullableString,
    type: nullableString,
    set: schemas.componentSet,
    variants: {
      type: 'array', description: 'group=set only, when a set is known: its matching variants in document order. Counts cover the filtered nodes of each variant, not placements; the set root itself is not a variant.',
      items: { type: 'object', properties: { key: { type: 'string', description: 'Figma component key (node id when unavailable).' }, name: nullableString, nodeCount: { type: 'integer' } } },
    },
    nodeCount: { type: 'integer' },
    categories: { type: 'array', items: { type: 'string' } },
    changedProps: { type: 'array', items: { type: 'string' } },
    changes: {
      type: 'object', additionalProperties: true,
      description: '`{ nodeId: { prop: { built, now, category } } }` for the listed `nodeIds` (per `changes=`: by default modified and deleted nodes only; absent with `changes=names`). A side over 1 KB is `{ truncated: true, bytes }`; `get_node` returns it whole.',
    },
    placements: { type: ['integer', 'null'], description: 'group=component: instance rows whose mainComponentId is the key.' },
    placementsInScope: {
      type: ['integer', 'null'],
      description: 'group=component with expand=instances: the instances of the key reached from the scope (inside `under` or inside the expanded components) — how often this screen uses it.',
    },
    nodeIds: { type: 'array', items: { type: 'string' }, description: `The item's first ${MAX_ITEM_NODE_IDS} node ids, in document order (the design's layer order).` },
    more: { type: 'integer', description: 'How many node ids `nodeIds` leaves out.' },
    progress: {
      type: 'object', description: 'Present with include=progress: counts across all states for this item, independent of state=; other listing filters still apply. Cleared tombstones are excluded.',
      properties: { total: { type: 'integer' }, clean: { type: 'integer' } },
    },
  },
};

const work = format.withFormat({
  summary: 'List work items',
  description: [
    'The nodes the `list_nodes` filters match (default: dirty) bundled into work items — the best way to plan: fix a component once and its instances follow. Items are in document order (the design\'s layer order, by each item\'s key node), paged by `cursor`; each has its node ids (`claim_nodes` takes them), changed properties and categories.',
    '`group=component` (default): by the nearest COMPONENT / COMPONENT_SET ancestor-or-self; nodes with none form one item with `key: null`, listed last.',
    '`group=set`: merge variants of each known component set into one item named like the Figma set, with its Figma key, set reference and variants [{ key, name, nodeCount }]. Use this to build a design system. Standalone components and variants whose set is unavailable keep their component item; the default grouping is unchanged.',
    '`group=frame`: by the ancestor one level below `under` (required); the `under` node itself is in the `key: null` item.',
    '`include=progress` adds { total, clean } for each returned item across all states, independent of state= and the nodeIds cap. Use clean / total for a progress bar.',
    '`expand=instances` answers "which components do I need to build for this screen, and how often does it use each?": with `under` = the screen, items also cover every main component its instances reach (transitively, each once; filters apply after expansion), and with `group=component` each item has `placementsInScope` beside the file-wide `placements`. '
      + 'Nodes of expanded components that are outside `under` fall in the `key: null` item with `group=frame`.',
    'Each item\'s `changes` maps its listed node ids to their diffs (`changes=auto`: modified and deleted nodes; `diff`: added ones too; `names`: none — `changedProps` only). Values over 1 KB are `{ truncated: true, bytes }` and the page has `truncated: true`; `get_node` returns them whole.',
  ].join(' '),
  tags, security,
  ...agentOp('list_work_items', 'work'),
  params: schemas.getFile.params,
  querystring: {
    type: 'object',
    properties: {
      ...filterQuery,
      ...schemas.expandQuery,
      group: { type: 'string', enum: GROUPS, description: 'component (default): by nearest component; set: merge all matching variants of a known component set (best for design systems); frame: by child frame of `under` (needs `under`).' },
      changes: {
        ...listQuery.changes,
        description: 'auto (default): each item\'s `changes` has the diffs of its modified and deleted nodes; diff: of every listed node, added ones included (their full values); names: no `changes`, only `changedProps`.',
      },
      limit: { ...listQuery.limit, description: `Items per page (default ${schemas.DEFAULT_LIMIT}, max ${schemas.MAX_LIMIT}).` },
      cursor: listQuery.cursor,
      include: { type: 'string', enum: ['progress'], description: 'progress: add total and clean node counts across all states for each work item.' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        group: { type: 'string', enum: GROUPS },
        items: { type: 'array', items: workItem },
        nextCursor: nullableString,
        total: { type: 'integer', description: 'Items across all pages.' },
        truncated: { type: 'boolean', description: 'Present (true) when a change value on this page was replaced by `{ truncated: true, bytes }`.' },
        expansion,
      },
    },
    ...problems,
  },
}, { outline: 'item' });

// --- representation ------------------------------------------------------------
const itemOut = (group, expanded) => i => ({
  key: i.keyId,
  name: i.name,
  type: i.type,
  ...(i.set ? { set: i.set } : {}),
  ...(i.variants ? { variants: i.variants } : {}),
  nodeCount: i.nodeCount,
  categories: i.categories,
  changedProps: i.changedProps,
  ...(i.changes ? { changes: i.changes } : {}),
  ...(i.progress ? { progress: i.progress } : {}),
  ...(group === 'component' ? { placements: i.placements } : {}),
  ...(group === 'component' && expanded ? { placementsInScope: i.placementsInScope } : {}),
  nodeIds: i.nodeIds,
  more: i.nodeCount - i.nodeIds.length,
});

const zeros = keys => Object.fromEntries(keys.map(k => [k, 0]));
const sortedKeys = obj => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerInsightRoutes(app, { store, now }) {
  async function trackedFile(fileKey) {
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
  }

  async function findNode(fileKey, raw) {
    for (const id of address.nodeIdCandidates(raw)) {
      const node = await store.getNodeV3(fileKey, id);
      if (node) return node;
    }
    throw address.nodeNotFound(fileKey, raw);
  }

  /** `{ fileKey, filter }` from the listing parameters (and ?url=), as the listing reads them. */
  function parseFilter(request) {
    const { query } = request;
    const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, query.url);
    const params = filterParams(query);
    if (params.under === undefined && urlNodeId) params.under = urlNodeId;
    const filter = buildFilter(params, now().toISOString());
    return { fileKey, filter, expand: parseExpand(query, filter) };
  }

  /** Resolves `under` to a stored node id and, with `expand`, sets `filter.regions`; returns the expansion (or null). */
  async function resolveScope(fileKey, filter, expand) {
    await trackedFile(fileKey);
    const underNode = filter.under === null ? null : await findNode(fileKey, filter.under);
    if (underNode) filter.under = underNode.nodeId;
    if (!expand) return null;
    const expansion = await expandScope(store, fileKey, underNode, expand);
    filter.regions = expansion.regions;
    return expansion;
  }

  app.get('/files/:fileKey/summary', { schema: summary }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/summary', 'get'>} */ request) => {
    const { fileKey, filter, expand } = parseFilter(request);
    const expansion = await resolveScope(fileKey, filter, expand);
    const s = await store.summarizeNodes(fileKey, filter);
    return {
      fileKey,
      total: s.total,
      byState: { ...zeros(['dirty', 'clean', 'blocked']), ...s.byState },
      byChangeType: { ...zeros(schemas.CHANGE_TYPES), ...s.byChangeType },
      byCategory: { ...zeros(schemas.CATEGORIES), ...s.byCategory },
      byType: sortedKeys(s.byType),
      ...(filter.under !== null ? { byFrame: s.byFrame || [] } : {}),
      ...(expansion ? { expansion: expansion.meta } : {}),
    };
  });

  /**
   * Work items as format=outline: each item's line, then its listed nodes as a
   * tree; whole items from the cursor's, as many as fit in OUTLINE_LINES lines
   * (at least one), rendered once and paged by `limit` lines.
   */
  async function outlineWork(reply, { fileKey, filter, group, pos, fp, limit, toItem, lineLimit, progress }) {
    const at = now().toISOString();
    const lines = [];
    let shown = 0, last = null, page = await store.listWorkItems(fileKey, filter, { group, limit, after: pos.after, maxIds: MAX_ITEM_NODE_IDS, progress });
    const { total } = page;
    let full = false;
    for (;;) {
      const rows = new Map((await store.getNodes(fileKey, [...new Set(page.items.flatMap(i => i.nodeIds))])).map(n => [n.nodeId, n]));
      const mainIds = [...new Set([...rows.values()].map(n => n.mainComponentId).filter(id => id && !rows.has(id)))];
      const mains = new Map([...rows.values(), ...(mainIds.length ? await store.getNodes(fileKey, mainIds) : [])].map(n => [n.nodeId, n.name]));
      for (const raw of page.items) {
        const item = toItem(raw);
        const nodes = item.nodeIds.filter(id => rows.has(id)).map(id => ({ node: nodeFields(fileKey, rows.get(id), at, 'names'), path: rows.get(id).path, absolute: isAbsolute(rows.get(id)), region: 0 }));
        const itemLines = [format.itemOutline(group, item), ...format.outlineTree(nodes, { base: 1, mainNames: mains })];
        if (shown && lines.length + itemLines.length > format.OUTLINE_LINES) { full = true; break; }
        lines.push(...itemLines);
        shown++;
        last = raw;
      }
      if (full || !page.next) break;
      page = await store.listWorkItems(fileKey, filter, { group, limit, after: page.next, maxIds: MAX_ITEM_NODE_IDS, progress });
    }
    const shownTo = pos.offset + shown;
    const next = full ? { k: last.k, id: last.keyId ?? '' } : null;
    return format.sendOutline(reply, lines, {
      from: pos.line,
      limit: lineLimit,
      cursorAt: line => encodeOutlineCursor(fp, { after: pos.after, offset: pos.offset, line }),
      more: full ? Math.max(total - shownTo, 1) : 0,
      moreCursor: next ? encodeOutlineCursor(fp, { after: next, offset: shownTo }) : null,
      unit: 'items',
      total,
    });
  }

  app.get('/files/:fileKey/work', { schema: work }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/work', 'get'>} */ request, reply) => {
    const { query } = request;
    const fmt = query.format ?? 'json';
    const group = query.group ?? 'component';
    const { fileKey, filter, expand } = parseFilter(request);
    if (group === 'frame' && filter.under === null) {
      throw problem('invalid_parameter', "group: 'frame' needs under.", {
        hint: 'Pass under=<nodeId> (e.g. a page or section, or a ?url= link to it): its children are the frames. Or use group=component.',
      });
    }
    const changes = parseChanges(query.changes, 'auto');
    const progress = query.include === 'progress';
    const outline = fmt === 'outline';
    const fp = queryFingerprint(filter, { route: 'work', group, changes, ...(progress ? { include: 'progress' } : {}), ...(expand ? { expand } : {}), ...(outline ? { format: fmt } : {}) });
    const pos = outline ? decodeOutlineCursor(query.cursor, fp) : null;
    const after = outline ? pos.after : query.cursor === undefined ? null : decodeCursor(query.cursor, fp);
    const expansion = await resolveScope(fileKey, filter, expand);

    const limit = outline ? format.STREAM_PAGE : format.pageSize(fmt, query.limit, schemas.DEFAULT_LIMIT);
    let truncated = false;
    /** Adds each item's `changes` (`{ nodeId: diff }` for its listed dirty nodes) from one batched read per page. */
    async function withChanges(items) {
      if (changes === 'names') return items;
      const rows = await store.getNodes(fileKey, [...new Set(items.flatMap(i => i.nodeIds))]);
      const at = now().toISOString();
      const diffs = new Map();
      for (const row of rows) {
        const n = nodeFields(fileKey, row, at, changes);
        if (n.changeType === null || n.changes === undefined) continue;
        const cut = truncateChanges(n);
        truncated = truncated || cut.truncated;
        diffs.set(n.nodeId, cut.node.changes);
      }
      return items.map(i => ({ ...i, changes: Object.fromEntries(i.nodeIds.filter(id => diffs.has(id)).map(id => [id, diffs.get(id)])) }));
    }
    const read = async next => {
      const r = await store.listWorkItems(fileKey, filter, { group, limit, after: next, maxIds: MAX_ITEM_NODE_IDS, progress });
      return { ...r, items: await withChanges(r.items) };
    };
    const toItem = itemOut(group, !!expansion);
    if (outline) return outlineWork(reply, { fileKey, filter, group, pos, fp, limit, toItem, lineLimit: query.limit ?? null, progress });
    const result = await read(after);
    if (fmt !== 'json') {
      return format.stream(reply, fmt, {
        first: { rows: result.items, next: result.next },
        fetch: async next => { const r = await read(next); return { rows: r.items, next: r.next }; },
        cap: query.limit ?? null,
        total: result.total,
        toObject: toItem,
        toLine: i => format.itemLine(fileKey, group, toItem(i)),
      });
    }
    return {
      fileKey,
      group,
      items: result.items.map(toItem),
      nextCursor: result.next ? encodeCursor(result.next, fp, offsetAfter(after, result.items.length)) : null,
      total: result.total,
      ...(truncated ? { truncated } : {}),
      ...(expansion ? { expansion: expansion.meta } : {}),
    };
  });
}

module.exports = { registerInsightRoutes, MAX_ITEM_NODE_IDS, GROUPS };
