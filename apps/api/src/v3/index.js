'use strict';

/*
 * API v3 (docs/api-v3-design.md): every route lives under /v3, takes an agent
 * token — or, for GET routes, a viewer token — (except /v3/openapi.json),
 * validates with the schemas in schemas.js and answers errors as RFC 9457
 * problems (problem.js). Every response carries `X-RDS-Server`. The plugin
 * routes (plugin.js) take a plugin token instead.
 */
const swagger = require('@fastify/swagger');
const { bearer, roleOf, authLabel, AGENT, VIEWER, PLUGIN } = require('../auth');
const { readSession, requestOrigin, registerSessionRoutes } = require('../session');
const { Problem, problem, sendProblem } = require('./problem');
const { keyFromUrlish } = require('./address');
const { legacyRouteHint } = require('./legacy');
const { registerReadRoutes } = require('./read');
const { registerActionRoutes } = require('./actions');
const { registerEventRoutes } = require('./events');
const { registerInsightRoutes } = require('./insights');
const { registerBlockRoutes } = require('./block');
const { registerPluginRoutes } = require('./plugin');
const { registerStatusRoutes } = require('./status');
const { registerTokenRoutes } = require('./tokens');
const { registerClaimRoutes } = require('./claims');
const { registerFileRoutes } = require('./files');
const { registerNoteRoutes } = require('./notes');
const schemas = require('./schemas');
const { version: SERVER_VERSION } = require('../../package.json');

/** Methods a viewer token or session may call. */
const READ_METHODS = new Set(['GET', 'HEAD']);
/** Methods the cookie CSRF check guards. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/**
 * The session-cookie CSRF gate (docs/ui-portal.md, "CSRF"): a
 * cookie-authenticated POST/PATCH/DELETE must carry `X-RDS-Client: portal/…` and
 * an `Origin` equal to the request's own origin — the second layer after
 * `SameSite=Strict`.
 */
function checkSessionCsrf(request) {
  const client = request.headers['x-rds-client'];
  const okClient = typeof client === 'string' && client.startsWith('portal/');
  const origin = request.headers.origin;
  if (okClient && typeof origin === 'string' && origin.toLowerCase() === requestOrigin(request)) return;
  throw problem('csrf_rejected', 'Cookie-authenticated writes require an `X-RDS-Client: portal/…` header and a matching `Origin`.', {
    hint: 'Send `X-RDS-Client: portal/<version>` and make the call same-origin (its `Origin` must equal the API\'s own scheme and host). Bearer-token callers do not need either.',
  });
}

/** A viewer token or session may call this route: every read, and the writes flagged `config.viewerWrite` (notes). */
const viewerMay = request => READ_METHODS.has(request.method) || !!(request.routeOptions && request.routeOptions.config && request.routeOptions.config.viewerWrite);

/**
 * v3 auth: agent tokens call every route, viewer tokens the reads and the
 * note writes. A valid
 * `rds_session` cookie (a minted portal session) does the same when no
 * `Authorization` header was sent — the bearer token wins when both are
 * present — and writes through a session pass `checkSessionCsrf`.
 */
function v3Auth(config) {
  return async function v3Authenticate(request) {
    const token = bearer(request);
    if (!token) {
      const found = readSession(request, config);
      if (found.status === 'ok') {
        const { session } = found;
        if (session.role === AGENT || (session.role === VIEWER && viewerMay(request))) {
          if (WRITE_METHODS.has(request.method)) checkSessionCsrf(request);
          request.auth = { role: session.role, label: session.label, session: true };
          return;
        }
        throw problem('wrong_token_class', 'This route requires an agent session; a viewer session was sent.', {
          hint: 'Viewer sessions are read-only: they call v3 GET routes only. Sign in with an agent token to write.',
        });
      }
      if (found.status !== 'missing' && found.status !== 'disabled') {
        throw problem('invalid_token', 'The session cookie is not valid or has expired.', {
          hint: 'Sign in again with POST /v3/session.',
        });
      }
      throw problem('unauthorized', 'Missing bearer token.', { hint: 'Send Authorization: Bearer <agent token>.' });
    }
    const role = roleOf(config, token, [AGENT, VIEWER]);
    if (role === AGENT || (role === VIEWER && viewerMay(request))) {
      request.auth = { role, token, label: authLabel(config, token) };
      return;
    }
    if (role === VIEWER) {
      throw problem('wrong_token_class', 'This route requires an agent token; a viewer token was sent.', {
        hint: 'Viewer tokens (RDS_VIEWER_TOKENS) are read-only: they call v3 GET routes only. Use an agent token (RDS_AGENT_TOKENS) to write.',
      });
    }
    if (role === PLUGIN) {
      throw problem('wrong_token_class', 'This route requires an agent token; a plugin token was sent.', {
        hint: 'Plugin tokens only call the plugin routes (…/hashes, …/sync, …/exists). Use an agent token (RDS_AGENT_TOKENS) for the other v3 routes.',
      });
    }
    throw problem('invalid_token', 'The bearer token is not recognized.', {
      hint: 'Use an agent token from RDS_AGENT_TOKENS (or the local tokens file); viewer tokens (RDS_VIEWER_TOKENS) for reads only.',
    });
  };
}

/** Documents viewer access on the agent read routes: their `security` also lists `viewerToken`. */
function documentViewerAccess(route) {
  const methods = [].concat(route.method);
  const viewerWrite = !!(route.config && route.config.viewerWrite);
  if (!route.schema || !route.schema.security || !(viewerWrite || methods.every(m => READ_METHODS.has(m)))) return;
  if (!route.schema.security.some(s => s.agentToken)) return;
  route.schema = { ...route.schema, security: [...route.schema.security, { viewerToken: [] }] };
}

/** Documents the `429 rate_limited` problem (rateLimit.js) every v3 route can answer. */
function documentRateLimit(route) {
  if (!route.schema || !route.schema.response || route.schema.response[429]) return;
  route.schema = { ...route.schema, response: { ...route.schema.response, ...schemas.problemResponses([429]) } };
}

/** Documents cookie-session access on the token routes: a session of the same role always works. */
function documentSessionAccess(route) {
  if (!route.schema || !route.schema.security || !route.schema.security.some(s => s.agentToken)) return;
  if (route.schema.security.some(s => s.sessionCookie)) return;
  route.schema = { ...route.schema, security: [...route.schema.security, { sessionCookie: [] }] };
}

const distance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};

/** Unknown query parameters are a 400: a typo would otherwise silently widen a filter. */
async function rejectUnknownQuery(request) {
  const schema = request.routeOptions.schema;
  const allowed = Object.keys((schema && schema.querystring && schema.querystring.properties) || {});
  const unknown = Object.keys(request.query || {}).filter(k => !allowed.includes(k));
  if (!unknown.length) return;
  const suggestions = unknown
    .map(k => [k, allowed.find(a => a.toLowerCase() === k.toLowerCase()) || allowed.find(a => distance(a.toLowerCase(), k.toLowerCase()) <= 2)])
    .filter(([, s]) => s)
    .map(([k, s]) => `'${k}' → '${s}'`);
  const valid = allowed.length ? `Valid parameters: ${allowed.join(', ')}.` : 'This route takes no query parameters.';
  throw problem('unknown_parameter', `Unknown query parameter${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`, {
    hint: suggestions.length ? `Did you mean ${suggestions.join(', ')}? ${valid}` : valid,
    validParameters: allowed,
  });
}

function validationProblem(err) {
  const first = (err.validation && err.validation[0]) || {};
  const where = err.validationContext || 'request';
  const param = (first.instancePath || '').replace(/^\//, '') || (first.params && first.params.missingProperty) || where;
  return problem('invalid_parameter', `${where}${first.instancePath || ''} ${first.message || 'is invalid'}.`, {
    hint: `Check '${param}' against GET /v3/openapi.json.`,
  });
}

function errorHandler(err, request, reply) {
  if (err instanceof Problem) return sendProblem(reply, err);
  if (err.validation) return sendProblem(reply, validationProblem(err));
  if (err.statusCode && err.statusCode < 500) {
    return sendProblem(reply, problem('bad_request', err.message, { hint: 'Check the request against GET /v3/openapi.json.' }));
  }
  request.log.error(err);
  return sendProblem(reply, problem('internal_error', 'Internal server error.', { hint: 'Retry; if it persists, check the API logs.' }));
}

function notFoundHandler(request, reply) {
  const path = decodeURIComponent(String(request.url).split('?')[0]);
  const key = /^\/v3\/files\/[a-z]+:\/\//i.test(path) || /\/v3\/files\/.*figma\.com\//i.test(request.url) ? keyFromUrlish(request.url) : null;
  const hint = key
    ? `That looks like a Figma URL in the path. Use the file key '${key}', or /v3/files/-/…?url=<url-encoded figma link>.`
    : legacyRouteHint(request.method, path, request.query) || 'GET /v3/openapi.json lists every v3 route.';
  return sendProblem(reply, problem('route_not_found', `No route ${request.method} ${path}.`, { hint }));
}

async function v3Routes(v3, { config, store, now, bus, nodes, libraryLinks, blobs }) {
  v3.addHook('onRequest', async (request, reply) => { reply.header('x-rds-server', SERVER_VERSION); });
  v3.addHook('onRoute', documentViewerAccess);
  v3.addHook('onRoute', documentRateLimit);
  await v3.register(swagger, schemas.OPENAPI_OPTIONS);
  v3.setErrorHandler(errorHandler);
  v3.setNotFoundHandler(notFoundHandler);
  v3.addHook('preValidation', rejectUnknownQuery);
  const tokenRoutes = registerTokenRoutes(v3, { config, now });

  v3.get('/openapi.json', { schema: schemas.openapi }, async () => v3.swagger());
  registerSessionRoutes(v3, { config });

  v3.register(async authed => {
    authed.addHook('onRequest', v3Auth(config));
    authed.addHook('onRoute', documentSessionAccess);
    registerReadRoutes(authed, { store, now, libraryLinks });
    registerFileRoutes(authed, { store, now, bus });
    registerClaimRoutes(authed, { store, now });
    registerActionRoutes(authed, { store, now, config, bus, libraryLinks });
    registerEventRoutes(authed, { store, now, config, bus });
    registerBlockRoutes(authed, { store, now, bus, libraryLinks });
    registerNoteRoutes(authed, { store, now, bus, libraryLinks });
    registerInsightRoutes(authed, { store, now, config, libraryLinks });
    registerStatusRoutes(authed, { store, config, bus, libraryLinks });
    tokenRoutes(authed);
  });
  v3.register(async plugin => registerPluginRoutes(plugin, { config, nodes }));
}

/** Registered from app.js: `app.register(require('./v3'), { config })`. */
async function v3(app, { config }) {
  await app.register(v3Routes, { prefix: '/v3', config, store: app.store, bus: app.eventBus, nodes: app.nodeService, libraryLinks: app.libraryLinks, blobs: app.blobs, now: () => app.nodeService.now() });
}

v3.notFoundHandler = notFoundHandler;

module.exports = v3;
