'use strict';

/*
 * v3 change columns on every node write path (docs/api-v3-design.md, "The change
 * model" and "Supporting data"), against the memory store and PGlite.
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
const { changeColumns } = require('../src/nodeService');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };

const ROOT = '1:1';
const CHILD = '2:1';
const GRANDCHILD = '3:1';

const BATCH_KEYS = ['dirty', 'fileKey', 'skippedInstances', 'tombstoned', 'upserted'];

const CLEAN = { changeType: null, changedProps: [], changeCategories: [] };

function upsert(nodeId, attrs, { parentId = null, path: ancestors = [], nodeType = 'FRAME' } = {}) {
  return { nodeId, parentId, path: ancestors, nodeType, name: `Node ${nodeId}`, attrs, contentHash: core.contentHash(attrs) };
}

const ROOT_ATTRS = { width: 800 };
const CHILD_ATTRS = { paddingLeft: 16, fills: [{ type: 'SOLID', color: '#000' }] };
const GRANDCHILD_ATTRS = { characters: 'Hello', fontSize: 14 };
const rootUp = (attrs = ROOT_ATTRS) => upsert(ROOT, attrs, { nodeType: 'SECTION' });
const childUp = (attrs = CHILD_ATTRS) => upsert(CHILD, attrs, { parentId: ROOT, path: [ROOT] });
const grandchildUp = (attrs = GRANDCHILD_ATTRS) => upsert(GRANDCHILD, attrs, { parentId: CHILD, path: [ROOT, CHILD], nodeType: 'TEXT' });
const TREE = () => [rootUp(), childUp(), grandchildUp()];

const changesOf = n => ({ changeType: n.changeType, changedProps: n.changedProps, changeCategories: n.changeCategories });

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-changes-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

/** `file` row and `sync_event` rows (oldest first) straight from the store. */
async function syncMeta(store, fileKey) {
  if (store instanceof MemoryStore) {
    return {
      file: store.files.get(fileKey) || null,
      events: [...store.syncEvents.values()].filter(e => e.fileKey === fileKey),
    };
  }
  const file = (await store.query('select * from file where file_key = $1', [fileKey])).rows[0];
  const events = (await store.query('select * from sync_event where file_key = $1 order by created_at, id', [fileKey])).rows;
  return {
    file: file ? { fileKey: file.file_key, name: file.name, lastSyncAt: new Date(file.last_sync_at).toISOString() } : null,
    events: events.map(e => ({ fileKey: e.file_key, rootNodeId: e.root_node_id, counts: e.counts, createdAt: new Date(e.created_at).toISOString() })),
  };
}

let fileSeq = 0;

for (const [kind, open] of Object.entries(STORES)) {
  test.describe(`change columns (${kind} store)`, () => {
    let store, cleanup, app, clock;

    test.before(async () => {
      ({ store, cleanup } = await open());
      const config = loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN });
      app = buildApp({ store, config });
      // Deterministic, strictly increasing server clock for sync timestamps.
      clock = Date.parse('2026-09-29T12:00:00.000Z');
      app.nodeService.now = () => new Date(clock += 1000);
    });
    test.after(async () => { await app.close(); await cleanup(); });

    const newFile = () => `File${kind}${++fileSeq}`;

    async function call(method, url, { headers, body, query } = {}) {
      const res = await app.inject({ method, url, headers, payload: body, query });
      return { status: res.statusCode, body: res.json() };
    }
    const batch = async (fileKey, body) => {
      const res = await call('POST', `/v3/files/${fileKey}/sync`, { headers: plugin, body });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body;
    };
    const clear = async (fileKey, nodeId, attrs) => {
      const res = await call('POST', `/v3/files/${fileKey}/clear`, { headers: agent, body: { commitRef: 'c0ffee', items: [{ nodeId, contentHash: core.contentHash(attrs) }] } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.results[0].status, 'cleared', JSON.stringify(res.body));
      return res.body;
    };
    const node = (fileKey, nodeId) => store.getNode(fileKey, nodeId);

    test('added -> modified -> cleared -> modified again diffs against the cleared state', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE() });
      let child = await node(fk, CHILD);
      assert.deepEqual(changesOf(child), { changeType: 'added', changedProps: ['fills', 'paddingLeft'], changeCategories: ['color', 'layout'] });
      assert.equal(child.implementedAttrs, null);

      await batch(fk, { upserts: [childUp({ ...CHILD_ATTRS, paddingLeft: 24 })] });
      child = await node(fk, CHILD);
      assert.deepEqual(changesOf(child), { changeType: 'added', changedProps: ['fills', 'paddingLeft'], changeCategories: ['color', 'layout'] });

      const cleared = { ...CHILD_ATTRS, paddingLeft: 24 };
      await clear(fk, CHILD, cleared);
      child = await node(fk, CHILD);
      assert.deepEqual(changesOf(child), CLEAN);
      assert.deepEqual(child.implementedAttrs, cleared);

      await batch(fk, { upserts: [childUp({ ...cleared, fills: [{ type: 'SOLID', color: '#fff' }] })] });
      child = await node(fk, CHILD);
      assert.equal(child.dirty, true);
      assert.deepEqual(changesOf(child), { changeType: 'modified', changedProps: ['fills'], changeCategories: ['color'] });
      assert.deepEqual(child.implementedAttrs, cleared);
    });

    test('first-scan baseline stores implemented attrs and clean columns', async () => {
      const fk = newFile();
      const res = await batch(fk, { upserts: TREE(), markImplemented: true });
      assert.equal(res.baselined, 3);
      for (const u of TREE()) {
        const n = await node(fk, u.nodeId);
        assert.deepEqual(n.implementedAttrs, u.attrs);
        assert.deepEqual(changesOf(n), CLEAN);
      }
      await batch(fk, { upserts: [grandchildUp({ ...GRANDCHILD_ATTRS, fontSize: 16, characters: 'Hi' })] });
      assert.deepEqual(changesOf(await node(fk, GRANDCHILD)),
        { changeType: 'modified', changedProps: ['characters', 'fontSize'], changeCategories: ['content', 'typography'] });
    });

    test('tombstone -> deleted, diffed against null; a cleared deletion is clean', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE(), markImplemented: true });
      await batch(fk, { deletedNodeIds: [GRANDCHILD] });
      const gone = await node(fk, GRANDCHILD);
      assert.ok(gone.deletedAt);
      assert.deepEqual(changesOf(gone), { changeType: 'deleted', changedProps: ['characters', 'fontSize'], changeCategories: ['content', 'typography'] });

      await clear(fk, GRANDCHILD, GRANDCHILD_ATTRS);
      assert.deepEqual(changesOf(await node(fk, GRANDCHILD)), CLEAN);
    });

    test('tombstoned never-implemented node is deleted with no built props; revival recomputes', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE() });
      await batch(fk, { deletedNodeIds: [GRANDCHILD] });
      assert.deepEqual(changesOf(await node(fk, GRANDCHILD)), { changeType: 'deleted', changedProps: [], changeCategories: [] });

      await batch(fk, { upserts: [grandchildUp()] });
      assert.deepEqual(changesOf(await node(fk, GRANDCHILD)),
        { changeType: 'added', changedProps: ['characters', 'fontSize'], changeCategories: ['content', 'typography'] });
    });

    test('reverting to the implemented state gives clean columns', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE(), markImplemented: true });
      await batch(fk, { upserts: [childUp({ ...CHILD_ATTRS, paddingLeft: 32 })] });
      assert.equal((await node(fk, CHILD)).changeType, 'modified');
      const res = await batch(fk, { upserts: [childUp()] });
      assert.equal(res.dirty, 0);
      const child = await node(fk, CHILD);
      assert.equal(child.dirty, false);
      assert.deepEqual(changesOf(child), CLEAN);
    });

    test('a re-upload with an unchanged hash keeps consistent columns', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE(), markImplemented: true });
      await batch(fk, { upserts: [childUp({ ...CHILD_ATTRS, paddingLeft: 32 })] });
      const before = changesOf(await node(fk, CHILD));
      await batch(fk, { upserts: [childUp({ ...CHILD_ATTRS, paddingLeft: 32 })] });
      assert.deepEqual(changesOf(await node(fk, CHILD)), before);
      await batch(fk, { upserts: [rootUp()] });
      assert.deepEqual(changesOf(await node(fk, ROOT)), CLEAN);
    });

    test('a token rebinding with the same raw value is a change', async () => {
      const fk = newFile();
      const fills = [{ type: 'SOLID', color: '#3B5BDB' }];
      const bound = id => ({
        fills, boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id }] },
        resolvedVariables: { v1: { name: 'color/brand/500' }, v2: { name: 'color/brand/600' } },
      });
      await batch(fk, { upserts: [rootUp(bound('v1'))], markImplemented: true });
      await batch(fk, { upserts: [rootUp(bound('v2'))] });
      assert.deepEqual(changesOf(await node(fk, ROOT)), { changeType: 'modified', changedProps: ['fills'], changeCategories: ['color'] });
    });

    test('dirty nodes with unknown implemented attrs are modified with no props', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE(), markImplemented: true });
      await store.updateNode(fk, CHILD, { implementedAttrs: null });
      await batch(fk, { upserts: [childUp({ ...CHILD_ATTRS, paddingLeft: 40 })] });
      const child = await node(fk, CHILD);
      assert.equal(child.implementedAttrs, null);
      assert.deepEqual(changesOf(child), { changeType: 'modified', changedProps: [], changeCategories: [] });
    });

    test('a content-hash change unblocks a blocked node; an unchanged hash keeps it blocked', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE() });
      const block = { blockedAt: '2026-09-29T00:00:00.000Z', blockedBy: 'agent-1', blockedReason: 'ambiguous spacing' };
      await store.updateNode(fk, CHILD, block);

      await batch(fk, { upserts: [childUp()] });
      let child = await node(fk, CHILD);
      assert.deepEqual({ blockedAt: child.blockedAt, blockedBy: child.blockedBy, blockedReason: child.blockedReason }, block);

      await batch(fk, { upserts: [childUp({ ...CHILD_ATTRS, paddingLeft: 20 })] });
      child = await node(fk, CHILD);
      assert.deepEqual({ blockedAt: child.blockedAt, blockedBy: child.blockedBy, blockedReason: child.blockedReason },
        { blockedAt: null, blockedBy: null, blockedReason: null });
    });

    test('fileName / rootNodeId name the file and record one sync_event per batch with counts', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE(), fileName: 'Design System', rootNodeId: ROOT });
      let meta = await syncMeta(store, fk);
      assert.equal(meta.file.name, 'Design System');
      assert.equal(meta.events.length, 1);
      assert.deepEqual(meta.events[0].counts, { uploaded: 3, changed: 0, added: 3, deleted: 0, baselined: 0 });
      assert.equal(meta.events[0].rootNodeId, ROOT);
      assert.equal(meta.events[0].createdAt, meta.file.lastSyncAt);

      await batch(fk, {
        upserts: [rootUp(), childUp({ ...CHILD_ATTRS, paddingLeft: 8 })], deletedNodeIds: [GRANDCHILD, 'never-seen'],
        fileName: 'Design System v2', rootNodeId: ROOT,
      });
      meta = await syncMeta(store, fk);
      assert.equal(meta.file.name, 'Design System v2');
      assert.equal(meta.events.length, 2);
      assert.deepEqual(meta.events[1].counts, { uploaded: 2, changed: 1, added: 0, deleted: 1, baselined: 0 });

      await batch(fk, { upserts: [upsert('4:1', { x: 1 }, { parentId: ROOT, path: [ROOT] })], markImplemented: true, rootNodeId: ROOT });
      meta = await syncMeta(store, fk);
      assert.equal(meta.file.name, 'Design System v2', 'a batch without fileName keeps the stored name');
      assert.deepEqual(meta.events[2].counts, { uploaded: 1, changed: 0, added: 0, deleted: 0, baselined: 1 });
    });

    test('without fileName / rootNodeId only file.last_sync_at is bumped', async () => {
      const fk = newFile();
      await batch(fk, { upserts: TREE() });
      const first = await syncMeta(store, fk);
      assert.deepEqual(first.events, []);
      assert.equal(first.file.name, null);
      assert.ok(first.file.lastSyncAt);

      await batch(fk, { deletedNodeIds: [GRANDCHILD] });
      const second = await syncMeta(store, fk);
      assert.deepEqual(second.events, []);
      assert.ok(second.file.lastSyncAt > first.file.lastSyncAt);
    });

    test('invalid fileName / rootNodeId are 400 and write nothing', async () => {
      const fk = newFile();
      for (const bad of [{ fileName: 7 }, { rootNodeId: ['1:1'] }]) {
        await assert.rejects(app.nodeService.batchUpsert({ fileKey: fk, upserts: TREE(), ...bad }), { statusCode: 400 });
      }
      assert.equal(await node(fk, ROOT), null);
      assert.equal((await syncMeta(store, fk)).file, null);
    });

    test('sync responses keep their shape', async () => {
      const fk = newFile();
      const res = await batch(fk, { upserts: TREE(), fileName: 'F', rootNodeId: ROOT });
      assert.deepEqual(Object.keys(res).sort(), BATCH_KEYS);
      assert.deepEqual(res, { fileKey: fk, upserted: 3, dirty: 3, tombstoned: 0, skippedInstances: 0 });
      const baseline = await batch(newFile(), { upserts: TREE(), markImplemented: true, fileName: 'F', rootNodeId: ROOT });
      assert.deepEqual(Object.keys(baseline).sort(), [...BATCH_KEYS, 'baselined'].sort());
    });
  });
}

test('changeColumns: clean, added, modified, unknown, deleted', () => {
  const attrs = { width: 10, name: 'A' };
  assert.deepEqual(changeColumns({ dirty: false, attrs }), CLEAN);
  assert.deepEqual(changeColumns({ dirty: true, implementedHash: null, attrs }),
    { changeType: 'added', changedProps: ['name', 'width'], changeCategories: ['layout', 'structure'] });
  assert.deepEqual(changeColumns({ dirty: true, implementedHash: 'h', implementedAttrs: { width: 10, name: 'B' }, attrs }),
    { changeType: 'modified', changedProps: ['name'], changeCategories: ['structure'] });
  assert.deepEqual(changeColumns({ dirty: true, implementedHash: 'h', implementedAttrs: null, attrs }),
    { changeType: 'modified', changedProps: [], changeCategories: [] });
  assert.deepEqual(changeColumns({ dirty: true, deletedAt: 'now', implementedHash: 'h', implementedAttrs: attrs, attrs }),
    { changeType: 'deleted', changedProps: ['name', 'width'], changeCategories: ['layout', 'structure'] });
});
