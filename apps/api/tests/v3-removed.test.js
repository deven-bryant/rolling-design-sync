'use strict';

/*
 * Removed design (docs/api-v3-design.md, "Removed design"): never-built
 * deletions resolve themselves at sync, removed work items per removed root
 * with the components they used, and the subtree clear — against the memory
 * store and PGlite (same SQL as Postgres), plus the migration that resolves
 * dirty never-built tombstones stored before.
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
const { openLocalStore, DEFAULT_MIGRATIONS_DIR } = require('../src/store/pglite');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const FK = 'ReMoVeD0RuSpspQy2E3WMD';
const MIGRATION = '20261012000000_api_v3_auto_resolve_never_built.sql';

function up(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}

const SET = { id: '6:0', key: 'BUTTONS', name: 'Buttons' };
const PRIMARY = { id: '6:1', key: 'PRIMARY', name: 'Primary', remote: false, set: SET };
const R = ['1:1'];
/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Old screen          deleted (built) — removed root
 * │  ├─ 3:1 INSTANCE Btn (of 6:1)  deleted
 * │  ├─ 3:2 INSTANCE Only (of 6:5) deleted — 6:5 is used only here
 * │  └─ 3:3 FRAME Card             deleted
 * │     └─ 4:1 TEXT Label          deleted
 * ├─ 2:2 FRAME Live screen         modified
 * │  ├─ 3:4 INSTANCE Btn (of 6:1)
 * │  └─ 3:5 INSTANCE Old (of 6:9)
 * ├─ 2:3 FRAME Draft               never built, deleted — resolves itself
 * ├─ 2:6 FRAME Gone                deleted (built) — removed root
 * │  └─ 3:7 FRAME Kept             live, modified
 * │     └─ 4:2 TEXT Note           deleted — its own removed root (parent live)
 * ├─ 6:0 COMPONENT_SET Buttons
 * │  ├─ 6:1 COMPONENT Primary
 * │  │  └─ 7:1 TEXT Label          deleted — inside a live component: part of 6:1's item
 * │  └─ 6:2 COMPONENT Secondary    deleted — inside a live set: its own component item
 * ├─ 6:5 COMPONENT Only
 * └─ 6:9 COMPONENT Old main        deleted — removed root with a live placement (3:5)
 */
const BUILT = () => [
  up('1:1', 'SECTION', 'Page', { childOrder: ['2:1', '2:2', '2:3', '2:6', '6:0', '6:5', '6:9'] }),
  up('2:1', 'FRAME', 'Old screen', { childOrder: ['3:1', '3:2', '3:3'] }, R),
  up('3:1', 'INSTANCE', 'Btn', { componentReference: PRIMARY }, [...R, '2:1'], { mainComponentId: '6:1' }),
  up('3:2', 'INSTANCE', 'Only', { fills: ['red'] }, [...R, '2:1'], { mainComponentId: '6:5' }),
  up('3:3', 'FRAME', 'Card', { childOrder: ['4:1'] }, [...R, '2:1']),
  up('4:1', 'TEXT', 'Label', { characters: 'Old' }, [...R, '2:1', '3:3']),
  up('2:2', 'FRAME', 'Live screen', { itemSpacing: 4, childOrder: ['3:4', '3:5'] }, R),
  up('3:4', 'INSTANCE', 'Btn', { componentReference: PRIMARY }, [...R, '2:2'], { mainComponentId: '6:1' }),
  up('3:5', 'INSTANCE', 'Old', { fills: ['blue'] }, [...R, '2:2'], { mainComponentId: '6:9' }),
  up('2:6', 'FRAME', 'Gone', { childOrder: ['3:7'] }, R),
  up('3:7', 'FRAME', 'Kept', { itemSpacing: 2, childOrder: ['4:2'] }, [...R, '2:6']),
  up('4:2', 'TEXT', 'Note', { characters: 'N' }, [...R, '2:6', '3:7']),
  up('6:0', 'COMPONENT_SET', 'Buttons', { childOrder: ['6:1', '6:2'] }, R),
  up('6:1', 'COMPONENT', 'Primary', { componentReference: PRIMARY, childOrder: ['7:1'] }, [...R, '6:0']),
  up('7:1', 'TEXT', 'Label', { characters: 'OK' }, [...R, '6:0', '6:1']),
  up('6:2', 'COMPONENT', 'Secondary', { cornerRadius: 2 }, [...R, '6:0']),
  up('6:5', 'COMPONENT', 'Only', { cornerRadius: 4 }, R),
  up('6:9', 'COMPONENT', 'Old main', { cornerRadius: 8 }, R),
];
const DRAFT = up('2:3', 'FRAME', 'Draft', { width: 10 }, R);
const DELETED = ['2:1', '3:1', '3:2', '3:3', '4:1', '2:3', '2:6', '4:2', '7:1', '6:2', '6:9'];
const EDITS = () => [
  up('2:2', 'FRAME', 'Live screen', { itemSpacing: 8, childOrder: ['3:4', '3:5'] }, R),
  up('3:7', 'FRAME', 'Kept', { itemSpacing: 6, childOrder: ['4:2'] }, [...R, '2:6']),
];
const hashOf = nodeId => BUILT().find(n => n.nodeId === nodeId).contentHash;

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-removed-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return { store, cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
  },
};

async function sync(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
  await sync(app, { fileName: 'Removed', rootNodeId: '1:1', upserts: BUILT(), markImplemented: true });
  await sync(app, { rootNodeId: '1:1', upserts: [DRAFT] });
  const deletion = await sync(app, { rootNodeId: '1:1', upserts: EDITS(), deletedNodeIds: DELETED });
  return { app, store, deletion, close: async () => { await app.close(); await cleanup(); } };
}

const get = (app, url) => app.inject({ method: 'GET', url, headers: agent });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const work = async (app, qs = '') => ok(await get(app, `/v3/files/${FK}/work?changes=names${qs}`));
const clear = async (app, items) => ok(await app.inject({ method: 'POST', url: `/v3/files/${FK}/clear`, headers: agent, payload: { commitRef: 'c1', items } }));
const dirtyIds = async app => ok(await get(app, `/v3/files/${FK}/nodes?state=dirty&fields=nodeId&limit=200`)).nodes.map(n => n.nodeId).sort();

const OLD_SCREEN = {
  kind: 'removed', key: '2:1', name: 'Old screen', type: 'FRAME', nodeCount: 5,
  categories: ['color', 'content', 'other'], changedProps: ['characters', 'childOrder', 'componentReference', 'fills'],
  uses: [
    { componentId: '6:5', name: 'Only', placementsRemoved: 1, livePlacements: 0 },
    { componentId: '6:1', name: 'Primary', set: SET, remote: false, placementsRemoved: 1, livePlacements: 1 },
  ],
  warnings: [],
  nodeIds: ['2:1', '3:1', '3:2', '3:3', '4:1'], more: 0,
};

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] a never-built deletion resolves itself at sync; the sync counts it as autoResolved`, async t => {
    const { app, store, deletion, close } = await openApp(kind);
    t.after(close);
    assert.equal(deletion.tombstoned, DELETED.length);
    assert.equal(deletion.autoResolved, 1);
    const draft = await store.getNode(FK, '2:3');
    assert.ok(draft.deletedAt);
    assert.equal(draft.dirty, false);
    assert.equal(draft.changeType, null);
    const events = await store.listEvents({ fileKey: FK, types: ['sync.completed'] });
    const { counts } = events[events.length - 1].data;
    assert.equal(counts.autoResolved, 1);
    assert.equal(counts.deleted, DELETED.length);
    assert.equal(counts.dirty, DELETED.length - 1 + EDITS().length, 'built deletions and edits only');
    assert.ok(!(await dirtyIds(app)).includes('2:3'));

    // Reappearing, it is never-implemented work again.
    await sync(app, { upserts: [DRAFT] });
    const back = await store.getNode(FK, '2:3');
    assert.equal(back.deletedAt, null);
    assert.equal(back.changeType, 'added');
  });

  test(`[${kind}] removed work items: one per removed root, after components and before key null; uses and warnings`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const all = await work(app);
    assert.deepEqual(all.items.map(i => [i.kind ?? null, i.key]), [
      [null, '6:1'], [null, '6:2'], ['removed', '2:1'], ['removed', '2:6'], ['removed', '4:2'], ['removed', '6:9'], [null, null],
    ]);
    const [primary, secondary, oldScreen, gone, note, oldMain, rest] = all.items;
    assert.deepEqual(primary.nodeIds, ['7:1'], 'a layer removed from a live component stays in its item');
    assert.equal(primary.placements, 1);
    assert.deepEqual(secondary.nodeIds, ['6:2'], 'a variant removed from a live set keeps its component item');
    assert.deepEqual(oldScreen, OLD_SCREEN);
    assert.equal('placements' in oldScreen, false);
    assert.deepEqual(gone.nodeIds, ['2:6'], 'the live 3:7 splits the removed design');
    assert.deepEqual(note.nodeIds, ['4:2']);
    assert.deepEqual(oldMain.uses, []);
    assert.deepEqual(oldMain.warnings, [{ code: 'main_removed_with_live_placements', componentId: '6:9', livePlacements: 1 }]);
    assert.deepEqual(rest.nodeIds, ['2:2', '3:7']);

    const progress = await work(app, '&include=progress');
    assert.deepEqual(progress.items[2].progress, { total: 5, clean: 0 });

    const set = await work(app, '&group=set');
    assert.deepEqual(set.items.map(i => [i.kind ?? null, i.key]), [
      [null, 'BUTTONS'], ['removed', '2:1'], ['removed', '2:6'], ['removed', '4:2'], ['removed', '6:9'], [null, null],
    ]);
    assert.deepEqual(set.items.slice(1, 5), all.items.slice(2, 6));

    for (const qs of ['', '&group=set']) {
      const pages = [];
      let cursor = null;
      do {
        const page = await work(app, `${qs}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        pages.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(pages, (await work(app, qs)).items);
    }

    const frames = await work(app, '&group=frame&under=1:1');
    assert.ok(frames.items.every(i => i.kind === undefined), 'group=frame is unchanged');
    assert.ok(frames.items.some(i => i.key === '2:1'));

    const expanded = await work(app, '&under=2:1&expand=instances');
    assert.deepEqual(expanded.items.map(i => i.key), ['2:1'], 'removed design is not expanded');

    const md = await get(app, `/v3/files/${FK}/work?format=md`);
    assert.match(md.body, /Removed: \*\*Old screen\*\* \(FRAME\) — 5 nodes: [^·]+ · uses 2 components \(1 unused elsewhere\)/);
    const lines = (await get(app, `/v3/files/${FK}/work?format=outline`)).body.split('\n');
    assert.ok(lines.some(l => l.startsWith('removed: Old screen (FRAME) · 5 nodes')), lines.join('\n'));
  });

  test(`[${kind}] subtree clear: stale root, not_removed on a live node, deleted descendants cleared, live ones untouched`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const stale = await clear(app, [{ nodeId: '2:1', contentHash: 'outdated', subtree: true }]);
    assert.deepEqual(stale.results, [{ nodeId: '2:1', status: 'stale', contentHash: hashOf('2:1') }]);

    const live = await clear(app, [{ nodeId: '2:2', contentHash: EDITS()[0].contentHash, subtree: true }]);
    assert.deepEqual(live.results, [{ nodeId: '2:2', status: 'not_removed', contentHash: EDITS()[0].contentHash }]);
    assert.deepEqual(live.totals, { cleared: 0, stale: 0, notFound: 0, notRemoved: 1 });
    assert.ok((await dirtyIds(app)).includes('2:2'));

    const done = await clear(app, [
      { nodeId: '2:1', contentHash: hashOf('2:1'), subtree: true },
      { nodeId: '2:6', contentHash: hashOf('2:6'), subtree: true },
    ]);
    assert.deepEqual(done.results, [
      { nodeId: '2:1', status: 'cleared', contentHash: hashOf('2:1'), subtreeCleared: 4 },
      { nodeId: '2:6', status: 'cleared', contentHash: hashOf('2:6'), subtreeCleared: 1 },
    ]);
    assert.deepEqual(done.totals, { cleared: 2, stale: 0, notFound: 0, notRemoved: 0 });
    assert.deepEqual(await dirtyIds(app), ['2:2', '3:7', '6:2', '6:9', '7:1'], '3:7 (live, below 2:6) is untouched');
    const events = await store.listEvents({ fileKey: FK, types: ['nodes.cleared'] });
    const last = events[events.length - 1].data;
    assert.equal(last.count, 7);
    assert.deepEqual([...last.nodeIds].sort(), ['2:1', '2:6', '3:1', '3:2', '3:3', '4:1', '4:2']);
    assert.deepEqual((await work(app)).items.filter(i => i.kind === 'removed').map(i => i.key), ['6:9']);
  });
}

test('the migration resolves dirty never-built tombstones stored before (local store)', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-removed-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const before = path.join(dir, 'migrations');
  fs.mkdirSync(before);
  for (const f of fs.readdirSync(DEFAULT_MIGRATIONS_DIR)) if (f.endsWith('.sql') && f !== MIGRATION) fs.copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(before, f));
  const dataDir = path.join(dir, 'data');
  let { store } = await openLocalStore({ dataDir, migrationsDir: before });
  await store.upsertFile({ fileKey: FK, name: 'Old' });
  for (const [nodeId, implementedHash] of [['1:1', null], ['1:2', 'h2'], ['1:3', null]]) {
    await store.upsertNode(FK, { nodeId, nodeType: 'FRAME', name: nodeId, parentId: null, path: nodeId.replace(':', '_3a'), attrs: {}, contentHash: `h${nodeId}`, captureVersion: 2, changeType: 'deleted', changedProps: [], changeCategories: [] });
    await store.updateNode(FK, nodeId, { implementedHash, dirty: true, deletedAt: nodeId === '1:3' ? null : new Date().toISOString(), changeType: nodeId === '1:3' ? 'added' : 'deleted' });
  }
  await store.close();
  ({ store } = await openLocalStore({ dataDir }));
  t.after(() => store.close());
  const [neverBuilt, built, live] = await store.getNodes(FK, ['1:1', '1:2', '1:3']).then(rows => ['1:1', '1:2', '1:3'].map(id => rows.find(r => r.nodeId === id)));
  assert.equal(neverBuilt.dirty, false);
  assert.equal(neverBuilt.changeType, null);
  assert.equal(built.dirty, true, 'a built deletion stays work');
  assert.equal(built.changeType, 'deleted');
  assert.equal(live.dirty, true, 'live rows are untouched');
});

test('/v3/openapi.json documents removed items, subtree clear and autoResolved', async t => {
  const app = buildApp({ store: new MemoryStore(), config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
  t.after(() => app.close());
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  const workOp = doc.paths['/v3/files/{fileKey}/work'].get;
  const item = workOp.responses['200'].content['application/json'].schema.properties.items.items;
  assert.deepEqual(item.properties.kind.enum, ['removed']);
  assert.ok(item.properties.uses && item.properties.warnings);
  assert.match(workOp.description, /subtree: true/);
  const clearOp = doc.paths['/v3/files/{fileKey}/clear'].post;
  const body = clearOp.requestBody.content['application/json'].schema;
  assert.equal(body.properties.items.items.properties.subtree.type, 'boolean');
  const result = clearOp.responses['200'].content['application/json'].schema.properties.results.items;
  assert.ok(result.properties.status.enum.includes('not_removed'));
  const syncOp = doc.paths['/v3/files/{fileKey}/sync'].post;
  assert.ok(syncOp.responses['200'].content['application/json'].schema.properties.autoResolved);
});
