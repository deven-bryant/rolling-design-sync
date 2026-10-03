'use strict';

/*
 * v3 action routes (docs/api-v3-design.md, "Actions"): bulk clear and claims,
 * including leases stored without a claim row — against the memory store and PGlite
 * (same SQL as Postgres).
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
const { COMPACT_FIELDS } = require('../src/v3/schemas');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };

const FK = 'AbCdEf123456GhIjKl7890';
const UNKNOWN_CLAIM = '00000000-0000-4000-8000-000000000000';

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}

/*
 * 1:1 SECTION Page     clean
 * ├─ 2:1 FRAME Card    dirty [paddingLeft]
 * ├─ 2:2 FRAME Header  dirty [itemSpacing]
 * ├─ 2:3 TEXT Title    dirty [characters]
 * └─ 2:4 TEXT Caption  dirty [characters]
 */
const R = ['1:1'];
const TREE = v => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: v ? 24 : 16 }, R),
  up('2:2', 'FRAME', 'Header', { itemSpacing: v ? 12 : 8 }, R),
  up('2:3', 'TEXT', 'Title', { characters: v ? 'Hello' : 'Hi' }, R),
  up('2:4', 'TEXT', 'Caption', { characters: v ? 'Cap' : 'C' }, R),
];
const DIRTY = ['2:1', '2:2', '2:3', '2:4'];
const hashOf = nodeId => TREE(true).find(n => n.nodeId === nodeId).contentHash;

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-actions-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

/** A seeded app whose clock (`clock.offset` ms ahead of real time) drives the sync service. */
async function openApp(kind, env = {}) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, ...env }) });
  const clock = { offset: 0 };
  app.nodeService.now = () => new Date(Date.now() + clock.offset);
  await batch(app, { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE(false), markImplemented: true });
  await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true) });
  return { app, store, clock, close: async () => { await app.close(); await cleanup(); } };
}

async function batch(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${body.fileKey}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

const call = (app, method, url, payload) => app.inject({ method, url, headers: agent, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const claim = async (app, body) => ok(await call(app, 'POST', `/v3/files/${FK}/claims`, body));
const clear = (app, body) => call(app, 'POST', `/v3/files/${FK}/clear`, body);
const renew = (app, id, body) => call(app, 'POST', `/v3/files/${FK}/claims/${id}/renew`, body);
const release = (app, id) => call(app, 'DELETE', `/v3/files/${FK}/claims/${id}`);
const getNode = async (app, nodeId) => ok(await call(app, 'GET', `/v3/files/${FK}/nodes/${nodeId}`));
const listIds = async (app, qs) => ok(await call(app, 'GET', `/v3/files/${FK}/nodes?${qs}`)).nodes.map(n => n.nodeId);
const ids = nodes => nodes.map(n => n.nodeId);
const sameSet = (actual, expected) => assert.deepEqual([...actual].sort(), [...expected].sort());

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

for (const kind of Object.keys(STORES)) {
  test(`v3 bulk clear (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);

    await t.test('mixed results: cleared, stale with the current hash, not_found; 200 with totals', async () => {
      const body = ok(await clear(app, {
        commitRef: 'c1',
        items: [
          { nodeId: '2:1', contentHash: hashOf('2:1') },
          { nodeId: '2:2', contentHash: 'outdated' },
          { nodeId: '9:9', contentHash: 'x' },
          { nodeId: '2-3', contentHash: hashOf('2:3') },
        ],
      }));
      assert.equal(body.fileKey, FK);
      assert.equal(body.commitRef, 'c1');
      assert.deepEqual(body.results, [
        { nodeId: '2:1', status: 'cleared', contentHash: hashOf('2:1') },
        { nodeId: '2:2', status: 'stale', contentHash: hashOf('2:2') },
        { nodeId: '9:9', status: 'not_found', contentHash: null },
        { nodeId: '2:3', status: 'cleared', contentHash: hashOf('2:3') },
      ]);
      assert.deepEqual(body.totals, { cleared: 2, stale: 1, notFound: 1 });
      sameSet(await listIds(app, 'state=dirty'), ['2:2', '2:4']);
    });

    await t.test('clearing stores implemented attrs and the next change diffs against them', async () => {
      const card = await getNode(app, '2:1');
      assert.equal(card.state, 'clean');
      assert.equal(card.changeType, null);
      assert.deepEqual(card.changes, {});
      assert.deepEqual(card.implementedAttrs, { paddingLeft: 24 });
      assert.equal(card.history.implementedCommit, 'c1');
      assert.equal(card.history.implementedHash, hashOf('2:1'));
      await batch(app, { fileKey: FK, upserts: [up('2:1', 'FRAME', 'Card', { paddingLeft: 32 }, R)] });
      const next = await getNode(app, '2:1');
      assert.equal(next.state, 'dirty');
      assert.equal(next.changeType, 'modified');
      assert.deepEqual(next.changes, { paddingLeft: { built: 24, now: 32, category: 'layout' } });
    });

    await t.test('clearing releases the claims on the cleared nodes', async () => {
      const c = await claim(app, { worker: 'w1', nodeIds: ['2:2'] });
      await claim(app, { worker: 'w2', nodeIds: ['2:4'] });
      assert.equal((await getNode(app, '2:4')).claim.worker, 'w2');
      const body = ok(await clear(app, { items: [{ nodeId: '2:2', contentHash: hashOf('2:2') }, { nodeId: '2:4', contentHash: hashOf('2:4') }] }));
      assert.deepEqual(body.totals, { cleared: 2, stale: 0, notFound: 0 });
      assert.equal(body.commitRef, null);
      assert.equal((await getNode(app, '2:2')).claim, null);
      assert.equal((await getNode(app, '2:4')).claim, null);
      assert.deepEqual(ok(await renew(app, c.claimId)).nodes, [], 'a cleared node is no longer held by the claim');
    });

    await t.test('bad input is a problem', async () => {
      assertProblem(await clear(app, { items: [] }), 400, 'invalid_parameter');
      assertProblem(await clear(app, {}), 400, 'invalid_parameter');
      assertProblem(await clear(app, { items: [{ nodeId: '2:1' }] }), 400, 'invalid_parameter');
      const many = Array.from({ length: 501 }, (_, i) => ({ nodeId: `9:${i}`, contentHash: 'x' }));
      assertProblem(await clear(app, { items: many }), 400, 'invalid_parameter');
      assert.deepEqual(ok(await clear(app, { items: many.slice(0, 500) })).totals, { cleared: 0, stale: 0, notFound: 500 });
      const unknown = assertProblem(await clear(app, { itemz: [], items: [{ nodeId: '2:1', contentHash: 'x' }] }), 400, 'invalid_body');
      assert.match(unknown.detail, /itemz/);
      assertProblem(await call(app, 'POST', '/v3/files/NoSuchFile/clear', { items: [{ nodeId: '2:1', contentHash: 'x' }] }), 404, 'file_not_found');
      assertProblem(await app.inject({ method: 'POST', url: `/v3/files/${FK}/clear`, headers: plugin, payload: { items: [] } }), 403, 'wrong_token_class');
    });
  });

  test(`v3 claims (${kind} store)`, async t => {
    const { app, clock, close } = await openApp(kind);
    t.after(close);
    let w1;

    await t.test('claim by filter: compact nodes carrying the claim; default TTL from RDS_CLAIM_TTL_SECONDS', async () => {
      const before = Date.now();
      w1 = await claim(app, { worker: 'w1', label: 'Sprite', filter: { type: 'TEXT' } });
      assert.match(w1.claimId, /^[0-9a-f-]{36}$/);
      assert.equal(w1.worker, 'w1');
      assert.equal(w1.label, 'Sprite');
      const ttl = Date.parse(w1.expiresAt) - before;
      assert.ok(ttl > 14 * 60e3 && ttl <= 15 * 60e3 + 5e3, `default TTL ${ttl}`);
      assert.deepEqual(ids(w1.nodes), ['2:3', '2:4']);
      for (const n of w1.nodes) {
        assert.deepEqual(Object.keys(n).sort(), [...COMPACT_FIELDS].sort());
        assert.deepEqual(n.claim, { claimId: w1.claimId, worker: 'w1', label: 'Sprite', expiresAt: w1.expiresAt });
      }
      assert.deepEqual((await getNode(app, '2:3')).claim, { claimId: w1.claimId, worker: 'w1', label: 'Sprite', expiresAt: w1.expiresAt });
      sameSet(await listIds(app, 'claimed=mine&worker=w1'), ['2:3', '2:4']);
    });

    await t.test('filter takes q and ?url= scoping; already-yours nodes are taken again', async () => {
      const again = await claim(app, { worker: 'w1', filter: { q: 'type:TEXT name:Title' } });
      assert.deepEqual(ids(again.nodes), ['2:3']);
      assert.equal(again.nodes[0].claim.claimId, again.claimId);
      const url = encodeURIComponent(`https://www.figma.com/design/${FK}/My-Design?node-id=2-4`);
      const scoped = ok(await call(app, 'POST', `/v3/files/-/claims?url=${url}`, { worker: 'w1' }));
      assert.deepEqual(ids(scoped.nodes), ['2:4']);
    });

    await t.test('claim by ids skips nodes held by another worker and unknown ids', async () => {
      const w2 = await claim(app, { worker: 'w2', nodeIds: ['2-1', '2:3', '9:9', '2:1'] });
      assert.deepEqual(ids(w2.nodes), ['2:1']);
      assert.equal(w2.label, null);
      assert.deepEqual((await claim(app, { worker: 'w3', filter: { state: 'dirty' } })).nodes.map(n => n.nodeId), ['2:2']);
      assert.deepEqual((await claim(app, { worker: 'w4' })).nodes, []);
    });

    await t.test('another worker cannot take held nodes', async () => {
      assert.deepEqual((await claim(app, { worker: 'w9', nodeIds: ['2:1', '2:2', '2:3', '2:4'] })).nodes, []);
      const by = {};
      for (const id of ['2:1', '2:2', '2:3', '2:4']) by[id] = (await getNode(app, id)).claim.worker;
      assert.deepEqual(by, { '2:1': 'w2', '2:2': 'w3', '2:3': 'w1', '2:4': 'w1' });
    });

    await t.test('expiry frees nodes; renew then only touches nodes still held by the claim', async () => {
      clock.offset = 16 * 60e3;
      const w5 = await claim(app, { worker: 'w5', nodeIds: ['2:3'] });
      assert.deepEqual(ids(w5.nodes), ['2:3']);
      clock.offset = 0;
      const renewed = ok(await renew(app, w1.claimId, { ttlSeconds: 600 }));
      assert.equal(renewed.claimId, w1.claimId);
      assert.ok(Math.abs(Date.parse(renewed.expiresAt) - (Date.now() + 600e3)) < 5e3);
      assert.deepEqual(ids(renewed.nodes), [], 'nodes re-claimed since (by w5, or by w1 under a newer claim) are left alone');
      assert.equal((await getNode(app, '2:3')).claim.worker, 'w5');
    });

    await t.test('renew extends the claim and its nodes; release ends only that claim', async () => {
      const c = await claim(app, { worker: 'w1', label: 'L', nodeIds: ['2:4'], ttlSeconds: 60 });
      assert.deepEqual(ids(c.nodes), ['2:4']);
      const renewed = ok(await renew(app, c.claimId));
      assert.ok(Date.parse(renewed.expiresAt) > Date.parse(c.expiresAt));
      assert.deepEqual(ids(renewed.nodes), ['2:4']);
      assert.equal(renewed.nodes[0].claim.expiresAt, renewed.expiresAt);
      assert.equal(renewed.label, 'L');

      const released = ok(await release(app, c.claimId));
      assert.deepEqual(released, { claimId: c.claimId, worker: 'w1', label: 'L', released: ['2:4'] });
      assert.equal((await getNode(app, '2:4')).claim, null);
      assert.equal((await getNode(app, '2:3')).claim.worker, 'w5', 'other claims keep their nodes');
      assert.equal((await getNode(app, '2:1')).claim.worker, 'w2');
      assert.deepEqual(ok(await release(app, c.claimId)).released, []);
      assert.deepEqual(ok(await renew(app, c.claimId)).nodes, [], 'released nodes are not revived');
    });

    await t.test('a stored lease without a claim row shows with claimId null', async () => {
      await app.store.updateNode(FK, '2:4', { claimedBy: 'legacy-worker', claimExpiresAt: new Date(Date.now() + 600e3).toISOString() });
      const n = await getNode(app, '2:4');
      assert.equal(n.claim.claimId, null);
      assert.equal(n.claim.worker, 'legacy-worker');
      assert.equal(n.claim.label, null);
      assert.ok(Date.parse(n.claim.expiresAt) > Date.now());
      assert.deepEqual((await claim(app, { worker: 'w6', nodeIds: ['2:4'] })).nodes, []);
    });

    await t.test('ttlSeconds is capped at 24 h', async () => {
      clock.offset = 48 * 3600e3;
      const c = await claim(app, { worker: 'w7', nodeIds: ['2:1'], ttlSeconds: 7 * 24 * 3600 });
      assert.deepEqual(ids(c.nodes), ['2:1']);
      assert.ok(Math.abs(Date.parse(c.expiresAt) - (Date.now() + clock.offset + 24 * 3600e3)) < 5e3);
      const r = ok(await renew(app, c.claimId, { ttlSeconds: 10 ** 7 }));
      assert.ok(Math.abs(Date.parse(r.expiresAt) - (Date.now() + clock.offset + 24 * 3600e3)) < 5e3);
      clock.offset = 0;
    });

    await t.test('bad input is a problem', async () => {
      const post = body => call(app, 'POST', `/v3/files/${FK}/claims`, body);
      assertProblem(await post({}), 400, 'invalid_parameter');
      assertProblem(await post({ worker: '  ' }), 400, 'invalid_body');
      assertProblem(await post({ worker: 'w', nodeIds: ['2:1'], filter: {} }), 400, 'invalid_body');
      assertProblem(await post({ worker: 'w', ttlSeconds: 0 }), 400, 'invalid_parameter');
      assertProblem(await post({ worker: 'w', limit: 1001 }), 400, 'invalid_parameter');
      assertProblem(await post({ worker: 'w', nodeIDs: ['2:1'] }), 400, 'invalid_body');
      assertProblem(await post({ worker: 'w', filter: { stat: 'dirty' } }), 400, 'invalid_body');
      assertProblem(await post({ worker: 'w', filter: { claimed: 'true' } }), 400, 'invalid_body');
      assertProblem(await post({ worker: 'w', filter: { q: 'worker:x' } }), 400, 'invalid_body');
      assertProblem(await post({ worker: 'w', filter: { state: 'done' } }), 400, 'invalid_parameter');
      assertProblem(await post({ worker: 'w', filter: { under: '9:9' } }), 404, 'node_not_found');
      assertProblem(await call(app, 'POST', '/v3/files/NoSuchFile/claims', { worker: 'w' }), 404, 'file_not_found');
      for (const id of [UNKNOWN_CLAIM, 'not-a-uuid']) {
        assertProblem(await renew(app, id), 404, 'claim_not_found');
        assertProblem(await release(app, id), 404, 'claim_not_found');
      }
      assertProblem(await renew(app, w1.claimId, { ttl: 5 }), 400, 'invalid_body');
      assertProblem(await call(app, 'DELETE', `/v3/files/Other/claims/${w1.claimId}`), 404, 'file_not_found');
    });
  });

  test(`v3 claims: concurrent workers never share a node (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const workers = ['a', 'b', 'c', 'd', 'e'];
    const results = await Promise.all(workers.map(worker => claim(app, { worker, filter: {} })));
    const taken = results.flatMap(r => ids(r.nodes));
    sameSet(taken, DIRTY);
    assert.equal(new Set(taken).size, taken.length);
    for (const r of results) for (const n of r.nodes) assert.equal(n.claim.worker, r.worker);
  });
}

test('/v3/openapi.json documents the action routes', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  const ops = {
    '/v3/files/{fileKey}/clear': ['post'],
    '/v3/files/{fileKey}/claims': ['post', 'get'],
    '/v3/files/{fileKey}/claims/{claimId}/renew': ['post'],
    '/v3/files/{fileKey}/claims/{claimId}': ['delete'],
  };
  for (const [route, methods] of Object.entries(ops)) {
    assert.deepEqual(Object.keys(doc.paths[route] || {}).sort(), [...methods].sort(), route);
    const op = doc.paths[route][methods[0]];
    assert.deepEqual(op.security, [{ agentToken: [] }, { sessionCookie: [] }], route);
    for (const status of ['200', '400', '401', '403', '404']) assert.equal(typeof op.responses[status].description, 'string', `${route} ${status}`);
    const declared = (op.parameters || []).filter(p => p.in === 'path').map(p => p.name).sort();
    assert.deepEqual(declared, [...route.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), route);
    if (methods[0] === 'post' && !route.endsWith('/renew')) assert.ok(op.requestBody.content['application/json'].schema.properties, route);
  }
  const claimBody = doc.paths['/v3/files/{fileKey}/claims'].post.requestBody.content['application/json'].schema;
  for (const k of ['worker', 'label', 'ttlSeconds', 'limit', 'nodeIds', 'filter']) assert.ok(claimBody.properties[k], k);
  assert.equal(doc.paths['/v3/files/{fileKey}/clear'].post.requestBody.content['application/json'].schema.properties.items.maxItems, 500);
});
