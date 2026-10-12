'use strict';

/*
 * v3 insights (docs/api-v3-phase2.md, "2. Summaries and work items"): counts of
 * the nodes a listing filter matches, and those nodes bundled into work items
 * by component or by frame. Both take every listing filter (default
 * `state=dirty`) and aggregate in the store. Trends aggregate the event log:
 * nodes cleared and newly dirtied per window, across files.
 */
const { problem } = require('./problem');
const address = require('./address');
const schemas = require('./schemas');
const format = require('./format');
const {
  filterParams, buildFilter, parseChanges, nodeFields, truncateChanges, queryFingerprint, encodeCursor, decodeCursor, encodeOutlineCursor, decodeOutlineCursor, offsetAfter, FILTER_KEYS,
  parseExpand, expandScope, isAbsolute, resolveUnder, singleRoot, applyLibraryDefault, withLibraryRefs, libraryOut, nodeUrl,
  withUsage, parseInclude, isVariableToken,
} = require('./read');
const { documentSortKey } = require('../documentOrder');

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
  description: 'Counts of the nodes the `list_nodes` filters match (default: dirty) by state, change type, change category and node type — a cheap overview before listing or planning work. With one `under` (e.g. a page), `byFrame` also counts per child frame of it (not with several `under` ids). '
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

const MAX_TREND_DAYS = 14;
const DEFAULT_TREND_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const trendCounts = {
  cleared: { type: 'integer', description: 'Nodes cleared in the window [from, to).' },
  clearedPrevious: { type: 'integer', description: 'Nodes cleared in the window before it [from − windowDays, from).' },
  clearedChangePct: { type: ['integer', 'null'], description: 'round((cleared − clearedPrevious) / clearedPrevious × 100); null when clearedPrevious is 0.' },
  dirtied: { type: 'integer', description: 'Nodes newly marked dirty by syncs in [from, to): new, changed while clean, or deleted while clean.' },
  netDirty: { type: 'integer', description: 'dirtied − cleared: positive when the backlog grew.' },
};
const trends = {
  summary: 'Weekly trends',
  description: 'How fast the backlog moves: nodes cleared and nodes newly dirtied by syncs in the last `windowDays` days (default 7) and the change in clears vs the window before, for the whole server (`total`) and each tracked file (`files`); `fileKey` narrows both to one file. '
    + 'Counts come from the event log, so `complete` is false when RDS_EVENT_RETENTION_DAYS (`retentionDays`) keeps less than two windows — `clearedPrevious` and `clearedChangePct` may then undercount. Returns no nodes.',
  tags, security,
  ...agentOp('get_trends', 'trends'),
  querystring: {
    type: 'object',
    properties: {
      windowDays: { type: 'integer', minimum: 1, maximum: MAX_TREND_DAYS, default: DEFAULT_TREND_DAYS, description: `Window length in days, 1–${MAX_TREND_DAYS} (default ${DEFAULT_TREND_DAYS}).` },
      fileKey: { type: 'string', minLength: 1, description: 'Only this tracked file (file_not_found otherwise).' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        windowDays: { type: 'integer' },
        from: { type: 'string', format: 'date-time', description: 'Window start (inclusive): to − windowDays.' },
        to: { type: 'string', format: 'date-time', description: 'Window end (exclusive): now.' },
        complete: { type: 'boolean', description: 'False when event retention is shorter than 2 × windowDays.' },
        retentionDays: { type: 'integer' },
        total: { type: 'object', properties: trendCounts },
        files: {
          type: 'array',
          items: { type: 'object', properties: { fileKey: { type: 'string' }, fileName: nullableString, ...trendCounts } },
        },
      },
    },
    ...problems,
  },
};

const removedUse = {
  type: 'object',
  properties: {
    componentId: { type: 'string', description: 'The main component\'s node id.' },
    name: { ...nullableString, description: 'The main component\'s name; null when it was never synced.' },
    set: schemas.componentSet,
    remote: { type: 'boolean', description: 'True for a library (remote) main component, when captured.' },
    placementsRemoved: { type: 'integer', description: 'Instance rows of it inside the removed subtree.' },
    livePlacements: { type: 'integer', description: 'Live (not tombstoned) instance rows of it anywhere in the file. 0: nothing in the design uses it any more.' },
  },
};
const removedWarning = {
  type: 'object',
  properties: {
    code: { type: 'string', enum: ['main_removed_with_live_placements'], description: 'main_removed_with_live_placements: a main component inside the removed subtree still has live instances elsewhere — keep its code.' },
    componentId: { type: 'string' },
    livePlacements: { type: 'integer' },
  },
};

/** `include=` values of the work items (comma-separated). */
const WORK_INCLUDES = ['progress', 'usage'];

const workItem = {
  type: 'object',
  properties: {
    kind: {
      type: 'string', enum: ['removed', 'library', 'tokens'],
      description: '`removed`: design deleted in Figma that was built — one item per removed root (the topmost tombstoned node; key = its id), listing the components it used (`uses`). '
        + '`library`: a reference item — a library (remote) main component the scope uses while the file does not track library components (`expand=instances`, group=component or set): `tracked: false`, `nodeCount: 0`, no `nodeIds`, no `progress`, with `placements` / `placementsInScope`. Use the library component as is; there is nothing to build or clear. '
        + '`tokens`: design tokens of one collection (key = the collection node id `tokens:<collectionKey>`, name = the collection name; the `tokens` root\'s own changes have key `tokens`): for each changed `value:<Mode>` update the code variable named by the token\'s `codeSyntax` (WEB, else the token name) in that mode, then clear the tokens. Absent on other component, set and frame items.',
    },
    tracked: { type: 'boolean', description: 'Reference (`kind: "library"`) items only: false — the library component is not tracked in this file.' },
    library: { ...schemas.library, description: 'Items whose component is a library (remote) component: `{ key, fileKey?, resolved }` as on nodes. Absent on other items.' },
    figmaUrl: { type: ['string', 'null'], description: 'Library items only: the component in its library file, or null while unresolved.' },
    key: { ...nullableString, description: 'The component or frame node id; with group=set, the Figma set key (id when no key is available). Standalone components retain their node id; removed items: the removed root\'s id; null for nodes with none.' },
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
    uses: {
      type: 'array', items: removedUse,
      description: 'Removed items only: the main components referenced by instances inside the removed subtree, those with `livePlacements: 0` first (then by name). Keep the code of components with livePlacements > 0; consider removing those with 0.',
    },
    warnings: {
      type: 'array', items: removedWarning,
      description: 'Removed items only (empty when none): main components removed with the design while other instances of them are still live.',
    },
    usage: {
      type: 'object', additionalProperties: { type: 'object', properties: { layers: { type: 'integer' } } },
      description: 'Token items with `include=usage`: `{ nodeId: { layers } }` for the listed tokens — how many live layers use each.',
    },
    nodeIds: { type: 'array', items: { type: 'string' }, description: `The item's first ${MAX_ITEM_NODE_IDS} node ids, in document order (the design's layer order; a removed item's root first).` },
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
    'Removed design (group=component and group=set): deleted nodes that were built are grouped under their removed root — the topmost deleted node — into one `kind: "removed"` item (after the component items, before `key: null`, in the roots\' document order), unless that root sits inside a live component (then they are part of that component\'s item). '
      + 'For a removed item: remove the code that rendered the root; keep components in `uses` with `livePlacements > 0` (still used elsewhere), consider removing those with 0; heed `warnings`; then clear the root with `subtree: true` (`clear_nodes`) — one item clears the whole removed subtree. Deleted nodes that were never built are not work (they resolve at sync).',
    'Design tokens (group=component and group=set): the dirty tokens of each collection form one `kind: "tokens"` item (key = the collection node id, after the component and removed items, before `key: null`). For each token, update the code variable named by its `codeSyntax` (WEB, else the token name) for every changed `value:<Mode>`, then clear it. `include=usage` adds how many layers use each token.',
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
      group: { type: 'string', enum: GROUPS, description: 'component (default): by nearest component; set: merge all matching variants of a known component set (best for design systems); frame: by child frame of `under` (needs exactly one `under`).' },
      changes: {
        ...listQuery.changes,
        description: 'auto (default): each item\'s `changes` has the diffs of its modified and deleted nodes; diff: of every listed node, added ones included (their full values); names: no `changes`, only `changedProps`.',
      },
      limit: { ...listQuery.limit, description: `Items per page (default ${schemas.DEFAULT_LIMIT}, max ${schemas.MAX_LIMIT}).` },
      cursor: listQuery.cursor,
      include: { type: 'string', description: `Comma-separated: ${WORK_INCLUDES.join(', ')}. progress: add total and clean node counts across all states for each work item; usage: add \`usage: { nodeId: { layers } }\` to token items.` },
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
  ...(i.kind ? { kind: i.kind } : {}),
  ...(i.kind === 'library' ? { tracked: false } : {}),
  ...(i.libraryRef ? { library: libraryOut(i.libraryRef), figmaUrl: i.libraryRef.resolved ? nodeUrl('', { library: true, libraryRef: i.libraryRef }) : null } : {}),
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
  ...(group === 'component' && (!i.kind || i.kind === 'library') ? { placements: i.placements } : {}),
  ...(group === 'component' && (!i.kind || i.kind === 'library') && expanded ? { placementsInScope: i.placementsInScope } : {}),
  ...(i.kind === 'removed' ? { uses: i.uses, warnings: i.warnings } : {}),
  ...(i.usage ? { usage: i.usage } : {}),
  ...(i.kind === 'library' ? {} : { nodeIds: i.nodeIds, more: i.nodeCount - i.nodeIds.length }),
});

const byK = (a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);

const zeros = keys => Object.fromEntries(keys.map(k => [k, 0]));
const sortedKeys = obj => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));

/** The trend fields of `{ cleared, clearedPrevious, dirtied }`. */
const trendOf = ({ cleared, clearedPrevious, dirtied }) => ({
  cleared,
  clearedPrevious,
  clearedChangePct: clearedPrevious ? Math.round(((cleared - clearedPrevious) / clearedPrevious) * 100) : null,
  dirtied,
  netDirty: dirtied - cleared,
});

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerInsightRoutes(app, { store, now, config, libraryLinks = null }) {
  async function trackedFile(fileKey) {
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
    return file;
  }

  /**
   * Reference items (`kind: "library"`): with `expand=instances` while library
   * nodes are excluded, each library main component the expansion reached —
   * by set with group=set — with its placements and no nodes.
   */
  async function libraryRefItems(fileKey, filter, group, expansion) {
    if (!expansion || filter.library !== 'exclude' || group === 'frame') return [];
    const mainIds = [...new Set(expansion.vias.slice(expansion.scopes).map(v => v && v.mainComponentId).filter(Boolean))];
    const mains = mainIds.length ? (await store.getNodes(fileKey, mainIds)).filter(n => n.library && n.path) : [];
    if (!mains.length) return [];
    await withLibraryRefs(store, libraryLinks, fileKey, mains);
    const counts = new Map((await store.placementCounts(fileKey, mains.map(m => m.nodeId), filter.regions ?? null)).map(c => [c.mainComponentId, c]));
    const base = { nodeCount: 0, categories: [], changedProps: [], nodeIds: [], kind: 'library' };
    if (group === 'component') {
      return mains.map(m => {
        const set = m.attrs?.componentReference?.set;
        const c = counts.get(m.nodeId);
        return {
          ...base, k: `${documentSortKey(m)} ${m.path}`, keyId: m.nodeId, name: m.name ?? null, type: m.nodeType ?? null, ...(set ? { set } : {}),
          libraryRef: m.libraryRef, placements: c ? c.placements : 0, placementsInScope: c ? c.placementsInScope : null,
        };
      }).sort(byK);
    }
    const setRows = new Map((await store.getNodes(fileKey, [...new Set(mains.map(m => m.attrs?.componentReference?.set?.id).filter(Boolean))])).map(n => [n.nodeId, n]));
    await withLibraryRefs(store, libraryLinks, fileKey, [...setRows.values()]);
    const items = new Map();
    for (const m of mains) {
      const set = m.attrs?.componentReference?.set || null;
      const identity = set ? `set:${set.key ?? set.id}` : m.path;
      const owner = (set && setRows.get(set.id)) || m;
      const k = `${documentSortKey(owner)} ${identity}`;
      if (!items.has(identity)) {
        items.set(identity, {
          ...base, k, keyId: set ? set.key ?? set.id : m.nodeId, name: set ? set.name ?? null : m.name ?? null, type: set ? 'COMPONENT_SET' : m.nodeType ?? null,
          ...(set ? { set, variants: [] } : {}), libraryRef: (set && setRows.get(set.id)?.libraryRef) || m.libraryRef,
        });
      }
      const item = items.get(identity);
      if (k < item.k) item.k = k;
      if (set) item.variants.push({ key: m.attrs?.componentReference?.key ?? m.nodeId, name: m.name ?? null, nodeCount: 0 });
    }
    return [...items.values()].sort(byK);
  }

  /**
   * `store.listWorkItems` with the reference items `refs` merged in key order; the key nodes of library items get `libraryRef`.
   * Frame items and the `key: null` item are never library components.
   */
  async function listItems(fileKey, filter, page, refs) {
    const r = await store.listWorkItems(fileKey, filter, page);
    const keyIds = r.items.map(i => (i.kind || page.group === 'frame' || i.keyId === null ? [] : [page.group === 'set' && i.set ? i.set.id : i.keyId, i.nodeIds[0]]));
    const rows = filter.library === 'exclude' ? new Map() : new Map((await store.getNodes(fileKey, [...new Set(keyIds.flat().filter(Boolean))])).map(n => [n.nodeId, n]));
    const keyRows = r.items.map((i, x) => (i.kind ? null : rows.get(keyIds[x][0]) || rows.get(keyIds[x][1]) || null));
    await withLibraryRefs(store, libraryLinks, fileKey, [...new Set(keyRows.filter(n => n && n.library))]);
    r.items.forEach((i, x) => { if (keyRows[x] && keyRows[x].library) i.libraryRef = keyRows[x].libraryRef; });
    if (!refs.length) return r;
    const pending = refs.filter(i => !page.after || i.k > page.after.k);
    const merged = [...r.items, ...pending].sort(byK);
    const bound = r.next && r.items.length ? r.items[r.items.length - 1].k : null;
    const eligible = merged.filter(i => bound === null || i.k <= bound);
    const items = eligible.slice(0, page.limit);
    const last = items[items.length - 1];
    const more = eligible.length > page.limit || !!r.next;
    return { items, total: r.total + refs.length, next: more && last ? { k: last.k, id: last.keyId ?? '' } : null };
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

  /** Resolves the `under` ids to stored node ids and, with `expand`, sets `filter.regions`; returns the expansion (or null). */
  async function resolveScope(fileKey, filter, expand) {
    applyLibraryDefault(filter, await trackedFile(fileKey));
    const underNodes = filter.under === null ? null : await resolveUnder(fileKey, filter.under, findNode);
    if (underNodes) filter.under = underNodes.map(n => n.nodeId);
    if (!expand) return null;
    const expansion = await expandScope(store, fileKey, underNodes, expand);
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
      ...(filter.under !== null && filter.under.length === 1 ? { byFrame: s.byFrame || [] } : {}),
      ...(expansion ? { expansion: expansion.meta } : {}),
    };
  });

  app.get('/insights/trends', { schema: trends }, async (/** @type {import('./types').V3Request<'/v3/insights/trends', 'get'>} */ request) => {
    const { windowDays = DEFAULT_TREND_DAYS, fileKey = null } = request.query;
    if (fileKey !== null) await trackedFile(fileKey);
    const to = now();
    const window = windowDays * DAY_MS;
    const from = new Date(to.getTime() - window);
    const rows = await store.eventTrends({
      fileKey, from: new Date(to.getTime() - 2 * window).toISOString(), since: from.toISOString(), until: to.toISOString(),
    });
    const retentionDays = config.eventRetentionDays;
    const sum = key => rows.reduce((n, r) => n + r[key], 0);
    return {
      windowDays,
      from: from.toISOString(),
      to: to.toISOString(),
      complete: retentionDays >= 2 * windowDays,
      retentionDays,
      total: trendOf({ cleared: sum('cleared'), clearedPrevious: sum('clearedPrevious'), dirtied: sum('dirtied') }),
      files: rows.map(r => ({ fileKey: r.fileKey, fileName: r.fileName, ...trendOf(r) })),
    };
  });

  /**
   * Work items as format=outline: each item's line, then its listed nodes as a
   * tree; whole items from the cursor's, as many as fit in OUTLINE_LINES lines
   * (at least one), rendered once and paged by `limit` lines.
   */
  async function outlineWork(reply, { fileKey, filter, group, pos, fp, limit, toItem, lineLimit, progress, refs }) {
    const at = now().toISOString();
    const lines = [];
    let shown = 0, last = null, page = await listItems(fileKey, filter, { group, limit, after: pos.after, maxIds: MAX_ITEM_NODE_IDS, progress }, refs);
    const { total } = page;
    let full = false;
    for (;;) {
      const rows = new Map((await store.getNodes(fileKey, [...new Set(page.items.flatMap(i => i.nodeIds))])).map(n => [n.nodeId, n]));
      const mainIds = [...new Set([...rows.values()].flatMap(n => (n.mainComponentId && !rows.has(n.mainComponentId) ? [n.mainComponentId] : [])))];
      const mains = new Map([...rows.values(), ...(mainIds.length ? await store.getNodes(fileKey, mainIds) : [])].map(n => [n.nodeId, n.name]));
      for (const raw of page.items) {
        const item = toItem(raw);
        const nodes = (item.nodeIds || []).flatMap(id => {
          const row = rows.get(id);
          return row ? [{ node: nodeFields(fileKey, row, at, 'names'), path: row.path, absolute: isAbsolute(row), region: 0 }] : [];
        });
        const itemLines = [format.itemOutline(group, item), ...format.outlineTree(nodes, { base: 1, mainNames: mains })];
        if (shown && lines.length + itemLines.length > format.OUTLINE_LINES) { full = true; break; }
        lines.push(...itemLines);
        shown++;
        last = raw;
      }
      if (full || !page.next) break;
      page = await listItems(fileKey, filter, { group, limit, after: page.next, maxIds: MAX_ITEM_NODE_IDS, progress }, refs);
    }
    const shownTo = pos.offset + shown;
    const next = full && last ? { k: last.k, id: last.keyId ?? '' } : null;
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
    const include = parseInclude(query.include, WORK_INCLUDES);
    const progress = include.includes('progress');
    const usage = include.includes('usage');
    const outline = fmt === 'outline';
    const fp = queryFingerprint(filter, { route: 'work', group, changes, ...(progress ? { include: 'progress' } : {}), ...(usage ? { usage } : {}), ...(expand ? { expand } : {}), ...(outline ? { format: fmt } : {}) });
    const pos = decodeOutlineCursor(outline ? query.cursor : undefined, fp);
    const after = outline ? pos.after : query.cursor === undefined ? null : decodeCursor(query.cursor, fp);
    const expansion = await resolveScope(fileKey, filter, expand);
    if (group === 'frame' && filter.under && filter.under.length > 1) throw singleRoot('group', `'frame' needs exactly one under (got ${filter.under.length} distinct nodes).`);
    const refs = await libraryRefItems(fileKey, filter, group, expansion);

    const limit = outline ? format.STREAM_PAGE : format.pageSize(fmt, query.limit, schemas.DEFAULT_LIMIT);
    let truncated = false;
    /** Adds each token item's `usage` (`{ nodeId: { layers } }` for its listed tokens) from one batched read and one usage query per page. */
    async function withItemUsage(items) {
      const ids = [...new Set(items.filter(i => i.kind === 'tokens').flatMap(i => i.nodeIds))];
      if (!usage || !ids.length) return items;
      const rows = new Map((await withUsage(store, fileKey, (await store.getNodes(fileKey, ids)).filter(isVariableToken))).map(n => [n.nodeId, n.usage]));
      return items.map(i => (i.kind === 'tokens' ? { ...i, usage: Object.fromEntries(i.nodeIds.filter(id => rows.has(id)).map(id => [id, rows.get(id)])) } : i));
    }
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
      const r = await listItems(fileKey, filter, { group, limit, after: next, maxIds: MAX_ITEM_NODE_IDS, progress }, refs);
      return { ...r, items: await withItemUsage(await withChanges(r.items)) };
    };
    const toItem = itemOut(group, !!expansion);
    if (outline) return outlineWork(reply, { fileKey, filter, group, pos, fp, limit, toItem, lineLimit: query.limit ?? null, progress, refs });
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

module.exports = { registerInsightRoutes, MAX_ITEM_NODE_IDS, GROUPS, MAX_TREND_DAYS, DEFAULT_TREND_DAYS };
