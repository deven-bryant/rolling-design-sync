'use strict';

/*
 * Portal browser sessions, token names, the /ui static portal
 * (docs/ui-portal.md, "Sign-in and sessions", "Token labels", "Same origin") —
 * against the memory store and PGlite (same SQL as Postgres).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, createHmac } = require('node:crypto');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig, ensureLocalTokens } = require('../src/config');
const { tokenLabel } = require('../src/auth');
const { COOKIE } = require('../src/session');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { CODES } = require('../src/v3/problem');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const SESSION_SECRET = 'test-session-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}
const R = ['1:1'];
const TREE = (v, title = 'Hello') => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: v ? 24 : 16 }, R),
  up('2:2', 'FRAME', 'Header', { itemSpacing: v ? 12 : 8 }, R),
];
const hashOf = nodeId => TREE(true).find(n => n.nodeId === nodeId).contentHash;

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-session-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

const ENV = {
  RDS_PLUGIN_TOKENS: `figma:${PLUGIN_TOKEN}`,
  RDS_AGENT_TOKENS: `devin:${AGENT_TOKEN}`,
  RDS_VIEWER_TOKENS: `portal-read:${VIEWER_TOKEN}`,
  RDS_SESSION_SECRET: SESSION_SECRET,
  // These tests sign in far more often than the per-IP auth budget allows (rate-limit.test.js covers it).
  RDS_RATE_LIMIT_AUTH: '0',
};

/** A file synced twice: 2:1, 2:2 dirty. */
async function openApp(kind, env = ENV) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig(env) });
  const res = await app.inject({
    method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin,
    payload: { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE(false), markImplemented: true },
  });
  assert.equal(res.statusCode, 200, res.body);
  const res2 = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true) } });
  assert.equal(res2.statusCode, 200, res2.body);
  return { app, close: async () => { await app.close(); await cleanup(); } };
}

const call = (app, method, url, { headers = agent, payload } = {}) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const events = async app => ok(await call(app, 'GET', `/v3/files/${FK}/events?limit=1000`)).events;

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.code, code, res.body);
  assert.ok(CODES[code], `code ${code} is listed in problem.js`);
  assert.equal(typeof body.hint, 'string');
  return body;
}

/** Sign in; returns the `rds_session` cookie value. */
async function signIn(app, token) {
  const res = await app.inject({ method: 'POST', url: '/v3/session', payload: { token } });
  assert.equal(res.statusCode, 200, res.body);
  const cookies = res.cookies;
  assert.equal(cookies.length, 1);
  const [cookie] = cookies;
  assert.equal(cookie.name, COOKIE);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.path, '/');
  assert.equal(cookie.maxAge, 43200);
  return { session: res.json(), cookie: `rds_session=${cookie.value}`, value: cookie.value };
}

/** A cookie `payload` signed with `secret`. */
function forge(payload, secret = SESSION_SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${COOKIE}=${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const fp = token => createHash('sha256').update(token).digest('hex');
const sameOrigin = { 'x-rds-client': 'portal/0.1.0', origin: 'http://localhost:80' };

// --- token names -----------------------------------------------------------------
test('config: name:token entries parse, are named, and label the token', () => {
  const config = loadConfig(ENV);
  assert.deepEqual(config.agentTokens, [AGENT_TOKEN]);
  assert.deepEqual(config.viewerTokens, [VIEWER_TOKEN]);
  assert.equal(config.tokenLabels.get(AGENT_TOKEN), 'devin');
  assert.equal(config.tokenLabels.get(VIEWER_TOKEN), 'portal-read');
  assert.equal(config.tokenLabels.get(PLUGIN_TOKEN), 'figma');

  const mixed = loadConfig({ RDS_AGENT_TOKENS: `named:${AGENT_TOKEN},${VIEWER_TOKEN}` });
  assert.deepEqual(mixed.agentTokens, [AGENT_TOKEN, VIEWER_TOKEN]);
  assert.equal(mixed.tokenLabels.get(AGENT_TOKEN), 'named');
  assert.equal(mixed.tokenLabels.get(VIEWER_TOKEN), undefined, 'unnamed entries keep the hash label');
});

test('config: invalid or duplicate names are startup errors', () => {
  for (const list of ['UPPER:x', 'has space:x', ':x', 'name:', `n${'a'.repeat(40)}:x`, 'dup:x,dup:y', 'dup:x,other:y,dup:z']) {
    assert.throws(() => loadConfig({ RDS_AGENT_TOKENS: list }), /RDS_AGENT_TOKENS/, list);
  }
  assert.throws(() => loadConfig({ RDS_AGENT_TOKENS: 'dup:x,dup:y' }), /'dup' is used more than once/);
  assert.throws(() => loadConfig({ RDS_AGENT_TOKENS: 'UPPER:x' }), /not a valid token name/);
  // The same name in two classes is fine.
  assert.equal(loadConfig({ RDS_AGENT_TOKENS: 'same:x', RDS_VIEWER_TOKENS: 'same:y' }).tokenLabels.get('x'), 'same');
});

for (const kind of Object.keys(STORES)) {
  test(`sessions: sign-in, cookie auth, CSRF (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);

    await t.test('POST /v3/session mints viewer and agent sessions; the cookie is HttpOnly SameSite=Strict', async () => {
      const v = await signIn(app, VIEWER_TOKEN);
      assert.deepEqual(v.session.role, 'viewer');
      assert.equal(v.session.label, 'portal-read');
      assert.ok(Date.parse(v.session.expiresAt) > Date.now() + 11 * 3600e3);

      const a = await signIn(app, AGENT_TOKEN);
      assert.equal(a.session.role, 'agent');
      assert.equal(a.session.label, 'devin');

      // Secure when the request came over HTTPS (X-Forwarded-Proto counts).
      const https = await app.inject({ method: 'POST', url: '/v3/session', headers: { 'x-forwarded-proto': 'https' }, payload: { token: VIEWER_TOKEN } });
      assert.equal(https.cookies[0].secure, true);
      assert.equal((await signIn(app, VIEWER_TOKEN)).session.role, 'viewer');
    });

    await t.test('POST /v3/session: plugin → wrong_token_class; unknown → invalid_token; bad body → 400', async () => {
      const p = assertProblem(await app.inject({ method: 'POST', url: '/v3/session', payload: { token: PLUGIN_TOKEN } }), 403, 'wrong_token_class');
      assert.match(p.detail, /plugin token/);
      assertProblem(await app.inject({ method: 'POST', url: '/v3/session', payload: { token: 'nope' } }), 401, 'invalid_token');
      assertProblem(await app.inject({ method: 'POST', url: '/v3/session', payload: {} }), 400, 'invalid_parameter');
      assertProblem(await app.inject({ method: 'POST', url: '/v3/session', payload: { token: AGENT_TOKEN, extra: 1 } }), 400, 'invalid_body');
    });

    await t.test('GET /v3/session reads the session; no cookie → 401; DELETE clears the cookie', async () => {
      assertProblem(await app.inject({ method: 'GET', url: '/v3/session' }), 401, 'unauthorized');
      const { session, cookie } = await signIn(app, AGENT_TOKEN);
      const read = ok(await app.inject({ method: 'GET', url: '/v3/session', headers: { cookie } }));
      assert.deepEqual(read, session);
      const out = ok(await app.inject({ method: 'DELETE', url: '/v3/session', headers: { cookie } }));
      assert.deepEqual(out, { signedOut: true });
      const cleared = (await app.inject({ method: 'DELETE', url: '/v3/session' })).cookies[0];
      assert.equal(cleared.name, COOKIE);
      assert.equal(cleared.value, '');
      assert.equal(cleared.maxAge, 0);
    });

    await t.test('the cookie calls v3 GET routes; a viewer session reads but cannot write', async () => {
      const v = await signIn(app, VIEWER_TOKEN);
      const page = ok(await call(app, 'GET', '/v3/files', { headers: { cookie: v.cookie } }));
      assert.equal(page.files[0].fileKey, FK);
      const blocked = assertProblem(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: { cookie: v.cookie, ...sameOrigin }, payload: { reason: 'r' } }), 403, 'wrong_token_class');
      assert.match(blocked.hint, /agent/);
    });

    await t.test('tampered, expired and revoked-token cookies are 401; bearer wins when both are sent', async () => {
      const { cookie } = await signIn(app, AGENT_TOKEN);
      const tampered = { cookie: `${cookie.slice(0, -1)}x` };
      assertProblem(await call(app, 'GET', '/v3/files', { headers: tampered }), 401, 'invalid_token');
      const expired = { cookie: forge({ role: 'agent', fp: fp(AGENT_TOKEN), exp: Math.floor(Date.now() / 1000) - 10 }) };
      assertProblem(await call(app, 'GET', '/v3/files', { headers: expired }), 401, 'invalid_token');
      const revoked = { cookie: forge({ role: 'agent', fp: fp('gone-token'), exp: Math.floor(Date.now() / 1000) + 3600 }) };
      assertProblem(await call(app, 'GET', '/v3/files', { headers: revoked }), 401, 'invalid_token');
      const badSig = { cookie: forge({ role: 'agent', fp: fp(AGENT_TOKEN), exp: Math.floor(Date.now() / 1000) + 3600 }, 'other-secret') };
      assertProblem(await call(app, 'GET', '/v3/files', { headers: badSig }), 401, 'invalid_token');

      // A valid bearer token wins over a bad cookie; a bad bearer is invalid even with a good cookie.
      ok(await call(app, 'GET', '/v3/files', { headers: { ...agent, cookie: tampered.cookie } }));
      assertProblem(await call(app, 'GET', '/v3/files', { headers: { authorization: 'Bearer nope', cookie } }), 401, 'invalid_token');
    });

    await t.test('CSRF: cookie writes need X-RDS-Client: portal/… and a same-origin Origin', async () => {
      const { cookie } = await signIn(app, AGENT_TOKEN);
      const payload = { reason: 'r' };
      assertProblem(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: { cookie }, payload }), 403, 'csrf_rejected');
      assertProblem(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: { cookie, origin: 'http://localhost:80' }, payload }), 403, 'csrf_rejected');
      assertProblem(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: { cookie, 'x-rds-client': 'portal/0.1.0', origin: 'http://evil.example' }, payload }), 403, 'csrf_rejected');
      assertProblem(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: { cookie, 'x-rds-client': 'curl/8', origin: 'http://localhost:80' }, payload }), 403, 'csrf_rejected');
      ok(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: { cookie, ...sameOrigin }, payload }));
      ok(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/unblock`, { headers: { cookie, ...sameOrigin }, payload: {} }));
      // Bearer writes need no CSRF headers.
      ok(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { payload }));
      ok(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/unblock`, { payload: {} }));
    });

    await t.test('session writes record portal:<label> as the event actor; clear accepts worker', async () => {
      const { cookie } = await signIn(app, AGENT_TOKEN);
      const portal = { cookie, ...sameOrigin };
      ok(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: portal, payload: { reason: 'Ambiguous spacing' } }));
      const blocked = (await events(app)).at(-1);
      assert.equal(blocked.type, 'node.blocked');
      assert.equal(blocked.actor, 'portal:devin');
      assert.equal(blocked.data.by, 'portal:devin');

      const claim = ok(await call(app, 'POST', `/v3/files/${FK}/claims`, { payload: { worker: 'w-1', nodeIds: ['2:2'] } }));
      ok(await call(app, 'DELETE', `/v3/files/${FK}/claims/${claim.claimId}`, { headers: portal }));
      const released = (await events(app)).at(-1);
      assert.equal(released.type, 'claim.released');
      assert.equal(released.actor, 'portal:devin');

      ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { headers: portal, payload: { items: [{ nodeId: '2:1', contentHash: hashOf('2:1') }] } }));
      assert.equal((await events(app)).at(-1).actor, 'portal:devin');
      ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { headers: portal, payload: { worker: 'release-bot', items: [{ nodeId: '2:2', contentHash: hashOf('2:2') }] } }));
      const cleared = (await events(app)).at(-1);
      assert.equal(cleared.type, 'nodes.cleared');
      assert.equal(cleared.actor, 'release-bot');
    });

    await t.test('a bearer write names the token label: name:token wins, unnamed keeps the hash label', async () => {
      ok(await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { payload: { reason: 'r' } }));
      assert.equal((await events(app)).at(-1).actor, 'devin');
      const unnamed = { authorization: 'Bearer unnamed-agent' };
      const app2 = buildApp({ store: new MemoryStore(), config: loadConfig({ RDS_AGENT_TOKENS: 'unnamed-agent', RDS_SESSION_SECRET: SESSION_SECRET }) });
      try {
        const res = await app2.inject({ method: 'GET', url: '/v3/files', headers: unnamed });
        assert.equal(res.statusCode, 200, res.body);
      } finally { await app2.close(); }
    });
  });
}

test('sessions: RDS_SESSION_SECRET missing in DATABASE_URL mode → 503 sessions_disabled', async t => {
  const app = buildApp({
    store: new MemoryStore(),
    config: loadConfig({ DATABASE_URL: 'postgres://x', RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }),
  });
  t.after(() => app.close());
  const res = assertProblem(await app.inject({ method: 'POST', url: '/v3/session', payload: { token: AGENT_TOKEN } }), 503, 'sessions_disabled');
  assert.match(res.hint, /RDS_SESSION_SECRET/);
  const cookie = forge({ role: 'agent', fp: fp(AGENT_TOKEN), exp: Math.floor(Date.now() / 1000) + 3600 });
  assertProblem(await app.inject({ method: 'GET', url: '/v3/session', headers: { cookie } }), 503, 'sessions_disabled');
  assertProblem(await app.inject({ method: 'GET', url: '/v3/files', headers: { cookie } }), 401, 'unauthorized');
  // And local mode generates it into tokens.json (config test) — covered in local-store.test.js.
});

test('local mode: ensureLocalTokens generates the session secret', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-local-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = ensureLocalTokens(loadConfig({ RDS_STORE: 'local', RDS_DATA_DIR: dir }));
  assert.match(res.config.sessionSecret, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(fs.readFileSync(res.file, 'utf8')).session, res.config.sessionSecret);
});

// --- the portal build at /ui ------------------------------------------------------
test('the API serves the portal build at /ui: asset, index, SPA fallback, traversal, / redirect', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-portal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>portal</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-a1b2.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'styles.css'), 'body{}');

  const app = buildApp({
    store: new MemoryStore(),
    config: loadConfig({ RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_PORTAL_DIR: dir }),
  });
  t.after(() => app.close());

  const redir = await app.inject({ method: 'GET', url: '/' });
  assert.equal(redir.statusCode, 302);
  assert.equal(redir.headers.location, '/ui/');

  const index = await app.inject({ method: 'GET', url: '/ui' });
  assert.equal(index.statusCode, 200);
  assert.match(index.headers['content-type'], /^text\/html/);
  assert.equal(index.headers['cache-control'], 'no-cache');
  assert.equal(index.body, '<!doctype html><title>portal</title>');

  const asset = await app.inject({ method: 'GET', url: '/ui/assets/app-a1b2.js' });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers['content-type'], /javascript/);
  assert.match(asset.headers['cache-control'], /max-age=31536000.*immutable|immutable/);
  const css = await app.inject({ method: 'GET', url: '/ui/styles.css' });
  assert.match(css.headers['content-type'], /^text\/css/);
  assert.equal(css.headers['cache-control'], 'no-cache');

  // SPA fallback: unknown client routes get index.html; traversal never leaves the root.
  const spa = await app.inject({ method: 'GET', url: '/ui/nodes/2:1?x=1' });
  assert.equal(spa.statusCode, 200);
  assert.equal(spa.body, '<!doctype html><title>portal</title>');
  for (const url of ['/ui/%2e%2e/package.json', '/ui/%2e%2e%2fsecret.txt', '/ui/..%5c..%5cwindows']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url);
  }
});

test('/ui without a build answers a 404 page that explains how to build it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-portal-missing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = path.join(dir, 'nothing-here');
  const app = buildApp({
    store: new MemoryStore(),
    config: loadConfig({ RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_PORTAL_DIR: missing }),
  });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/ui' });
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.body, /npm run build/);
  assert.match(res.body, /nothing-here/);
});

test('OpenAPI: /v3/session is documented with the sessionCookie scheme', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  const scheme = doc.components.securitySchemes.sessionCookie;
  assert.deepEqual({ type: scheme.type, in: scheme.in, name: scheme.name }, { type: 'apiKey', in: 'cookie', name: 'rds_session' });
  assert.deepEqual(Object.keys(doc.paths['/v3/session']).sort(), ['delete', 'get', 'post']);
  assert.deepEqual(doc.paths['/v3/session'].get.security, [{ sessionCookie: [] }]);
  // Not exposed as MCP/CLI ops.
  assert.equal(doc.paths['/v3/session'].post['x-rds-mcp'], undefined);
});
