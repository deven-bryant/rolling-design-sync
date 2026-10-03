'use strict';

/*
 * v3 blocking (docs/api-v3-phase2.md, "3. Blocking"): an agent marks a node it
 * cannot implement as blocked (out of `state=dirty`, listed under
 * `state=blocked`) and unblocks it again. Blocking releases the node's lease;
 * a design change also unblocks it (nodeService, `auto: true`).
 */
const { writeActor } = require('../auth');
const { withEvents } = require('../events/outbox');
const address = require('./address');
const schemas = require('./schemas');
const { nodeFields, pick } = require('./read');
const { rejectUnknownKeys } = require('./actions');

const MAX_REASON_LENGTH = 500;

// --- schemas -------------------------------------------------------------------
const { security, tags } = schemas.listNodes;
const { agentOp } = schemas;
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const problemResponse = schemas.getFile.response[404];
const problemResponses = statuses => Object.fromEntries(statuses.map(s => [s, { ...problemResponse }]));
const ERRORS = [400, 401, 403, 404];
const nodeParams = schemas.getNode.params;
const urlQuery = { type: 'object', properties: { url: schemas.getFile.querystring.properties.url } };
const compactNode = schemas.listNodes.response[200].properties.nodes.items;
const worker = { type: 'string', minLength: 1, maxLength: 200, description: 'Your worker id; recorded as `by` (default: the token label).' };

const block = {
  summary: 'Block a node',
  description: [
    `Marks a node you cannot implement (missing asset, unclear or impossible design, needs a human) as blocked, with a reason (1–${MAX_REASON_LENGTH} chars) a person can act on.`,
    'It leaves the default dirty listing (list it with `state=blocked`) until `unblock_node` or its next design change, and its lease is released. Blocking a blocked node replaces the reason.',
    'Use it instead of clearing a node you did not build.',
  ].join(' '),
  tags, security,
  ...agentOp('block_node', 'block'),
  params: nodeParams,
  querystring: urlQuery,
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: MAX_REASON_LENGTH, description: 'Why the node cannot be implemented and what would unblock it.' },
      worker,
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        node: compactNode,
        released: nullable('object', {
          description: 'The lease the block released, or null when the node was not leased.',
          properties: { claimId: nullable('string'), worker: { type: 'string' } },
        }),
      },
    },
    ...problemResponses(ERRORS),
  },
};

const unblock = {
  summary: 'Unblock a node',
  description: 'Removes a node\'s block once its blocker is resolved: it is dirty again (back in the default listing) or clean, by its hashes. `unblocked: false` when it was not blocked — nothing changed. A design change unblocks a node on its own.',
  tags, security,
  ...agentOp('unblock_node', 'unblock'),
  params: nodeParams,
  querystring: urlQuery,
  body: nullable('object', { properties: { worker }, description: 'Optional; `{}` or null records the token label as `by`.' }),
  response: {
    200: {
      type: 'object',
      properties: { fileKey: { type: 'string' }, node: compactNode, unblocked: { type: 'boolean' } },
    },
    ...problemResponses(ERRORS),
  },
};

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerBlockRoutes(app, { store, now, bus = null }) {
  const compact = (fileKey, n, at) => pick(nodeFields(fileKey, n, at), schemas.COMPACT_FIELDS);
  // `by`: the body `worker` when given; `portal:<label>` on a session-authenticated
  // call; else the token label — recorded as both the event actor and `blocked_by`.
  const actorOf = (request, body) => {
    const named = body && typeof body.worker === 'string' ? body.worker.trim() : '';
    return named || writeActor(request);
  };

  async function target(request) {
    const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, request.query.url);
    const raw = address.resolveNodeParam(request.params.nodeId, urlNodeId);
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
    return { fileKey, raw };
  }

  /** The stored id for a caller's `1:2` / `1-2`, read inside `tx`. */
  async function storedId(tx, fileKey, raw) {
    const ids = address.nodeIdCandidates(raw);
    const rows = await tx.getNodes(fileKey, ids);
    const found = ids.find(id => rows.some(n => n.nodeId === id));
    if (!found) throw address.nodeNotFound(fileKey, raw);
    return found;
  }

  app.post('/files/:fileKey/nodes/:nodeId/block', { schema: block }, /** @returns {Promise<import('./types').BlockReply>} */ async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/nodes/{nodeId}/block', 'post'>} */ request) => {
    rejectUnknownKeys('body', request.body, block.body);
    const { fileKey, raw } = await target(request);
    const reason = request.body.reason;
    const by = actorOf(request, request.body);
    const at = now().toISOString();
    const { node, released } = await withEvents(store, bus, async (tx, emit) => {
      const nodeId = await storedId(tx, fileKey, raw);
      const done = await tx.blockNode(fileKey, nodeId, { reason, by, at });
      await emit(fileKey, 'node.blocked', { actor: by, data: { nodeId, reason, by, auto: false } });
      return done;
    });
    return { fileKey, node: compact(fileKey, node, at), released };
  });

  app.post('/files/:fileKey/nodes/:nodeId/unblock', { schema: unblock }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/nodes/{nodeId}/unblock', 'post'>} */ request) => {
    rejectUnknownKeys('body', request.body, unblock.body);
    const { fileKey, raw } = await target(request);
    const by = actorOf(request, request.body);
    const at = now().toISOString();
    const result = await withEvents(store, bus, async (tx, emit) => {
      const nodeId = await storedId(tx, fileKey, raw);
      const done = await tx.unblockNode(fileKey, nodeId);
      if (!done) return { node: await tx.getNodeV3(fileKey, nodeId), unblocked: false };
      await emit(fileKey, 'node.unblocked', { actor: by, data: { nodeId, reason: done.prior.reason, by, auto: false } });
      return { node: done.node, unblocked: true };
    });
    return { fileKey, node: compact(fileKey, result.node, at), unblocked: result.unblocked };
  });
}

module.exports = { registerBlockRoutes, MAX_REASON_LENGTH };
