'use strict';

/*
 * v3 check targets (docs/api-v3-design.md, "Check targets"): the scope
 * checks switch (and legacy kinds), automatic detection (the union of
 * top-level frames / variants and main components), families and variant
 * mappings, node maps, the ready list and its containment order, exclude,
 * containing=, route capture, attribution, node masks, history and retention — against the memory store and PGlite (same SQL as Postgres).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { MemoryBlobs } = require('../src/blobs/memory');
const { attribute, commonParent, NODE_MAP_MAX_ENTRIES } = require('../src/checkTargets');
const { pathNodeIds } = require('../src/ltree');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';
const W = 240;
const H = 200;

function up(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}
const inst = (nodeId, name, main, attrs, ancestors) => up(nodeId, 'INSTANCE', name, attrs, ancestors, { isInstance: true, mainComponentId: main });

/*
 * 1:1 SECTION Screens
 * ├─ 2:1 COMPONENT_SET Portal
 * │  ├─ 2:2 COMPONENT View=Files, Color Mode=Light   240×200
 * │  │  ├─ 3:1 FRAME Header → 4:1 TEXT Title
 * │  │  ├─ 3:2 INSTANCE Button (main 6:2)
 * │  │  └─ 3:3 FRAME Row → 4:2, 4:3, 4:4 TEXT
 * │  ├─ 2:3 COMPONENT View=Files, Color Mode=Dark
 * │  └─ 2:4 COMPONENT View=Nodes, Color Mode=Light
 * ├─ 2:5 FRAME Landing
 * └─ 2:6 TEXT Caption (not a target)
 * 5:1 SECTION Components
 * ├─ 6:1 COMPONENT_SET Button
 * │  ├─ 6:2 COMPONENT Size=sm → 6:5 TEXT Label, 7:1 INSTANCE Icon (main 6:4)
 * │  └─ 6:3 COMPONENT Size=lg
 * └─ 6:4 COMPONENT Icon
 */
const S = ['1:1'];
const P = [...S, '2:1'];
const V = [...P, '2:2'];
const SCREENS = [
  up('1:1', 'SECTION', 'Screens', { width: 2000 }),
  up('2:1', 'COMPONENT_SET', 'Portal', { width: 800 }, S),
  up('2:2', 'COMPONENT', 'View=Files, Color Mode=Light', { width: W, height: H, variantProperties: { View: 'Files', 'Color Mode': 'Light' } }, P),
  up('3:1', 'FRAME', 'Header', { width: 240, height: 40 }, V),
  up('4:1', 'TEXT', 'Title', { characters: 'Files' }, [...V, '3:1']),
  inst('3:2', 'Button', '6:2', { width: 80 }, V),
  up('3:3', 'FRAME', 'Row', { width: 240, height: 50 }, V),
  up('4:2', 'TEXT', 'A', { characters: 'a' }, [...V, '3:3']),
  up('4:3', 'TEXT', 'B', { characters: 'b' }, [...V, '3:3']),
  up('4:4', 'TEXT', 'C', { characters: 'c' }, [...V, '3:3']),
  up('2:3', 'COMPONENT', 'View=Files, Color Mode=Dark', { width: W, height: H, variantProperties: { View: 'Files', 'Color Mode': 'Dark' } }, P),
  up('2:4', 'COMPONENT', 'View=Nodes, Color Mode=Light', { width: W, height: H, variantProperties: { View: 'Nodes', 'Color Mode': 'Light' } }, P),
  up('2:5', 'FRAME', 'Landing', { width: 1440, height: 900 }, S),
  up('2:6', 'TEXT', 'Caption', { characters: 'x' }, S),
];
const C = ['5:1'];
const COMPONENTS = [
  up('5:1', 'SECTION', 'Components', { width: 1000 }),
  up('6:1', 'COMPONENT_SET', 'Button', { width: 200 }, C),
  up('6:2', 'COMPONENT', 'Size=sm', { width: 80, height: 40, variantProperties: { Size: 'sm' }, componentReference: { id: '6:2', key: 'k-sm', name: 'Size=sm', set: { id: '6:1', key: 'k-set', name: 'Button' } } }, [...C, '6:1']),
  up('6:5', 'TEXT', 'Label', { characters: 'Go' }, [...C, '6:1', '6:2']),
  inst('7:1', 'Icon', '6:4', { width: 16 }, [...C, '6:1', '6:2']),
  up('6:3', 'COMPONENT', 'Size=lg', { width: 120, height: 48, variantProperties: { Size: 'lg' } }, [...C, '6:1']),
  up('6:4', 'COMPONENT', 'Icon', { width: 40, height: 40, componentReference: { id: '6:4', key: 'k-icon', name: 'Icon' } }, C),
];

/** The node map of 2:2 (target px). */
const MAP_22 = [
  { nodeId: '2:2', x: 0, y: 0, width: W, height: H, depth: 0 },
  { nodeId: '3:1', x: 0, y: 0, width: 240, height: 40, depth: 1 },
  { nodeId: '4:1', x: 10, y: 10, width: 100, height: 20, depth: 2 },
  { nodeId: '3:2', x: 10, y: 100, width: 80, height: 40, depth: 1 },
  { nodeId: 'I3:2;6:5', mainNodeId: '6:5', x: 20, y: 110, width: 40, height: 20, depth: 2 },
  { nodeId: '3:3', x: 0, y: 150, width: 240, height: 50, depth: 1 },
  { nodeId: '4:2', x: 10, y: 160, width: 40, height: 20, depth: 2 },
  { nodeId: '4:3', x: 90, y: 160, width: 40, height: 20, depth: 2 },
  { nodeId: '4:4', x: 170, y: 160, width: 40, height: 20, depth: 2 },
];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-targets-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const blobs = new MemoryBlobs();
  const app = buildApp({
    store, blobs,
    config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN }),
  });
  await sync(app, { fileName: 'Design File', rootNodeId: '1:1', upserts: SCREENS, markImplemented: true });
  await sync(app, { rootNodeId: '5:1', upserts: COMPONENTS, markImplemented: true });
  return { app, blobs, close: async () => { await app.close(); await cleanup(); } };
}

async function sync(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: { fileKey: FK, ...body } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

const call = (app, method, url, { headers = agent, payload } = {}) =>
  app.inject({ method, url: `/v3/files/${FK}${url}`, headers, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.equal(res.json().code, code, res.body);
  return res.json();
}

/** A white PNG (base64) with optional black boxes. */
async function png({ width = W, height = H, boxes = [] } = {}) {
  const raw = Buffer.alloc(width * height * 4, 255);
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) raw.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return (await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer()).toString('base64');
}

const list = async (app, query = '') => ok(await call(app, 'GET', `/targets${query}`)).targets;
const byId = async (app, nodeId) => (await list(app)).find(t => t.nodeId === nodeId);
const patchSettings = async (app, value) => ok(await call(app, 'PATCH', '', { payload: { settings: value } }));
const needed = async app => ok(await call(app, 'GET', '/screens/references-needed', { headers: plugin })).screens;
async function reference(app, nodeId, { width = W, height = H, nodeMap } = {}) {
  const want = (await needed(app)).find(s => s.nodeId === nodeId);
  assert.ok(want, `${nodeId} needs a reference`);
  return ok(await call(app, 'PUT', `/screens/${nodeId}/reference`, {
    headers: plugin, payload: { designVersion: want.designVersion, image: await png({ width, height }), ...(nodeMap ? { nodeMap } : {}) },
  }));
}
async function check(app, nodeId, image) {
  const { check: c } = ok(await call(app, 'POST', `/screens/${nodeId}/checks`));
  return ok(await call(app, 'POST', `/checks/${c.checkId}/result`, { payload: { image } })).check;
}
const openNotes = async (app, nodeId) => ok(await call(app, 'GET', `/nodes/${nodeId}/notes`)).notes.filter(n => n.status === 'open');

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] scope checks: on by default, the union of targets, sync and API, legacy kinds, autoTargets=false`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const ids = async (query = '') => (await list(app, query)).map(x => x.nodeId).sort();
    assert.deepEqual(await ids(), ['2:2', '2:3', '2:4', '2:5', '6:2', '6:3', '6:4'], 'scopes never set are checked: top-level frames, variants, main components');
    assert.ok((await list(app)).every(x => x.source === 'auto' && x.excluded === false));
    assert.deepEqual((await byId(app, '2:5')).viewport, { width: 1440, height: 900 }, 'viewport = the Figma size');
    assert.deepEqual(ok(await call(app, 'GET', '/scopes')).scopes.map(s => s.checks), [true, true]);

    // A main component nested in a frame is a target too, checked before the frame that contains it.
    await sync(app, { rootNodeId: '1:1', upserts: [up('2:7', 'COMPONENT', 'Badge', { width: 30, height: 20 }, [...S, '2:5'])] });
    const all = await list(app);
    assert.ok(all.some(x => x.nodeId === '2:7' && x.level === 'component'), 'deprecated level: component below the top level');
    assert.deepEqual((await byId(app, '2:5')).contains, ['2:7']);
    assert.ok(all.findIndex(x => x.nodeId === '2:7') < all.findIndex(x => x.nodeId === '2:5'), 'contained targets first');

    const bad = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: { checks: false, upserts: [] } });
    assertProblem(bad, 400, 'invalid_body');
    await sync(app, { rootNodeId: '1:1', upserts: [], checks: false });
    assert.deepEqual(await ids(), ['6:2', '6:3', '6:4'], 'checks: false removes the scope\'s targets');
    await sync(app, { rootNodeId: '1:1', upserts: [] });
    assert.deepEqual(await ids(), ['6:2', '6:3', '6:4'], 'a sync without the field keeps the stored value');
    await sync(app, { rootNodeId: '5:1', upserts: [], scopeKind: 'none' });
    assert.deepEqual(await ids(), [], 'legacy kind none = off');
    await sync(app, { rootNodeId: '5:1', upserts: [], scopeKind: 'components' });
    assert.deepEqual(await ids(), ['6:2', '6:3', '6:4'], 'legacy screens / components = on');

    assertProblem(await call(app, 'PATCH', '/scopes/1:1', { headers: viewer, payload: { checks: true } }), 403, 'wrong_token_class');
    const set = ok(await call(app, 'PATCH', '/scopes/1:1', { payload: { checks: true } }));
    assert.deepEqual(set, { fileKey: FK, nodeId: '1:1', checks: true, targets: 5 });
    assert.deepEqual(ok(await call(app, 'PATCH', '/scopes/5:1', { payload: { kind: 'none' } })), { fileKey: FK, nodeId: '5:1', checks: false, targets: 0 });
    assertProblem(await call(app, 'PATCH', '/scopes/1:1', { payload: {} }), 400, 'invalid_body');
    assertProblem(await call(app, 'PATCH', '/scopes/1:1', { payload: { kind: 'pages' } }), 400, 'invalid_parameter');
    const checks = Object.fromEntries(ok(await call(app, 'GET', '/scopes')).scopes.map(s => [s.nodeId, s.checks]));
    assert.deepEqual(checks, { '1:1': true, '5:1': false });

    // A manual screen survives everything.
    ok(await call(app, 'PUT', '/screens/2:5', { payload: { route: '/landing' } }));
    assert.equal((await byId(app, '2:5')).source, 'manual');
    await patchSettings(app, { autoTargets: false });
    assert.deepEqual((await list(app)).map(x => [x.nodeId, x.source]), [['2:5', 'manual']], 'autoTargets=false: only manual screens');
    assert.deepEqual(await needed(app), [{ nodeId: '2:5', designVersion: (await byId(app, '2:5')).designVersion, level: 'screen' }]);
    await patchSettings(app, { autoTargets: true });
    assert.equal((await list(app)).length, 5);
  });

  test(`[${kind}] families and variant mappings; route capture; render info`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    let t22 = await byId(app, '2:2');
    assert.notEqual(t22.familyKey, (await byId(app, '2:3')).familyKey, 'unmapped differences make separate families');
    assert.equal(t22.theme, null);

    const file = await patchSettings(app, {
      variantMappings: { 'Color Mode': { as: 'theme', values: { Light: 'light', Dark: 'dark' } }, View: { as: 'query', key: 'view' } },
      themeMode: 'query', themeKey: 't', gallery: { urlTemplate: '/gallery?figma={set}&variant={variant}', storybookUrl: null },
    });
    assert.equal(file.settings.themeMode, 'query');
    assert.equal(file.settings.checkRetention, 5);
    assertProblem(await call(app, 'PATCH', '', { payload: { settings: { themeMode: 'cookie' } } }), 400, 'invalid_parameter');
    assertProblem(await call(app, 'PATCH', '', { payload: { settings: { variantMappings: { Mode: { as: 'class' } } } } }), 400, 'invalid_parameter');

    t22 = await byId(app, '2:2');
    const t23 = await byId(app, '2:3');
    const t24 = await byId(app, '2:4');
    assert.equal(t22.familyKey, t23.familyKey, 'variants that differ only in a mapped property share a family');
    assert.equal(t22.familyKey, t24.familyKey, 'View is mapped too');
    assert.deepEqual([t22.theme, t23.theme, t22.query, t24.query], ['light', 'dark', 'view=Files', 'view=Nodes']);
    assert.equal(t22.route, null);

    assertProblem(await call(app, 'PATCH', '/targets/2:2', { headers: viewer, payload: { route: '/files' } }), 403, 'wrong_token_class');
    assertProblem(await call(app, 'PATCH', '/targets/2:2', { payload: { route: 'files' } }), 400, 'invalid_parameter');
    const captured = ok(await call(app, 'PATCH', '/targets/2:2', { payload: { route: '/files' } })).target;
    assert.equal(captured.route, '/files');
    assert.deepEqual(captured.render, {
      gallery: { urlTemplate: '/gallery?figma={set}&variant={variant}', storybookUrl: null }, key: null, nodeId: '2:2', set: 'Portal',
      variant: 'View=Files, Color Mode=Light', props: { View: 'Files', 'Color Mode': 'Light' }, cache: null,
      route: '/files', theme: 'light', query: 'view=Files', themeMode: 'query', themeKey: 't', viewport: { width: W, height: H },
    }, 'every target: gallery info first, then the route');
    assert.equal((await byId(app, '2:3')).route, '/files', 'the family shares the route');
    const checkReq = ok(await call(app, 'POST', '/screens/2:3/checks')).check;
    assert.equal(checkReq.route, '/files', 'requested checks carry the family route');

    const sm = await byId(app, '6:2');
    assert.deepEqual(sm.render, {
      gallery: { urlTemplate: '/gallery?figma={set}&variant={variant}', storybookUrl: null }, key: 'k-sm', nodeId: '6:2', set: 'Button',
      variant: 'Size=sm', props: { Size: 'sm' }, route: null, theme: null, query: null, themeMode: 'query', themeKey: 't', viewport: { width: 80, height: 40 }, cache: null,
    });
    const lg = ok(await call(app, 'PATCH', '/targets/6:3', { payload: { route: '/gallery/button-lg' } })).target;
    assert.equal(lg.render.route, '/gallery/button-lg', 'components take a route too (used when the gallery has no entry)');
    const icon = await byId(app, '6:4');
    assert.deepEqual([icon.render.key, icon.render.set, icon.render.variant], ['k-icon', 'Icon', '']);
    const cached = ok(await call(app, 'PATCH', '/targets/6:4', { payload: { gallery: { mapped: true, storyId: 'icon--default' } } })).target;
    assert.deepEqual(cached.gallery, { mapped: true, storyId: 'icon--default' });
    assert.deepEqual(cached.render.cache, { mapped: true, storyId: 'icon--default' });
    assert.equal((await byId(app, '2:5')).familyKey, '2:5', 'a lone frame is its own family');
  });

  test(`[${kind}] references-needed covers auto targets; node map upload and caps`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const want = await needed(app);
    assert.deepEqual(want.map(s => s.nodeId).sort(), ['2:2', '2:3', '2:4', '2:5', '6:2', '6:3', '6:4']);
    assert.equal(want.find(s => s.nodeId === '6:4').level, 'screen', 'deprecated level: a top-level component');

    const v = want.find(s => s.nodeId === '2:2').designVersion;
    const tooMany = Array.from({ length: NODE_MAP_MAX_ENTRIES + 1 }, (_, i) => ({ nodeId: `9:${i}`, x: 0, y: 0, width: 1, height: 1, depth: 1 }));
    assertProblem(await call(app, 'PUT', '/screens/2:2/reference', { headers: plugin, payload: { designVersion: v, image: await png(), nodeMap: tooMany } }), 400, 'invalid_parameter');
    assertProblem(await call(app, 'PUT', '/screens/2:2/reference', { headers: plugin, payload: { designVersion: v, image: await png(), nodeMap: [{ nodeId: '2:2', x: 0 }] } }), 400, 'invalid_parameter');
    const huge = Array.from({ length: NODE_MAP_MAX_ENTRIES }, (_, i) => ({ nodeId: `I${'9'.repeat(100)}:${i}`, mainNodeId: `${'8'.repeat(100)}:${i}`, x: 0, y: 0, width: 1, height: 1, depth: 1 }));
    assertProblem(await call(app, 'PUT', '/screens/2:2/reference', { headers: plugin, payload: { designVersion: v, image: await png(), nodeMap: huge } }), 400, 'invalid_parameter');

    await reference(app, '2:2', { nodeMap: MAP_22 });
    const t22 = await byId(app, '2:2');
    assert.ok(t22.reference && t22.nodeMap, 'reference and node map stored');
    assert.equal(t22.nodeMap.contentType, 'application/json');
    const raw = await app.inject({ method: 'GET', url: t22.nodeMap.url, headers: agent });
    assert.equal(raw.statusCode, 200);
    assert.deepEqual(JSON.parse(raw.body), MAP_22);
    assert.ok(!(await needed(app)).some(s => s.nodeId === '2:2'));
    await reference(app, '6:4', { width: 40, height: 40 });
    assert.equal((await byId(app, '6:4')).nodeMap, null, 'the node map is optional');
  });

  test(`[${kind}] ready list: containment order, waiting on a failing target, not mapped never blocks`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const ready = await list(app, '?status=ready');
    const ids = ready.map(x => x.nodeId);
    assert.equal(ready.length, 7);
    assert.ok(ids.indexOf('6:4') < ids.indexOf('6:2'), 'a target placing instances of another comes after it');
    assert.ok(ids.indexOf('6:2') < ids.indexOf('2:2'));
    assert.deepEqual((await byId(app, '6:2')).contains, ['6:4']);
    assert.deepEqual((await byId(app, '2:2')).contains, ['6:2']);

    await reference(app, '6:4', { width: 40, height: 40 });
    const bad = await check(app, '6:4', await png({ width: 40, height: 40, boxes: [{ x: 0, y: 0, width: 20, height: 20 }] }));
    assert.equal(bad.status, 'mismatch');
    const sm = await byId(app, '6:2');
    assert.equal(sm.status, 'waiting');
    assert.deepEqual(sm.waitingOn, { nodeId: '6:4', name: 'Icon' });
    assert.equal((await byId(app, '2:2')).status, 'waiting', 'screens wait through nested components');
    assert.deepEqual((await byId(app, '2:2')).waitingOn, { nodeId: '6:4', name: 'Icon' });
    assert.ok(!(await list(app, '?status=ready')).some(x => ['6:2', '2:2'].includes(x.nodeId)));
    assert.deepEqual((await list(app, '?status=waiting&under=5:1')).map(x => x.nodeId), ['6:2']);

    ok(await call(app, 'PATCH', '/targets/6:4', { payload: { gallery: { mapped: false } } }));
    const icon = await byId(app, '6:4');
    assert.equal(icon.notMapped, true);
    assert.equal((await byId(app, '6:2')).status, 'ready', 'not-mapped targets never block');
    ok(await call(app, 'PATCH', '/targets/6:4', { payload: { route: '/icons' } }));
    assert.equal((await byId(app, '6:4')).notMapped, false, 'a route maps it');
    assert.equal((await byId(app, '6:2')).status, 'waiting');
    assert.deepEqual((await list(app, '?under=5:1')).map(x => x.nodeId).sort(), ['6:2', '6:3', '6:4']);

    // Building: a dirty node under a target.
    await sync(app, { rootNodeId: '5:1', upserts: [up('6:3', 'COMPONENT', 'Size=lg', { width: 130, height: 48, variantProperties: { Size: 'lg' } }, [...C, '6:1'])] });
    assert.equal((await byId(app, '6:3')).status, 'building');
    assert.deepEqual((await byId(app, '6:3')).viewport, { width: 130, height: 48 }, 'auto targets follow the Figma size');
  });

  test(`[${kind}] exclude: skipped by the ready list, never blocks, keeps history, survives re-detection`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await reference(app, '6:4', { width: 40, height: 40 });
    const bad = await check(app, '6:4', await png({ width: 40, height: 40, boxes: [{ x: 0, y: 0, width: 20, height: 20 }] }));
    assert.equal((await byId(app, '6:2')).status, 'waiting');

    assertProblem(await call(app, 'PATCH', '/targets/6:4', { headers: viewer, payload: { excluded: true } }), 403, 'wrong_token_class');
    const ex = ok(await call(app, 'PATCH', '/targets/6:4', { payload: { excluded: true } })).target;
    assert.equal(ex.excluded, true);
    assert.equal((await byId(app, '6:2')).status, 'ready', 'an excluded target never blocks');
    assert.ok(!(await list(app, '?status=ready')).some(x => x.nodeId === '6:4'));
    assert.ok(!(await list(app, '?status=mismatch')).some(x => x.nodeId === '6:4'), 'excluded targets match no status filter');
    assert.ok((await list(app)).some(x => x.nodeId === '6:4' && x.excluded), 'still listed');
    assert.deepEqual(ok(await call(app, 'GET', '/targets/6:4/checks')).checks.map(c => c.checkId), [bad.checkId], 'history kept');
    assert.equal(ok(await call(app, 'GET', '/nodes/6:4')).screen.excluded, true, 'on the node summary');

    await sync(app, { rootNodeId: '5:1', upserts: [up('6:4', 'COMPONENT', 'Icon', { width: 44, height: 40, componentReference: { id: '6:4', key: 'k-icon', name: 'Icon' } }, C)] });
    const redetected = await byId(app, '6:4');
    assert.deepEqual([redetected.viewport.width, redetected.excluded], [44, true], 're-detection keeps the flag');

    ok(await call(app, 'PATCH', '/targets/6:4', { payload: { excluded: false } }));
    assert.equal((await byId(app, '6:4')).excluded, false);
  });

  test(`[${kind}] containing=: the targets containing a node, with their open render notes`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const holders = async nodeId => (await list(app, `?containing=${nodeId}`)).map(x => x.nodeId);
    assert.deepEqual(await holders('6:5'), ['6:2', '2:2'], 'its component, and the screen placing an instance of it');
    assert.deepEqual(await holders('4:1'), ['2:2']);
    assert.deepEqual(await holders('6:4'), ['6:4', '6:2', '2:2'], 'itself, then through instances (transitively)');
    assert.deepEqual(await holders('2:6'), []);
    assertProblem(await call(app, 'GET', '/targets?containing=99:99'), 404, 'node_not_found');

    await reference(app, '6:4', { width: 40, height: 40 });
    await check(app, '6:4', await png({ width: 40, height: 40, boxes: [{ x: 0, y: 0, width: 20, height: 20 }] }));
    const [icon, sm] = await list(app, '?containing=6:4');
    assert.equal(icon.renderNotes.open, 1);
    assert.equal(icon.renderNotes.latest.nodeId, '6:4');
    assert.match(icon.renderNotes.latest.body, /Render check/);
    assert.deepEqual(sm.renderNotes, { open: 0, latest: null });
    assert.equal(icon.lastCheck.status, 'mismatch');
    assert.equal((await byId(app, '6:4')).renderNotes, undefined, 'only with containing');
  });

  test(`[${kind}] attribution: deepest node, instance → main node, > 2 nodes → common parent, summary; pass resolves; node masks`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await reference(app, '2:2', { nodeMap: MAP_22 });
    ok(await call(app, 'PATCH', '/targets/2:2', { payload: { threshold: 0 } }));

    const title = await check(app, '2:2', await png({ boxes: [{ x: 20, y: 12, width: 10, height: 10 }] }));
    assert.equal(title.status, 'mismatch');
    assert.deepEqual(title.attribution.map(a => [a.nodeId, a.name, a.regions]), [['4:1', 'Title', [0]]]);
    const [titleNote] = await openNotes(app, '4:1');
    assert.equal(titleNote.source, 'render_check');
    assert.equal(titleNote.noteId, title.attribution[0].noteId);
    assert.match(titleNote.body, /10×10 px at 20,12/);
    const [summary] = await openNotes(app, '2:2');
    assert.match(summary.body, /Traced to: "Title" \(4:1\)/);
    assert.deepEqual(summary.attachments.map(a => a.kind).sort(), ['built', 'heatmap', 'reference']);
    const titleNode = ok(await call(app, 'GET', '/nodes/4:1'));
    assert.equal(titleNode.state, 'dirty');
    assert.deepEqual(ok(await call(app, 'GET', '/nodes?state=dirty&category=render')).nodes.map(n => n.nodeId).sort(), ['2:2', '4:1']);

    const label = await check(app, '2:2', await png({ boxes: [{ x: 25, y: 112, width: 10, height: 10 }] }));
    assert.deepEqual(label.attribution.map(a => a.nodeId), ['6:5'], 'an instance sublayer goes to the main component\'s node');
    assert.equal((await openNotes(app, '4:1')).length, 0, 'a new mismatch replaces the target\'s earlier render notes');
    assert.equal((await openNotes(app, '6:5')).length, 1);
    assert.equal((await openNotes(app, '2:2')).length, 1);

    const row = await check(app, '2:2', await png({ boxes: [{ x: 5, y: 155, width: 220, height: 40 }] }));
    assert.deepEqual(row.attribution.map(a => a.nodeId), ['3:3'], 'a region over > 2 nodes goes to their nearest common parent');
    assert.equal((await openNotes(app, '6:5')).length, 0);

    const pass = await check(app, '2:2', await png());
    assert.equal(pass.status, 'passed');
    for (const id of ['2:2', '3:3', '4:1', '6:5']) assert.equal((await openNotes(app, id)).length, 0, `${id}: a pass resolves the render notes`);
    assert.equal(ok(await call(app, 'GET', '/nodes/3:3')).state, 'clean');

    // Masks by node: the Title's rectangle from the node map is skipped.
    const again = await check(app, '2:2', await png({ boxes: [{ x: 20, y: 12, width: 10, height: 10 }] }));
    assert.equal(again.status, 'mismatch');
    ok(await call(app, 'PATCH', '/targets/2:2', { payload: { maskNodeIds: ['4:1'] } }));
    assert.deepEqual((await byId(app, '2:2')).maskNodeIds, ['4:1']);
    const masked = await check(app, '2:2', await png({ boxes: [{ x: 20, y: 12, width: 10, height: 10 }] }));
    assert.equal(masked.status, 'passed');

    // Without a node map the note stays on the target only (rev9).
    await reference(app, '2:4');
    ok(await call(app, 'PATCH', '/targets/2:4', { payload: { threshold: 0 } }));
    const plain = await check(app, '2:4', await png({ boxes: [{ x: 20, y: 12, width: 10, height: 10 }] }));
    assert.equal(plain.status, 'mismatch');
    assert.deepEqual(plain.attribution, []);
    assert.equal((await openNotes(app, '2:4')).length, 1);
  });

  test(`[${kind}] history: latest first with image urls; retention keeps the last pass`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await reference(app, '6:4', { width: 40, height: 40 });
    await patchSettings(app, { checkRetention: 2 });
    const passed = await check(app, '6:4', await png({ width: 40, height: 40 }));
    const fails = [];
    for (let i = 0; i < 3; i++) fails.push(await check(app, '6:4', await png({ width: 40, height: 40, boxes: [{ x: 0, y: 0, width: 5 + i, height: 5 }] })));
    const history = ok(await call(app, 'GET', '/targets/6:4/checks')).checks;
    assert.deepEqual(history.map(c => c.checkId), [fails[2].checkId, fails[1].checkId, passed.checkId], 'the 2 newest and the last pass');
    for (const c of history) for (const k of ['reference', 'built', 'heatmap']) assert.ok(c[k] && c[k].url, k);
    const img = await app.inject({ method: 'GET', url: history[2].built.url, headers: viewer });
    assert.equal(img.statusCode, 200, 'kept results keep their images');
    assertProblem(await call(app, 'GET', `/checks/${fails[0].checkId}`), 404, 'check_not_found');
    assertProblem(await call(app, 'GET', '/targets/2:6/checks'), 404, 'screen_not_found');
    assert.equal((await byId(app, '6:4')).lastCheck.checkId, fails[2].checkId);
  });
}

test('attribute: leaves, main nodes, common parent, target fallback', () => {
  const nodes = [['2:2', '2_3a2'], ['3:1', '2_3a2.3_3a1'], ['4:1', '2_3a2.3_3a1.4_3a1'], ['3:3', '2_3a2.3_3a3'], ['4:2', '2_3a2.3_3a3.4_3a2'],
    ['4:3', '2_3a2.3_3a3.4_3a3'], ['4:4', '2_3a2.3_3a3.4_3a4'], ['6:5', '5_3a1.6_3a2.6_3a5']];
  const records = new Map(nodes.map(([nodeId, p]) => [nodeId, { nodeId, path: p }]));
  const target = { nodeId: '2:2', subtree: new Set(['2:2', '3:1', '4:1', '3:3', '4:2', '4:3', '4:4']) };
  const at = (x, y, width, height) => attribute([{ x, y, width, height }], MAP_22, records, target).map(a => a.nodeId);
  assert.deepEqual(at(20, 12, 5, 5), ['4:1']);
  assert.deepEqual(at(5, 5, 20, 10), ['3:1', '4:1'], 'two nodes: both');
  assert.deepEqual(at(25, 112, 5, 5), ['6:5']);
  assert.deepEqual(at(5, 155, 220, 40), ['3:3']);
  assert.deepEqual(at(0, 0, W, H), ['2:2'], 'a common parent outside the target falls back to it');
  assert.equal(commonParent([records.get('4:2'), records.get('4:3')]), '3:3');
});

/** `store` with every method call counted in `calls.n` (store-internal calls not included). */
function counting(store) {
  const calls = { n: 0 };
  const proxy = new Proxy(store, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      return (...args) => { calls.n++; return v.apply(target, args); };
    },
  });
  return { proxy, calls };
}

/** 8:1 SECTION Many → `n` top-level FRAME targets 9:i, each with a TEXT 10:i and an INSTANCE 11:i of Icon (6:4). */
function manyFrames(n) {
  const M = ['8:1'];
  const out = [up('8:1', 'SECTION', 'Many', { width: 4000 })];
  for (let i = 1; i <= n; i++) {
    out.push(up(`9:${i}`, 'FRAME', `Frame ${i}`, { width: 320, height: 200 + i }, M));
    out.push(up(`10:${i}`, 'TEXT', `Text ${i}`, { characters: `t${i}` }, [...M, `9:${i}`]));
    out.push(inst(`11:${i}`, 'Icon', '6:4', { width: 16 }, [...M, `9:${i}`]));
  }
  return out;
}

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] targets: store calls do not grow with the number of targets`, async t => {
    const { store, cleanup } = await STORES[kind]();
    const { proxy, calls } = counting(store);
    const app = buildApp({
      store: proxy, blobs: new MemoryBlobs(),
      config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN }),
    });
    t.after(async () => { await app.close(); await cleanup(); });
    await sync(app, { fileName: 'Design File', rootNodeId: '1:1', upserts: SCREENS, markImplemented: true });
    await sync(app, { rootNodeId: '5:1', upserts: COMPONENTS, markImplemented: true });
    const cost = async url => {
      const before = calls.n;
      const res = ok(await call(app, 'GET', url));
      return { calls: calls.n - before, size: (res.targets || res.nodes).length };
    };
    const measure = async () => ({
      all: await cost('/targets'), containing: await cost('/targets?containing=6:4'), nodes: await cost('/nodes?state=all&limit=500'),
    });

    await sync(app, { rootNodeId: '8:1', upserts: manyFrames(3) });
    const few = await measure();
    await sync(app, { rootNodeId: '8:1', upserts: manyFrames(40) });
    const many = await measure();
    assert.equal(many.all.size - few.all.size, 37, 'the larger file has more targets');
    assert.equal(many.containing.size - few.containing.size, 37, 'each new frame places an instance of 6:4');
    assert.ok(many.nodes.size > few.nodes.size);
    assert.deepEqual([many.all.calls, many.containing.calls, many.nodes.calls], [few.all.calls, few.containing.calls, few.nodes.calls], 'constant store calls');
    assert.ok(many.containing.calls <= many.all.calls + 2, `containing= costs about a full listing (${many.containing.calls} vs ${many.all.calls})`);
  });

  test(`[${kind}] targets: containing= and design versions match per-target subtree evaluation`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await sync(app, { rootNodeId: '8:1', upserts: manyFrames(4) });
    // A dirty edit and a deletion, so versions, states and live subtrees differ from the clean fixture.
    await sync(app, { rootNodeId: '8:1', upserts: [up('10:2', 'TEXT', 'Text 2', { characters: 'edited' }, ['8:1', '9:2'])], deletedNodeIds: ['11:3'] });
    const targets = await list(app);
    const ids = targets.map(x => x.nodeId);

    // Reference: one listNodeSubtree per target, as the endpoint used to do.
    const source = /** @type {any} */ (app).store;
    const subtrees = new Map();
    for (const id of ids) subtrees.set(id, await source.listNodeSubtree(FK, id, { includeDeleted: false }));
    const version = nodes => {
      const hash = require('node:crypto').createHash('sha256');
      for (const n of [...nodes].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))) hash.update(`${n.nodeId}\u0000${n.contentHash || ''}\n`);
      return hash.digest('hex').slice(0, 32);
    };
    for (const x of targets) assert.equal(x.designVersion, version(subtrees.get(x.nodeId)), `${x.nodeId} design version`);

    const contains = new Map();
    const mains = new Map();
    for (const id of ids) {
      const sub = subtrees.get(id);
      const has = new Set(sub.map(n => n.nodeId));
      mains.set(id, new Set(sub.filter(n => n.isInstance && n.mainComponentId).map(n => n.mainComponentId)));
      contains.set(id, { has, inner: ids.filter(c => c !== id && (has.has(c) || mains.get(id).has(c))) });
    }
    const expected = node => {
      const above = new Set([...pathNodeIds(node.path), node.nodeId]);
      const out = new Set(ids.filter(id => contains.get(id).has.has(node.nodeId) || [...mains.get(id)].some(m => above.has(m))));
      for (let grew = true; grew;) {
        grew = false;
        for (const id of ids) if (!out.has(id) && contains.get(id).inner.some(k => out.has(k))) { out.add(id); grew = true; }
      }
      return [...out].sort();
    };
    for (const x of targets) assert.deepEqual(x.contains, contains.get(x.nodeId).inner, `${x.nodeId} contains`);
    const nodes = [...SCREENS, ...COMPONENTS, ...manyFrames(4)].filter(n => n.nodeId !== '11:3');
    for (const n of nodes) {
      const [row] = await source.getNodes(FK, [n.nodeId]);
      const got = (await list(app, `?containing=${n.nodeId}`)).map(x => x.nodeId).sort();
      assert.deepEqual(got, expected(row), `containing=${n.nodeId}`);
    }
  });
}
