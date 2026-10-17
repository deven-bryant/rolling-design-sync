'use strict';

/*
 * v3 screens, render checks, attachments and note screenshots — against the
 * memory store and PGlite (same SQL as Postgres).
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

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';
const W = 240;
const H = 200;

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}
const TREE = (pad = 16) => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Settings', { width: W, height: H, paddingLeft: pad }, ['1:1']),
  up('3:1', 'TEXT', 'Title', { characters: 'Hi' }, ['1:1', '2:1']),
  up('2:2', 'FRAME', 'Tiny', { width: 50, height: 50 }, ['1:1']),
];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-screens-'));
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
  await sync(app, { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE(), markImplemented: true });
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

/** A solid PNG (base64), optionally with a black box. */
async function png({ width = W, height = H, box = null, format = 'png' } = {}) {
  const raw = Buffer.alloc(width * height * 4, 255);
  if (box) {
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) raw.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  const img = sharp(raw, { raw: { width, height, channels: 4 } });
  const out = format === 'jpeg' ? img.jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }) : img.png();
  return (await out.toBuffer()).toString('base64');
}

const setScreen = (app, payload, headers = agent, nodeId = '2:1') => call(app, 'PUT', `/screens/${nodeId}`, { payload, headers });
const needed = async app => ok(await call(app, 'GET', '/screens/references-needed', { headers: plugin })).screens;
async function uploadReference(app, image) {
  const [want] = await needed(app);
  return ok(await call(app, 'PUT', `/screens/${want.nodeId}/reference`, { headers: plugin, payload: { designVersion: want.designVersion, image } }));
}
const request = async (app, headers = agent) => ok(await call(app, 'POST', '/screens/2:1/checks', { headers }));
const submit = (app, checkId, payload, headers = agent) => call(app, 'POST', `/checks/${checkId}/result`, { headers, payload });
const screens = async app => ok(await call(app, 'GET', '/screens')).screens;
const events = async app => ok(await call(app, 'GET', '/events?limit=1000')).events;

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] screens: configure, reference, check, mismatch note, pass resolves`, async t => {
    const { app, blobs, close } = await openApp(kind);
    t.after(close);

    assertProblem(await setScreen(app, { route: '/settings' }, viewer), 403, 'wrong_token_class');
    assertProblem(await setScreen(app, { route: '/settings' }, agent, '1:1'), 400, 'invalid_parameter');
    assertProblem(await setScreen(app, { route: 'settings' }), 400, 'invalid_parameter');
    assertProblem(await setScreen(app, { route: '/tiny' }, agent, '2:2'), 400, 'invalid_parameter');
    assertProblem(await setScreen(app, { route: '/s', masks: [{ x: 230, y: 0, width: 20, height: 10 }] }), 400, 'invalid_parameter');
    const created = ok(await setScreen(app, { route: '/settings', masks: [{ x: 0, y: 0, width: 10, height: 10 }] })).screen;
    assert.deepEqual(created.viewport, { width: W, height: H }, 'defaults to the frame size');
    assert.equal(created.threshold, 1);
    assert.equal(created.status, 'ready');
    assert.equal(created.reference, null);

    assertProblem(await call(app, 'GET', '/screens/references-needed'), 403, 'wrong_token_class');
    const want = await needed(app);
    assert.deepEqual(want.map(s => s.nodeId), ['2:1']);
    assert.equal(want[0].designVersion, created.designVersion);

    const check = await request(app, viewer);
    assert.equal(check.created, true);
    assert.equal(check.check.status, 'requested');
    assert.equal(check.check.route, '/settings');
    const again = await request(app);
    assert.equal(again.created, false, 'idempotent while requested');
    assert.equal(again.check.checkId, check.check.checkId);
    assert.equal((await screens(app))[0].status, 'requested');
    const pending = ok(await call(app, 'GET', '/checks?status=requested')).checks;
    assert.deepEqual(pending.map(c => c.checkId), [check.check.checkId]);

    assertProblem(await submit(app, check.check.checkId, { image: await png() }), 409, 'reference_missing');
    assertProblem(await submit(app, check.check.checkId, { image: await png() }, viewer), 403, 'wrong_token_class');
    await uploadReference(app, await png());
    assert.deepEqual(await needed(app), []);
    assertProblem(await submit(app, check.check.checkId, {}), 400, 'invalid_body');

    const bad = ok(await submit(app, check.check.checkId, { image: await png({ box: { x: 100, y: 100, width: 40, height: 40 } }), commitRef: 'abc' })).check;
    assert.equal(bad.status, 'mismatch');
    assert.ok(bad.score > 1, String(bad.score));
    assert.equal(bad.regions.length, 1);
    assert.deepEqual(bad.regions[0], { x: 100, y: 100, width: 40, height: 40, pixels: 1600 });
    for (const k of ['reference', 'built', 'heatmap']) assert.ok(bad[k] && bad[k].url, k);
    assertProblem(await submit(app, check.check.checkId, { image: await png() }), 409, 'check_not_requested');

    const node = ok(await call(app, 'GET', '/nodes/2:1'));
    assert.equal(node.state, 'dirty');
    assert.ok(node.changeCategories === undefined || true);
    assert.deepEqual(node.screen, { status: 'mismatch', stale: false, score: bad.score });
    const [note] = node.notes;
    assert.equal(note.source, 'render_check');
    assert.equal(note.author, 'render-check');
    assert.deepEqual(note.attachments.map(a => a.kind).sort(), ['built', 'heatmap', 'reference']);
    const listed = ok(await call(app, 'GET', '/nodes?state=dirty&category=render')).nodes.map(n => n.nodeId);
    assert.deepEqual(listed, ['2:1']);

    // Images are served only with credentials, inline and sandboxed.
    const heat = bad.heatmap;
    const unauth = await app.inject({ method: 'GET', url: heat.url });
    assert.equal(unauth.statusCode, 401);
    const img = await app.inject({ method: 'GET', url: heat.url, headers: viewer });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(img.headers['x-content-type-options'], 'nosniff');
    assert.match(img.headers['cache-control'], /private/);
    const meta = await sharp(img.rawPayload).metadata();
    assert.equal(meta.width, W);
    const thumb = await app.inject({ method: 'GET', url: heat.thumbUrl, headers: agent });
    assert.equal(thumb.statusCode, 200);
    assertProblem(await app.inject({ method: 'GET', url: `/v3/files/${FK}/attachments/00000000-0000-4000-8000-000000000000`, headers: agent }), 404, 'attachment_not_found');

    // A passing check resolves the render note.
    const second = await request(app);
    const good = ok(await submit(app, second.check.checkId, { image: await png() })).check;
    assert.equal(good.status, 'passed');
    assert.equal(good.score, 0);
    const after = ok(await call(app, 'GET', '/nodes/2:1'));
    assert.equal(after.state, 'clean');
    assert.ok(!after.notes || after.notes.length === 0);
    assert.deepEqual(after.screen, { status: 'passed', stale: false, score: 0 });

    // Design change: stale, needs a new reference.
    await sync(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(24) });
    const [stale] = await screens(app);
    assert.equal(stale.status, 'building');
    assert.equal(stale.stale, true);
    assert.equal((await needed(app)).length, 1);
    await call(app, 'POST', '/clear', { payload: { commitRef: 'c2', items: [{ nodeId: '2:1', contentHash: core.contentHash(TREE(24)[1].attrs) }] } });
    assert.equal((await screens(app))[0].status, 'ready');

    const types = (await events(app)).map(e => e.type).filter(x => x.startsWith('render_check.'));
    assert.deepEqual(types, ['render_check.requested', 'render_check.mismatch', 'render_check.requested', 'render_check.passed']);
    for (const e of (await events(app)).filter(x => x.type.startsWith('render_check.'))) {
      assert.ok(!JSON.stringify(e.data).includes('base64') && JSON.stringify(e.data).length < 400, 'ids only');
    }

    // Deleting the screen drops its checks and images.
    assert.ok(blobs.blobs.size > 0);
    ok(await call(app, 'DELETE', '/screens/2:1'));
    assertProblem(await call(app, 'GET', `/checks/${check.check.checkId}`), 404, 'check_not_found');
    assertProblem(await call(app, 'DELETE', '/screens/2:1'), 404, 'screen_not_found');
    assert.deepEqual(await screens(app), []);
  });

  test(`[${kind}] render checks: size mismatch, masks, error results, pruning`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    ok(await setScreen(app, { route: '/s', masks: [{ x: 100, y: 100, width: 40, height: 40 }], threshold: 0 }));
    await uploadReference(app, await png());

    const masked = ok(await submit(app, (await request(app)).check.checkId, { image: await png({ box: { x: 100, y: 100, width: 40, height: 40 } }) })).check;
    assert.equal(masked.status, 'passed', 'masked areas are ignored');
    const small = ok(await submit(app, (await request(app)).check.checkId, { image: await png({ width: W, height: H - 20 }) })).check;
    assert.equal(small.status, 'mismatch');
    assert.ok(small.score > 9 && small.score < 11, String(small.score));
    const failed = ok(await submit(app, (await request(app)).check.checkId, { error: 'route 404' })).check;
    assert.equal(failed.status, 'error');
    assert.equal(failed.error, 'route 404');
    assertProblem(await submit(app, (await request(app)).check.checkId, { image: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') }), 400, 'invalid_image');

    for (let i = 0; i < 10; i++) {
      const { check } = await request(app);
      ok(await submit(app, check.checkId, { image: await png() }));
    }
    const all = ok(await call(app, 'GET', '/checks?nodeId=2:1')).checks;
    assert.ok(all.length <= 11, String(all.length));
    assert.equal(all.filter(c => c.status !== 'requested').length, 10, 'keeps the 10 newest results');
    assertProblem(await call(app, 'GET', `/checks/${masked.checkId}`), 404, 'check_not_found');
  });

  test(`[${kind}] note screenshots: upload, re-encode, limits, delete, storeImages=false`, async t => {
    const { app, blobs, close } = await openApp(kind);
    t.after(close);
    const jpeg = await png({ format: 'jpeg', box: { x: 0, y: 0, width: 10, height: 10 } });
    const added = ok(await call(app, 'POST', '/nodes/2:1/notes', { headers: viewer, payload: { body: 'Button misaligned', images: [{ data: jpeg, name: 'a.jpg' }] } }));
    const [shot] = added.note.attachments;
    assert.equal(shot.kind, 'screenshot');
    assert.equal(shot.contentType, 'image/webp');
    assert.equal(shot.width, W);
    const full = await app.inject({ method: 'GET', url: shot.url, headers: agent });
    assert.equal(full.statusCode, 200);
    assert.ok(!full.rawPayload.includes(Buffer.from('secret-gps')), 'metadata stripped');
    assert.equal(ok(await call(app, 'GET', '/nodes/2:1/notes')).notes[0].attachments.length, 1);

    const four = Array.from({ length: 4 }, () => ({ data: jpeg }));
    assertProblem(await call(app, 'POST', '/nodes/2:1/notes', { payload: { body: 'x', images: four } }), 400, 'invalid_parameter');
    assertProblem(await call(app, 'POST', '/nodes/2:1/notes', { payload: { body: 'x', images: [{ data: Buffer.from('GIF89a-------').toString('base64') }] } }), 400, 'invalid_image');
    assertProblem(await call(app, 'POST', '/nodes/2:1/notes', { payload: { body: 'x', images: [{ data: '<html>' }] } }), 400, 'invalid_parameter');

    const before = blobs.blobs.size;
    ok(await call(app, 'DELETE', `/notes/${added.note.noteId}`, { headers: viewer }));
    assert.equal(blobs.blobs.size, before - 2, 'the image and its thumbnail are deleted');
    assertProblem(await app.inject({ method: 'GET', url: shot.url, headers: agent }), 404, 'attachment_not_found');

    ok(await app.inject({ method: 'PATCH', url: `/v3/files/${FK}`, headers: agent, payload: { settings: { storeImages: false } } }));
    assertProblem(await call(app, 'POST', '/nodes/2:1/notes', { payload: { body: 'x', images: [{ data: jpeg }] } }), 409, 'images_disabled');
    ok(await call(app, 'POST', '/nodes/2:1/notes', { payload: { body: 'text only is fine' } }));
    ok(await setScreen(app, { route: '/s' }));
    const [want] = await needed(app);
    assertProblem(await call(app, 'PUT', '/screens/2:1/reference', { headers: plugin, payload: { designVersion: want.designVersion, image: await png() } }), 409, 'images_disabled');
  });
}
