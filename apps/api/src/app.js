'use strict';

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { loadConfig } = require('./config');
const { HttpError } = require('./errors');
const { NodeSyncService } = require('./nodeService');
const v3 = require('./v3');
const { registerPortalRoutes } = require('./static');
const { requestOrigin } = require('./session');
const { registerRateLimits } = require('./rateLimit');
const { MemoryBus } = require('./events/bus');
const { withClient } = require('./events/outbox');
const { LibraryLinks } = require('./library');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_CLIENT_LENGTH = 100;

/** True when a `Host` header names a loopback host, on any port or none. */
function isLoopbackHostHeader(header) {
  const m = /^(\[[^\]]*\]|[^:[\]]*)(?::\d*)?$/.exec(String(header || '').toLowerCase());
  return !!m && LOOPBACK_HOSTS.has(m[1]);
}

/**
 * Build the Fastify app. `store` implements the data layer interface
 * (store/memory.js or store/postgres.js); `config` comes from loadConfig();
 * `bus` is the event bus (events/), in-memory unless given. The caller owns
 * the store's and the bus's lifecycles. `now` is the rate limits' clock.
 *
 * @param {{
 *   store?: import('./store/types').Store,
 *   config?: ReturnType<typeof loadConfig>,
 *   logger?: import('fastify').FastifyServerOptions['logger'],
 *   bus?: import('./events/bus').MemoryBus | import('./events/postgres').PostgresBus,
 *   now?: () => number,
 *   libraryLinks?: LibraryLinks,
 * }} [options]
 */
function buildApp({ store, config = loadConfig(), logger = false, bus = new MemoryBus(), now = Date.now, libraryLinks } = {}) {
  if (!store) throw new Error('buildApp requires a store.');
  // Fastify takes a hop count for trustProxy too; its typings omit `number`.
  const app = Fastify({ logger, bodyLimit: config.bodyLimit, trustProxy: /** @type {any} */ (config.trustProxy || false) });

  // Embedded modes (RDS_STORE=local|memory) serve one user's machine, so they
  // refuse browser traffic from web pages before auth: the Host must name a
  // loopback host on any port (DNS-rebinding defense; rebinding puts the
  // attacker's hostname in Host), and the only Origins accepted are `null` (the
  // plugin's sandboxed frame), none (CLI, MCP, curl), the request's own origin
  // (the portal the API itself serves at /ui) and the loopback UI origins in
  // RDS_UI_ORIGINS.
  const uiOrigins = new Set(config.uiOrigins || []);
  // Serialized as is: a route's response schema (v3 problems) must not reshape it.
  const reject = (reply, error, message) => reply.code(403).type('application/json; charset=utf-8').serializer(JSON.stringify).send({ error, message });
  if (config.checkHost || config.checkOrigin) {
    app.addHook('onRequest', async (request, reply) => {
      if (config.checkHost && !isLoopbackHostHeader(request.headers.host)) {
        return reject(reply, 'forbidden_host', 'Host not allowed.');
      }
      const origin = request.headers.origin;
      if (config.checkOrigin && origin !== undefined && origin !== 'null' && !uiOrigins.has(String(origin).toLowerCase())
        && String(origin).toLowerCase() !== requestOrigin(request)) {
        return reject(reply, 'forbidden_origin', 'Origin not allowed.');
      }
    });
  }

  // The Figma plugin UI runs in a sandboxed iframe (Origin: null) and sends
  // Authorization + JSON, so browsers fire a CORS preflight. Answer it globally
  // (before the per-route bearer-auth hooks) or every upload fails with
  // "Failed to fetch". With DATABASE_URL any origin is reflected; in the
  // embedded modes the hook above has already rejected every origin but `null`
  // and the RDS_UI_ORIGINS ones.
  // Access-Control-Allow-Private-Network is never sent. Token auth remains the
  // security boundary everywhere.
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-rds-client'],
    exposedHeaders: ['x-rds-server', 'x-rds-next-cursor', 'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset'],
    maxAge: 86400,
  });

  // Rate limits run after CORS so a 429 still reaches a browser caller.
  app.after(() => registerRateLimits(app, config.rateLimit, { now }));

  const links = libraryLinks || new LibraryLinks({ store, token: config.figmaToken, log: app.log });
  app.addHook('onClose', async () => links.close());
  const nodes = new NodeSyncService(store, { bus, libraryLinks: links });
  app.decorate('nodeService', nodes);
  app.decorate('libraryLinks', links);
  app.decorate('store', store);
  app.decorate('eventBus', bus);

  app.setErrorHandler((/** @type {import('fastify').FastifyError} */ err, request, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: 'bad_request', message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code || 'error', message: err.message });
    request.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Internal server error.' });
  });

  // `X-RDS-Client: <name>/<version>` is logged and recorded as `data.client` on
  // the events this request writes (docs/api-v3-phase2.md, "Client versions").
  app.addHook('preHandler', (request, reply, done) => {
    const raw = request.headers['x-rds-client'];
    const client = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, MAX_CLIENT_LENGTH) : null;
    if (client) request.log.debug({ client }, 'client');
    withClient(client, done);
  });

  app.get('/health', async () => ({ ok: true }));

  // Every API route is under /v3; any other path (the removed v1 and v2 routes
  // among them) is a v3 `route_not_found` problem — except `/ui`, which serves
  // the portal build, and `/`, which redirects to it.
  app.setNotFoundHandler(v3.notFoundHandler);
  registerPortalRoutes(app, { config });
  app.register(v3, { config });

  return app;
}

module.exports = { buildApp };
