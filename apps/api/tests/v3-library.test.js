'use strict';

/*
 * Library components (docs/api-v3-design.md, "Library components"): the
 * library flag (sync and the backfill migration), the per-file
 * trackLibraryComponents setting, filtering and reference items while it is
 * off, and library links through a stubbed Figma client — against the memory
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
const { LibraryLinks } = require('../src/library');
const { openLocalStore, DEFAULT_MIGRATIONS_DIR } = require('../src/store/pglite');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'LiBrArY0RuSpspQy2E3WMD';
const LIB_FILE = 'LibFile0RuSpspQy2E3WMD';
const MIGRATION = '20261013000000_api_v3_library_components.sql';

function up(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}

const LIB_REF = { id: '9:1', key: 'LIBKEY1', name: 'Lib button', remote: true };
const LOCAL_REF = { id: '6:1', key: 'LOCALKEY', name: 'Local', remote: false };
/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Screen
 * │  ├─ 3:1 INSTANCE Btn (of library 9:1)
 * │  └─ 3:2 INSTANCE Local (of 6:1)
 * └─ 6:1 COMPONENT Local
 * 9:1 COMPONENT Lib button (remote main, imported by key; outside the page)
 * └─ 9:2 TEXT Label
 */
const NODES = () => [
  up('1:1', 'SECTION', 'Page', { childOrder: ['2:1', '6:1'] }),
  up('2:1', 'FRAME', 'Screen', { childOrder: ['3:1', '3:2'] }, ['1:1']),
  up('3:1', 'INSTANCE', 'Btn', { componentReference: LIB_REF }, ['1:1', '2:1'], { mainComponentId: '9:1' }),
  up('3:2', 'INSTANCE', 'Local', { componentReference: LOCAL_REF }, ['1:1', '2:1'], { mainComponentId: '6:1' }),
  up('6:1', 'COMPONENT', 'Local', { componentReference: LOCAL_REF }, ['1:1']),
  up('9:1', 'COMPONENT', 'Lib button', { componentReference: LIB_REF, childOrder: ['9:2'] }),
  up('9:2', 'TEXT', 'Label', { characters: 'OK' }, ['9:1']),
];
const hashOf = id => NODES().find(n => n.nodeId === id).contentHash;

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-library-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return { store, cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
  },
};

/** A Figma REST stub: `answers` maps a component key to `{ status, meta }`; records the calls. */
function figmaStub(answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, token: init.headers['X-Figma-Token'] });
    const key = decodeURIComponent(String(url).split('/').pop());
    const a = answers[key] || { status: 404 };
    return { ok: a.status === 200, status: a.status, json: async () => ({ status: a.status, error: a.status !== 200, meta: a.meta }) };
  };
  return { fetch, calls };
}

async function openApp(kind, { token = '', answers = {}, clock = null } = {}) {
  const { store, cleanup } = await STORES[kind]();
  const stub = figmaStub(answers);
  const libraryLinks = new LibraryLinks({ store, token, fetch: stub.fetch, ...(clock ? { now: () => clock.now } : {}) });
  const config = loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN });
  const app = buildApp({ store, config, libraryLinks, ...(process.env.DBG ? { logger: { level: 'error' } } : {}) });
  const synced = await sync(app, { fileName: 'Library', rootNodeId: '1:1', upserts: NODES() });
  return { app, store, stub, synced, close: async () => { await app.close(); await cleanup(); } };
}

async function sync(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

const get = (app, url, headers = agent) => app.inject({ method: 'GET', url, headers });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const patch = (app, payload, headers = agent, fileKey = FK) => app.inject({ method: 'PATCH', url: `/v3/files/${fileKey}`, headers, payload });
const ids = async (app, qs = '') => ok(await get(app, `/v3/files/${FK}/nodes?fields=nodeId&limit=200${qs}`)).nodes.map(n => n.nodeId).sort();
const trackOff = async app => ok(await patch(app, { settings: { trackLibraryComponents: false }, worker: 'w-1' }));

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] library nodes: remote mains and their subtrees are flagged at sync; instances are not`, async t => {
    const { app, store, synced, close } = await openApp(kind);
    t.after(close);
    assert.equal(synced.upserted, NODES().length);
    const rows = new Map((await store.getNodes(FK, NODES().map(n => n.nodeId))).map(n => [n.nodeId, n.library]));
    assert.deepEqual(Object.fromEntries(rows), { '1:1': false, '2:1': false, '3:1': false, '3:2': false, '6:1': false, '9:1': true, '9:2': true });
    const label = ok(await get(app, `/v3/files/${FK}/nodes/9:2`));
    assert.deepEqual(label.library, { key: 'LIBKEY1', resolved: false });
    assert.equal(label.figmaUrl, null, 'no token: no link to the consuming file');
    const local = ok(await get(app, `/v3/files/${FK}/nodes/6:1`));
    assert.equal(local.library, null);
    assert.equal(local.figmaUrl, core.link(FK, '6:1'));
    const [event] = (await store.listEvents({ fileKey: FK, types: ['sync.completed'] }));
    assert.equal(event.data.counts.libraryDirty, 2);

    // `library: true` from the plugin flags a row too, and a later sync never unsets it.
    await sync(app, { upserts: [up('9:3', 'FRAME', 'Slot', { width: 2 }, ['9:9'], { library: true })] });
    await sync(app, { upserts: [up('9:3', 'FRAME', 'Slot', { width: 3 }, ['9:9'])] });
    assert.equal((await store.getNode(FK, '9:3')).library, true);
    const bad = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: { upserts: [{ ...up('9:4', 'TEXT', 'x', {}), library: 'yes' }] } });
    assert.equal(bad.statusCode, 400);
  });

  test(`[${kind}] settings: defaults, PATCH by agents only, unknown setting and file, event, returned to the plugin`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}`)).settings, { trackLibraryComponents: true });
    assert.deepEqual(ok(await get(app, '/v3/files')).files[0].settings, { trackLibraryComponents: true });
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/hashes?under=1:1`, plugin)).settings, { trackLibraryComponents: true });

    const asViewer = await patch(app, { settings: { trackLibraryComponents: false } }, viewer);
    assert.equal(asViewer.statusCode, 403);
    assert.equal(asViewer.json().code, 'wrong_token_class');
    const unknown = await patch(app, { settings: { trackEverything: true } });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().code, 'invalid_parameter');
    assert.equal((await patch(app, { settings: { trackLibraryComponents: 'no' } })).json().code, 'invalid_parameter');
    assert.equal((await patch(app, { settings: { trackLibraryComponents: false } }, agent, 'NoSuchFile1234')).json().code, 'file_not_found');

    const file = await trackOff(app);
    assert.deepEqual(file.settings, { trackLibraryComponents: false });
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/hashes?under=1:1`, plugin)).settings, { trackLibraryComponents: false });
    const events = await store.listEvents({ fileKey: FK, types: ['file.settings_changed'] });
    assert.equal(events.length, 1);
    assert.equal(events[0].actor, 'w-1');
    assert.deepEqual(events[0].data, { settings: { trackLibraryComponents: false } });
    ok(await patch(app, { settings: { trackLibraryComponents: false } }));
    assert.equal((await store.listEvents({ fileKey: FK, types: ['file.settings_changed'] })).length, 1, 'no change, no event');

  });

  const settle = () => new Promise(resolve => setTimeout(resolve, 2));

  test(`[${kind}] tracking off: library nodes leave listings, counts, summaries, progress and trends; back on restores them`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const all = ['1:1', '2:1', '3:1', '3:2', '6:1', '9:1', '9:2'];
    assert.deepEqual(await ids(app), all);
    const countsOn = ok(await get(app, `/v3/files/${FK}`)).counts;
    const trendsOn = ok(await get(app, `/v3/insights/trends?fileKey=${FK}`)).total;
    const summaryOn = ok(await get(app, `/v3/files/${FK}/summary`)).total;

    await trackOff(app);
    assert.deepEqual(await ids(app), ['1:1', '2:1', '3:1', '3:2', '6:1']);
    assert.deepEqual(await ids(app, '&library=include'), all);
    assert.deepEqual(await ids(app, '&library=only'), ['9:1', '9:2']);
    assert.deepEqual(await ids(app, '&q=library:only'), ['9:1', '9:2']);
    assert.equal((await get(app, `/v3/files/${FK}/nodes?library=sometimes`)).json().code, 'invalid_parameter');
    const countsOff = ok(await get(app, `/v3/files/${FK}`)).counts;
    assert.equal(countsOff.dirty, countsOn.dirty - 2);
    assert.equal(ok(await get(app, '/v3/files')).files[0].counts.total, countsOn.total - 2);
    assert.equal(ok(await get(app, `/v3/files/${FK}/summary`)).total, summaryOn - 2);
    assert.equal(ok(await get(app, `/v3/insights/trends?fileKey=${FK}`)).total.dirtied, trendsOn.dirtied - 2);

    // Clearing a library node by id still works, and its clear does not count while off.
    const cleared = ok(await app.inject({ method: 'POST', url: `/v3/files/${FK}/clear`, headers: agent, payload: { items: [{ nodeId: '9:2', contentHash: hashOf('9:2') }, { nodeId: '6:1', contentHash: hashOf('6:1') }] } }));
    assert.equal(cleared.totals.cleared, 2);
    const [clearEvent] = await store.listEvents({ fileKey: FK, types: ['nodes.cleared'] });
    assert.equal(clearEvent.data.libraryCount, 1);
    await settle(); // the trends window ends at now (exclusive): let a clear made this millisecond fall inside it
    assert.equal(ok(await get(app, `/v3/insights/trends?fileKey=${FK}`)).total.cleared, 1);
    const claim = ok(await app.inject({ method: 'POST', url: `/v3/files/${FK}/claims`, headers: agent, payload: { worker: 'w-1', nodeIds: ['9:1'] } }));
    assert.deepEqual(claim.nodes.map(n => n.nodeId), ['9:1']);

    ok(await patch(app, { settings: { trackLibraryComponents: true } }));
    assert.deepEqual(await ids(app), ['1:1', '2:1', '3:1', '3:2', '9:1']);
    await settle(); // the trends window ends at now (exclusive): let a clear made this millisecond fall inside it
    assert.equal(ok(await get(app, `/v3/insights/trends?fileKey=${FK}`)).total.cleared, 2);
  });

  test(`[${kind}] tracking off: with expand=instances a library main is a reference item with placements and no nodes`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const on = ok(await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&changes=names`));
    const tracked = on.items.find(i => i.key === '9:1');
    assert.equal(tracked.kind, undefined);
    assert.deepEqual(tracked.library, { key: 'LIBKEY1', resolved: false });
    assert.deepEqual(tracked.nodeIds, ['9:1', '9:2']);
    const frames = ok(await get(app, `/v3/files/${FK}/work?under=2:1&group=frame&expand=instances&changes=names&type=TEXT`));
    assert.deepEqual(frames.items.map(i => [i.key, i.nodeIds]), [[null, ['9:2']]]);
    assert.ok(frames.items.every(i => !('library' in i) && !('figmaUrl' in i)), 'frame items and the key: null item are never library items');
    const outside = ok(await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&changes=names&type=TEXT`));
    assert.deepEqual(outside.items.map(i => [i.key, 'library' in i]), [['9:1', true]]);

    await trackOff(app);
    const off = ok(await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&changes=names&include=progress`));
    assert.deepEqual(off.items.map(i => [i.kind ?? null, i.key]), [['library', '9:1'], [null, '6:1'], [null, null]]
      .sort((a, b) => off.items.findIndex(i => i.key === a[1]) - off.items.findIndex(i => i.key === b[1])));
    const ref = off.items.find(i => i.key === '9:1');
    assert.deepEqual(ref, {
      kind: 'library', tracked: false, library: { key: 'LIBKEY1', resolved: false }, figmaUrl: null,
      key: '9:1', name: 'Lib button', type: 'COMPONENT', nodeCount: 0, categories: [], changedProps: [], placements: 1, placementsInScope: 1,
    });
    assert.equal(off.total, off.items.length);
    const pages = [];
    let cursor = null;
    do {
      const page = ok(await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&changes=names&include=progress&limit=1${cursor ? `&cursor=${cursor}` : ''}`));
      pages.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(pages, off.items);
    const set = ok(await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&group=set&changes=names`));
    assert.equal(set.items.find(i => i.key === '9:1').kind, 'library');
    assert.equal(ok(await get(app, `/v3/files/${FK}/work?under=2:1&changes=names`)).items.some(i => i.kind === 'library'), false, 'only with expand=instances');
    const md = (await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&format=md`)).body;
    assert.match(md, /Library: \*\*Lib button\*\* \(COMPONENT\) — reference \(not tracked\)/);
    const outline = (await get(app, `/v3/files/${FK}/work?under=2:1&expand=instances&format=outline`)).body;
    assert.match(outline, /^library: Lib button \(COMPONENT\) · reference \(not tracked\)/m);
  });

  test(`[${kind}] library links: resolved through Figma with a token, cached; errors retried at most hourly`, async t => {
    const clock = { now: new Date('2026-10-12T00:00:00Z') };
    const answers = { LIBKEY1: { status: 200, meta: { key: 'LIBKEY1', file_key: LIB_FILE, node_id: '12:34', name: 'Lib button' } } };
    const { app, stub, close } = await openApp(kind, { token: 'figd-test-token', answers, clock });
    t.after(close);
    await app.libraryLinks.idle();
    assert.equal(stub.calls.length, 1, 'resolved after the sync');
    assert.equal(stub.calls[0].url, 'https://api.figma.com/v1/components/LIBKEY1');
    assert.equal(stub.calls[0].token, 'figd-test-token');
    assert.equal(ok(await get(app, '/v3/status')).libraryLinks, true);
    const label = ok(await get(app, `/v3/files/${FK}/nodes/9:2`));
    assert.deepEqual(label.library, { key: 'LIBKEY1', fileKey: LIB_FILE, resolved: true });
    assert.equal(label.figmaUrl, core.link(LIB_FILE, '12:34'));
    ok(await get(app, `/v3/files/${FK}/nodes?library=only`));
    assert.equal(stub.calls.length, 1, 'cached');

    // A key Figma does not know: error cached, no link, retried only after an hour.
    await sync(app, { upserts: [up('8:1', 'COMPONENT', 'Gone', { componentReference: { id: '8:1', key: 'MISSING', name: 'Gone', remote: true } })] });
    await app.libraryLinks.idle();
    const gone = ok(await get(app, `/v3/files/${FK}/nodes/8:1`));
    assert.deepEqual(gone.library, { key: 'MISSING', resolved: false });
    assert.equal(gone.figmaUrl, null);
    await app.libraryLinks.idle();
    assert.equal(stub.calls.filter(c => c.url.endsWith('/MISSING')).length, 1);
    clock.now = new Date(clock.now.getTime() + 61 * 60 * 1000);
    ok(await get(app, `/v3/files/${FK}/nodes/8:1`));
    await app.libraryLinks.idle();
    assert.equal(stub.calls.filter(c => c.url.endsWith('/MISSING')).length, 2);
    const body = JSON.stringify(ok(await get(app, `/v3/files/${FK}/nodes?library=only&view=full`)));
    assert.ok(!body.includes('figd-test-token'), 'the token is never returned');
  });
}

test('without a token nothing calls Figma and status reports libraryLinks: false', async t => {
  const { app, stub, close } = await openApp('memory', { answers: {} });
  t.after(close);
  ok(await get(app, `/v3/files/${FK}/nodes?library=only`));
  await app.libraryLinks.idle();
  assert.equal(stub.calls.length, 0);
  assert.equal(ok(await get(app, '/v3/status')).libraryLinks, false);
});

test('a Figma timeout is cached as an error and never fails the sync', async t => {
  const store = new MemoryStore();
  const links = new LibraryLinks({ store, token: 't', timeoutMs: 20, fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))) });
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }), libraryLinks: links });
  t.after(() => app.close());
  await sync(app, { upserts: NODES() });
  await links.idle();
  const [row] = await store.getLibraryComponents(['LIBKEY1']);
  assert.equal(row.error, 'timeout');
});

test('the migration flags library nodes stored before (local store)', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-library-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const before = path.join(dir, 'migrations');
  fs.mkdirSync(before);
  for (const f of fs.readdirSync(DEFAULT_MIGRATIONS_DIR)) if (f.endsWith('.sql') && f !== MIGRATION) fs.copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(before, f));
  const dataDir = path.join(dir, 'data');
  let { store } = await openLocalStore({ dataDir, migrationsDir: before });
  const rows = [
    ['1:1', 'FRAME', '1_3a1', {}, null], ['3:1', 'INSTANCE', '1_3a1.3_3a1', { componentReference: LIB_REF }, '9:1'],
    ['9:1', 'COMPONENT', '9_3a1', {}, null], ['9:2', 'TEXT', '9_3a1.9_3a2', {}, null],
    ['7:1', 'COMPONENT', '7_3a1', { componentReference: { id: '7:1', key: 'K7', remote: true } }, null], ['7:2', 'TEXT', '7_3a1.7_3a2', {}, null],
    ['6:1', 'COMPONENT', '6_3a1', { componentReference: LOCAL_REF }, null],
  ];
  for (const [nodeId, type, p, attrs, main] of rows) {
    await store.query(`insert into node (file_key, node_id, node_type, name, path, attrs, main_component_id, is_instance, content_hash, dirty)
      values ($1, $2, $3, $2, $4::ltree, $5::jsonb, $6, $7, 'h', true)`, [FK, nodeId, type, p, JSON.stringify(attrs), main, type === 'INSTANCE']);
  }
  await store.close();
  ({ store } = await openLocalStore({ dataDir }));
  t.after(() => store.close());
  const flags = Object.fromEntries((await store.getNodes(FK, rows.map(r => r[0]))).map(n => [n.nodeId, n.library]));
  assert.deepEqual(flags, { '1:1': false, '3:1': false, '9:1': true, '9:2': true, '7:1': true, '7:2': true, '6:1': false });
});

test('/v3/openapi.json documents the setting, the library filter, reference items and libraryLinks', async t => {
  const app = buildApp({ store: new MemoryStore(), config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
  t.after(() => app.close());
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  const op = doc.paths['/v3/files/{fileKey}'].patch;
  assert.equal(op['x-rds-mcp'].tool, 'update_file_settings');
  assert.ok(op.requestBody.content['application/json'].schema.properties.settings.properties.trackLibraryComponents);
  assert.ok(doc.paths['/v3/files/{fileKey}/nodes'].get.parameters.some(p => p.name === 'library'));
  const item = doc.paths['/v3/files/{fileKey}/work'].get.responses['200'].content['application/json'].schema.properties.items.items;
  assert.deepEqual(item.properties.kind.enum, ['removed', 'library', 'tokens']);
  assert.ok(doc.paths['/v3/status'].get.responses['200'].content['application/json'].schema.properties.libraryLinks);
});
