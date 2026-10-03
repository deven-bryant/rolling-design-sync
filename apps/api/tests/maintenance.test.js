'use strict';

/*
 * Startup maintenance (docs/api-v3-agent-ergonomics.md, "8. Repairing missing
 * change data"): the runner and the `change-data` step, against the memory
 * store and PGlite.
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
const { buildPath } = require('../src/ltree');
const { runMaintenance, repairChangeData, STEPS } = require('../src/maintenance');

const AGENT_TOKEN = 'agent-secret';
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-maintenance-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

const ROOT = '1:1';
const EMPTY = { changedProps: [], changeCategories: [] };
const BUILT = { characters: 'Hello', fontSize: 14 };
const NOW = { characters: 'Hello', fontSize: 16 };
const ADDED = { paddingLeft: 16, fills: [{ type: 'SOLID', color: '#000' }] };
const GONE = { width: 800 };

const changesOf = n => ({ changeType: n.changeType, changedProps: n.changedProps, changeCategories: n.changeCategories });
const silent = () => {
  const lines = [];
  return { lines, info: msg => lines.push(['info', msg]), warn: (obj, msg) => lines.push(['warn', msg, obj]) };
};

/** Writes a node row directly through the store, as the given change columns. */
async function put(store, fileKey, nodeId, attrs, { baseline = false, changeType, parentId = ROOT } = {}) {
  const ancestors = nodeId === ROOT ? [] : [parentId];
  return store.upsertNode(fileKey, {
    nodeId, nodeType: 'FRAME', name: `Node ${nodeId}`, parentId: nodeId === ROOT ? null : parentId,
    path: buildPath(nodeId, ancestors), attrs, contentHash: core.contentHash(attrs), captureVersion: 2,
    changeType: changeType ?? null, ...EMPTY,
  }, baseline ? { implementedAt: '2026-09-01T00:00:00.000Z' } : null);
}

/**
 * Rows as the v0.8.0 migration's backfill left them: `change_type` set, no
 * props/categories. Returns the node ids by case.
 */
async function seedPreV080(store, fileKey) {
  await store.upsertFile({ fileKey, lastSyncAt: '2026-09-02T00:00:00.000Z' });
  await put(store, fileKey, ROOT, { width: 1200 }, { baseline: true });
  // added: never implemented
  await put(store, fileKey, '2:1', ADDED, { changeType: 'added' });
  // deleted, implemented attrs known
  await put(store, fileKey, '2:2', GONE, { baseline: true });
  await store.tombstoneNodes(fileKey, ['2:2'], '2026-09-02T00:00:00.000Z');
  await store.updateNode(fileKey, '2:2', { changeType: 'deleted', ...EMPTY });
  // modified, implemented attrs known
  await put(store, fileKey, '2:3', BUILT, { baseline: true });
  await put(store, fileKey, '2:3', NOW, { changeType: 'modified' });
  // modified, implemented attrs unknown (can't be recomputed)
  await put(store, fileKey, '2:4', BUILT, { baseline: true });
  await put(store, fileKey, '2:4', NOW, { changeType: 'modified' });
  await store.updateNode(fileKey, '2:4', { implementedAttrs: null });
  return { added: '2:1', deleted: '2:2', modified: '2:3', unknown: '2:4' };
}

for (const [kind, open] of Object.entries(STORES)) {
  test.describe(`startup maintenance (${kind} store)`, () => {
    let store, cleanup, app;
    let seq = 0;
    const newFile = () => `Maint${kind}${++seq}`;

    test.before(async () => {
      ({ store, cleanup } = await open());
      app = buildApp({ store, config: loadConfig({ RDS_AGENT_TOKENS: AGENT_TOKEN }) });
    });
    test.after(async () => { await app.close(); await cleanup(); });

    const summary = async fileKey => {
      const res = await app.inject({ method: 'GET', url: `/v3/files/${fileKey}/summary`, headers: agent });
      assert.equal(res.statusCode, 200, res.body);
      return res.json();
    };

    test('change-data recomputes added / deleted / modified rows; unknown-modified rows are untouched', async () => {
      const fk = newFile();
      const ids = await seedPreV080(store, fk);
      assert.ok(Object.values((await summary(fk)).byCategory).every(n => n === 0));
      const unknownBefore = await store.getNode(fk, ids.unknown);

      const log = silent();
      const results = await runMaintenance(store, { log });
      assert.deepEqual(results, [{ name: 'change-data', count: 3 }, { name: 'document-order', count: 5 }]);
      assert.deepEqual(log.lines, [['info', 'Maintenance change-data: 3 row(s) repaired.'], ['info', 'Maintenance document-order: 5 row(s) repaired.']]);

      assert.deepEqual(changesOf(await store.getNode(fk, ids.added)),
        { changeType: 'added', changedProps: ['fills', 'paddingLeft'], changeCategories: ['color', 'layout'] });
      assert.deepEqual(changesOf(await store.getNode(fk, ids.deleted)),
        { changeType: 'deleted', changedProps: ['width'], changeCategories: ['layout'] });
      assert.deepEqual(changesOf(await store.getNode(fk, ids.modified)),
        { changeType: 'modified', changedProps: ['fontSize'], changeCategories: ['typography'] });
      assert.deepEqual(await store.getNode(fk, ids.unknown), { ...unknownBefore, orderKey: '00000.00002' });
      assert.deepEqual(changesOf(await store.getNode(fk, ROOT)), { changeType: null, ...EMPTY });

      const byCategory = (await summary(fk)).byCategory;
      assert.ok(Object.values(byCategory).some(n => n > 0), JSON.stringify(byCategory));
      assert.equal(byCategory.typography, 1);
    });

    test('a second run changes nothing', async () => {
      const fk = newFile();
      const ids = await seedPreV080(store, fk);
      await runMaintenance(store, { log: silent() });
      const before = await store.getNodes(fk, [ROOT, ...Object.values(ids)]);
      const log = silent();
      assert.deepEqual(await runMaintenance(store, { log }), [{ name: 'change-data', count: 0 }, { name: 'document-order', count: 0 }]);
      assert.deepEqual(log.lines, [['info', 'Maintenance change-data: 0 row(s) repaired.'], ['info', 'Maintenance document-order: 0 row(s) repaired.']]);
      assert.deepEqual(await store.getNodes(fk, [ROOT, ...Object.values(ids)]), before);
    });

    test('change-data pages through candidates that stay unchanged', async () => {
      const fk = newFile();
      await put(store, fk, ROOT, { width: 1200 }, { baseline: true });
      const nodeIds = [];
      for (let i = 1; i <= 7; i += 1) {
        const nodeId = `3:${i}`;
        nodeIds.push(nodeId);
        await put(store, fk, nodeId, BUILT, { baseline: true });
        await put(store, fk, nodeId, NOW, { changeType: 'modified' });
        // every other row is unknown-modified and stays a candidate
        if (i % 2) await store.updateNode(fk, nodeId, { implementedAttrs: null });
      }
      const repaired = await repairChangeData(store, { batchSize: 2 });
      assert.equal(repaired, 3);
      for (const n of await store.getNodes(fk, nodeIds)) {
        const known = Number(n.nodeId.split(':')[1]) % 2 === 0;
        assert.deepEqual(changesOf(n), known
          ? { changeType: 'modified', changedProps: ['fontSize'], changeCategories: ['typography'] }
          : { changeType: 'modified', ...EMPTY }, n.nodeId);
      }
      assert.equal(await repairChangeData(store, { batchSize: 2 }), 0);
    });

    test('change-data does not overwrite a row rewritten since it was read', async () => {
      const fk = newFile();
      const ids = await seedPreV080(store, fk);
      const [row] = await store.listChangeRepairCandidates({ after: { fileKey: fk, nodeId: '2:0' }, limit: 1 });
      assert.equal(row.nodeId, ids.added);
      await store.updateNode(fk, ids.added, { changeType: 'added', changedProps: ['x'], changeCategories: ['structure'] });
      const written = await store.repairChangeColumns([{
        fileKey: fk, nodeId: ids.added, contentHash: row.contentHash, from: 'added',
        changeType: 'added', changedProps: ['fills'], changeCategories: ['color'],
      }]);
      assert.equal(written, 0);
      assert.deepEqual((await store.getNode(fk, ids.added)).changedProps, ['x']);
      assert.equal(await repairChangeData(store), 2);
    });

    test('the runner logs a failing step as a warning and runs the next one', async () => {
      const fk = newFile();
      const ids = await seedPreV080(store, fk);
      const boom = new Error('boom');
      const log = silent();
      const results = await runMaintenance(store, { log, steps: [{ name: 'broken', run: async () => { throw boom; } }, ...STEPS] });
      assert.deepEqual(results.map(r => [r.name, r.count]).slice(0, 2), [['broken', null], ['change-data', 3]]);
      assert.equal(results[2].name, 'document-order');
      assert.ok(results[2].count >= 5, String(results[2].count));
      assert.equal(results[0].error, boom);
      assert.equal(log.lines[0][0], 'warn');
      assert.match(log.lines[0][1], /Maintenance broken failed.*boom/);
      assert.deepEqual(log.lines[0][2], { err: boom });
      assert.deepEqual(log.lines[1], ['info', 'Maintenance change-data: 3 row(s) repaired.']);
      assert.equal((await store.getNode(fk, ids.added)).changedProps.length, 2);
    });
  });
}
