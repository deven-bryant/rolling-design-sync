'use strict';

const { TOKEN_FIELDS, authLabel, bearer } = require('../auth');
const { readSession } = require('../session');
const schemas = require('./schemas');

function registerTokenRoutes(app, { config, now }) {
  const used = new Map();
  function record(request) {
    if (!request.auth) return;
    const token = request.auth.token || readSession(request, config).token;
    if (token) used.set(token, now().toISOString());
  }
  app.addHook('preValidation', async request => { record(request); });
  app.addHook('onSend', async (request, reply, payload) => {
    record(request);
    if (request.routeOptions.url === '/v3/session' && reply.statusCode === 200) {
      const token = request.method === 'POST' ? request.body.token : bearer(request) || readSession(request, config).token;
      if (token) used.set(token, now().toISOString());
    }
    return payload;
  });
  return function routes(authed) {
    authed.get('/tokens', {
      schema: {
        summary: 'List token labels and last use',
        description: 'Configured token classes and labels only, never token values. `lastUsedAt` records authenticated bearer and session requests on this server instance, is null before use, and resets on restart. Unnamed tokens use their stable hash label.',
        tags: schemas.listNodes.tags, security: schemas.listNodes.security,
        response: {
          200: {
            type: 'array', items: {
              type: 'object', properties: {
                class: { type: 'string', enum: Object.keys(TOKEN_FIELDS) },
                label: { type: 'string' }, lastUsedAt: { type: ['string', 'null'] },
              },
            },
          },
          401: schemas.getFile.response[401], 403: schemas.getFile.response[403],
        },
      },
    }, async () => Object.entries(TOKEN_FIELDS).flatMap(([role, field]) => (config[field] || []).map(token => ({
      class: role, label: authLabel(config, token), lastUsedAt: used.get(token) ?? null,
    }))));
  };
}

module.exports = { registerTokenRoutes };
