'use strict';

/* Fixed-window rate limits (docs/setup.md, "Rate limits"): buckets, headers, exemptions, proxy trust, defaults. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildApp } = require('../src/app');
const { loadConfig, RATE_LIMIT_DEFAULTS } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';
const TOKENS = { RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN, RDS_SESSION_SECRET: 'session-secret' };

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = ms => { t += ms; };
  return now;
}

function makeApp(t, env = {}, { now = clock(), rateLimit } = {}) {
  const config = loadConfig({ ...TOKENS, ...env }, { warn: () => {} });
  const app = buildApp({ store: new MemoryStore(), config: rateLimit ? { ...config, rateLimit } : config, now });
  t.after(() => app.close());
  return app;
}

async function call(app, method, url, { headers, body, ip = '203.0.113.1' } = {}) {
  const res = await app.inject({ method, url, headers, payload: body, remoteAddress: ip });
  let json = null;
  try { json = res.body ? res.json() : null; } catch (_) { json = res.body; }
  return { status: res.statusCode, body: json, headers: res.headers };
}

function assertLimited(res, { limit, retryAfter }) {
  assert.equal(res.status, 429);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.body.code, 'rate_limited');
  assert.equal(res.body.status, 429);
  assert.equal(res.body.type, 'https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#rate-limited');
  assert.match(res.body.hint, /Retry in \d+ s/);
  assert.equal(res.headers['ratelimit-limit'], String(limit));
  assert.equal(res.headers['ratelimit-remaining'], '0');
  if (retryAfter !== undefined) {
    assert.equal(res.headers['retry-after'], String(retryAfter));
    assert.equal(res.headers['ratelimit-reset'], String(retryAfter));
    assert.equal(res.body.retryAfter, retryAfter);
  }
}

// --- config ------------------------------------------------------------------------
test('config: hosted (database) deployments default to the documented limits', () => {
  const c = loadConfig({ ...TOKENS, DATABASE_URL: 'postgres://db/x' });
  assert.deepEqual(c.rateLimit, { token: 600, ip: 120, auth: 10, sync: RATE_LIMIT_DEFAULTS.sync });
  assert.deepEqual(loadConfig({}).rateLimit, c.rateLimit);
  assert.equal(c.trustProxy, false);
});

test('config: local modes default to no limits; RDS_RATE_LIMIT_* turn them on', () => {
  for (const RDS_STORE of ['local', 'memory']) {
    assert.deepEqual(loadConfig({ RDS_STORE }).rateLimit, { token: 0, ip: 0, auth: 0, sync: 0 });
    assert.deepEqual(loadConfig({ RDS_STORE, RDS_RATE_LIMIT_TOKEN: '50', RDS_RATE_LIMIT_IP: '5', RDS_RATE_LIMIT_AUTH: '3' }).rateLimit,
      { token: 50, ip: 5, auth: 3, sync: RATE_LIMIT_DEFAULTS.sync });
  }
});

test('config: 0 disables one limit; anything but a non-negative integer is a startup error', () => {
  assert.deepEqual(loadConfig({ RDS_RATE_LIMIT_TOKEN: '0', RDS_RATE_LIMIT_AUTH: ' 0 ' }).rateLimit, { token: 0, ip: 120, auth: 0, sync: 0 });
  for (const bad of ['-1', '1.5', 'ten', '1e3']) {
    assert.throws(() => loadConfig({ RDS_RATE_LIMIT_IP: bad }), /RDS_RATE_LIMIT_IP must be a non-negative integer/);
  }
});

test('config: RDS_TRUST_PROXY', () => {
  const trust = v => loadConfig({ RDS_TRUST_PROXY: v }).trustProxy;
  assert.equal(trust(''), false);
  assert.equal(trust('false'), false);
  assert.equal(trust('0'), false);
  assert.equal(trust('true'), true);
  assert.equal(trust('2'), 2);
  assert.equal(trust('10.0.0.0/8, 127.0.0.1'), '10.0.0.0/8, 127.0.0.1');
});

// --- buckets -------------------------------------------------------------------------
test('per token: the limit counts per credential, with RateLimit-* headers, then 429 with Retry-After', async t => {
  const now = clock();
  const app = makeApp(t, { RDS_RATE_LIMIT_TOKEN: '3' }, { now });
  for (let i = 0; i < 3; i++) {
    const ok = await call(app, 'GET', '/v3/files', { headers: agent });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['ratelimit-limit'], '3');
    assert.equal(ok.headers['ratelimit-remaining'], String(2 - i));
    assert.equal(ok.headers['ratelimit-reset'], '60');
    assert.equal(ok.headers['retry-after'], undefined);
  }
  now.advance(15_000);
  assertLimited(await call(app, 'GET', '/v3/files', { headers: agent }), { limit: 3, retryAfter: 45 });
  assert.match((await call(app, 'GET', '/v3/files', { headers: agent })).body.detail, /more than 3 requests in a minute/);
  // Another token, even from the same address, has its own budget.
  assert.equal((await call(app, 'GET', '/v3/files', { headers: viewer })).status, 200);
});

test('window reset: a spent budget comes back when the minute ends', async t => {
  const now = clock();
  const app = makeApp(t, { RDS_RATE_LIMIT_TOKEN: '2' }, { now });
  await call(app, 'GET', '/v3/files', { headers: agent });
  await call(app, 'GET', '/v3/files', { headers: agent });
  now.advance(59_500);
  assertLimited(await call(app, 'GET', '/v3/files', { headers: agent }), { limit: 2, retryAfter: 1 });
  now.advance(500);
  const ok = await call(app, 'GET', '/v3/files', { headers: agent });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['ratelimit-remaining'], '1');
});

test('per IP: requests without a credential count per client address', async t => {
  const app = makeApp(t, { RDS_RATE_LIMIT_IP: '2' });
  assert.equal((await call(app, 'GET', '/v3/openapi.json')).status, 200);
  assert.equal((await call(app, 'GET', '/v3/openapi.json')).status, 200);
  assertLimited(await call(app, 'GET', '/v3/openapi.json'), { limit: 2, retryAfter: 60 });
  assert.equal((await call(app, 'GET', '/v3/openapi.json', { ip: '203.0.113.2' })).status, 200);
  // Authenticated requests from the limited address use their token's budget.
  assert.equal((await call(app, 'GET', '/v3/files', { headers: agent })).status, 200);
});

test('exempt: /health and CORS preflights are never limited or counted', async t => {
  const app = makeApp(t, { RDS_RATE_LIMIT_IP: '1', RDS_RATE_LIMIT_TOKEN: '1' });
  for (let i = 0; i < 5; i++) {
    const health = await call(app, 'GET', '/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers['ratelimit-limit'], undefined);
    const pre = await call(app, 'OPTIONS', '/v3/files', { headers: { origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    assert.equal(pre.status, 204);
  }
  assert.equal((await call(app, 'GET', '/v3/openapi.json')).status, 200);
  assert.equal((await call(app, 'GET', '/v3/files', { headers: agent })).status, 200);
});

test('auth failures: 401s spend the per-IP auth budget, after which every request from that IP is refused', async t => {
  const now = clock();
  const app = makeApp(t, { RDS_RATE_LIMIT_AUTH: '3' }, { now });
  for (let i = 0; i < 3; i++) {
    assert.equal((await call(app, 'GET', '/v3/files', { headers: { authorization: `Bearer guess-${i}` } })).status, 401);
  }
  // The right token is refused too: a lucky guess looks like any other.
  const limited = await call(app, 'GET', '/v3/files', { headers: agent });
  assertLimited(limited, { limit: 3, retryAfter: 60 });
  assert.match(limited.body.detail, /sign-in attempts or rejected requests/);
  assert.equal((await call(app, 'GET', '/v3/files', { headers: agent, ip: '203.0.113.9' })).status, 200);
  assert.equal((await call(app, 'GET', '/health')).status, 200);
  now.advance(60_000);
  assert.equal((await call(app, 'GET', '/v3/files', { headers: agent })).status, 200);
});

test('auth failures: every POST /v3/session counts, successful or not', async t => {
  const app = makeApp(t, { RDS_RATE_LIMIT_AUTH: '3' });
  assert.equal((await call(app, 'POST', '/v3/session', { body: { token: AGENT_TOKEN } })).status, 200);
  assert.equal((await call(app, 'POST', '/v3/session', { body: { token: 'wrong' } })).status, 401);
  assert.equal((await call(app, 'POST', '/v3/session', { body: { token: VIEWER_TOKEN } })).status, 200);
  assertLimited(await call(app, 'POST', '/v3/session', { body: { token: AGENT_TOKEN } }), { limit: 3, retryAfter: 60 });
});

test('auth failures: a 401 for a missing credential is not a guess and does not count', async t => {
  const app = makeApp(t, { RDS_RATE_LIMIT_AUTH: '2' });
  for (let i = 0; i < 5; i++) assert.equal((await call(app, 'GET', '/v3/session')).status, 401);
  assert.equal((await call(app, 'GET', '/v3/files', { headers: agent })).status, 200);
  assert.equal((await call(app, 'GET', '/v3/session', { headers: { cookie: 'rds_session=forged' } })).status, 401);
  assert.equal((await call(app, 'GET', '/v3/files', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assertLimited(await call(app, 'GET', '/v3/files', { headers: agent }), { limit: 2 });
});

test('auth failures: 0 turns the auth budget off', async t => {
  const off = makeApp(t, { RDS_RATE_LIMIT_AUTH: '0' });
  for (let i = 0; i < 20; i++) assert.equal((await call(off, 'GET', '/v3/files', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call(off, 'GET', '/v3/files', { headers: agent })).status, 200);
});

test('proxy trust off: X-Forwarded-For is ignored, the socket address is the client', async t => {
  const app = makeApp(t, { RDS_RATE_LIMIT_IP: '1' });
  assert.equal((await call(app, 'GET', '/v3/openapi.json', { headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 200);
  assertLimited(await call(app, 'GET', '/v3/openapi.json', { headers: { 'x-forwarded-for': '198.51.100.2' } }), { limit: 1 });
});

test('proxy trust on: X-Forwarded-For names the client', async t => {
  const app = makeApp(t, { RDS_RATE_LIMIT_IP: '1', RDS_TRUST_PROXY: 'true' });
  assert.equal((await call(app, 'GET', '/v3/openapi.json', { headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 200);
  assert.equal((await call(app, 'GET', '/v3/openapi.json', { headers: { 'x-forwarded-for': '198.51.100.2' } })).status, 200);
  assertLimited(await call(app, 'GET', '/v3/openapi.json', { headers: { 'x-forwarded-for': '198.51.100.1' } }), { limit: 1 });
});

test('local mode: no limits and no RateLimit-* headers by default', async t => {
  const app = makeApp(t, { RDS_STORE: 'memory' });
  const host = { host: '127.0.0.1:8787' };
  for (let i = 0; i < 150; i++) {
    const res = await call(app, 'GET', '/v3/files', { headers: { ...host, ...agent } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['ratelimit-limit'], undefined);
  }
  for (let i = 0; i < 15; i++) assert.equal((await call(app, 'GET', '/v3/files', { headers: { ...host, authorization: 'Bearer nope' } })).status, 401);
});

// --- plugin sync budget ------------------------------------------------------------------
test('sync routes use their own per-token budget, apart from the token budget', async t => {
  const app = makeApp(t, {}, { rateLimit: { token: 1, sync: 3, ip: 0, auth: 0 } });
  for (let i = 0; i < 3; i++) {
    const res = await call(app, 'GET', `/v3/files/${FK}/hashes?under=1:1`, { headers: plugin });
    assert.equal(res.status, 200);
    assert.equal(res.headers['ratelimit-limit'], '3');
  }
  assertLimited(await call(app, 'POST', `/v3/files/${FK}/exists`, { headers: plugin, body: { nodeIds: ['1:1'] } }), { limit: 3 });
  assert.equal((await call(app, 'GET', '/v3/files', { headers: agent })).status, 200);
  assertLimited(await call(app, 'GET', '/v3/files', { headers: agent }), { limit: 1 });
});

function loadPlugin() {
  const dir = path.join(__dirname, '..', '..', 'figma-plugin');
  const sandbox = { module: { exports: {} }, ChecklistCore: require(path.join(dir, 'src', 'core')), setTimeout, PLUGIN_VERSION: require(path.join(dir, 'package.json')).version };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'src', 'plugin.js'), 'utf8'), sandbox);
  return sandbox.module.exports;
}

/** A 2,001-node Figma scope: a section of 100 frames with 19 styled text layers each. */
function scope() {
  const node = (id, type, extra) => ({ id, type, name: `${type} ${id}`, visible: true, width: 320, height: 48, removed: false, ...extra });
  const root = node('1:1', 'SECTION', { children: [] });
  const registry = new Map([[root.id, root]]);
  for (let f = 0; f < 100; f++) {
    const frame = node(`2:${f}`, 'FRAME', { parent: root, children: [], layoutMode: 'VERTICAL', itemSpacing: 8, paddingLeft: 16, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] });
    root.children.push(frame);
    registry.set(frame.id, frame);
    for (let i = 0; i < 19; i++) {
      const text = node(`3:${f * 19 + i}`, 'TEXT', { parent: frame, characters: `Label ${f}.${i} `.repeat(20), fontSize: 14, getStyledTextSegments: () => [], fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }] });
      frame.children.push(text);
      registry.set(text.id, text);
    }
  }
  const api = { root: { name: 'Design file' }, skipInvisibleInstanceChildren: true, getNodeByIdAsync: async id => registry.get(id) || null, getStyleByIdAsync: async () => null, variables: { getVariableByIdAsync: async () => null } };
  return { root, api, size: registry.size };
}

test('sync budget: a full 2,000-node upload fits many times over in one minute', async t => {
  const P = loadPlugin();
  const app = makeApp(t, { DATABASE_URL: 'postgres://db/x' });
  const { root, api, size } = scope();
  assert.ok(size >= 2000);
  const snapshot = await P.capture(api, root, FK);
  let requests = 0;
  const http = async (url, init) => {
    requests++;
    const res = await app.inject({ method: init.method, url: url.replace('http://127.0.0.1:8787', ''), headers: { ...init.headers, host: '127.0.0.1:8787' }, payload: init.body });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => res.json() };
  };
  const settings = { baseUrl: 'http://127.0.0.1:8787', token: PLUGIN_TOKEN };
  const first = await P.sync(http, settings, snapshot, { api });
  assert.equal(first.result.upserted, size);
  // Two hashes reads (scope + design tokens; no variables, so no token upload) plus one /sync per 2 MB batch.
  assert.equal(requests, 2 + first.batches);
  t.diagnostic(`full upload: ${requests} requests (${first.batches} batches)`);
  assert.ok(requests * 9 <= RATE_LIMIT_DEFAULTS.sync, `${requests} requests for one full upload must fit nine times in the sync budget (${RATE_LIMIT_DEFAULTS.sync})`);
  // Re-uploading everything (a fresh file each time) stays under the budget.
  for (let i = 1; i < Math.floor(RATE_LIMIT_DEFAULTS.sync / requests); i++) {
    const again = await P.sync(http, settings, { ...snapshot, fileKey: `${FK.slice(0, -2)}${String(i).padStart(2, '0')}` }, { api });
    assert.equal(again.result.upserted, size);
  }
});
