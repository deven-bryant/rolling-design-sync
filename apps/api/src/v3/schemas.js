'use strict';

/*
 * JSON Schemas for every v3 route (docs/api-v3-design.md). Fastify validates
 * requests and serializes responses with them; @fastify/swagger renders
 * /v3/openapi.json from the same objects.
 */
const core = require('@rolling-design-sync/core');

const CATEGORIES = [...Object.keys(core.CATEGORY_RULES), 'other', 'note', 'render'];
const STATES = ['dirty', 'clean', 'blocked', 'requested', 'all'];
const CHANGE_TYPES = ['added', 'modified', 'deleted', 'requested'];
const SORTS = ['document', 'path', 'updatedAt', 'name'];
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;
const CHANGES_MODES = ['auto', 'diff', 'names'];
/** Longest JSON (bytes) a change side keeps in compact listing / work responses before `{ truncated, bytes }`. */
const MAX_CHANGE_SIDE_BYTES = 1024;
const EXPANDS = ['instances'];
const LIBRARY_MODES = ['include', 'exclude', 'only'];
const DEFAULT_EXPAND_DEPTH = 10;
const MAX_EXPAND_DEPTH = 20;
/** `expand=instances` expands at most this many distinct main components per request. */
const EXPANSION_LIMIT = 500;

const COMPACT_FIELDS = ['nodeId', 'name', 'type', 'parentId', 'isInstance', 'mainComponentId', 'component', 'state', 'changeType', 'changedProps',
  'changes', 'changesKnown', 'contentHash', 'figmaUrl', 'library', 'claim', 'blocked', 'notes'];
const FULL_FIELDS = [...COMPACT_FIELDS, 'attrs', 'implementedAttrs', 'path'];
const DETAIL_FIELDS = [...FULL_FIELDS, 'deleted', 'notesResolved', 'history'];
const NODE_FIELDS = [...DETAIL_FIELDS, 'descendants', 'usage'];
/** `include=` values of the node listing (comma-separated). */
const LISTING_INCLUDES = ['counts', 'usage'];
/** Listing `fields`: every node field, plus `via` (with `expand=instances`). */
const LISTING_FIELDS = [...NODE_FIELDS, 'via'];

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const str = description => ({ type: 'string', description });

/** Marks an agent-facing operation: the MCP server registers it as `tool`, the CLI as `command`. */
const agentOp = (tool, command) => ({ 'x-rds-mcp': { tool }, 'x-rds-cli': { command } });

const problem = {
  type: 'object',
  description: 'RFC 9457 problem details, plus `code` and `hint`.',
  required: ['type', 'title', 'status', 'code', 'detail'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
    hint: { type: 'string' },
    validParameters: { type: 'array', items: { type: 'string' } },
    retryAfter: { type: 'integer', description: '`rate_limited` only: seconds until the window resets, as in `Retry-After`.' },
  },
  additionalProperties: true,
};
const problemResponses = statuses => Object.fromEntries(statuses.map(s => [s, problem]));
const AUTH_ERRORS = [400, 401, 403];

const counts = {
  type: 'object',
  properties: { total: { type: 'integer' }, dirty: { type: 'integer' }, clean: { type: 'integer' }, blocked: { type: 'integer' } },
};
const descendants = {
  type: 'object',
  description: 'Counts over the node\'s subtree, excluding the node itself (`include=counts`).',
  properties: { total: { type: 'integer' }, dirty: { type: 'integer' }, blocked: { type: 'integer' } },
};

const componentSet = {
  type: 'object', description: 'The variant\'s Figma component set. Omitted when unavailable (including inaccessible library parents).',
  properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } },
};
const component = {
  type: ['object', 'null'], description: 'The captured component reference (the main for an instance, self for a component), including its set when it is a variant; null on other nodes.',
  properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, remote: { type: 'boolean' }, set: componentSet },
};

const library = {
  type: ['object', 'null'],
  description: 'Library nodes only (null on others): a remote (library) main component or component set, or a layer inside one. `key` is its component key (the nearest component\'s); `resolved` is true when the server (RDS_FIGMA_TOKEN) has resolved it to the library file — then `fileKey` is that file and `figmaUrl` opens the component there. Unresolved: `figmaUrl` is null; find it in the library by `key`.',
  properties: { key: nullable('string'), fileKey: { type: 'string' }, resolved: { type: 'boolean' } },
};

const fileSettings = {
  type: 'object',
  description: 'Per-file settings, defaults filled in.',
  properties: {
    trackLibraryComponents: {
      type: 'boolean',
      description: 'Default true. false: library (remote) components are not tracked — the plugin does not scan or upload library mains, and stored library nodes are left out of listings, summaries, counts, work-item progress and trends (not deleted; `library=include` still lists them). Instances of library components stay tracked.',
    },
    storeImages: {
      type: 'boolean',
      description: 'Default true. false: the API stores no images for the file — note screenshots, screen reference images and render-check results are refused with images_disabled (images already stored are kept).',
    },
  },
};

const node = {
  type: 'object',
  description: 'A node. Compact nodes carry the first group of properties; `view=full` adds `attrs`, `implementedAttrs` and `path`; `fields` picks any subset.',
  properties: {
    nodeId: { type: 'string' },
    name: nullable('string'),
    type: nullable('string'),
    parentId: nullable('string'),
    isInstance: { type: 'boolean', description: 'An INSTANCE of a component; `mainComponentId` is that component.' },
    mainComponentId: nullable('string', { description: "The instance's main component node id (`get_node` it, or filter `component=`); null for non-instances." }),
    component,
    state: { type: 'string', enum: ['dirty', 'clean', 'blocked'] },
    changeType: nullable('string', { enum: [...CHANGE_TYPES, null] }),
    changedProps: { type: 'array', items: { type: 'string' }, description: 'Sorted names of the properties changed since last built (every property of an `added` node).' },
    changes: nullable('object', {
      description: 'Property-level diff against what was built: `{ prop: { built, now, category } }`; values bound to a token are `{ token, value }`. `null` when unknown (`changesKnown: false`). '
        + 'Omitted for `added` nodes by default (`changes=auto`) and always with `changes=names`. In compact listing / work responses a side whose JSON exceeds 1 KB is `{ truncated: true, bytes }` — `get_node` returns it whole.',
      additionalProperties: true,
    }),
    changesKnown: { type: 'boolean' },
    contentHash: nullable('string'),
    figmaUrl: nullable('string', { description: 'The node in Figma. For a library node: the main component in its library file, or null while unresolved (see `library`).' }),
    library,
    claim: nullable('object', {
      properties: { claimId: nullable('string'), worker: { type: 'string' }, label: nullable('string'), expiresAt: { type: 'string' } },
    }),
    blocked: nullable('object', {
      properties: { reason: nullable('string'), by: nullable('string'), at: { type: 'string' } },
    }),
    notes: {
      type: 'array',
      description: 'Open notes, newest first: what a person or agent says does not match the design. Read them, fix the code to match the design as they describe, then clear the node — clearing resolves them. A node with open notes is dirty (`changeType: requested` when its design is otherwise built).',
      items: { type: 'object', properties: { noteId: { type: 'string' }, body: { type: 'string' }, author: { type: 'string' }, createdAt: { type: 'string' } } },
    },
    notesResolved: { type: 'integer', description: '`get_node` only: how many of its notes clears have resolved.' },
    attrs: nullable('object', { additionalProperties: true }),
    implementedAttrs: nullable('object', { additionalProperties: true }),
    path: { type: 'array', items: { type: 'string' }, description: 'Ancestor node ids, root first, ending with this node.' },
    deleted: { type: 'boolean' },
    history: {
      type: 'object',
      properties: {
        createdAt: nullable('string'), updatedAt: nullable('string'), implementedAt: nullable('string'),
        implementedCommit: nullable('string'), implementedHash: nullable('string'), deletedAt: nullable('string'),
      },
    },
    descendants,
    usage: {
      type: 'object',
      description: 'Design tokens (`token:<variableKey>`) only: `layers` — how many live layers use the token (their captured `resolvedVariables` has an entry with its variable key, under any imported id). Always on `get_node`; on listings with `include=usage`.',
      properties: { layers: { type: 'integer' } },
    },
    via: nullable('object', {
      description: 'Only with `expand=instances`: how the node was reached — `{ instanceId, mainComponentId, depth }` of the first (shortest) instance → main hop chain into its component; null for nodes in the original scope.',
      properties: { instanceId: { type: 'string' }, mainComponentId: { type: 'string' }, depth: { type: 'integer' } },
    }),
  },
};

const expansion = {
  type: 'object',
  description: 'Only with `expand=instances`: `components` — main components expanded; `truncated` — true when the '
    + `${EXPANSION_LIMIT}-component limit stopped the expansion (then \`hint\` says how to narrow it); \`unresolved\` — main component ids instances point at that were never synced (sync their page to include them).`,
  properties: {
    components: { type: 'integer' },
    truncated: { type: 'boolean' },
    unresolved: { type: 'array', items: { type: 'string' } },
    hint: { type: 'string' },
  },
};
const expandQuery = {
  expand: {
    type: 'string', enum: EXPANDS,
    description: '`instances`: also include the subtree of every main component the scope\'s instances use (the scope is `under`, or the whole file) — transitively through instances inside those components, breadth-first, each component once. '
      + 'Use it for "everything this screen uses" / "which components do I build for this screen". Other filters apply after expansion; `depth` cannot be combined with it.',
  },
  expandDepth: {
    type: 'integer', minimum: 1, maximum: MAX_EXPAND_DEPTH,
    description: `With \`expand=instances\`: at most this many instance → main hops (default ${DEFAULT_EXPAND_DEPTH}, max ${MAX_EXPAND_DEPTH}; 1 = only the components the scope uses directly).`,
  },
};

const file = {
  type: 'object',
  properties: {
    fileKey: { type: 'string' },
    name: nullable('string'),
    lastSyncAt: nullable('string'),
    createdAt: nullable('string'),
    settings: fileSettings,
    counts,
  },
};

const scope = {
  type: 'object',
  properties: {
    nodeId: { type: 'string' },
    name: nullable('string'),
    type: nullable('string'),
    deleted: { type: 'boolean' },
    figmaUrl: nullable('string', { description: 'The scope root in Figma; null for the design-tokens scope (`tokens`).' }),
    lastSyncAt: { type: 'string' },
    lastSyncCounts: { type: 'object', additionalProperties: true },
    counts,
  },
};

const fileKeyParams = {
  type: 'object',
  required: ['fileKey'],
  properties: { fileKey: str("The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead.") },
};
const urlQuery = str("A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`.");

const listQuery = {
  type: 'object',
  properties: {
    state: str(`Comma-separated: ${STATES.join(', ')}. Default dirty (changed since last built or with open notes, not blocked); \`requested\`: dirty only by open notes; \`all\` for every state.`),
    under: str("Only this node's subtree, the node included (1:2 or 1-2). Several subtrees: up to 50 comma-separated ids (1:2,1:5) for their union, each node once, in the order given. Defaults to the `url` link's node-id."),
    depth: { type: 'integer', minimum: 0, description: 'Needs `under`: at most this many levels below it — below each root when there are several (1 = direct children).' },
    type: str('Comma-separated Figma node types, e.g. TEXT,INSTANCE,FRAME.'),
    changeType: str(`Comma-separated: ${CHANGE_TYPES.join(', ')} (dirty nodes only; \`requested\`: built as designed but with open notes).`),
    hasNotes: { type: 'string', enum: ['true', 'false'], description: 'true: only nodes with open notes; false: only nodes without.' },
    changed: str('Comma-separated changed property names (fills, paddingLeft); a trailing `*` matches a prefix (padding*).'),
    category: str(`Comma-separated change categories: ${CATEGORIES.join(', ')}.`),
    component: str('Comma-separated main component ids: the components and all their instances.'),
    name: str('Comma-separated case-insensitive name globs (`*`, `?`), e.g. Button*.'),
    since: str('ISO 8601 time: only nodes changed at or after it.'),
    claimed: str('Comma-separated: true (leased), false (free), mine (leased to `worker`).'),
    worker: str('Your worker id; needed with `claimed=mine`.'),
    instance: { type: 'string', enum: ['true', 'false'], description: 'true: only component instances (`isInstance`); false: only other nodes.' },
    library: {
      type: 'string', enum: LIBRARY_MODES,
      description: 'Library nodes (remote main components / sets and their layers): include, exclude, or only them. Default: include when the file tracks library components (`settings.trackLibraryComponents`), else exclude.',
    },
    q: str('All the filters above in one string: space-separated `key:value` pairs, e.g. `state:dirty under:1:2 changed:fills` (several subtrees: `under:1:2,1:5`); quote values with spaces (name:"Primary Button"). A key may not also be passed as its own parameter.'),
    view: { type: 'string', enum: ['compact', 'full'], description: 'compact (default: state, changes, hash, claim, block) or full (adds attrs, implementedAttrs, path; change values never truncated).' },
    changes: {
      type: 'string', enum: CHANGES_MODES,
      description: 'auto (default): the built→now diff for modified and deleted nodes, omitted for added ones (their property names are in `changedProps`) — keeps fresh-sync pages small; '
        + 'diff: the diff for every node, including added ones\' full values; names: never `changes`, only `changedProps`. Ask for `changes=diff` (or `get_node`) when you need the values of added nodes.',
    },
    fields: str(`Comma-separated node fields to return (overrides view): ${LISTING_FIELDS.join(', ')} (\`via\` needs \`expand=instances\`).`),
    include: { type: 'string', description: `Comma-separated: ${LISTING_INCLUDES.join(', ')}. \`counts\` adds subtree counts (\`descendants\`) to each node; \`usage\` adds \`usage: { layers }\` to each design token (\`token:<variableKey>\`).` },
    sort: { type: 'string', enum: [...SORTS, ...SORTS.map(s => `-${s}`)], description: 'document (default: the design\'s layer order — auto-layout flow order, else top-to-bottom, left-to-right), path (node-id path order), updatedAt or name; prefix `-` for descending.' },
    limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Page size (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
    cursor: str("The previous page's `nextCursor`, unchanged, with all other parameters the same (else `invalid_cursor`)."),
    url: urlQuery,
    ...expandQuery,
  },
};

const SECURITY = [{ agentToken: [] }];
const TAGS = ['v3'];

const listFiles = {
  summary: 'List tracked files',
  description: 'Every file the plugin has synced, most recently synced first, with node counts (total, dirty, clean, blocked) and the last sync time. Use it to find a `fileKey` when you have no Figma link; with a link, pass it as `url` (or use `resolve_url`).',
  tags: TAGS, security: SECURITY,
  ...agentOp('list_files', 'files ls'),
  querystring: { type: 'object', properties: {} },
  response: {
    200: { type: 'object', properties: { files: { type: 'array', items: file } } },
    ...problemResponses(AUTH_ERRORS),
  },
};

const getFile = {
  summary: 'Get a file',
  description: "One tracked file's node counts and last sync time: a quick check of how much is dirty. For counts by category, type or frame use `summarize`. `file_not_found`: the file was never synced — take the key from `list_files`, or pass the Figma link as `url` with fileKey '-'.",
  tags: TAGS, security: SECURITY,
  ...agentOp('get_file', 'files show'),
  params: fileKeyParams,
  querystring: { type: 'object', properties: { url: urlQuery } },
  response: { 200: file, ...problemResponses([...AUTH_ERRORS, 404]) },
};

const listScopes = {
  summary: 'List synced scopes',
  description: "The scopes (sections/frames) the plugin has synced in a file: each root's name, last sync, and current counts. Only nodes under these roots exist in the API; a `node_not_found` usually means the node is outside every scope and must be synced from the plugin first.",
  tags: TAGS, security: SECURITY,
  ...agentOp('list_scopes', 'scopes ls'),
  params: fileKeyParams,
  querystring: { type: 'object', properties: { url: urlQuery } },
  response: {
    200: { type: 'object', properties: { fileKey: { type: 'string' }, scopes: { type: 'array', items: scope } } },
    ...problemResponses([...AUTH_ERRORS, 404]),
  },
};

const listNodes = {
  summary: 'List nodes',
  description: [
    'Nodes of a file with their property-level changes — by default the dirty ones (design changed since last built), compact, in document order (the design\'s layer order), 100 per page.',
    'The main read for implementation work: filter by subtree (`under` — one node id or several comma-separated — or a `url` with node-id), type, change, category, component or name; values within a parameter are OR, parameters are AND.',
    'Each node\'s `changes` is `{ prop: { built, now } }` and `contentHash` is what `clear_nodes` needs. For counts only use `summarize`; to work component by component use `list_work_items`.',
    'Every node carries `changedProps` and, for instances, `isInstance` / `mainComponentId` (`instance=true` lists only instances). By default (`changes=auto`) `added` nodes have no `changes` — on a fresh sync every node is added, so pages stay small; get their values with `changes=diff`, `view=full` or `get_node`.',
    'Change values over 1 KB are replaced by `{ truncated: true, bytes }` and the page has `truncated: true`; `view=full` or `get_node` returns them whole.',
    '`expand=instances` returns everything a screen uses in one call: with `under` = the screen, it adds the main components its instances point at (and theirs, transitively), each once; filters apply to that union (`expand=instances&state=dirty` = every dirty node the screen uses).'
      + ' Scope nodes come first, then each component in discovery order; expanded nodes carry `via` (the instance that reached them), and `expansion` reports the count, `truncated` and `unresolved` (unsynced) components.',
    'Page with `nextCursor` → `cursor`. On `unknown_parameter` / `invalid_parameter` follow `hint`; on `invalid_cursor` keep every other parameter unchanged or drop `cursor`.',
  ].join(' '),
  tags: TAGS, security: SECURITY,
  ...agentOp('list_nodes', 'nodes ls'),
  params: fileKeyParams,
  querystring: listQuery,
  response: {
    200: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        nodes: { type: 'array', items: node },
        nextCursor: nullable('string'),
        total: { type: 'integer' },
        truncated: { type: 'boolean', description: 'Present (true) when a change value on this page was replaced by `{ truncated: true, bytes }`.' },
        expansion,
      },
    },
    ...problemResponses([...AUTH_ERRORS, 404]),
  },
};

const getNode = {
  summary: 'Get a node',
  description: 'One node in full: state, property changes (whole values, never truncated), component link (`isInstance`, `mainComponentId`), current `contentHash`, claim, block, subtree counts and history (when and in which commit it was last built). Use it to re-read a node before clearing it — e.g. after `clear_nodes` reports it `stale`. `node_not_found`: check the id against the link\'s node-id and that it is under a synced scope (`list_scopes`).',
  tags: TAGS, security: SECURITY,
  ...agentOp('get_node', 'nodes show'),
  params: {
    type: 'object',
    required: ['fileKey', 'nodeId'],
    properties: { fileKey: fileKeyParams.properties.fileKey, nodeId: str("The node id, 1:2 or 1-2 (a link's node-id). Pass '-' to take it from `url`.") } ,
  },
  querystring: {
    type: 'object',
    properties: {
      fields: str(`Comma-separated node fields to return (default: all): ${NODE_FIELDS.join(', ')}.`),
      changes: {
        type: 'string', enum: CHANGES_MODES,
        description: 'diff (default): the whole built→now diff, never truncated — the way to read an added node\'s values; auto: omitted for added nodes; names: never `changes`, only `changedProps`.',
      },
      url: urlQuery,
    },
  },
  response: { 200: { ...node, properties: { fileKey: { type: 'string' }, ...node.properties } }, ...problemResponses([...AUTH_ERRORS, 404]) },
};

const resolve = {
  summary: 'Resolve a Figma link',
  description: "Turns a Figma link into `{ fileKey, nodeId }` (nodeId as 1:2; `null` when the link has no node-id). Needs no tracked file. Most calls also take the link directly as `url` with '-' path parameters, so use this only when you need the ids themselves. `invalid_url`: pass a figma.com/design/… link, URL-encoded.",
  tags: TAGS, security: SECURITY,
  ...agentOp('resolve_url', 'resolve'),
  querystring: { type: 'object', required: ['url'], properties: { url: str('A Figma design link, e.g. https://www.figma.com/design/<fileKey>/<name>?node-id=1-2.') } },
  response: {
    200: { type: 'object', properties: { fileKey: { type: 'string' }, nodeId: nullable('string') } },
    ...problemResponses(AUTH_ERRORS),
  },
};

const openapi = {
  summary: 'OpenAPI document',
  description: 'This document. No token needed.',
  tags: TAGS,
  querystring: { type: 'object', properties: {} },
  response: { 200: { type: 'object', additionalProperties: true } },
};

const OPENAPI_OPTIONS = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Rolling Design Sync API v3',
      description: 'File-scoped, queryable design-change API. Errors are RFC 9457 problem details with `code` and `hint`.',
      version: '3.0.0',
    },
    tags: [{ name: 'v3' }],
    components: {
      securitySchemes: {
        agentToken: { type: 'http', scheme: 'bearer', description: 'An agent token (RDS_AGENT_TOKENS).' },
        viewerToken: { type: 'http', scheme: 'bearer', description: 'A read-only viewer token (RDS_VIEWER_TOKENS): GET routes only.' },
        pluginToken: { type: 'http', scheme: 'bearer', description: 'A plugin token (RDS_PLUGIN_TOKENS): the plugin routes (…/hashes, …/sync, …/exists) only.' },
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'rds_session', description: 'The browser session POST /v3/session mints: a cookie of the same role as the token it was minted from.' },
      },
    },
  },
};

module.exports = {
  componentSet, library, fileSettings, LIBRARY_MODES,
  problemResponses,
  LISTING_INCLUDES, CATEGORIES, STATES, CHANGE_TYPES, SORTS, MAX_LIMIT, DEFAULT_LIMIT, CHANGES_MODES, MAX_CHANGE_SIDE_BYTES, COMPACT_FIELDS, FULL_FIELDS, DETAIL_FIELDS, NODE_FIELDS,
  LISTING_FIELDS, EXPANDS, DEFAULT_EXPAND_DEPTH, MAX_EXPAND_DEPTH, EXPANSION_LIMIT, expansion, expandQuery,
  agentOp, listFiles, getFile, listScopes, listNodes, getNode, resolve, openapi, OPENAPI_OPTIONS,
};
