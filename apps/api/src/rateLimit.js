'use strict';

/*
 * In-memory fixed-window rate limits, per API instance (docs/setup.md, "Rate
 * limits"). Buckets, each counted per one-minute window:
 *
 * - `token`: requests presenting a bearer token or session cookie, per
 *   credential fingerprint (SHA-256; the raw credential is never kept).
 * - `sync`: the plugin sync routes, per credential, instead of `token`.
 * - `ip`: requests presenting no credential, per client IP.
 * - `auth`: per client IP, every `POST /v3/session` and every 401 to a request
 *   that presented a credential (a missing one is no guess). Once spent,
 *   every request from that IP gets 429 until the window ends, so a correct
 *   guess looks the same as a wrong one.
 *
 * `/health` and CORS preflights are exempt. A limit of 0 disables its bucket.
 */

const { createHash } = require('node:crypto');
const { bearer } = require('./auth');
const { sessionCookie } = require('./session');
const { problem, CONTENT_TYPE } = require('./v3/problem');

const WINDOW_MS = 60 * 1000;
const SWEEP_MS = WINDOW_MS;
const EXEMPT_ROUTES = new Set(['/health']);
const SYNC_ROUTES = new Set(['/v3/files/:fileKey/hashes', '/v3/files/:fileKey/sync', '/v3/files/:fileKey/exists']);
const SESSION_ROUTE = '/v3/session';

/** Fixed-window counters keyed by string; expired windows are swept lazily. */
class FixedWindow {
  constructor(limit, { windowMs = WINDOW_MS, now = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.counts = new Map();
    this.nextSweep = now() + SWEEP_MS;
  }

  entry(key) {
    const t = this.now();
    if (t >= this.nextSweep) {
      for (const [k, e] of this.counts) if (e.reset <= t) this.counts.delete(k);
      this.nextSweep = t + SWEEP_MS;
    }
    let e = this.counts.get(key);
    if (!e || e.reset <= t) {
      e = { count: 0, reset: t + this.windowMs };
      this.counts.set(key, e);
    }
    return e;
  }

  state(e) {
    const resetSeconds = Math.max(1, Math.ceil((e.reset - this.now()) / 1000));
    return { limit: this.limit, remaining: Math.max(0, this.limit - e.count), resetSeconds, allowed: e.count <= this.limit };
  }

  /** Counts one request against `key`. */
  hit(key) {
    const e = this.entry(key);
    e.count += 1;
    return this.state(e);
  }

  /** The state of `key` without counting; `allowed` is false once the budget is spent. */
  peek(key) {
    const e = this.entry(key);
    return { ...this.state(e), allowed: e.count < this.limit };
  }
}

const fingerprint = credential => createHash('sha256').update(credential).digest('base64url');

const credentialOf = request => bearer(request) || sessionCookie(request) || null;

const DESCRIPTIONS = {
  token: limit => `This token made more than ${limit} requests in a minute.`,
  sync: limit => `This plugin token made more than ${limit} sync requests in a minute.`,
  ip: limit => `This address made more than ${limit} unauthenticated requests in a minute.`,
  auth: limit => `This address made more than ${limit} sign-in attempts or rejected requests in a minute.`,
};

function setHeaders(reply, state) {
  reply.header('ratelimit-limit', String(state.limit));
  reply.header('ratelimit-remaining', String(state.remaining));
  reply.header('ratelimit-reset', String(state.resetSeconds));
}

function sendLimited(reply, bucket, state) {
  setHeaders(reply, state);
  reply.header('retry-after', String(state.resetSeconds));
  const body = problem('rate_limited', DESCRIPTIONS[bucket](state.limit), {
    hint: `Retry in ${state.resetSeconds} s (Retry-After). Limits are per minute; the server sets them with RDS_RATE_LIMIT_TOKEN, RDS_RATE_LIMIT_IP and RDS_RATE_LIMIT_AUTH.`,
    retryAfter: state.resetSeconds,
  }).toJSON();
  return reply.code(429).type(CONTENT_TYPE).serializer(JSON.stringify).send(body);
}

/**
 * Adds the rate-limit hooks to `app` for `limits` ({ token, ip, auth, sync },
 * requests per minute; 0 or missing disables one). No hooks when all are off.
 */
function registerRateLimits(app, limits = {}, { now = Date.now } = {}) {
  const make = limit => (limit > 0 ? new FixedWindow(limit, { now }) : null);
  const buckets = { token: make(limits.token), sync: make(limits.sync), ip: make(limits.ip), auth: make(limits.auth) };
  if (!Object.values(buckets).some(Boolean)) return buckets;

  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions && request.routeOptions.url;
    if (request.method === 'OPTIONS' || EXEMPT_ROUTES.has(route)) return;
    const ip = request.ip;
    if (buckets.auth) {
      const auth = buckets.auth.peek(ip);
      if (!auth.allowed) return sendLimited(reply, 'auth', auth);
      if (request.method === 'POST' && route === SESSION_ROUTE) {
        request.rateLimitAuthCounted = true;
        buckets.auth.hit(ip);
      }
    }
    const credential = credentialOf(request);
    const name = credential ? (SYNC_ROUTES.has(route) ? 'sync' : 'token') : 'ip';
    const bucket = buckets[name];
    if (!bucket) return;
    const state = bucket.hit(credential ? fingerprint(credential) : ip);
    if (!state.allowed) return sendLimited(reply, name, state);
    setHeaders(reply, state);
  });

  const authBucket = buckets.auth;
  if (authBucket) {
    app.addHook('onSend', async (request, reply, payload) => {
      if (reply.statusCode === 401 && !request.rateLimitAuthCounted && credentialOf(request)) {
        request.rateLimitAuthCounted = true;
        authBucket.hit(request.ip);
      }
      return payload;
    });
  }
  return buckets;
}

module.exports = { registerRateLimits, FixedWindow, WINDOW_MS, fingerprint };
