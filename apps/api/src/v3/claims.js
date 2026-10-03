'use strict';

const schemas = require('./schemas');
const address = require('./address');

const claim = {
  type: 'object', properties: {
    claimId: { type: 'string' }, worker: { type: 'string' }, label: { type: ['string', 'null'] },
    expiresAt: { type: 'string' }, createdAt: { type: 'string' },
    nodeCount: { type: 'integer' }, nodeIds: { type: 'array', maxItems: 500, items: { type: 'string' } },
    nodes: {
      type: 'array', maxItems: 3, description: 'The first 3 leased nodes in document order, with their layer name and node type — enough to say what the claim covers ("Table, +3") without reading each node.',
      items: { type: 'object', properties: { nodeId: { type: 'string' }, name: { type: ['string', 'null'] }, type: { type: ['string', 'null'] } } },
    },
  },
};
const description = 'Active (unexpired) claims, soonest expiry first. `nodeCount` counts nodes still leased to each claim; `nodeIds` contains at most 500 of them in node-id order; `nodes` names the first 3 in document order. Cleared, released, expired or reassigned nodes are excluded. Use this to see agents at work, then list_nodes with claimed=mine and worker to inspect a worker\'s nodes.';
const base = {
  description, tags: schemas.listNodes.tags, security: schemas.listNodes.security,
  response: { 401: schemas.getFile.response[401], 403: schemas.getFile.response[403] },
};

/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerClaimRoutes(app, { store, now }) {
  app.get('/files/:fileKey/claims', {
    schema: {
      ...base, summary: 'List file claims', ...schemas.agentOp('list_claims', 'claims ls'),
      params: schemas.getFile.params,
      querystring: { type: 'object', properties: { url: schemas.getFile.querystring.properties.url } },
      response: {
        ...base.response, 400: schemas.getFile.response[400], 404: schemas.getFile.response[404],
        200: { type: 'object', properties: { fileKey: { type: 'string' }, claims: { type: 'array', items: claim } } },
      },
    },
  }, async request => {
    const { fileKey } = address.resolveFile(request.params.fileKey, request.query.url);
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
    return { fileKey, claims: await store.listClaims({ fileKey, nowIso: now().toISOString() }) };
  });
  app.get('/claims', {
    schema: {
      ...base, summary: 'List claims across files', description: `${description} Each claim includes fileKey and fileName.`,
      response: {
        ...base.response,
        200: { type: 'object', properties: { claims: { type: 'array', items: { ...claim, properties: { ...claim.properties, fileKey: { type: 'string' }, fileName: { type: ['string', 'null'], description: 'The Figma file\'s name (null before a sync sent one).' } } } } } },
      },
    },
  }, async () => ({ claims: await store.listClaims({ nowIso: now().toISOString() }) }));
}

module.exports = { registerClaimRoutes };
