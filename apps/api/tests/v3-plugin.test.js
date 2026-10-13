'use strict';

/*
 * v3 plugin routes (docs/api-v3-phase2.md, "7. The plugin on v3"): a full
 * plugin sync session gives the same responses and stored state on the memory
 * store and PGlite (same SQL as Postgres).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { CODES } = require('../src/v3/problem');
const { version: SERVER_VERSION } = require('../package.json');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';
const CLOCK = new Date('2026-01-02T03:04:05.000Z');
const link = nodeId => `https://www.figma.com/design/${FK}/Design-File${nodeId ? `?node-id=${nodeId}` : ''}`;

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}
/** The same upsert with every node id written the Figma-link way (`1-2`). */
const dashed = id => id.replace(':', '-');
const dashedUp = u => ({ ...u, nodeId: dashed(u.nodeId), parentId: u.parentId && dashed(u.parentId), path: u.path.map(dashed) });

/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Card      paddingLeft 16 → 24
 * │  └─ 3:1 TEXT Label   unchanged
 * ├─ 2:2 TEXT Title      'Hi' → 'Hello'
 * ├─ 2:3 TEXT Caption    deleted in the second sync (tombstone)
 * ├─ 2:4 FRAME Badge     added in the second sync
 * └─ 2:5 INSTANCE Button of main 9:1
 */
const R = ['1:1'];
const BUILT = [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: 16 }, R),
  up('3:1', 'TEXT', 'Label', { characters: 'Label' }, [...R, '2:1']),
  up('2:2', 'TEXT', 'Title', { characters: 'Hi' }, R),
  up('2:3', 'TEXT', 'Caption', { characters: 'Cap' }, R),
  { ...up('2:5', 'INSTANCE', 'Button', { width: 80 }, R), isInstance: true, mainComponentId: '9:1' },
];
const NOW = [
  BUILT[0],
  up('2:1', 'FRAME', 'Card', { paddingLeft: 24 }, R),
  BUILT[2],
  up('2:2', 'TEXT', 'Title', { characters: 'Hello' }, R),
  up('2:4', 'FRAME', 'Badge', { cornerRadius: 4 }, R),
  BUILT[5],
];
const IDS = ['1:1', '2:1', '3:1', '2:2', '2:3', '2:4', '2:5', '9:9'];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-plugin-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({
    store,
    config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN }),
  });
  let tick = 0;
  app.nodeService.now = () => new Date(CLOCK.getTime() + 1000 * tick++);
  return { app, store, close: async () => { await app.close(); await cleanup(); } };
}

const inject = (app, method, url, payload, headers = plugin) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.ok(CODES[code], `code ${code} is listed in problem.js`);
  assert.equal(typeof body.detail, 'string');
  assert.equal(typeof body.hint, 'string');
  return body;
}

/** One plugin session's calls: node ids in stored (`1:2`) form in, dashed (`1-2`) on the wire; `exists` sets sorted. */
const client = app => ({
  hashes: async under => ok(await inject(app, 'GET', `/v3/files/${FK}/hashes?under=${dashed(under)}`)),
  sync: async ({ upserts = [], deletedNodeIds = [], rootNodeId, ...rest }) => ok(await inject(app, 'POST', `/v3/files/${FK}/sync`, {
    ...rest,
    ...(rootNodeId ? { rootNodeId: dashed(rootNodeId) } : {}),
    upserts: upserts.map(dashedUp),
    deletedNodeIds: deletedNodeIds.map(dashed),
  }, { ...plugin, 'x-rds-client': 'plugin/1.0.0' })),
  exists: async nodeIds => {
    const { present, stale } = ok(await inject(app, 'POST', `/v3/files/${FK}/exists`, { nodeIds: nodeIds.map(dashed) }));
    return { present: [...present].sort(), stale: [...stale].sort() };
  },
});

/** `value` without the store's own wall-clock stamps (`createdAt` / `updatedAt`). */
const WALL_CLOCK = new Set(['createdAt', 'updatedAt']);
const unstamped = value => JSON.parse(JSON.stringify(value), (k, v) => (WALL_CLOCK.has(k) ? undefined : v));

/** Runs the plugin's sync session; returns every response and the stored state after it. */
async function session(kind) {
  const { app, store, close } = await openApp(kind);
  try {
    const c = client(app);
    const responses = {};
    responses.hashesBefore = await c.hashes('1:1');
    responses.existsBefore = await c.exists(IDS);
    responses.baseline = await c.sync({ fileName: 'Design File', rootNodeId: '1:1', upserts: BUILT, markImplemented: true });
    responses.hashesBaseline = await c.hashes('1:1');
    responses.changed = await c.sync({ rootNodeId: '1:1', upserts: NOW.slice(0, 4) });
    responses.rest = await c.sync({ rootNodeId: '1:1', upserts: NOW.slice(4), deletedNodeIds: ['2:3'] });
    responses.hashesSubtree = await c.hashes('2:1');
    responses.hashesAfter = await c.hashes('1:1');
    await store.updateNode(FK, '2:5', { captureVersion: 1 });
    responses.existsAfter = await c.exists(IDS);
    responses.lateBaseline = await c.sync({ upserts: [up('4:1', 'FRAME', 'Late', { width: 1 }, R)], markImplemented: true });

    const nodes = await store.listNodeSubtree(FK, '1:1', { includeDeleted: true });
    nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const events = (await store.listEvents({ fileKey: FK, limit: 100 })).map(({ id, ...e }) => e);
    const scopes = ok(await inject(app, 'GET', `/v3/files/${FK}/scopes`, undefined, agent));
    const files = ok(await inject(app, 'GET', `/v3/files/${FK}`, undefined, agent));
    const listing = ok(await inject(app, 'GET', `/v3/files/${FK}/nodes?state=all&view=full&limit=100`, undefined, agent));
    return { responses, stored: unstamped({ nodes, events, scopes, files, listing }) };
  } finally {
    await close();
  }
}

test('v3 plugin routes: a full sync session gives the same responses and stored state on every store', async () => {
  const [first, ...others] = Object.keys(STORES);
  const ref = await session(first);
  for (const kind of others) {
    const other = await session(kind);
    assert.deepEqual(other.responses, ref.responses, `${kind} responses`);
    assert.deepEqual(other.stored, ref.stored, `${kind} stored state`);
  }

  // The fixtures exercise what they claim to.
  const r = ref.responses;
  assert.deepEqual(r.hashesBefore, { settings: { trackLibraryComponents: true } });
  assert.deepEqual(r.existsBefore, { present: [], stale: [] });
  assert.equal(r.baseline.baselined, BUILT.length);
  assert.equal(r.baseline.dirty, 0);
  assert.equal(r.changed.dirty, 2);
  assert.equal(r.rest.tombstoned, 1);
  assert.deepEqual(Object.keys(r.hashesSubtree).sort(), ['2:1', '3:1', 'settings']);
  assert.equal(r.hashesAfter['2:3'], undefined);
  assert.equal(r.hashesAfter['2:4'], NOW[4].contentHash);
  assert.deepEqual([...r.existsAfter.present].sort(), ['1:1', '2:1', '2:2', '2:4', '2:5', '3:1']);
  assert.deepEqual(r.existsAfter.stale, ['2:5']);
  assert.equal(r.lateBaseline.baselined, 1);
  const syncs = ref.stored.events.filter(e => e.type === 'sync.completed');
  assert.equal(syncs.length, 4);
  for (const e of syncs) assert.equal(e.data.client, 'plugin/1.0.0');
  const caption = ref.stored.nodes.find(n => n.nodeId === '2:3');
  assert.ok(caption.deletedAt, 'the tombstone is stored');
});

test('v3 plugin routes: plugin tokens only', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const routes = [
    ['GET', `/v3/files/${FK}/hashes?under=1-1`],
    ['POST', `/v3/files/${FK}/sync`, { upserts: [] }],
    ['POST', `/v3/files/${FK}/exists`, { nodeIds: ['1-1'] }],
  ];
  for (const [method, url, body] of routes) {
    for (const headers of [agent, viewer]) {
      const p = assertProblem(await inject(app, method, url, body, headers), 403, 'wrong_token_class');
      assert.match(p.detail, /requires a plugin token/);
      assert.match(p.hint, /RDS_PLUGIN_TOKENS/);
    }
    assertProblem(await inject(app, method, url, body, {}), 401, 'unauthorized');
    assertProblem(await inject(app, method, url, body, { authorization: 'Bearer nope' }), 401, 'invalid_token');
    const res = await inject(app, method, url, body);
    assert.equal(res.statusCode, 200, `${method} ${url}: ${res.body}`);
    assert.equal(res.headers['x-rds-server'], SERVER_VERSION);
  }
  // The agent routes still turn plugin tokens away.
  const p = assertProblem(await inject(app, 'GET', `/v3/files/${FK}/nodes`), 403, 'wrong_token_class');
  assert.match(p.hint, /plugin routes/);
  assertProblem(await inject(app, 'POST', `/v3/files/${FK}/clear`, { items: [] }), 403, 'wrong_token_class');
});

test('v3 plugin routes: ?url= addressing and 1-2 node ids', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const url = encodeURIComponent(link('1-1'));
  ok(await inject(app, 'POST', `/v3/files/-/sync?url=${url}`, { fileName: 'Design File', rootNodeId: '1-1', upserts: BUILT.map(dashedUp), markImplemented: true }));
  const all = ok(await inject(app, 'GET', `/v3/files/${FK}/hashes?under=1:1`));
  assert.deepEqual(Object.keys(all).filter(k => k !== 'settings').sort(), BUILT.map(u => u.nodeId).sort());

  // hashes: the link's node is the default `under`; the path may also name the file.
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/-/hashes?url=${url}`)), all);
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/${FK}/hashes?url=${url}`)), all);
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/-/hashes?url=${url}&under=1:1`)), all);
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/-/hashes?url=${encodeURIComponent(link('2-1'))}`)),
    { '2:1': all['2:1'], '3:1': all['3:1'], settings: all.settings });
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/-/hashes?url=${encodeURIComponent(link())}&under=2-1`)),
    { '2:1': all['2:1'], '3:1': all['3:1'], settings: all.settings });
  assertProblem(await inject(app, 'GET', `/v3/files/-/hashes?url=${url}&under=2-1`), 400, 'url_mismatch');
  assertProblem(await inject(app, 'GET', `/v3/files/-/hashes?url=${encodeURIComponent(link())}`), 400, 'invalid_parameter');
  assertProblem(await inject(app, 'GET', `/v3/files/${FK}/hashes`), 400, 'invalid_parameter');
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/${FK}/hashes?under=7-7`)), { settings: { trackLibraryComponents: true } });
  assert.deepEqual(ok(await inject(app, 'GET', `/v3/files/unknownFile/hashes?under=1-1`)), { settings: { trackLibraryComponents: true } });

  // exists and sync take the file from the link too.
  assert.deepEqual(ok(await inject(app, 'POST', `/v3/files/-/exists?url=${url}`, { nodeIds: ['1-1', '2:1', '9-9'] })), { present: ['1:1', '2:1'], stale: [] });
  const gone = ok(await inject(app, 'POST', `/v3/files/-/sync?url=${url}`, { deletedNodeIds: ['2-3'] }));
  assert.equal(gone.tombstoned, 1);
  assert.equal(ok(await inject(app, 'GET', `/v3/files/${FK}/hashes?under=1-1`))['2:3'], undefined);

  for (const [method, suffix, body] of [['GET', 'hashes', undefined], ['POST', 'exists', { nodeIds: ['1-1'] }], ['POST', 'sync', {}]]) {
    assertProblem(await inject(app, method, `/v3/files/otherFile/${suffix}?url=${url}`, body), 400, 'url_mismatch');
    assertProblem(await inject(app, method, `/v3/files/-/${suffix}`, body), 400, 'invalid_parameter');
    assertProblem(await inject(app, method, `/v3/files/-/${suffix}?url=${encodeURIComponent('https://example.com/x')}`, body), 400, 'invalid_url');
  }
});

test('v3 plugin routes: request errors are problems with hints', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const sync = body => inject(app, 'POST', `/v3/files/${FK}/sync`, body);
  const exists = body => inject(app, 'POST', `/v3/files/${FK}/exists`, body);

  // A body fileKey is accepted when it names the path's file.
  ok(await sync({ fileKey: FK, upserts: BUILT }));
  assert.deepEqual(ok(await exists({ fileKey: FK, nodeIds: ['1:1'] })), { present: ['1:1'], stale: [] });
  assert.match(assertProblem(await sync({ fileKey: 'otherFile', upserts: [] }), 400, 'invalid_body').detail, /does not match/);
  assertProblem(await exists({ fileKey: 'otherFile', nodeIds: [] }), 400, 'invalid_body');

  const unknown = assertProblem(await sync({ upserts: [], deletedNodeIDs: ['2:1'] }), 400, 'invalid_body');
  assert.ok(unknown.validParameters.includes('deletedNodeIds'));
  assertProblem(await exists({ nodeIds: [], extra: true }), 400, 'invalid_body');
  assertProblem(await inject(app, 'GET', `/v3/files/${FK}/hashes?under=1:1&fileKey=${FK}`), 400, 'unknown_parameter');

  assertProblem(await sync({ upserts: [{ nodeId: '5:1' }] }), 400, 'invalid_parameter');
  assertProblem(await sync({ upserts: [], markImplemented: 'maybe' }), 400, 'invalid_parameter');
  assertProblem(await exists({}), 400, 'invalid_parameter');
  const tooMany = assertProblem(await exists({ nodeIds: Array.from({ length: 5001 }, (_, i) => `1:${i}`) }), 400, 'invalid_body');
  assert.match(tooMany.detail, /at most 5000/);
  assert.match(tooMany.hint, /5000/);
});

test('OpenAPI: plugin routes take the plugin token and carry no agent annotations', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  assert.equal(doc.components.securitySchemes.pluginToken.scheme, 'bearer');
  const ops = [
    ['/v3/files/{fileKey}/hashes', 'get'],
    ['/v3/files/{fileKey}/sync', 'post'],
    ['/v3/files/{fileKey}/exists', 'post'],
  ];
  for (const [route, method] of ops) {
    const op = doc.paths[route][method];
    assert.deepEqual(op.security, [{ pluginToken: [] }], route);
    for (const status of ['200', '400', '401', '403']) assert.ok(op.responses[status], `${route} documents ${status}`);
    assert.deepEqual(Object.keys(op).filter(k => k.startsWith('x-')), [], `${route} has no x- annotations`);
    assert.ok(op.parameters.some(p => p.in === 'query' && p.name === 'url'), `${route} takes ?url=`);
  }
  const hashes = doc.paths['/v3/files/{fileKey}/hashes'].get;
  assert.ok(hashes.parameters.some(p => p.in === 'query' && p.name === 'under'));
  const sync = doc.paths['/v3/files/{fileKey}/sync'].post.requestBody.content['application/json'].schema;
  for (const k of ['upserts', 'deletedNodeIds', 'markImplemented', 'fileName', 'rootNodeId']) assert.ok(sync.properties[k], k);
  assert.deepEqual(doc.paths['/v3/files/{fileKey}/exists'].post.requestBody.content['application/json'].schema.required, ['nodeIds']);
  for (const [route, method] of ops) {
    assert.equal(JSON.stringify(doc.paths[route][method]).includes('x-rds-mcp'), false, route);
    assert.equal(JSON.stringify(doc.paths[route][method]).includes('x-rds-cli'), false, route);
  }
});
