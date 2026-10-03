'use strict';

const { timingSafeEqual, createHash } = require('node:crypto');

const PLUGIN = 'plugin';
const AGENT = 'agent';
const VIEWER = 'viewer';

const TOKEN_FIELDS = { [PLUGIN]: 'pluginTokens', [AGENT]: 'agentTokens', [VIEWER]: 'viewerTokens' };

function safeEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function matches(tokens, presented) {
  return tokens.some(t => safeEqual(t, presented));
}

function bearer(request) {
  const header = request.headers.authorization || '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1] : null;
}

/** The class of `token`, trying `preferred` classes first; null when no class holds it. */
function roleOf(config, token, preferred = []) {
  const order = [...preferred, ...Object.keys(TOKEN_FIELDS).filter(r => !preferred.includes(r))];
  return order.find(r => matches(config[TOKEN_FIELDS[r]] || [], token)) || null;
}

/** The label for a token: its `name:` label (docs/ui-portal.md, "Token labels"), else the hash label. */
function authLabel(config, token) {
  return (config.tokenLabels && config.tokenLabels.get(token)) || tokenLabel(token);
}

/**
 * The `actor` to record on an event for a write: `portal:<label>` when the
 * request was authenticated by a portal session cookie, else `fallback` —
 * the request's token label by default, or a worker id the route chose.
 */
function writeActor(request, fallback = request.auth.label) {
  return request.auth.session ? `portal:${request.auth.label}` : fallback;
}

/**
 * Fastify preHandler factory: allows only tokens of the given class. A valid
 * session cookie (`readSession`, from session.js) with the needed role also
 * passes when no `Authorization` header was sent; a bearer token wins when
 * both are present.
 */
function requireRole(config, role, readSession = null) {
  return async function authenticate(request, reply) {
    const token = bearer(request);
    if (!token) {
      const found = readSession && readSession(request, config);
      if (found && found.status === 'ok' && found.session.role === role) {
        request.auth = { role, label: found.session.label, session: true };
        return;
      }
      return reply.code(401).send({ error: 'unauthorized', message: 'Missing bearer token.' });
    }
    const held = roleOf(config, token, [role]);
    if (held === role) { request.auth = { role, token, label: authLabel(config, token) }; return; }
    if (held) return reply.code(403).send({ error: 'forbidden', message: `This route requires ${role === AGENT ? 'an' : 'a'} ${role} token.` });
    return reply.code(401).send({ error: 'unauthorized', message: 'Invalid bearer token.' });
  };
}

/** Short stable label for a token, used as the `agent` column (never the raw token). */
function tokenLabel(token) {
  return 'token:' + createHash('sha256').update(token).digest('hex').slice(0, 12);
}

module.exports = { PLUGIN, AGENT, VIEWER, TOKEN_FIELDS, requireRole, roleOf, authLabel, writeActor, tokenLabel, bearer };
