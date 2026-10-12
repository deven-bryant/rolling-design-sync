'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { tokenLabel } = require('../src/auth');
const { version } = require('../package.json');

const plugin = { authorization: 'Bearer portal-plugin-secret', 'x-rds-client': 'figma/1.2' };
const agent = { authorization: 'Bearer portal-agent-secret' };
const viewer = { authorization: 'Bearer portal-viewer-secret' };
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const get = (app, url, headers = viewer) => app.inject({ method: 'GET', url, headers });
const sync = (app, fileKey, upserts = []) => app.inject({ method: 'POST', url: `/v3/files/${fileKey}/sync`, headers: plugin, payload: { fileName: fileKey, upserts } });

async function openApp(kind) {
  const dir = kind === 'local' ? fs.mkdtempSync(path.join(os.tmpdir(), 'rds-portal-')) : null;
  const store = dir ? (await openLocalStore({ dataDir: dir })).store : new MemoryStore();
  const config = loadConfig({ RDS_STORE: kind, RDS_PLUGIN_TOKENS: 'figma:portal-plugin-secret', RDS_AGENT_TOKENS: 'bot:portal-agent-secret', RDS_VIEWER_TOKENS: 'portal-viewer-secret', RDS_SESSION_SECRET: 'portal-session-secret' });
  const app = buildApp({ store, config });
  return { app, store, config, close: async () => { await app.close(); if (dir) { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); } } };
}

for (const kind of ['memory', 'local']) {
  test(`[${kind}] status uses the newest sync and bus mode`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    assert.deepEqual(ok(await get(app, '/v3/status')), { version, store: kind, events: 'listening', replayHours: 24, libraryLinks: false, plugin: { lastSyncAt: null, client: null } });
    ok(await sync(app, 'PortalA'));
    ok(await sync(app, 'PortalB'));
    const events = await app.store.listEvents({ types: ['sync.completed'] });
    app.eventBus.mode = 'polling';
    const status = ok(await get(app, '/v3/status'));
    assert.equal(status.events, 'polling');
    assert.deepEqual(status.plugin, { lastSyncAt: events.at(-1).createdAt, client: 'figma/1.2' });
    assert.equal((await get(app, '/v3/status', plugin)).statusCode, 403);
    assert.equal((await get(app, '/v3/status', {})).statusCode, 401);
  });

  test(`[${kind}] tokens track bearer and session use without exposing values`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    let at = new Date('2026-10-01T12:00:00Z');
    app.nodeService.now = () => at;
    const first = ok(await get(app, '/v3/tokens'));
    assert.deepEqual(first, [
      { class: 'plugin', label: 'figma', lastUsedAt: null },
      { class: 'agent', label: 'bot', lastUsedAt: null },
      { class: 'viewer', label: tokenLabel('portal-viewer-secret'), lastUsedAt: at.toISOString() },
    ]);
    ok(await sync(app, 'PortalA'));
    ok(await get(app, '/v3/status', agent));
    const login = await app.inject({ method: 'POST', url: '/v3/session', payload: { token: 'portal-agent-secret' } });
    ok(login);
    const cookie = login.headers['set-cookie'].split(';')[0];
    at = new Date('2026-10-01T13:00:00Z');
    ok(await get(app, '/v3/status', { cookie }));
    const res = await get(app, '/v3/tokens');
    const tokens = ok(res);
    assert.equal(tokens[0].lastUsedAt, '2026-10-01T12:00:00.000Z');
    assert.equal(tokens[1].lastUsedAt, at.toISOString());
    for (const value of ['portal-plugin-secret', 'portal-agent-secret', 'portal-viewer-secret']) assert.ok(!res.body.includes(value));
    at = new Date('2026-10-01T14:00:00Z');
    assert.equal((await get(app, '/v3/status', { authorization: 'Bearer invalid', cookie })).statusCode, 401);
    assert.equal(ok(await get(app, '/v3/tokens'))[1].lastUsedAt, '2026-10-01T13:00:00.000Z');
    ok(await get(app, '/v3/session', { cookie }));
    assert.equal(ok(await get(app, '/v3/tokens'))[1].lastUsedAt, at.toISOString());
  });

  test(`[${kind}] claims exclude expired leases, order by expiry and cap IDs`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const at = '2026-10-01T12:00:00.000Z';
    app.nodeService.now = () => new Date(at);
    const nodes = Array.from({ length: 505 }, (_, i) => ({ nodeId: `2:${i}`, nodeType: 'TEXT', attrs: {}, contentHash: 'h' }));
    ok(await sync(app, 'PortalA', nodes));
    ok(await sync(app, 'PortalB', [{ nodeId: '1:1', attrs: {}, contentHash: 'h' }]));
    const late = await store.createClaim({ fileKey: 'PortalA', worker: 'late', label: 'Large', nodeIds: nodes.map(n => n.nodeId), nowIso: at, expiresAt: '2026-10-01T13:00:00.000Z' });
    const soon = await store.createClaim({ fileKey: 'PortalB', worker: 'soon', label: null, nodeIds: ['1:1'], nowIso: at, expiresAt: '2026-10-01T12:10:00.000Z' });
    await store.createClaim({ fileKey: 'PortalA', worker: 'expired', label: null, nodeIds: [], nowIso: at, expiresAt: at });
    const all = ok(await get(app, '/v3/claims')).claims;
    assert.deepEqual(all.map(c => [c.claimId, c.fileKey]), [[soon.claim.claimId, 'PortalB'], [late.claim.claimId, 'PortalA']]);
    assert.equal(all[1].nodeCount, 505);
    assert.equal(all[1].nodeIds.length, 500);
    assert.equal(all[1].createdAt, at);
    const perFile = ok(await get(app, '/v3/files/PortalA/claims'));
    assert.equal(perFile.fileKey, 'PortalA');
    assert.equal(perFile.claims[0].fileKey, undefined);
    assert.equal(perFile.claims[0].label, 'Large');
    ok(await app.inject({ method: 'POST', url: '/v3/files/PortalA/clear', headers: agent, payload: { commitRef: 'test', items: [{ nodeId: '2:0', contentHash: 'h' }] } }));
    assert.equal(ok(await get(app, '/v3/files/PortalA/claims')).claims[0].nodeCount, 504);
    await store.releaseClaim('PortalB', soon.claim.claimId, { nowIso: at });
    assert.equal(ok(await get(app, '/v3/claims')).claims.length, 1);
    assert.equal((await get(app, '/v3/files/Unknown/claims')).json().code, 'file_not_found');
    const linked = ok(await get(app, '/v3/files/-/claims?url=https://www.figma.com/design/PortalA/Design'));
    assert.deepEqual(linked, ok(await get(app, '/v3/files/PortalA/claims')));
  });

  test(`[${kind}] claims name their first 3 nodes in document order, and their file across files`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const at = '2026-10-01T12:00:00.000Z';
    app.nodeService.now = () => new Date(at);
    const node = (nodeId, nodeType, name, attrs, ancestors = []) => ({ nodeId, nodeType, name, parentId: ancestors.at(-1) ?? null, path: ancestors, attrs, contentHash: nodeId });
    const upserts = [
      node('1:1', 'FRAME', 'Page', { layoutMode: 'VERTICAL', childOrder: ['2:5', '2:1', '2:4', '2:3', '2:2'] }),
      node('2:1', 'FRAME', 'Table', {}, ['1:1']),
      node('2:2', 'TEXT', 'Footer', {}, ['1:1']),
      node('2:3', 'INSTANCE', 'Button', {}, ['1:1']),
      node('2:4', 'TEXT', 'Unclaimed', {}, ['1:1']),
      node('2:5', 'FRAME', 'Page header', {}, ['1:1']),
    ];
    ok(await app.inject({ method: 'POST', url: '/v3/files/Names/sync', headers: plugin, payload: { fileName: 'Checkout', rootNodeId: '1:1', upserts } }));
    await store.createClaim({ fileKey: 'Names', worker: 'devin', label: null, nodeIds: ['2:1', '2:2', '2:3', '2:5'], nowIso: at, expiresAt: '2026-10-01T13:00:00.000Z' });
    const expected = [{ nodeId: '2:5', name: 'Page header', type: 'FRAME' }, { nodeId: '2:1', name: 'Table', type: 'FRAME' }, { nodeId: '2:3', name: 'Button', type: 'INSTANCE' }];
    const [perFile] = ok(await get(app, '/v3/files/Names/claims')).claims;
    assert.deepEqual(perFile.nodes, expected);
    assert.deepEqual(perFile.nodeIds, ['2:1', '2:2', '2:3', '2:5']);
    assert.equal(perFile.nodeCount, 4);
    assert.ok(!('fileName' in perFile) && !('fileKey' in perFile));
    const [all] = ok(await get(app, '/v3/claims')).claims;
    assert.deepEqual(all.nodes, expected);
    assert.equal(all.fileKey, 'Names');
    assert.equal(all.fileName, 'Checkout');
    ok(await app.inject({ method: 'POST', url: '/v3/files/Names/clear', headers: agent, payload: { commitRef: 'test', items: [{ nodeId: '2:5', contentHash: '2:5' }] } }));
    assert.deepEqual(ok(await get(app, '/v3/claims')).claims[0].nodes.map(n => n.nodeId), ['2:1', '2:3', '2:2']);
    await store.createClaim({ fileKey: 'Names', worker: 'idle', label: null, nodeIds: [], nowIso: at, expiresAt: '2026-10-01T12:30:00.000Z' });
    const idle = ok(await get(app, '/v3/claims')).claims.find(c => c.worker === 'idle');
    assert.deepEqual([idle.nodeCount, idle.nodeIds, idle.nodes], [0, [], []]);
  });
}
