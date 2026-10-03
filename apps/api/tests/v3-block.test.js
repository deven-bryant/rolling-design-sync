'use strict';

/*
 * v3 blocking, the viewer token and client headers (docs/api-v3-phase2.md,
 * "3. Blocking", "5. Viewer token and UI origins", "6. Client versions") —
 * against the memory store and PGlite (same SQL as Postgres).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { tokenLabel } = require('../src/auth');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { MAX_REASON_LENGTH } = require('../src/v3/block');
const { version: SERVER_VERSION } = require('../package.json');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
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
  up('2:3', 'TEXT', 'Title', { characters: v ? title : 'Hi' }, R),
];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-block-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

/** A file synced twice: 2:1–2:3 dirty. */
async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({
    store,
    config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN }),
  });
  await batch(app, { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE(false), markImplemented: true });
  await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true) });
  return { app, close: async () => { await app.close(); await cleanup(); } };
}

async function batch(app, body, headers = {}) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${body.fileKey}/sync`, headers: { ...plugin, ...headers }, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

const call = (app, method, url, { headers = agent, payload } = {}) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const block = (app, nodeId, payload, headers) => call(app, 'POST', `/v3/files/${FK}/nodes/${nodeId}/block`, { payload, headers });
const unblock = (app, nodeId, payload, headers) => call(app, 'POST', `/v3/files/${FK}/nodes/${nodeId}/unblock`, { payload, headers });
const getNode = async (app, nodeId) => ok(await call(app, 'GET', `/v3/files/${FK}/nodes/${nodeId}`));
const listIds = async (app, qs = '') => ok(await call(app, 'GET', `/v3/files/${FK}/nodes?${qs}`)).nodes.map(n => n.nodeId);
const events = async app => ok(await call(app, 'GET', `/v3/files/${FK}/events?limit=1000`)).events;

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.code, code, res.body);
  assert.equal(typeof body.hint, 'string');
  return body;
}

for (const kind of Object.keys(STORES)) {
  test(`block / unblock (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);

    await t.test('block releases the lease, moves the node out of dirty and emits node.blocked', async () => {
      const claim = ok(await call(app, 'POST', `/v3/files/${FK}/claims`, { payload: { worker: 'w-1', nodeIds: ['2:2'] } }));
      assert.equal((await getNode(app, '2:2')).claim.worker, 'w-1');

      const res = ok(await block(app, '2-2', { reason: 'Ambiguous spacing', worker: 'w-1' }));
      assert.equal(res.fileKey, FK);
      assert.equal(res.node.nodeId, '2:2');
      assert.equal(res.node.state, 'blocked');
      assert.equal(res.node.claim, null);
      assert.equal(res.node.blocked.reason, 'Ambiguous spacing');
      assert.equal(res.node.blocked.by, 'w-1');
      assert.deepEqual(res.released, { claimId: claim.claimId, worker: 'w-1' });

      const node = await getNode(app, '2:2');
      assert.equal(node.state, 'blocked');
      assert.equal(node.claim, null);
      assert.deepEqual(await listIds(app), ['2:1', '2:3']);
      assert.deepEqual(await listIds(app, 'state=blocked'), ['2:2']);

      const last = (await events(app)).at(-1);
      assert.equal(last.type, 'node.blocked');
      assert.equal(last.actor, 'w-1');
      assert.deepEqual(last.data, { nodeId: '2:2', reason: 'Ambiguous spacing', by: 'w-1', auto: false });
    });

    await t.test('re-blocking replaces the reason; without worker, by is the token label; no lease → released null', async () => {
      const res = ok(await block(app, '2:2', { reason: 'Waiting on tokens' }));
      assert.equal(res.released, null);
      assert.equal(res.node.blocked.reason, 'Waiting on tokens');
      assert.equal(res.node.blocked.by, tokenLabel(AGENT_TOKEN));
      assert.equal((await events(app)).at(-1).data.by, tokenLabel(AGENT_TOKEN));
    });

    await t.test('unblock clears the block and emits node.unblocked; a second unblock is a no-op', async () => {
      const res = ok(await unblock(app, '2:2', { worker: 'w-2' }));
      assert.equal(res.unblocked, true);
      assert.equal(res.node.state, 'dirty');
      assert.equal(res.node.blocked, null);
      assert.deepEqual(await listIds(app), ['2:1', '2:2', '2:3']);
      assert.deepEqual(await listIds(app, 'state=blocked'), []);
      const before = await events(app);
      assert.equal(before.at(-1).type, 'node.unblocked');
      assert.deepEqual(before.at(-1).data, { nodeId: '2:2', reason: 'Waiting on tokens', by: 'w-2', auto: false });

      const again = ok(await unblock(app, '2:2'));
      assert.equal(again.unblocked, false);
      assert.equal(again.node.state, 'dirty');
      assert.equal((await events(app)).length, before.length);
    });

    await t.test('a clean node blocks and unblocks back to clean', async () => {
      assert.equal(ok(await block(app, '1:1', { reason: 'Out of scope' })).node.state, 'blocked');
      assert.equal(ok(await unblock(app, '1:1')).node.state, 'clean');
    });

    await t.test('a design change still auto-unblocks with auto: true', async () => {
      ok(await block(app, '2:3', { reason: 'Copy pending', worker: 'w-3' }));
      await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true, 'Hello there') });
      assert.equal((await getNode(app, '2:3')).state, 'dirty');
      const unblocked = (await events(app)).filter(e => e.type === 'node.unblocked').at(-1);
      assert.deepEqual(unblocked.data, { nodeId: '2:3', reason: 'Copy pending', by: null, auto: true });
    });

    await t.test('validation and not-found problems', async () => {
      assertProblem(await block(app, '2:1', {}), 400, 'invalid_parameter');
      assertProblem(await block(app, '2:1', { reason: '' }), 400, 'invalid_parameter');
      assertProblem(await block(app, '2:1', { reason: 'x'.repeat(MAX_REASON_LENGTH + 1) }), 400, 'invalid_parameter');
      assert.equal(ok(await block(app, '2:1', { reason: 'x'.repeat(MAX_REASON_LENGTH) })).node.state, 'blocked');
      ok(await unblock(app, '2:1'));
      assertProblem(await block(app, '2:1', { reason: 'r', nodeId: '2:2' }), 400, 'invalid_body');
      assertProblem(await unblock(app, '2:1', { reason: 'r' }), 400, 'invalid_body');
      assertProblem(await block(app, '9:9', { reason: 'r' }), 404, 'node_not_found');
      assertProblem(await unblock(app, '9:9'), 404, 'node_not_found');
      assertProblem(await call(app, 'POST', '/v3/files/NoSuchFile000/nodes/2:1/block', { payload: { reason: 'r' } }), 404, 'file_not_found');
      const link = encodeURIComponent(`https://www.figma.com/design/${FK}/Design?node-id=2-1`);
      assert.equal(ok(await call(app, 'POST', `/v3/files/-/nodes/-/block?url=${link}`, { payload: { reason: 'via link' } })).node.nodeId, '2:1');
      ok(await unblock(app, '2:1'));
    });
  });

  test(`viewer token: every v3 GET, no write (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const link = encodeURIComponent(`https://www.figma.com/design/${FK}/Design?node-id=2-1`);
    const reads = [
      '/v3/files', `/v3/files/${FK}`, `/v3/files/${FK}/scopes`, `/v3/files/${FK}/nodes`, `/v3/files/${FK}/nodes/2:1`,
      `/v3/files/${FK}/events`, `/v3/resolve?url=${link}`, '/v3/openapi.json',
    ];
    for (const url of reads) {
      ok(await call(app, 'GET', url, { headers: viewer }));
      assert.equal((await call(app, 'HEAD', url, { headers: viewer })).statusCode, 200, `HEAD ${url}`);
    }

    const { claimId } = ok(await call(app, 'POST', `/v3/files/${FK}/claims`, { payload: { worker: 'w-1', nodeIds: ['2:1'] } }));
    const writes = [
      ['POST', `/v3/files/${FK}/clear`, { items: [{ nodeId: '2:1', contentHash: 'x' }] }],
      ['POST', `/v3/files/${FK}/claims`, { worker: 'viewer' }],
      ['POST', `/v3/files/${FK}/claims/${claimId}/renew`, {}],
      ['DELETE', `/v3/files/${FK}/claims/${claimId}`, undefined],
      ['POST', `/v3/files/${FK}/nodes/2:1/block`, { reason: 'r' }],
      ['POST', `/v3/files/${FK}/nodes/2:1/unblock`, {}],
    ];
    const before = (await events(app)).length;
    for (const [method, url, payload] of writes) {
      const body = assertProblem(await call(app, method, url, { headers: viewer, payload }), 403, 'wrong_token_class');
      assert.match(body.detail, /viewer token/, url);
      assert.match(body.hint, /read-only/, url);
      assert.match(body.hint, /agent token/, url);
    }
    assert.equal((await events(app)).length, before, 'no viewer write reached the store');
    assert.equal((await getNode(app, '2:1')).claim.claimId, claimId);

    for (const [method, url, payload] of writes) {
      assert.notEqual((await call(app, method, url, { payload })).statusCode, 403, `agent ${method} ${url}`);
    }
    assertProblem(await call(app, 'GET', '/v3/files', { headers: plugin }), 403, 'wrong_token_class');
    assertProblem(await call(app, 'GET', '/v3/files', { headers: { authorization: 'Bearer nope' } }), 401, 'invalid_token');
    assertProblem(await call(app, 'POST', `/v3/files/${FK}/sync`, { headers: viewer, payload: {} }), 403, 'wrong_token_class');
    assertProblem(await call(app, 'GET', `/v3/files/${FK}/hashes?under=1:1`, { headers: viewer }), 403, 'wrong_token_class');
  });

  test(`client headers: X-RDS-Server on v3 responses, X-RDS-Client in data.client (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const responses = [
      await call(app, 'GET', '/v3/files'),
      await call(app, 'GET', '/v3/openapi.json', { headers: {} }),
      await call(app, 'GET', '/v3/files', { headers: {} }),
      await call(app, 'GET', '/v3/nope'),
      await call(app, 'POST', `/v3/files/${FK}/nodes/2:1/block`, { headers: viewer, payload: { reason: 'r' } }),
      await call(app, 'GET', `/v3/files/${FK}/nodes/9:9`),
    ];
    assert.deepEqual(responses.map(r => r.statusCode), [200, 200, 401, 404, 403, 404]);
    for (const res of responses) assert.equal(res.headers['x-rds-server'], SERVER_VERSION);
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).headers['x-rds-server'], undefined);

    const mcp = { ...agent, 'x-rds-client': 'mcp/0.8.0' };
    ok(await block(app, '2:1', { reason: 'r' }, mcp));
    ok(await unblock(app, '2:1', undefined, mcp));
    const { claimId } = ok(await call(app, 'POST', `/v3/files/${FK}/claims`, { headers: mcp, payload: { worker: 'w', nodeIds: ['2:1'] } }));
    ok(await call(app, 'POST', `/v3/files/${FK}/claims/${claimId}/renew`, { headers: mcp, payload: {} }));
    ok(await call(app, 'DELETE', `/v3/files/${FK}/claims/${claimId}`, { headers: mcp }));
    ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { headers: mcp, payload: { items: [{ nodeId: '2:1', contentHash: TREE(true)[1].contentHash }] } }));
    await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true, 'Hey') }, { 'x-rds-client': 'plugin/0.8.0' });
    ok(await block(app, '2:2', { reason: 'no header' }));

    const log = await events(app);
    const tail = log.slice(-8);
    assert.deepEqual(tail.map(e => e.type), ['node.blocked', 'node.unblocked', 'claim.created', 'claim.renewed', 'claim.released', 'nodes.cleared', 'sync.completed', 'node.blocked']);
    assert.deepEqual(tail.map(e => e.data.client ?? null), ['mcp/0.8.0', 'mcp/0.8.0', 'mcp/0.8.0', 'mcp/0.8.0', 'mcp/0.8.0', 'mcp/0.8.0', 'plugin/0.8.0', null]);
    assert.ok(log.slice(0, -8).every(e => !('client' in e.data)), 'no client without the header');
    assert.equal(JSON.stringify(log).includes(AGENT_TOKEN), false);
  });
}

test('X-RDS-Client is logged at debug level and capped', async t => {
  const lines = [];
  const stream = { write: line => lines.push(JSON.parse(line)) };
  const app = buildApp({
    store: new MemoryStore(),
    config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }),
    logger: { level: 'debug', stream },
  });
  t.after(() => app.close());
  await app.inject({ method: 'GET', url: '/v3/files', headers: { ...agent, 'x-rds-client': `cli/${'9'.repeat(200)}` } });
  const entry = lines.find(l => l.client);
  assert.ok(entry, 'client logged');
  assert.equal(entry.level, 20);
  assert.equal(entry.client.length, 100);
  assert.ok(entry.client.startsWith('cli/9'));
  assert.equal(JSON.stringify(lines).includes(AGENT_TOKEN), false);
});

test('OpenAPI: block routes are agent-only; GET routes also accept the viewer token', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  assert.equal(doc.components.securitySchemes.viewerToken.scheme, 'bearer');
  for (const route of ['/v3/files/{fileKey}/nodes/{nodeId}/block', '/v3/files/{fileKey}/nodes/{nodeId}/unblock']) {
    const op = doc.paths[route].post;
    assert.deepEqual(op.security, [{ agentToken: [] }, { sessionCookie: [] }], route);
    assert.ok(op.responses['403'], route);
  }
  assert.deepEqual(doc.paths['/v3/files/{fileKey}/nodes/{nodeId}/block'].post.requestBody.content['application/json'].schema.required, ['reason']);
  assert.deepEqual(doc.paths['/v3/files/{fileKey}/events'].get.security, [{ agentToken: [] }, { viewerToken: [] }, { sessionCookie: [] }]);
});
