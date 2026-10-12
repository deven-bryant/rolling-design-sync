'use strict';

/* DB-free unit tests for NodeSyncService (docs/node-sync-design.md), the service behind the v3 plugin routes. */

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { buildPath } = require('../src/ltree');
const { HttpError } = require('../src/errors');
const { NodeSyncService, EXISTS_MAX_IDS, CAPTURE_VERSION } = require('../src/nodeService');

const FILE_KEY = 'AbCdEf123456';
const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };

const ROOT = '1:1';
const CHILD = '2:1';
const GRANDCHILD = '3:1';
const OTHER_ROOT = '8:8';

function makeApp() {
  const config = loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN });
  const store = new MemoryStore();
  const app = buildApp({ store, config });
  return { app, store, service: app.nodeService };
}

function fresh(t) {
  const made = makeApp();
  t.after(() => made.app.close());
  return made;
}

/** `{ status, body }` for a service call: 200 with its result, or the HttpError's status and `{ error, message }`. */
async function run(fn) {
  try {
    return { status: 200, body: await fn() };
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return { status: err.statusCode, body: { error: err.code, message: err.message } };
  }
}

/** An upsert record in the shape the plugin sends: `path` = ancestor node ids. */
function upsert(nodeId, attrs, { parentId = null, path = [], nodeType = 'FRAME', name = `Node ${nodeId}`, ...rest } = {}) {
  return { nodeId, parentId, path, nodeType, name, attrs, contentHash: core.contentHash(attrs), ...rest };
}

const TREE = () => [
  upsert(ROOT, { width: 800 }, { nodeType: 'SECTION' }),
  upsert(CHILD, { paddingLeft: 16 }, { parentId: ROOT, path: [ROOT] }),
  upsert(GRANDCHILD, { characters: 'Hello' }, { parentId: CHILD, path: [ROOT, CHILD], nodeType: 'TEXT' }),
];

const batch = ({ service }, body) => run(() => service.batchUpsert({ fileKey: FILE_KEY, ...body }));
const hashes = ({ service }, nodeId, fileKey = FILE_KEY) => run(() => service.subtreeHashes(fileKey, nodeId));
const exists = ({ service }, body) => run(() => service.exists({ fileKey: FILE_KEY, ...body }));
/** The subtree's dirty rows (tombstones included), in path order. */
const dirtyUnder = ({ store }, nodeId) => store.listNodeSubtree(FILE_KEY, nodeId, { dirty: true });
/** Marks `nodeId` implemented at its current hash through POST /v3/files/:fileKey/clear. */
async function clear({ app }, nodeId, contentHash, commitRef) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${FILE_KEY}/clear`, headers: agent, payload: { commitRef, items: [{ nodeId, contentHash }] } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().results[0];
}

async function seeded(t) {
  const made = fresh(t);
  const res = await batch(made, { upserts: TREE() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { ...made, summary: res.body };
}

// --- exists -----------------------------------------------------------------

test('exists: returns the stored subset, excluding tombstoned and other files', async t => {
  const ctx = await seeded(t);
  const res = await exists(ctx, { nodeIds: [ROOT, 'never-seen', GRANDCHILD, CHILD, CHILD] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.present.sort(), [ROOT, CHILD, GRANDCHILD].sort());

  await batch(ctx, { deletedNodeIds: [GRANDCHILD] });
  assert.deepEqual((await exists(ctx, { nodeIds: [GRANDCHILD, CHILD] })).body, { present: [CHILD], stale: [] });

  const other = await exists(ctx, { fileKey: 'other-file', nodeIds: [ROOT] });
  assert.deepEqual(other.body, { present: [], stale: [] });
});

test('exists: empty input and never-scanned file yield an empty subset', async t => {
  const ctx = fresh(t);
  assert.deepEqual((await exists(ctx, { nodeIds: [] })).body, { present: [], stale: [] });
  assert.deepEqual((await exists(ctx, { nodeIds: [ROOT] })).body, { present: [], stale: [] });
});

test('exists: rows captured before CAPTURE_VERSION are reported as stale (stale ⊆ present)', async t => {
  const ctx = await seeded(t);
  const { store } = ctx;
  assert.ok(CAPTURE_VERSION >= 2);
  // Pre-migration rows keep the schema default `1`; simulate one.
  await store.updateNode(FILE_KEY, CHILD, { captureVersion: 1 });
  await store.updateNode(FILE_KEY, GRANDCHILD, { captureVersion: 1 });
  await batch(ctx, { deletedNodeIds: [GRANDCHILD] });

  const res = await exists(ctx, { nodeIds: [ROOT, CHILD, GRANDCHILD, 'never-seen'] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.present.sort(), [ROOT, CHILD].sort());
  assert.deepEqual(res.body.stale, [CHILD]);

  // Re-scanning a stale main stamps the current version and heals it.
  await batch(ctx, { upserts: [upsert(CHILD, { paddingLeft: 16 }, { parentId: ROOT, path: [ROOT] })] });
  assert.deepEqual((await exists(ctx, { nodeIds: [CHILD] })).body, { present: [CHILD], stale: [] });
});

test('exists: validates the payload and caps the batch size', async t => {
  const ctx = await seeded(t);
  assert.equal((await exists(ctx, { fileKey: undefined, nodeIds: [ROOT] })).status, 400);
  assert.equal((await exists(ctx, { fileKey: '  ', nodeIds: [ROOT] })).status, 400);
  assert.equal((await exists(ctx, {})).status, 400);
  assert.equal((await exists(ctx, { nodeIds: ROOT })).status, 400);
  assert.equal((await exists(ctx, { nodeIds: [ROOT, 7] })).status, 400);
  assert.equal((await exists(ctx, { nodeIds: [ROOT, ''] })).status, 400);
  const tooMany = await exists(ctx, { nodeIds: Array.from({ length: EXISTS_MAX_IDS + 1 }, (_, i) => `${i}:0`) });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error, 'batch_too_large');
  assert.equal((await exists(ctx, { nodeIds: Array.from({ length: EXISTS_MAX_IDS }, (_, i) => `${i}:0`) })).status, 200);
});

// --- hashes -----------------------------------------------------------------

test('hashes: empty for a never-scanned node, subtree-scoped afterwards', async t => {
  const ctx = fresh(t);
  assert.deepEqual((await hashes(ctx, ROOT)).body, {});

  await batch(ctx, { upserts: [...TREE(), upsert(OTHER_ROOT, { width: 100 }, { nodeType: 'SECTION' })] });

  const all = await hashes(ctx, ROOT);
  assert.equal(all.status, 200);
  assert.deepEqual(Object.keys(all.body).sort(), [ROOT, CHILD, GRANDCHILD].sort());
  assert.equal(all.body[CHILD], core.contentHash({ paddingLeft: 16 }));
  assert.deepEqual(Object.keys((await hashes(ctx, CHILD)).body).sort(), [CHILD, GRANDCHILD].sort());
  assert.deepEqual(Object.keys((await hashes(ctx, OTHER_ROOT)).body), [OTHER_ROOT]);
});

test('hashes: fileKey is required', async t => {
  const ctx = fresh(t);
  assert.equal((await hashes(ctx, ROOT, null)).status, 400);
  assert.equal((await hashes(ctx, ROOT, ' ')).status, 400);
});

// --- batch ------------------------------------------------------------------

test('batch: upserts are dirty against the empty auto-baseline', async t => {
  const { summary } = await seeded(t);
  assert.deepEqual(summary, { fileKey: FILE_KEY, upserted: 3, dirty: 3, tombstoned: 0, autoResolved: 0, skippedInstances: 0 });
});

test('batch: every upsert stamps capture_version = CAPTURE_VERSION', async t => {
  const ctx = await seeded(t);
  const { store } = ctx;
  for (const id of [ROOT, CHILD, GRANDCHILD]) assert.equal((await store.getNode(FILE_KEY, id)).captureVersion, CAPTURE_VERSION);
  assert.equal((await dirtyUnder(ctx, ROOT))[0].captureVersion, CAPTURE_VERSION);
});

test('batch: instance nodes are stored as placement rows and show up as dirty rows', async t => {
  const ctx = await seeded(t);
  const { store } = ctx;
  const res = await batch(ctx, {
    upserts: [
      upsert('4:1', { x: 1 }, { parentId: CHILD, path: [ROOT, CHILD], nodeType: 'INSTANCE', mainComponentId: '9:9' }),
      upsert('4:2', { x: 2 }, { parentId: CHILD, path: [ROOT, CHILD], isInstance: true }),
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 2, dirty: 2, tombstoned: 0, autoResolved: 0, skippedInstances: 0 });
  assert.deepEqual(Object.keys((await hashes(ctx, ROOT)).body).sort(), [ROOT, CHILD, GRANDCHILD, '4:1', '4:2'].sort());

  const stored = await store.getNode(FILE_KEY, '4:1');
  assert.equal(stored.isInstance, true);
  assert.equal(stored.mainComponentId, '9:9');

  const nodes = (await dirtyUnder(ctx, CHILD));
  const byId = Object.fromEntries(nodes.map(n => [n.nodeId, n]));
  assert.deepEqual(Object.keys(byId).sort(), [CHILD, GRANDCHILD, '4:1', '4:2'].sort());
  assert.equal(byId['4:1'].isInstance, true);
  assert.equal(byId['4:1'].mainComponentId, '9:9');
  assert.equal(byId['4:1'].parentId, CHILD);
  assert.equal(byId['4:1'].path, buildPath('4:1', [ROOT, CHILD]));
  assert.deepEqual(byId['4:1'].attrs, { x: 1 });
  assert.equal(byId['4:2'].isInstance, true);
  assert.equal(byId['4:2'].mainComponentId, null);
  assert.equal(byId[CHILD].isInstance, false);
  assert.equal(byId[CHILD].mainComponentId, null);
});

test('batch: isInstance / mainComponentId are validated', async t => {
  const ctx = await seeded(t);
  const bad = async rest => (await batch(ctx, { upserts: [upsert('5:1', { x: 1 }, { parentId: ROOT, path: [ROOT], ...rest })] })).status;
  assert.equal(await bad({ isInstance: 'yes' }), 400);
  assert.equal(await bad({ mainComponentId: 42 }), 400);
  assert.equal(await bad({ mainComponentId: '' }), 400);
  assert.equal(await bad({ isInstance: false, mainComponentId: null }), 200);
});

test('batch: dirty follows content_hash vs implemented_hash, both ways', async t => {
  const ctx = await seeded(t);
  const hash = core.contentHash({ paddingLeft: 16 });
  assert.equal((await clear(ctx, CHILD, hash, 'abc123')).status, 'cleared');

  const again = await batch(ctx, { upserts: [upsert(CHILD, { paddingLeft: 16 }, { parentId: ROOT, path: [ROOT] })] });
  assert.deepEqual(again.body, { fileKey: FILE_KEY, upserted: 1, dirty: 0, tombstoned: 0, autoResolved: 0, skippedInstances: 0 });

  const edited = await batch(ctx, { upserts: [upsert(CHILD, { paddingLeft: 24 }, { parentId: ROOT, path: [ROOT] })] });
  assert.equal(edited.body.dirty, 1);

  // Reverting the design back to the implemented state clears the node again.
  const reverted = await batch(ctx, { upserts: [upsert(CHILD, { paddingLeft: 16 }, { parentId: ROOT, path: [ROOT] })] });
  assert.equal(reverted.body.dirty, 0);
});

test('batch: deleted ids that were built are tombstoned with last-known attrs and stay dirty', async t => {
  const ctx = fresh(t);
  assert.equal((await batch(ctx, { upserts: TREE(), markImplemented: true })).status, 200);
  const res = await batch(ctx, { deletedNodeIds: [GRANDCHILD, 'never-seen'] });
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 0, dirty: 0, tombstoned: 1, autoResolved: 0, skippedInstances: 0 });

  // Tombstoned nodes drop out of the hash map (nothing left to compare) ...
  assert.deepEqual(Object.keys((await hashes(ctx, ROOT)).body).sort(), [ROOT, CHILD].sort());
  // ... but remain dirty, carrying their last-known attrs.
  const gone = (await dirtyUnder(ctx, ROOT)).find(n => n.nodeId === GRANDCHILD);
  assert.ok(gone.deletedAt, 'tombstoned');
  assert.deepEqual(gone.attrs, { characters: 'Hello' });
});

test('batch: deleted ids that were never built resolve themselves as clean tombstones', async t => {
  const ctx = await seeded(t);
  const res = await batch(ctx, { deletedNodeIds: [GRANDCHILD] });
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 0, dirty: 0, tombstoned: 1, autoResolved: 1, skippedInstances: 0 });
  assert.equal((await dirtyUnder(ctx, ROOT)).some(n => n.nodeId === GRANDCHILD), false);
  const gone = await ctx.store.getNode(FILE_KEY, GRANDCHILD);
  assert.ok(gone.deletedAt, 'tombstoned');
  assert.equal(gone.dirty, false);
  assert.equal(gone.changeType, null);
  // Reappearing later, it is added work again (never implemented).
  await batch(ctx, { upserts: [upsert(GRANDCHILD, { characters: 'Hello' }, { parentId: CHILD, path: [ROOT, CHILD], nodeType: 'TEXT' })] });
  const back = await ctx.store.getNode(FILE_KEY, GRANDCHILD);
  assert.equal(back.deletedAt, null);
  assert.equal(back.dirty, true);
  assert.equal(back.changeType, 'added');
});

test('batch: validates the payload', async t => {
  const ctx = await seeded(t);
  assert.equal((await batch(ctx, { fileKey: undefined, upserts: [] })).status, 400);
  assert.equal((await batch(ctx, { upserts: {} })).status, 400);
  assert.equal((await batch(ctx, { upserts: [{ nodeId: CHILD }] })).status, 400);
  assert.equal((await batch(ctx, { upserts: [{ contentHash: 'h' }] })).status, 400);
  assert.equal((await batch(ctx, { upserts: [{ nodeId: CHILD, contentHash: 'h', attrs: [] }] })).status, 400);
  assert.equal((await batch(ctx, { deletedNodeIds: [7] })).status, 400);
});

test('batch: a missing path is derived from the stored parent chain', async t => {
  const ctx = await seeded(t);
  const res = await batch(ctx, {
    upserts: [
      { nodeId: '4:9', parentId: GRANDCHILD, contentHash: 'h', attrs: { x: 1 } },
      { nodeId: '5:9', parentId: '4:9', contentHash: 'h', attrs: { x: 2 } },
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const nodes = (await dirtyUnder(ctx, GRANDCHILD));
  assert.deepEqual(nodes.map(n => n.nodeId), [GRANDCHILD, '4:9', '5:9']);
  assert.equal(nodes[2].path, buildPath('5:9', [ROOT, CHILD, GRANDCHILD, '4:9']));
});

// --- batch: markImplemented (first-scan baseline) ----------------------------

test('batch markImplemented: never-seen nodes are inserted clean with implementedCommit "baseline"', async t => {
  const ctx = fresh(t);
  const { store } = ctx;
  const res = await batch(ctx, { upserts: TREE(), markImplemented: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 3, dirty: 0, tombstoned: 0, autoResolved: 0, skippedInstances: 0, baselined: 3 });

  for (const u of TREE()) {
    const node = await store.getNode(FILE_KEY, u.nodeId);
    assert.equal(node.dirty, false);
    assert.equal(node.implementedHash, u.contentHash);
    assert.equal(node.implementedCommit, 'baseline');
    assert.ok(node.implementedAt);
    assert.equal(node.captureVersion, CAPTURE_VERSION);
  }
  assert.deepEqual((await dirtyUnder(ctx, ROOT)), []);
  const hashesAfter = (await hashes(ctx, ROOT)).body;
  assert.deepEqual(hashesAfter, Object.fromEntries(TREE().map(u => [u.nodeId, u.contentHash])));

  // A later edit of a baselined node dirties it against the baseline as usual.
  const edited = await batch(ctx, { upserts: [upsert(CHILD, { paddingLeft: 24 }, { parentId: ROOT, path: [ROOT] })] });
  assert.deepEqual(edited.body, { fileKey: FILE_KEY, upserted: 1, dirty: 1, tombstoned: 0, autoResolved: 0, skippedInstances: 0 });
  const [child] = (await dirtyUnder(ctx, ROOT));
  assert.equal(child.nodeId, CHILD);
  assert.equal(child.implementedHash, core.contentHash({ paddingLeft: 16 }));
  assert.equal(child.implementedCommit, 'baseline');
});

test('batch markImplemented: implementedAt is the server clock', async () => {
  const now = '2026-01-02T03:04:05.000Z';
  const store = new MemoryStore();
  const service = new NodeSyncService(store, { now: () => new Date(now) });
  const res = await service.batchUpsert({ fileKey: FILE_KEY, upserts: TREE(), markImplemented: true });
  assert.equal(res.baselined, 3);
  assert.equal((await store.getNode(FILE_KEY, ROOT)).implementedAt, now);
});

test('batch markImplemented: an existing dirty node stays dirty; only new nodes are baselined', async t => {
  const ctx = await seeded(t);
  const { store } = ctx;
  const res = await batch(ctx, {
    markImplemented: true,
    upserts: [
      ...TREE(),
      upsert(CHILD, { paddingLeft: 32 }, { parentId: ROOT, path: [ROOT] }),
      upsert('4:1', { x: 1 }, { parentId: CHILD, path: [ROOT, CHILD] }),
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 5, dirty: 4, tombstoned: 0, autoResolved: 0, skippedInstances: 0, baselined: 1 });

  for (const id of [ROOT, CHILD, GRANDCHILD]) {
    const node = await store.getNode(FILE_KEY, id);
    assert.equal(node.dirty, true, `${id} keeps its pending work`);
    assert.equal(node.implementedHash, null);
    assert.equal(node.implementedCommit, null);
    assert.equal(node.implementedAt, null);
  }
  const fresh = await store.getNode(FILE_KEY, '4:1');
  assert.equal(fresh.dirty, false);
  assert.equal(fresh.implementedCommit, 'baseline');
  assert.deepEqual((await dirtyUnder(ctx, ROOT)).map(n => n.nodeId).sort(), [ROOT, CHILD, GRANDCHILD].sort());
});

test('batch markImplemented: an existing clean node keeps its implemented commit', async t => {
  const ctx = await seeded(t);
  const { store } = ctx;
  const hash = core.contentHash({ paddingLeft: 16 });
  assert.equal((await clear(ctx, CHILD, hash, 'abc123')).status, 'cleared');
  const before = await store.getNode(FILE_KEY, CHILD);

  const res = await batch(ctx, { markImplemented: true, upserts: [upsert(CHILD, { paddingLeft: 24 }, { parentId: ROOT, path: [ROOT] })] });
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 1, dirty: 1, tombstoned: 0, autoResolved: 0, skippedInstances: 0, baselined: 0 });
  const after = await store.getNode(FILE_KEY, CHILD);
  assert.equal(after.dirty, true);
  assert.equal(after.implementedHash, hash);
  assert.equal(after.implementedCommit, 'abc123');
  assert.equal(after.implementedAt, before.implementedAt);
});

test('batch markImplemented: a tombstoned node is revived exactly as without the flag', async t => {
  const upsertGrandchild = () => upsert(GRANDCHILD, { characters: 'Hello' }, { parentId: CHILD, path: [ROOT, CHILD], nodeType: 'TEXT' });
  const revive = async markImplemented => {
    const ctx = fresh(t);
    const { store } = ctx;
    assert.equal((await batch(ctx, { upserts: TREE() })).status, 200);
    assert.equal((await batch(ctx, { deletedNodeIds: [GRANDCHILD] })).body.tombstoned, 1);
    const body = markImplemented === undefined ? { upserts: [upsertGrandchild()] } : { upserts: [upsertGrandchild()], markImplemented };
    const res = await batch(ctx, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { createdAt, updatedAt, ...node } = await store.getNode(FILE_KEY, GRANDCHILD);
    return { summary: res.body, node };
  };
  const withFlag = await revive(true);
  const without = await revive(undefined);
  assert.deepEqual(withFlag.summary, { ...without.summary, baselined: 0 });
  assert.deepEqual(withFlag.node, without.node);
  assert.equal(withFlag.node.dirty, true);
  assert.equal(withFlag.node.deletedAt, null);
  assert.equal(withFlag.node.implementedCommit, null);
});

test('batch markImplemented: deletedNodeIds are tombstoned as usual', async t => {
  const ctx = await seeded(t);
  const res = await batch(ctx, { markImplemented: true, upserts: [upsert('4:1', { x: 1 }, { parentId: ROOT, path: [ROOT] })], deletedNodeIds: [GRANDCHILD] });
  assert.deepEqual(res.body, { fileKey: FILE_KEY, upserted: 1, dirty: 0, tombstoned: 1, autoResolved: 1, skippedInstances: 0, baselined: 1 });
  const gone = await ctx.store.getNode(FILE_KEY, GRANDCHILD);
  assert.ok(gone.deletedAt, 'tombstoned');
  assert.equal(gone.dirty, false, 'never built: a clean tombstone');
});

test('batch markImplemented: false or omitted keeps today\'s behavior and response shape', async t => {
  const ctx = fresh(t);
  const off = await batch(ctx, { upserts: TREE(), markImplemented: false });
  assert.deepEqual(off.body, { fileKey: FILE_KEY, upserted: 3, dirty: 3, tombstoned: 0, autoResolved: 0, skippedInstances: 0 });
  for (const n of (await dirtyUnder(ctx, ROOT))) {
    assert.equal(n.dirty, true);
    assert.equal(n.implementedHash, null);
    assert.equal(n.implementedCommit, null);
  }
});

test('batch markImplemented: a non-boolean flag is 400 bad_request and writes nothing', async t => {
  const ctx = fresh(t);
  const { store } = ctx;
  for (const markImplemented of ['true', 1, 0, null, {}, []]) {
    const res = await batch(ctx, { upserts: TREE(), markImplemented });
    assert.equal(res.status, 400, `markImplemented=${JSON.stringify(markImplemented)}`);
    assert.equal(res.body.error, 'bad_request');
  }
  assert.equal(await store.getNode(FILE_KEY, ROOT), null);
});
