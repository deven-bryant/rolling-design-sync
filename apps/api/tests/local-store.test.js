'use strict';

/* RDS_STORE=local (PGlite) store + the embedded-mode security defaults. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig, ensureLocalTokens, checkTokenStrength, TOKENS_FILE } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore, DEFAULT_MIGRATIONS_DIR } = require('../src/store/pglite');

const PLUGIN_TOKEN = 'p'.repeat(64);
const AGENT_TOKEN = 'a'.repeat(64);
const VIEWER_TOKEN = 'v'.repeat(64);
const PORT = 8787;
const HOST = `127.0.0.1:${PORT}`;
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}`, host: HOST };
const agent = { authorization: `Bearer ${AGENT_TOKEN}`, host: HOST };
const POSIX = process.platform !== 'win32';

const FILE_KEY = 'AbCdEf123456';
const ROOT = '1:1';
const CHILD = '2:1';

/**
 * Registers `fn` to run after the test, last-registered first. `t.after` runs
 * hooks in registration order, which would delete the temp dir before the store
 * that holds files in it is closed — Windows refuses that (ENOTEMPTY/EBUSY).
 */
const cleanups = new WeakMap();
function onCleanup(t, fn) {
  if (!cleanups.has(t)) {
    const stack = [];
    cleanups.set(t, stack);
    t.after(async () => { while (stack.length) await stack.pop()(); });
  }
  cleanups.get(t).push(fn);
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-local-'));
  onCleanup(t, () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return path.join(dir, 'data');
}

const localConfig = (dataDir, env = {}) => loadConfig({
  RDS_STORE: 'local', RDS_DATA_DIR: dataDir, PORT: String(PORT),
  RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, ...env,
});

async function openApp(t, dataDir) {
  const { store, applied } = await openLocalStore({ dataDir });
  const app = buildApp({ store, config: localConfig(dataDir) });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await app.close(); await store.close(); };
  onCleanup(t, close);
  return { app, store, applied, close };
}

async function call(app, method, url, { headers, body, query } = {}) {
  const res = await app.inject({ method, url, headers, payload: body, query });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}

function upsert(nodeId, attrs, { parentId = null, path: ancestors = [], nodeType = 'FRAME' } = {}) {
  return { nodeId, parentId, path: ancestors, nodeType, name: `Node ${nodeId}`, attrs, contentHash: core.contentHash(attrs) };
}

const SYNC = `/v3/files/${FILE_KEY}/sync`;
const batch = (app, body) => call(app, 'POST', SYNC, { headers: plugin, body });
/** Dirty nodes under `nodeId`, full view. */
const dirty = (app, nodeId) => call(app, 'GET', `/v3/files/${FILE_KEY}/nodes`, { headers: agent, query: { under: nodeId, state: 'dirty', view: 'full', limit: '200' } });
const clear = (app, body) => call(app, 'POST', `/v3/files/${FILE_KEY}/clear`, { headers: agent, body });

// --- store ------------------------------------------------------------------

test('local store: migrations apply once on first open, none on reopen', async t => {
  const dataDir = tempDir(t);
  const all = fs.readdirSync(DEFAULT_MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  assert.ok(all.length > 0);

  const first = await openLocalStore({ dataDir });
  assert.deepEqual(first.applied, all);
  const { rows } = await first.store.query('select filename from schema_migrations order by filename');
  assert.deepEqual(rows.map(r => r.filename), all);
  await first.store.close();

  const second = await openLocalStore({ dataDir });
  assert.deepEqual(second.applied, []);
  await second.store.close();
});

test('local store: the data directory is private (0700)', { skip: !POSIX }, async t => {
  const dataDir = tempDir(t);
  const { store } = await openLocalStore({ dataDir });
  await store.close();
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
});

test('local store: sync -> list -> clear, with the hash guard', async t => {
  const { app } = await openApp(t, tempDir(t));
  const up = await batch(app, { upserts: [upsert(ROOT, { width: 800 }, { nodeType: 'SECTION' }), upsert(CHILD, { paddingLeft: 16 }, { parentId: ROOT, path: [ROOT] })] });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual(up.body, { fileKey: FILE_KEY, upserted: 2, dirty: 2, tombstoned: 0, skippedInstances: 0 });

  const d = await dirty(app, ROOT);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const child = d.body.nodes.find(n => n.nodeId === CHILD);
  assert.deepEqual(child.attrs, { paddingLeft: 16 });
  assert.equal(child.parentId, ROOT);

  const stale = await clear(app, { commitRef: 'abc123', items: [{ nodeId: CHILD, contentHash: 'not-the-hash' }] });
  assert.equal(stale.status, 200, JSON.stringify(stale.body));
  assert.equal(stale.body.results[0].status, 'stale');

  const ok = await clear(app, { commitRef: 'abc123', items: [{ nodeId: CHILD, contentHash: child.contentHash }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.results[0].status, 'cleared');
  const stored = await app.store.getNode(FILE_KEY, CHILD);
  assert.equal(stored.dirty, false);
  assert.equal(stored.implementedCommit, 'abc123');
  assert.ok(!Number.isNaN(Date.parse(stored.implementedAt)));
  assert.deepEqual((await dirty(app, ROOT)).body.nodes.map(n => n.nodeId), [ROOT]);
});

test('local store: data persists across close and reopen', async t => {
  const dataDir = tempDir(t);
  const first = await openApp(t, dataDir);
  assert.equal((await batch(first.app, { upserts: [upsert(ROOT, { width: 800 })] })).status, 200);
  await first.close();

  const second = await openApp(t, dataDir);
  assert.deepEqual(second.applied, []);
  const d = await dirty(second.app, ROOT);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.nodes.map(n => [n.nodeId, n.attrs]), [[ROOT, { width: 800 }]]);
});

test('local store: parallel batches are serialized and all land', async t => {
  const { app, store } = await openApp(t, tempDir(t));
  assert.equal((await batch(app, { upserts: [upsert(ROOT, { width: 800 })] })).status, 200);
  const N = 12;
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    batch(app, { upserts: [upsert(`2:${i}`, { i }, { parentId: ROOT, path: [ROOT] }), upsert(ROOT, { width: 800 + i })] })));
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));

  const nodes = (await dirty(app, ROOT)).body.nodes;
  assert.equal(nodes.length, N + 1);
  for (let i = 0; i < N; i++) assert.deepEqual(nodes.find(n => n.nodeId === `2:${i}`).attrs, { i });
  const root = await store.getNode(FILE_KEY, ROOT);
  assert.ok(root.attrs.width >= 800 && root.attrs.width < 800 + N);
  assert.equal(root.contentHash, core.contentHash(root.attrs));
});

// --- config defaults ----------------------------------------------------------

test('config: embedded modes bind loopback by default, DATABASE_URL mode binds 0.0.0.0, HOST wins', () => {
  assert.equal(loadConfig({ RDS_STORE: 'local' }).host, '127.0.0.1');
  assert.equal(loadConfig({ RDS_STORE: 'memory' }).host, '127.0.0.1');
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x' }).host, '0.0.0.0');
  assert.equal(loadConfig({}).host, '0.0.0.0');
  assert.equal(loadConfig({ RDS_STORE: 'local', HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x', HOST: '127.0.0.1' }).host, '127.0.0.1');

  const local = loadConfig({ RDS_STORE: 'local' });
  assert.equal(local.checkHost, true);
  assert.equal(local.checkOrigin, true);
  assert.equal(loadConfig({ RDS_STORE: 'local', HOST: '0.0.0.0' }).checkHost, true);
  assert.equal(loadConfig({ RDS_STORE: 'memory', HOST: '0.0.0.0' }).checkHost, true);
  const pg = loadConfig({ DATABASE_URL: 'postgres://x' });
  assert.equal(pg.checkHost, false);
  assert.equal(pg.checkOrigin, false);
});

test('config: RDS_DATA_DIR defaults to ./data relative to the working directory', () => {
  assert.equal(loadConfig({}).dataDir, path.resolve('data'));
  assert.equal(loadConfig({ RDS_DATA_DIR: 'x/y' }).dataDir, path.resolve('x/y'));
});

test('config: local tokens are generated once, persisted, and reused', t => {
  const dataDir = tempDir(t);
  const base = loadConfig({ RDS_STORE: 'local', RDS_DATA_DIR: dataDir });
  const first = ensureLocalTokens(base);
  assert.deepEqual(first.generated.sort(), ['agent', 'plugin', 'viewer']);
  assert.equal(first.file, path.join(dataDir, TOKENS_FILE));
  assert.match(first.config.pluginTokens[0], /^[0-9a-f]{64}$/);
  assert.match(first.config.agentTokens[0], /^[0-9a-f]{64}$/);
  assert.match(first.config.viewerTokens[0], /^[0-9a-f]{64}$/);
  assert.equal(new Set([first.config.pluginTokens[0], first.config.agentTokens[0], first.config.viewerTokens[0]]).size, 3);
  assert.match(first.config.sessionSecret, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(first.file, 'utf8')), {
    plugin: first.config.pluginTokens[0], agent: first.config.agentTokens[0], viewer: first.config.viewerTokens[0],
    session: first.config.sessionSecret,
  });
  if (POSIX) {
    assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  }

  const second = ensureLocalTokens(base);
  assert.deepEqual(second.generated, []);
  assert.deepEqual(second.config.pluginTokens, first.config.pluginTokens);
  assert.deepEqual(second.config.agentTokens, first.config.agentTokens);
  assert.deepEqual(second.config.viewerTokens, first.config.viewerTokens);
  assert.equal(second.config.sessionSecret, first.config.sessionSecret);

  const explicit = ensureLocalTokens(loadConfig({ RDS_STORE: 'local', RDS_DATA_DIR: dataDir, RDS_AGENT_TOKENS: AGENT_TOKEN }));
  assert.deepEqual(explicit.config.agentTokens, [AGENT_TOKEN]);
  assert.deepEqual(explicit.config.pluginTokens, first.config.pluginTokens);
  assert.deepEqual(explicit.config.viewerTokens, first.config.viewerTokens);
  const viewer = ensureLocalTokens(loadConfig({ RDS_STORE: 'local', RDS_DATA_DIR: dataDir, RDS_VIEWER_TOKENS: VIEWER_TOKEN }));
  assert.deepEqual(viewer.config.viewerTokens, [VIEWER_TOKEN]);
});

test('config: a tokens.json without a viewer token gains one, keeping the others', t => {
  const dataDir = tempDir(t);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, TOKENS_FILE), JSON.stringify({ plugin: PLUGIN_TOKEN, agent: AGENT_TOKEN }));
  const res = ensureLocalTokens(loadConfig({ RDS_STORE: 'local', RDS_DATA_DIR: dataDir }));
  assert.deepEqual(res.generated, ['viewer']);
  assert.deepEqual(res.config.pluginTokens, [PLUGIN_TOKEN]);
  assert.deepEqual(res.config.agentTokens, [AGENT_TOKEN]);
  const stored = JSON.parse(fs.readFileSync(res.file, 'utf8'));
  assert.deepEqual(stored, { plugin: PLUGIN_TOKEN, agent: AGENT_TOKEN, viewer: res.config.viewerTokens[0], session: res.config.sessionSecret });
});

test('config: short tokens refuse non-loopback, warn on loopback; strong tokens and DATABASE_URL mode pass', () => {
  const short = { RDS_PLUGIN_TOKENS: 'dev-plugin', RDS_AGENT_TOKENS: AGENT_TOKEN };
  for (const RDS_STORE of ['local', 'memory']) {
    assert.throws(() => checkTokenStrength(loadConfig({ RDS_STORE, HOST: '0.0.0.0', ...short })), /Refusing to listen on 0\.0\.0\.0/);
    const warnings = checkTokenStrength(loadConfig({ RDS_STORE, ...short }));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /shorter than 32/);
    assert.deepEqual(checkTokenStrength(loadConfig({ RDS_STORE, HOST: '0.0.0.0', RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN })), []);
  }
  assert.deepEqual(checkTokenStrength(loadConfig({ DATABASE_URL: 'postgres://x', ...short })), []);
  const strong = { RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN };
  assert.throws(() => checkTokenStrength(loadConfig({ RDS_STORE: 'local', HOST: '0.0.0.0', ...strong, RDS_VIEWER_TOKENS: 'dev-viewer' })), /1 configured token/);
  assert.equal(checkTokenStrength(loadConfig({ RDS_STORE: 'local', ...strong, RDS_VIEWER_TOKENS: 'dev-viewer' })).length, 1);
  assert.deepEqual(checkTokenStrength(loadConfig({ RDS_STORE: 'local', HOST: '0.0.0.0', ...strong, RDS_VIEWER_TOKENS: VIEWER_TOKEN })), []);
});

test('config: RDS_UI_ORIGINS takes loopback origins only', () => {
  assert.deepEqual(loadConfig({}).uiOrigins, []);
  assert.deepEqual(loadConfig({ RDS_UI_ORIGINS: 'http://localhost:5173, HTTP://127.0.0.1:8080/' }).uiOrigins, ['http://localhost:5173', 'http://127.0.0.1:8080']);
  for (const bad of ['https://localhost:5173', 'http://evil.example:5173', 'http://localhost', 'http://localhost:0', 'http://localhost:70000',
    'http://localhost:5173/app', 'http://[::1]:5173', 'http://127.0.0.2:5173', 'http://localhost.evil.example:5173', '*']) {
    assert.throws(() => loadConfig({ RDS_STORE: 'local', RDS_UI_ORIGINS: `http://localhost:3000,${bad}` }), /RDS_UI_ORIGINS: .* is not a loopback origin/, bad);
  }
});

// --- Host / Origin checks -------------------------------------------------------

function embeddedApp(t, env = {}) {
  const config = loadConfig({ RDS_STORE: 'memory', PORT: String(PORT), RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, ...env });
  const app = buildApp({ store: new MemoryStore(), config });
  t.after(() => app.close());
  return app;
}

const preflight = (app, headers) => call(app, 'OPTIONS', SYNC, {
  headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type', 'access-control-request-private-network': 'true', ...headers },
});

test('embedded: loopback Host names pass on any port or none, anything else is 403 before auth', async t => {
  const app = embeddedApp(t);
  for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`, 'localhost:9000', '127.0.0.1', '[::1]:1234', '[::1]', 'localhost']) {
    assert.equal((await call(app, 'GET', '/health', { headers: { host } })).status, 200, host);
  }
  for (const host of [`evil.example:${PORT}`, 'evil.example', `127.0.0.2:${PORT}`, '::1', `localhost.evil.example:${PORT}`, `127.0.0.1.nip.io:${PORT}`, `[::2]:${PORT}`, `localhost:${PORT}:1`]) {
    const res = await call(app, 'GET', '/v3/files', { headers: { host } });
    assert.equal(res.status, 403, host);
    assert.equal(res.body.error, 'forbidden_host');
  }
});

test('embedded: the Host check stays on when bound to a non-loopback address', async t => {
  for (const RDS_STORE of ['memory', 'local']) {
    const env = { HOST: '0.0.0.0' };
    const app = RDS_STORE === 'memory'
      ? embeddedApp(t, env)
      : buildApp({ store: new MemoryStore(), config: localConfig(tempDir(t), env) });
    if (RDS_STORE === 'local') t.after(() => app.close());
    const foreign = await call(app, 'GET', '/health', { headers: { host: `design.example:${PORT}` } });
    assert.equal(foreign.status, 403, RDS_STORE);
    assert.equal(foreign.body.error, 'forbidden_host');
    for (const host of ['localhost:9000', '127.0.0.1', '[::1]:1234']) {
      assert.equal((await call(app, 'GET', '/health', { headers: { host } })).status, 200, `${RDS_STORE} ${host}`);
    }
    const evil = await call(app, 'GET', '/health', { headers: { host: `127.0.0.1:${PORT}`, origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.body.error, 'forbidden_origin');
  }
});

test('embedded: web origins are 403 (request and preflight); none / null reach auth', async t => {
  for (const RDS_STORE of ['memory', 'local']) {
    const app = RDS_STORE === 'memory' ? embeddedApp(t) : (await openApp(t, tempDir(t))).app;

    for (const origin of ['https://evil.example', 'http://localhost:3000']) {
      const req = await call(app, 'POST', SYNC, { headers: { host: HOST, origin }, body: {} });
      assert.equal(req.status, 403, `${RDS_STORE} ${origin}`);
      assert.equal(req.body.error, 'forbidden_origin');
      assert.equal(req.headers['access-control-allow-origin'], undefined);
      const pre = await preflight(app, { host: HOST, origin });
      assert.equal(pre.status, 403);
      assert.equal(pre.headers['access-control-allow-origin'], undefined);
      assert.equal(pre.headers['access-control-allow-private-network'], undefined);
    }

    assert.equal((await call(app, 'POST', SYNC, { headers: { host: HOST }, body: {} })).status, 401);
    assert.equal((await call(app, 'POST', SYNC, { headers: { host: HOST, origin: 'null' }, body: {} })).status, 401);

    const pre = await preflight(app, { host: HOST, origin: 'null' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], 'null');
    assert.equal(pre.headers['access-control-allow-private-network'], undefined);
  }
});

test('embedded: RDS_UI_ORIGINS origins pass the Origin check (request and preflight); others stay 403', async t => {
  const env = { RDS_UI_ORIGINS: 'http://localhost:5173,http://127.0.0.1:4173' };
  for (const RDS_STORE of ['memory', 'local']) {
    const app = RDS_STORE === 'memory'
      ? embeddedApp(t, env)
      : buildApp({ store: new MemoryStore(), config: localConfig(tempDir(t), env) });
    if (RDS_STORE === 'local') t.after(() => app.close());

    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:4173']) {
      const req = await call(app, 'GET', '/v3/files', { headers: { ...agent, origin } });
      assert.equal(req.status, 200, `${RDS_STORE} ${origin}`);
      assert.equal(req.headers['access-control-allow-origin'], origin);
      const pre = await call(app, 'OPTIONS', '/v3/files', {
        headers: { host: HOST, origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-rds-client' },
      });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers['access-control-allow-origin'], origin);
      assert.match(pre.headers['access-control-allow-headers'], /x-rds-client/);
      assert.equal(pre.headers['access-control-allow-private-network'], undefined);
    }
    assert.equal((await call(app, 'GET', '/v3/files', { headers: { ...agent, origin: 'http://localhost:5173' } })).headers['access-control-expose-headers'], 'x-rds-server, x-rds-next-cursor, retry-after, ratelimit-limit, ratelimit-remaining, ratelimit-reset');

    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'https://localhost:5173', 'https://evil.example', 'http://localhost:5173.evil.example']) {
      const req = await call(app, 'GET', '/v3/files', { headers: { ...agent, origin } });
      assert.equal(req.status, 403, `${RDS_STORE} ${origin}`);
      assert.equal(req.body.error, 'forbidden_origin');
    }
    const foreignHost = await call(app, 'GET', '/v3/files', { headers: { ...agent, host: 'evil.example', origin: 'http://localhost:5173' } });
    assert.equal(foreignHost.status, 403);
    assert.equal(foreignHost.body.error, 'forbidden_host');
  }
});

test('server: a non-loopback RDS_UI_ORIGINS entry is a startup error', t => {
  const res = spawnSync(process.execPath, [path.join(__dirname, '../src/server.js')], {
    env: { ...process.env, RDS_STORE: 'memory', RDS_DATA_DIR: tempDir(t), PORT: '0', RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_UI_ORIGINS: 'http://localhost:5173,https://ui.example.com' },
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /RDS_UI_ORIGINS: 'https:\/\/ui\.example\.com' is not a loopback origin/);
});

test('DATABASE_URL mode: any Host, origins reflected, no private-network opt-in', async t => {
  const config = loadConfig({ DATABASE_URL: 'postgres://x', RDS_PLUGIN_TOKENS: 'plugin-secret', RDS_AGENT_TOKENS: 'agent-secret' });
  const app = buildApp({ store: new MemoryStore(), config });
  t.after(() => app.close());
  for (const host of ['api.example.com', 'api.example.com:8443', `evil.example:${PORT}`]) {
    assert.equal((await call(app, 'GET', '/health', { headers: { host } })).status, 200, host);
  }
  const req = await call(app, 'POST', SYNC, { headers: { host: 'api.example.com', origin: 'https://evil.example' }, body: {} });
  assert.equal(req.status, 401);
  assert.equal(req.headers['access-control-allow-origin'], 'https://evil.example');
  const pre = await preflight(app, { host: 'api.example.com', origin: 'https://app.example' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'https://app.example');
  assert.equal(pre.headers['access-control-allow-private-network'], undefined);
});
