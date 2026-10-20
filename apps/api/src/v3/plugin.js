'use strict';

/*
 * v3 plugin routes (docs/api-v3-phase2.md, "7. The plugin on v3"): subtree
 * hashes, sync and exists over NodeSyncService, on v3 addressing, plugin
 * tokens only. No `x-rds-mcp` / `x-rds-cli` annotations: agents never see these routes.
 */
const { bearer, roleOf, PLUGIN, AGENT, VIEWER } = require('../auth');
const { HttpError } = require('../errors');
const { EXISTS_MAX_IDS } = require('../nodeService');
const { problem } = require('./problem');
const { rejectUnknownKeys } = require('./actions');
const { deleteBlobs } = require('./attachments');
const { SCOPE_KINDS, reconcileTargets } = require('../checkTargets');
const address = require('./address');
const schemas = require('./schemas');

const PLUGIN_ROUTES = '…/hashes, …/sync and …/exists';

// --- schemas -------------------------------------------------------------------
const security = [{ pluginToken: [] }];
const { tags } = schemas.listNodes;
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const problemResponse = schemas.getFile.response[404];
const problemResponses = statuses => Object.fromEntries(statuses.map(s => [s, { ...problemResponse }]));
const ERRORS = [400, 401, 403, 404];
const fileKeyParams = schemas.getFile.params;
const urlProperty = schemas.getFile.querystring.properties.url;
const urlQuery = { type: 'object', properties: { url: urlProperty } };
const nodeId = { type: 'string', minLength: 1, description: 'Node id (1:2 or 1-2).' };
const nodeIds = description => ({ type: 'array', items: nodeId, description });

const hashes = {
  summary: 'Subtree hashes (plugin)',
  description: 'The stored `contentHash` of every live node in `under`\'s subtree (inclusive), keyed by node id, plus the file\'s `settings` (defaults filled in; read `trackLibraryComponents` when a sync starts). Only `settings` when the node — or the file — was never synced. '
    + 'With `under=tokens` (the design-tokens scope) it also has `tokens: { "token:<variableKey>": { variableId, remote, collectionId } }` for every stored live variable: tombstone (in `deletedNodeIds`) only local variables no longer in the file, never library ones or one a sync merely did not reference, and a collection only once all its tokens are tombstoned. That key takes the place of the root\'s own hash, so send the `tokens` root on every tokens sync. Plugin tokens only.',
  tags, security,
  params: fileKeyParams,
  querystring: {
    type: 'object',
    properties: {
      under: { type: 'string', minLength: 1, description: 'The scope root (1:2 or 1-2). With ?url=, defaults to the link\'s node.' },
      url: urlProperty,
    },
  },
  response: {
    200: {
      type: 'object', description: '`{ [nodeId]: contentHash, settings, tokens? }` — `settings` is never a node id; `tokens` only with `under=tokens`.',
      properties: {
        settings: schemas.fileSettings,
        tokens: {
          type: 'object', description: '`under=tokens` only: every stored live variable (`token:<variableKey>`) with its Figma `variableId` (null when not captured), `remote` (a library variable) and `collectionId` (its collection node).',
          additionalProperties: { type: 'object', properties: { variableId: nullable('string'), remote: { type: 'boolean' }, collectionId: nullable('string') } },
        },
      },
      additionalProperties: nullable('string'),
    },
    ...problemResponses(ERRORS),
  },
};

const upsert = {
  type: 'object',
  required: ['nodeId', 'contentHash'],
  properties: {
    nodeId,
    contentHash: { type: 'string', minLength: 1, description: 'The plugin\'s hash of `attrs`.' },
    nodeType: nullable('string'),
    name: nullable('string'),
    parentId: nullable('string', { minLength: 1, description: 'Parent node id (1:2 or 1-2).' }),
    path: {
      anyOf: [{ type: 'array', items: nodeId }, { type: 'string' }, { type: 'null' }],
      description: 'Ancestor node ids, root first (the node itself may end it), or the same dot-joined.',
    },
    attrs: { type: 'object', additionalProperties: true, description: 'The captured properties.' },
    isInstance: nullable('boolean'),
    mainComponentId: nullable('string', { minLength: 1, description: 'An instance\'s main component (1:2 or 1-2).' }),
    library: nullable('boolean', { description: 'true: a library node — scanned under a remote (library) main component or set. Optional: main components / sets with a remote `componentReference` and the subtrees of the remote mains instances point at are flagged anyway. Never unset by a later sync.' }),
  },
};

const sync = {
  summary: 'Sync a batch (plugin)',
  description: 'Upserts scanned nodes and tombstones `deletedNodeIds`. Design tokens sync as their own scope: `rootNodeId: "tokens"` (type TOKENS), collections `tokens:<collectionKey>` (VARIABLE_COLLECTION), variables `token:<variableKey>` (VARIABLE, one `value:<Mode name>` attr per mode). For every node: `dirty` becomes `contentHash !== implementedHash`, a hash change unblocks a blocked node, and `markImplemented: true` inserts never-seen nodes as already implemented. A tombstoned node that was never implemented resolves itself (a clean tombstone, counted in `autoResolved`, not dirty). A token whose attrs differ from its implemented ones only in `variableId` (another imported copy of the same variable) stays clean: its baseline moves to the new attrs, counted in `rebaselined`; a batch with the `tokens` root does this for every stored token. `fileName` / `rootNodeId` name the file and record the sync for `…/scopes`. Emits `sync.completed`. Plugin tokens only.',
  tags, security,
  params: fileKeyParams,
  querystring: urlQuery,
  body: {
    type: 'object',
    properties: {
      fileKey: { type: 'string', description: 'Optional; must equal the path\'s file key when sent.' },
      fileName: nullable('string', { description: 'The Figma file\'s name.' }),
      rootNodeId: nullable('string', { description: 'The synced scope root (1:2 or 1-2).' }),
      scopeKind: { type: 'string', enum: SCOPE_KINDS, description: 'What the scope contains, as declared in Figma (needs `rootNodeId`): `screens`, `components` or `none`. Stored for the scope and used for automatic check targets; omitted = unchanged (older plugins send nothing; undeclared scopes are `none`).' },
      markImplemented: { type: 'boolean', default: false, description: 'First-scan baseline: insert never-seen nodes as implemented.' },
      upserts: { type: 'array', items: upsert, default: [] },
      deletedNodeIds: { ...nodeIds('Nodes that vanished from the scope; tombstoned.'), default: [] },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        upserted: { type: 'integer' },
        dirty: { type: 'integer', description: 'How many of the upserted nodes are dirty.' },
        tombstoned: { type: 'integer', description: 'Nodes this sync tombstoned (deletedNodeIds that were stored and live).' },
        autoResolved: { type: 'integer', description: 'Of `tombstoned`, the nodes that were never implemented: stored as clean tombstones at once, so they are not work.' },
        skippedInstances: { type: 'integer', description: 'Always 0; kept for older plugins.' },
        baselined: { type: 'integer', description: 'With markImplemented: nodes inserted as implemented.' },
        rebaselined: { type: 'integer', description: 'Tokens kept clean because only their Figma `variableId` changed (their baseline moved to the new attrs); present when > 0.' },
      },
    },
    ...problemResponses(ERRORS),
  },
};

const exists = {
  summary: 'Stored nodes (plugin)',
  description: `Which of \`nodeIds\` are stored and not tombstoned (\`present\`), and which of those were captured by an older plugin (\`stale\` ⊆ \`present\`, re-scan them). At most ${EXISTS_MAX_IDS} ids. Plugin tokens only.`,
  tags, security,
  params: fileKeyParams,
  querystring: urlQuery,
  body: {
    type: 'object',
    required: ['nodeIds'],
    properties: {
      fileKey: { type: 'string', description: 'Optional; must equal the path\'s file key when sent.' },
      nodeIds: nodeIds(`Node ids to look up; at most ${EXISTS_MAX_IDS}.`),
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { present: { type: 'array', items: { type: 'string' } }, stale: { type: 'array', items: { type: 'string' } } },
    },
    ...problemResponses(ERRORS),
  },
};

// --- auth ----------------------------------------------------------------------
/** Plugin tokens call these routes; every other class is a problem. */
function pluginAuth(config) {
  return async function pluginAuthenticate(request) {
    const token = bearer(request);
    if (!token) throw problem('unauthorized', 'Missing bearer token.', { hint: 'Send Authorization: Bearer <plugin token>.' });
    const role = roleOf(config, token, [PLUGIN]);
    if (role === PLUGIN) { request.auth = { role, token }; return; }
    if (role === AGENT || role === VIEWER) {
      throw problem('wrong_token_class', `This route requires a plugin token; ${role === AGENT ? 'an agent' : 'a viewer'} token was sent.`, {
        hint: `The plugin routes (${PLUGIN_ROUTES}) are for the Figma plugin: use a plugin token (RDS_PLUGIN_TOKENS). Agents read with GET …/nodes and clear with POST …/clear.`,
      });
    }
    throw problem('invalid_token', 'The bearer token is not recognized.', {
      hint: 'Use a plugin token from RDS_PLUGIN_TOKENS (or the local tokens file).',
    });
  };
}

// --- routes --------------------------------------------------------------------
const normalizeIds = ids => ids.map(address.normalizeNodeId);

function normalizePath(path) {
  if (Array.isArray(path)) return normalizeIds(path);
  if (typeof path === 'string') return normalizeIds(path.split('.').filter(Boolean));
  return path;
}

/** The upsert with its node ids in stored (`1:2`) form. */
function normalizeUpsert(u) {
  const out = { ...u, nodeId: address.normalizeNodeId(u.nodeId) };
  for (const k of ['parentId', 'mainComponentId']) if (typeof u[k] === 'string') out[k] = address.normalizeNodeId(u[k]);
  if (u.path !== undefined) out.path = normalizePath(u.path);
  return out;
}

/** A NodeSyncService validation error as a v3 problem with a hint. */
async function service(call) {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof HttpError) || err.statusCode !== 400) throw err;
    const hint = err.code === 'batch_too_large'
      ? `Split the ids into requests of at most ${EXISTS_MAX_IDS}.`
      : 'Check the body against GET /v3/openapi.json.';
    throw problem('invalid_body', err.message, { hint });
  }
}

/** The path's file key; a body `fileKey`, when sent, must name the same file. */
function fileOf(request) {
  const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, request.query.url);
  const sent = request.body && request.body.fileKey;
  if (sent !== undefined && sent !== fileKey) {
    throw problem('invalid_body', `body.fileKey '${sent}' does not match the file key '${fileKey}' in the path.`, {
      hint: 'Drop fileKey from the body; the path names the file.',
    });
  }
  return { fileKey, urlNodeId };
}

function registerPluginRoutes(app, { config, nodes, blobs = null }) {
  app.addHook('onRequest', pluginAuth(config));

  app.get('/files/:fileKey/hashes', { schema: hashes }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/hashes', 'get'>} */ request) => {
    const { fileKey, urlNodeId } = fileOf(request);
    const under = request.query.under === undefined ? urlNodeId : address.resolveNodeParam(request.query.under, urlNodeId);
    if (!under) {
      throw problem('invalid_parameter', 'querystring must have required property \'under\'.', {
        hint: 'Pass ?under=<scope root node id>, or ?url=<figma link> with a node-id.',
      });
    }
    return service(async () => ({ ...(await nodes.subtreeHashes(fileKey, address.normalizeNodeId(under))), settings: await nodes.fileSettings(fileKey) }));
  });

  app.post('/files/:fileKey/sync', { schema: sync }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/sync', 'post'>} */ request) => {
    rejectUnknownKeys('body', request.body, sync.body);
    const { fileKey } = fileOf(request);
    const body = request.body || {};
    const rootNodeId = typeof body.rootNodeId === 'string' ? address.normalizeNodeId(body.rootNodeId) : body.rootNodeId;
    const { scopeKind, ...batch } = /** @type {any} */ (body);
    if (scopeKind !== undefined && !rootNodeId) {
      throw problem('invalid_body', 'scopeKind needs rootNodeId: it is stored for the synced scope.', { hint: 'Send rootNodeId with scopeKind, or drop scopeKind.' });
    }
    const result = await service(() => nodes.batchUpsert({
      ...batch,
      fileKey,
      rootNodeId,
      upserts: (body.upserts || []).map(normalizeUpsert),
      deletedNodeIds: normalizeIds(body.deletedNodeIds || []),
    }));
    if (rootNodeId) {
      const at = nodes.now().toISOString();
      const kinds = await nodes.store.listScopeKinds(fileKey);
      if (scopeKind !== undefined && !kinds.some(k => k.nodeId === rootNodeId && k.kind === scopeKind)) {
        await nodes.store.setScopeKind(fileKey, rootNodeId, { kind: scopeKind, by: 'plugin', at });
      }
      if (scopeKind !== undefined || kinds.length) {
        const removed = await reconcileTargets(nodes.store, fileKey, { at });
        if (blobs) await deleteBlobs(blobs, removed, request.log);
      }
    }
    return result;
  });

  app.post('/files/:fileKey/exists', { schema: exists }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/exists', 'post'>} */ request) => {
    rejectUnknownKeys('body', request.body, exists.body);
    const { fileKey } = fileOf(request);
    return service(() => nodes.exists({ fileKey, nodeIds: normalizeIds(request.body.nodeIds) }));
  });
}

module.exports = { registerPluginRoutes };
