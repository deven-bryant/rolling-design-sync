'use strict';

/*
 * Browser sessions (docs/ui-portal.md, "Sign-in and sessions"): a signed
 * `rds_session` cookie minted from a viewer or agent token, so a browser can
 * call v3 — including the EventSource streams it cannot attach a bearer
 * token to — without keeping the token in JS-reachable storage.
 *
 * Stateless: the cookie carries `{ role, fp, exp }` (base64url JSON),
 * HMAC-SHA256-signed with `RDS_SESSION_SECRET`. `fp` is the token's SHA-256,
 * re-compared in constant time against the configured tokens on every
 * request, so removing a token signs its sessions out everywhere without
 * shared state.
 */
const { createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { AGENT, VIEWER, PLUGIN, TOKEN_FIELDS, roleOf, authLabel } = require('./auth');
const { problem } = require('./v3/problem');
const { rejectUnknownKeys } = require('./v3/actions');
const schemas = require('./v3/schemas');

const COOKIE = 'rds_session';
const TTL_SECONDS = 12 * 60 * 60;

const fingerprint = token => createHash('sha256').update(token).digest();
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function sessionCookie(request) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The scheme the client used: `X-Forwarded-Proto` first (TLS often ends at the proxy), else the socket's. */
function requestProto(request) {
  const fwd = request.headers['x-forwarded-proto'];
  const first = typeof fwd === 'string' && fwd.split(',')[0].trim();
  return String(first || request.protocol || 'http').toLowerCase();
}

/** The request's own origin (`scheme://host`, lowercased) — what a same-origin `Origin` header must equal. */
function requestOrigin(request) {
  return `${requestProto(request)}://${String(request.headers.host || '').toLowerCase()}`;
}

/** `{ role, label, value, expiresAt }` for a minted session, or null when `token` is no viewer/agent token. */
function mintSession(config, token) {
  const role = roleOf(config, token, [AGENT, VIEWER]);
  if (role !== AGENT && role !== VIEWER) return null;
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ role, fp: fingerprint(token).toString('hex'), exp })).toString('base64url');
  return {
    role,
    label: authLabel(config, token),
    expiresAt: new Date(exp * 1000).toISOString(),
    value: `${payload}.${sign(config.sessionSecret, payload)}`,
  };
}

/**
 * The session `request`'s cookie carries: `{ status: 'ok', session }`, or
 * `missing` / `disabled` / `invalid` / `expired` / `revoked`. A revoked
 * session is one whose token is no longer configured — the fingerprint check
 * is what signs its sessions out without shared state.
 */
function readSession(request, config) {
  const value = sessionCookie(request);
  if (!value) return { status: 'missing' };
  if (!config.sessionSecret) return { status: 'disabled' };
  const at = value.indexOf('.');
  const payload = at === -1 ? '' : value.slice(0, at);
  const signature = at === -1 ? '' : value.slice(at + 1);
  if (!payload || !signature || !safeEqual(sign(config.sessionSecret, payload), signature)) return { status: 'invalid' };
  let body;
  try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { status: 'invalid' }; }
  if (!body || (body.role !== AGENT && body.role !== VIEWER) || typeof body.fp !== 'string' || !/^[0-9a-f]{64}$/i.test(body.fp) || !Number.isFinite(body.exp)) {
    return { status: 'invalid' };
  }
  if (body.exp * 1000 <= Date.now()) return { status: 'expired' };
  const fp = Buffer.from(body.fp, 'hex');
  for (const token of config[TOKEN_FIELDS[body.role]] || []) {
    if (safeEqual(fingerprint(token), fp)) {
      return { status: 'ok', token, session: { role: body.role, label: authLabel(config, token), expiresAt: new Date(body.exp * 1000).toISOString() } };
    }
  }
  return { status: 'revoked' };
}

/** `rds_session` Set-Cookie: `Secure` when the request came over HTTPS (X-Forwarded-Proto counts). */
function setSessionCookie(reply, request, value) {
  const secure = requestProto(request) === 'https' ? '; Secure' : '';
  reply.header('set-cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}${secure}`);
}

function clearSessionCookie(reply, request) {
  const secure = requestProto(request) === 'https' ? '; Secure' : '';
  reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

const sessionsDisabled = () => problem('sessions_disabled', 'Browser sessions are disabled: RDS_SESSION_SECRET is not configured.', {
  hint: 'Set RDS_SESSION_SECRET to a strong random value (generate like the API tokens); RDS_STORE=local generates one into tokens.json automatically.',
});

// --- schemas -------------------------------------------------------------------
const { tags } = schemas.listNodes;
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const problemResponse = schemas.getFile.response[404];
const problemResponses = statuses => Object.fromEntries(statuses.map(s => [s, { ...problemResponse }]));

const sessionOut = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: [AGENT, VIEWER] },
    label: { type: 'string', description: 'The token\'s label: its `name:` in the token list, or the hash label.' },
    expiresAt: { type: 'string', description: 'ISO 8601; the session ends then or when the token is removed from the server.' },
  },
};
const sessionSecurity = [{ sessionCookie: [] }];

const createSession = {
  summary: 'Sign in (mint a session cookie)',
  description: [
    'Mints the `rds_session` browser cookie from a viewer or agent token — how the portal signs in, since a browser cannot attach a bearer token to `EventSource` and must not keep tokens in `localStorage`.',
    'Responds `{ role, label, expiresAt }` and sets the cookie (`HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, `Secure` over HTTPS). The session is stateless and ends at `expiresAt` or when its token leaves the server\'s token lists.',
    'A plugin token gets `403 wrong_token_class`; an unknown token `401 invalid_token`; a server without `RDS_SESSION_SECRET` `503 sessions_disabled`.',
    'Cookie-authenticated POST/DELETE requests to the other v3 routes must also send `X-RDS-Client: portal/<version>` and an `Origin` equal to the API\'s own origin, else `403 csrf_rejected`.',
  ].join(' '),
  tags,
  body: {
    type: 'object',
    required: ['token'],
    properties: { token: { type: 'string', minLength: 1, description: 'An agent or viewer token (RDS_AGENT_TOKENS / RDS_VIEWER_TOKENS).' } },
  },
  response: { 200: sessionOut, ...problemResponses([400, 401, 403, 503]) },
};

const readSessionSchema = {
  summary: 'Read the current session',
  description: 'The session the `rds_session` cookie carries: `{ role, label, expiresAt }`. `401 unauthorized` when the cookie is absent or no longer valid (expired, tampered, or the token was removed).',
  tags,
  security: sessionSecurity,
  response: { 200: sessionOut, ...problemResponses([401, 503]) },
};

const deleteSession = {
  summary: 'Sign out',
  description: 'Clears the `rds_session` cookie.',
  tags,
  response: { 200: { type: 'object', properties: { signedOut: { type: 'boolean' } } } },
};

// --- routes ----------------------------------------------------------------------
function registerSessionRoutes(app, { config }) {
  app.post('/session', { schema: createSession }, async (request, reply) => {
    if (!config.sessionSecret) throw sessionsDisabled();
    rejectUnknownKeys('body', request.body, createSession.body);
    const minted = mintSession(config, request.body.token);
    if (minted) {
      setSessionCookie(reply, request, minted.value);
      return { role: minted.role, label: minted.label, expiresAt: minted.expiresAt };
    }
    if (roleOf(config, request.body.token, [PLUGIN]) === PLUGIN) {
      throw problem('wrong_token_class', 'A plugin token cannot mint a session; it was sent to POST /v3/session.', {
        hint: 'Sign in with an agent or viewer token (RDS_AGENT_TOKENS / RDS_VIEWER_TOKENS).',
      });
    }
    throw problem('invalid_token', 'The token is not recognized.', {
      hint: 'Use an agent or viewer token (RDS_AGENT_TOKENS / RDS_VIEWER_TOKENS).',
    });
  });

  app.get('/session', { schema: readSessionSchema }, async request => {
    const found = readSession(request, config);
    if (found.status === 'ok') return found.session;
    if (found.status === 'missing') {
      throw problem('unauthorized', 'No session cookie.', { hint: 'Sign in with POST /v3/session to mint the rds_session cookie.' });
    }
    if (found.status === 'disabled') throw sessionsDisabled();
    throw problem('invalid_token', 'The session cookie is not valid.', {
      hint: 'The session expired, was tampered with, or its token was removed; sign in again with POST /v3/session.',
    });
  });

  app.delete('/session', { schema: deleteSession }, async (request, reply) => {
    clearSessionCookie(reply, request);
    return { signedOut: true };
  });
}

module.exports = { COOKIE, TTL_SECONDS, mintSession, readSession, sessionCookie, requestProto, requestOrigin, setSessionCookie, clearSessionCookie, sessionsDisabled, registerSessionRoutes };
