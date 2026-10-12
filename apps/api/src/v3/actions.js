'use strict';

/*
 * v3 action routes (docs/api-v3-design.md, "Actions"): hash-guarded bulk
 * clear and claims. Claims share the node lease columns (`claimed_by` /
 * `claim_expires_at`) and add a `claim` row linked by `node.claim_id`.
 */
const { changeColumns } = require('../nodeService');
const { writeActor } = require('../auth');
const { withEvents, capIds } = require('../events/outbox');
const { problem } = require('./problem');
const address = require('./address');
const schemas = require('./schemas');
const { filterParams, buildFilter, nodeFields, pick, FILTER_KEYS } = require('./read');

const MAX_CLEAR_ITEMS = 500;
const MAX_CLAIM_NODES = schemas.MAX_LIMIT;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const CLAIM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- schemas -------------------------------------------------------------------
const { security, tags } = schemas.listNodes;
const { agentOp } = schemas;
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const str = description => ({ type: 'string', description });
const problemResponse = schemas.getFile.response[404];
const problemResponses = statuses => Object.fromEntries(statuses.map(s => [s, { ...problemResponse }]));
const ERRORS = [400, 401, 403, 404];
const fileKeyParams = schemas.getFile.params;
const urlQuery = { type: 'object', properties: { url: schemas.getFile.querystring.properties.url } };
const compactNode = schemas.listNodes.response[200].properties.nodes.items;
const claimParams = {
  type: 'object',
  required: ['fileKey', 'claimId'],
  properties: { fileKey: fileKeyParams.properties.fileKey, claimId: str('The `claimId` that `claim_nodes` returned.') },
};

const filterKeys = ['q', ...FILTER_KEYS.filter(k => k !== 'claimed' && k !== 'worker')];
const listQuery = schemas.listNodes.querystring.properties;
const claimFilter = {
  type: 'object',
  description: 'The `list_nodes` filters (`q` included) selecting the nodes to claim, e.g. `{ "under": "1:2", "category": "color" }` (`under` may list several roots: `"1:2,1:5"`); `claimed` and `worker` are implied. `{}` = the dirty nodes.',
  properties: Object.fromEntries(filterKeys.map(k => [k, listQuery[k]])),
};

const ttlSeconds = {
  type: 'integer', minimum: 1,
  description: `Lease length in seconds (default: the server's RDS_CLAIM_TTL_SECONDS; capped at ${MAX_TTL_SECONDS} = 24 h).`,
};

const claimOut = {
  type: 'object',
  properties: {
    claimId: { type: 'string' },
    worker: { type: 'string' },
    label: nullable('string'),
    expiresAt: { type: 'string' },
    nodes: { type: 'array', items: compactNode, description: 'The nodes leased under this claim.' },
  },
};

const clear = {
  summary: 'Clear implemented nodes',
  description: [
    `Records nodes as implemented (up to ${MAX_CLEAR_ITEMS} per call) once your code matches the design: they become clean, their current design becomes the new baseline, and their leases are released.`,
    'Send each node with the `contentHash` you implemented (from `list_nodes` / `get_node`). Each item is checked on its own and the call is 200 even when some fail:',
    '`cleared`; `stale` — the design changed since you read it, so re-read that node with `get_node`, implement the new changes and clear it with the returned `contentHash`; `not_found` — a wrong id; `not_removed` — `subtree: true` on a node that is not deleted (nothing cleared).',
    'Removed design (a `kind: "removed"` work item): once its code is gone, clear just its root with `subtree: true` — that also clears every dirty deleted node below it (`subtreeCleared`); live nodes below are untouched.',
    'Clear only what you actually built; never clear to hide changes (use `block_node` for nodes you cannot implement).',
    'The `nodes.cleared` event\'s actor is the body\'s `worker` when given, `portal:<label>` on a session-authenticated call, else the token label.',
  ].join(' '),
  tags, security,
  ...agentOp('clear_nodes', 'clear'),
  params: fileKeyParams,
  querystring: urlQuery,
  body: {
    type: 'object',
    required: ['items'],
    properties: {
      commitRef: nullable('string', { description: 'The commit (SHA or ref) that implements the nodes; shown in node history.' }),
      worker: { type: 'string', minLength: 1, maxLength: 200, description: 'Your worker id; recorded as the `nodes.cleared` actor (default: the token label).' },
      items: {
        type: 'array', minItems: 1, maxItems: MAX_CLEAR_ITEMS,
        description: `The nodes to clear (1–${MAX_CLEAR_ITEMS}), each with the \`contentHash\` you implemented.`,
        items: {
          type: 'object',
          required: ['nodeId', 'contentHash'],
          additionalProperties: false,
          properties: {
            nodeId: { type: 'string', minLength: 1, description: 'Node id (1:2 or 1-2).' },
            contentHash: { type: 'string', minLength: 1, description: 'The node\'s `contentHash` as you read it before implementing.' },
            subtree: { type: 'boolean', default: false, description: 'For a deleted (removed) root: also clear every dirty deleted node below it. On a live node the item fails with `not_removed`.' },
          },
        },
      },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        fileKey: { type: 'string' },
        commitRef: nullable('string'),
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              status: { type: 'string', enum: ['cleared', 'stale', 'not_found', 'not_removed'] },
              contentHash: nullable('string', { description: 'cleared: the hash cleared; stale and not_removed: the current hash; not_found: null.' }),
              subtreeCleared: { type: 'integer', description: 'subtree: true and cleared: how many deleted nodes below the root were cleared with it.' },
            },
          },
        },
        totals: {
          type: 'object',
          properties: { cleared: { type: 'integer' }, stale: { type: 'integer' }, notFound: { type: 'integer' }, notRemoved: { type: 'integer' } },
        },
      },
    },
    ...problemResponses(ERRORS),
  },
};

const createClaim = {
  summary: 'Claim nodes',
  description: [
    'Leases nodes to `worker` so parallel agents do not implement the same nodes. Claim before working when other agents may share the file; alone, you can skip claims.',
    'Select by `nodeIds` or by `filter` (not both; neither = the dirty nodes, up to `limit`). Only free, expired or already-yours nodes are taken, and the response lists exactly those — work on those only; an empty `nodes` means nothing free matched.',
    'The lease ends at `expiresAt`: `renew_claim` before then for long work; `clear_nodes` releases cleared nodes, `release_claim` the rest.',
  ].join(' '),
  tags, security,
  ...agentOp('claim_nodes', 'claim'),
  params: fileKeyParams,
  querystring: urlQuery,
  body: {
    type: 'object',
    required: ['worker'],
    properties: {
      worker: { type: 'string', minLength: 1, description: 'A stable id for your agent session; reuse it on every call.' },
      label: nullable('string', { maxLength: 200, description: 'A short human-readable name for the work, shown in logs and UIs.' }),
      ttlSeconds,
      limit: { type: 'integer', minimum: 1, maximum: MAX_CLAIM_NODES, description: `At most this many nodes (default ${schemas.DEFAULT_LIMIT} with a filter; every listed id with nodeIds).` },
      nodeIds: { type: 'array', minItems: 1, maxItems: MAX_CLAIM_NODES, items: { type: 'string', minLength: 1 }, description: 'Exact node ids to claim (1:2 or 1-2); unknown ids are skipped.' },
      filter: claimFilter,
    },
  },
  response: { 200: claimOut, ...problemResponses(ERRORS) },
};

const renewClaim = {
  summary: 'Renew a claim',
  description: 'Extends the lease (to now + `ttlSeconds`) on the nodes still held under this claim; nodes cleared, released, expired or re-claimed since are not renewed, and the response lists the rest. Renew before `expiresAt` while work takes longer than the lease. `claim_not_found`: the id is wrong — take a new claim with `claim_nodes`.',
  tags, security,
  ...agentOp('renew_claim', 'renew'),
  params: claimParams,
  querystring: urlQuery,
  body: nullable('object', { properties: { ttlSeconds }, description: 'Optional; `{}` or null renews for the default lease.' }),
  response: { 200: claimOut, ...problemResponses(ERRORS) },
};

const releaseClaim = {
  summary: 'Release a claim',
  description: 'Ends the claim and frees the nodes still under it, so other agents can take them. Call it when you stop without clearing everything (cleared nodes are already released). `claim_not_found`: the id is wrong; an unreleased lease simply expires at `expiresAt`.',
  tags, security,
  ...agentOp('release_claim', 'release'),
  params: claimParams,
  querystring: urlQuery,
  response: {
    200: {
      type: 'object',
      properties: {
        claimId: { type: 'string' },
        worker: { type: 'string' },
        label: nullable('string'),
        released: { type: 'array', items: { type: 'string' }, description: 'Ids of the nodes unleased.' },
      },
    },
    ...problemResponses(ERRORS),
  },
};

// --- routes ----------------------------------------------------------------------
/** Unknown body members are a 400: a typo (e.g. `nodeIDs`) would otherwise silently widen a claim. */
function rejectUnknownKeys(where, value, schema) {
  const allowed = Object.keys(schema.properties);
  const unknown = Object.keys(value || {}).filter(k => !allowed.includes(k));
  if (!unknown.length) return;
  throw problem('invalid_body', `${where}: unknown member${unknown.length > 1 ? 's' : ''} ${unknown.map(k => `'${k}'`).join(', ')}.`, {
    hint: `Valid members: ${allowed.join(', ')}.`,
    validParameters: allowed,
  });
}

const claimNotFound = claimId => problem('claim_not_found', `No claim '${claimId}' on this file.`, {
  hint: 'Use the claimId returned by POST /v3/files/{fileKey}/claims; a released claim can be renewed only while it has not expired.',
});

/** `claim.*` event data: the claim and (up to 500 of) its node ids. */
const claimData = (claim, nodeIds) => ({
  claimId: claim.claimId, worker: claim.worker, label: claim.label ?? null, expiresAt: claim.expiresAt,
  nodeIds: capIds(nodeIds), nodeCount: nodeIds.length,
});

/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerActionRoutes(app, { store, now, config, bus = null }) {
  const defaultTtl = Math.min(config.claimTtlSeconds, MAX_TTL_SECONDS);
  const expiry = (at, ttl) => new Date(Date.parse(at) + Math.min(ttl ?? defaultTtl, MAX_TTL_SECONDS) * 1000).toISOString();
  const compact = (fileKey, n, at) => pick(nodeFields(fileKey, n, at), schemas.COMPACT_FIELDS);

  async function trackedFile(fileKey) {
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
  }

  /** Caller ids (`1:2` / `1-2`) → stored node ids, via one batched lookup. */
  async function resolveIds(tx, fileKey, raws) {
    const candidates = raws.map(raw => address.nodeIdCandidates(raw));
    const rows = await tx.getNodes(fileKey, [...new Set(candidates.flat())]);
    const byId = new Map(rows.map(n => [n.nodeId, n]));
    return candidates.map(ids => byId.get(ids.find(id => byId.has(id))) || null);
  }

  app.post('/files/:fileKey/clear', { schema: clear }, /** @returns {Promise<import('./types').ClearReply>} */ async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/clear', 'post'>} */ request) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    rejectUnknownKeys('body', request.body, clear.body);
    const { items, commitRef = null } = request.body;
    const actor = (typeof request.body.worker === 'string' && request.body.worker.trim()) || writeActor(request);
    await trackedFile(fileKey);
    const patch = {
      ...changeColumns({ dirty: false }),
      dirty: false,
      implementedCommit: commitRef || null,
      implementedAt: now().toISOString(),
      claimedBy: null,
      claimExpiresAt: null,
      claimId: null,
    };
    const results = await withEvents(store, bus, async (tx, emit) => {
      const nodes = await resolveIds(tx, fileKey, items.map(i => i.nodeId));
      const notRemoved = items.map((item, i) => !!(item.subtree && nodes[i] && !nodes[i].deletedAt));
      const found = items.map((item, i) => nodes[i] && !notRemoved[i] && { nodeId: nodes[i].nodeId, contentHash: item.contentHash }).filter(Boolean);
      const cleared = await tx.clearNodes(fileKey, found, patch);
      const done = new Set(cleared.map(c => `${c.nodeId}\u0000${c.contentHash}`));
      /** Rows by id, for the cleared nodes' lease holders. */
      const rows = new Map(nodes.filter(Boolean).map(n => [n.nodeId, n]));
      /** Removed root id → how many deleted descendants it cleared. */
      const subtreeCleared = new Map();
      for (const [i, item] of items.entries()) {
        const root = nodes[i];
        if (!item.subtree || !root || notRemoved[i] || !done.has(`${root.nodeId}\u0000${item.contentHash}`) || subtreeCleared.has(root.nodeId)) continue;
        const below = (await tx.listNodeSubtree(fileKey, root.nodeId, { dirty: true }))
          .filter(n => n.deletedAt && n.nodeId !== root.nodeId && n.contentHash);
        for (const n of below) if (!rows.has(n.nodeId)) rows.set(n.nodeId, n);
        const more = below.length ? await tx.clearNodes(fileKey, below.map(n => ({ nodeId: n.nodeId, contentHash: /** @type {string} */ (n.contentHash) })), patch) : [];
        subtreeCleared.set(root.nodeId, more.length);
        cleared.push(...more);
      }
      if (cleared.length) {
        const clearedIds = [...new Set(cleared.map(c => c.nodeId))];
        const holders = new Set(clearedIds.map(id => rows.get(id)).map(n => (n && n.claimedBy) || null));
        const worker = holders.size === 1 ? [...holders][0] : null;
        await emit(fileKey, 'nodes.cleared', {
          actor,
          data: { nodeIds: capIds(clearedIds), count: clearedIds.length, commitRef: commitRef || null, worker },
        });
      }
      return items.map((item, i) => {
        const node = nodes[i];
        if (!node) return { nodeId: item.nodeId, status: 'not_found', contentHash: null };
        if (notRemoved[i]) return { nodeId: node.nodeId, status: 'not_removed', contentHash: node.contentHash ?? null };
        if (done.has(`${node.nodeId}\u0000${item.contentHash}`)) {
          return { nodeId: node.nodeId, status: 'cleared', contentHash: item.contentHash, ...(item.subtree ? { subtreeCleared: subtreeCleared.get(node.nodeId) ?? 0 } : {}) };
        }
        return { nodeId: node.nodeId, status: 'stale', contentHash: node.contentHash ?? null };
      });
    });
    const count = status => results.filter(r => r.status === status).length;
    return { fileKey, commitRef: commitRef || null, results, totals: { cleared: count('cleared'), stale: count('stale'), notFound: count('not_found'), notRemoved: count('not_removed') } };
  });

  app.post('/files/:fileKey/claims', { schema: createClaim }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/claims', 'post'>} */ request) => {
    const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, request.query.url);
    rejectUnknownKeys('body', request.body, createClaim.body);
    rejectUnknownKeys('filter', request.body.filter, claimFilter);
    const { label = null, ttlSeconds: ttl, limit, nodeIds, filter } = request.body;
    const worker = request.body.worker.trim();
    if (!worker) throw problem('invalid_body', 'worker must not be blank.', { hint: 'Pass a worker id that identifies your agent session.' });
    if (nodeIds && filter) throw problem('invalid_body', 'Pass nodeIds or filter, not both.', { hint: 'Claim explicit ids with nodeIds, or listing parameters with filter.' });
    const at = now().toISOString();
    let storeFilter = null;
    if (!nodeIds) {
      const params = filterParams(filter || {});
      for (const k of ['claimed', 'worker']) {
        if (params[k] !== undefined) throw problem('invalid_body', `filter.q: '${k}' is implied by a claim.`, { hint: 'Claims take unclaimed, expired and your own nodes; drop claimed/worker from the filter.' });
      }
      if (params.under === undefined && urlNodeId) params.under = urlNodeId;
      storeFilter = { ...buildFilter(params, at), claimed: ['false', 'mine'], worker };
    }
    await trackedFile(fileKey);

    const { claim, nodes } = await withEvents(store, bus, async (tx, emit) => {
      let ids;
      if (nodeIds) {
        ids = [...new Set((await resolveIds(tx, fileKey, nodeIds)).filter(Boolean).map(n => n.nodeId))];
        if (limit !== undefined) ids = ids.slice(0, limit);
      } else if (storeFilter) {
        if (storeFilter.under !== null) {
          const roots = await resolveIds(tx, fileKey, storeFilter.under);
          const unknown = roots.findIndex(n => !n);
          if (unknown >= 0) throw address.nodeNotFound(fileKey, storeFilter.under[unknown]);
          storeFilter.under = [...new Set(roots.map(n => /** @type {any} */ (n).nodeId))];
        }
        const page = await tx.listNodes(fileKey, storeFilter, { sort: 'document', desc: false, limit: limit ?? schemas.DEFAULT_LIMIT, after: null, counts: false });
        ids = page.nodes.map(n => n.nodeId);
      }
      const taken = await tx.createClaim({ fileKey, worker, label, expiresAt: expiry(at, ttl), nowIso: at, nodeIds: ids });
      const byId = new Map(taken.nodes.map(n => [n.nodeId, n]));
      const leased = ids.filter(id => byId.has(id)).map(id => byId.get(id));
      await emit(fileKey, 'claim.created', { actor: writeActor(request, worker), data: claimData(taken.claim, leased.map(n => n.nodeId)) });
      return { claim: taken.claim, nodes: leased };
    });
    return {
      claimId: claim.claimId, worker: claim.worker, label: claim.label, expiresAt: claim.expiresAt,
      nodes: nodes.map(n => compact(fileKey, n, at)),
    };
  });

  app.post('/files/:fileKey/claims/:claimId/renew', { schema: renewClaim }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/claims/{claimId}/renew', 'post'>} */ request) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    const { claimId } = request.params;
    if (!CLAIM_ID.test(claimId)) throw claimNotFound(claimId);
    await trackedFile(fileKey);
    const at = now().toISOString();
    rejectUnknownKeys('body', request.body, renewClaim.body);
    const ttl = request.body ? request.body.ttlSeconds : undefined;
    const result = await withEvents(store, bus, async (tx, emit) => {
      const renewed = await tx.renewClaim(fileKey, claimId, { expiresAt: expiry(at, ttl), nowIso: at });
      // `UPDATE … RETURNING` has no defined order; sort by node id like release.
      if (renewed) renewed.nodes.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
      if (renewed) await emit(fileKey, 'claim.renewed', { actor: writeActor(request, renewed.claim.worker), data: claimData(renewed.claim, renewed.nodes.map(n => n.nodeId)) });
      return renewed;
    });
    if (!result) throw claimNotFound(claimId);
    const { claim, nodes } = result;
    return { claimId: claim.claimId, worker: claim.worker, label: claim.label, expiresAt: claim.expiresAt, nodes: nodes.map(n => compact(fileKey, n, at)) };
  });

  app.delete('/files/:fileKey/claims/:claimId', { schema: releaseClaim }, async (/** @type {import('./types').V3Request<'/v3/files/{fileKey}/claims/{claimId}', 'delete'>} */ request) => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    const { claimId } = request.params;
    if (!CLAIM_ID.test(claimId)) throw claimNotFound(claimId);
    await trackedFile(fileKey);
    const result = await withEvents(store, bus, async (tx, emit) => {
      const released = await tx.releaseClaim(fileKey, claimId, { nowIso: now().toISOString() });
      if (released) await emit(fileKey, 'claim.released', { actor: writeActor(request, released.claim.worker), data: claimData(released.claim, released.nodes.map(n => n.nodeId).sort()) });
      return released;
    });
    if (!result) throw claimNotFound(claimId);
    const { claim, nodes } = result;
    return { claimId: claim.claimId, worker: claim.worker, label: claim.label, released: nodes.map(n => n.nodeId).sort() };
  });
}

module.exports = { registerActionRoutes, rejectUnknownKeys, MAX_CLEAR_ITEMS, MAX_TTL_SECONDS };
