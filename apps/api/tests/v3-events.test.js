'use strict';

/*
 * v3 events (docs/api-v3-phase2.md, "1. Events"): the transactional outbox,
 * the JSON page and SSE stream of GET /v3/files/{fileKey}/events, retention,
 * and the buses — against the memory store and PGlite (same SQL as Postgres).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { MemoryBus, PostgresBus, withEvents, pruneEvents, startRetention, MAX_EVENT_NODE_IDS } = require('../src/events');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';
const OTHER = 'OtherFile0000000000000';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}
const R = ['1:1'];
const TREE = v => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: v ? 24 : 16 }, R),
  up('2:2', 'FRAME', 'Header', { itemSpacing: v ? 12 : 8 }, R),
  up('2:3', 'TEXT', 'Title', { characters: v ? 'Hello' : 'Hi' }, R),
];
const hashOf = nodeId => TREE(true).find(n => n.nodeId === nodeId).contentHash;

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-events-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

/** An app with the file synced once (baseline) — so the log starts with one sync.completed. */
async function openApp(kind, { env = {}, config = {}, seed = true } = {}) {
  const { store, cleanup } = await STORES[kind]();
  const bus = new MemoryBus();
  const app = buildApp({
    store, bus,
    config: { ...loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, ...env }), ...config },
  });
  if (seed) await batch(app, { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE(false), markImplemented: true });
  let base = null;
  const listen = async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${app.server.address().port}`;
    return base;
  };
  return { app, store, bus, listen, close: async () => { await app.close(); await bus.close(); await cleanup(); } };
}

async function batch(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${body.fileKey}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}
const call = (app, method, url, payload) => app.inject({ method, url, headers: agent, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const page = async (app, qs = '') => ok(await call(app, 'GET', `/v3/files/${FK}/events${qs ? `?${qs}` : ''}`));
const lastEvent = async app => (await page(app, 'limit=1000')).events.at(-1);

/** A minimal SSE client over node:http: parsed messages and comments, and `until(pred)`. */
function openStream(base, url, headers = {}) {
  const messages = [], comments = [];
  const waiters = [];
  let buffer = '';
  let response = null;
  const stream = {};
  const settle = () => {
    for (const w of [...waiters]) {
      const hit = w.pred();
      if (hit) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(hit); }
    }
  };
  const opened = new Promise((resolve, reject) => {
    const req = http.get(`${base}${url}`, { headers: { accept: 'text/event-stream', ...agent, ...headers } }, res => {
      response = res;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const msg = {};
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) { comments.push(line.slice(1).trim()); continue; }
            const [, field, value] = /^([a-z]+): ?(.*)$/i.exec(line) || [];
            if (field === 'id') msg.id = Number(value);
            else if (field === 'event') msg.event = value;
            else if (field === 'data') msg.data = JSON.parse(value);
          }
          if (msg.event) messages.push(msg);
        }
        settle();
      });
      resolve(res);
    });
    req.on('error', reject);
    stream.req = req;
  });
  return Object.assign(stream, {
    messages, comments, opened,
    response: () => response,
    until(pred, what = 'stream condition', ms = 5000) {
      return new Promise((resolve, reject) => {
        const w = { pred, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timed out waiting for ${what}: ${JSON.stringify({ messages, comments })}`)); }, ms) };
        waiters.push(w);
        settle();
      });
    },
    connected() { return this.until(() => comments.includes('connected'), 'connected'); },
    events(type) { return messages.filter(m => !type || m.event === type); },
    close() { stream.req.destroy(); },
  });
}

const waitFor = async (pred, what, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error(`timed out waiting for ${what}`);
};

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] cross-file event pages filter before paging by node and time`, async t => {
    const { app, store, close } = await openApp(kind, { seed: false });
    t.after(close);
    await batch(app, { fileKey: FK, upserts: [] });
    await batch(app, { fileKey: OTHER, upserts: [] });
    const after = await store.lastEventId(null);
    const rows = [
      { fileKey: FK, type: 'node.blocked', data: { nodeId: '2:1' }, createdAt: '2026-10-01T12:00:00Z' },
      { fileKey: OTHER, type: 'nodes.cleared', data: { nodeIds: ['2:1', '2:2'] }, createdAt: '2026-10-01T13:00:00Z' },
      { fileKey: FK, type: 'nodes.cleared', data: { nodeIds: ['2:2'] }, createdAt: '2026-10-01T14:00:00Z' },
      { fileKey: FK, type: 'node.unblocked', data: { nodeId: '2:1' }, createdAt: '2026-10-01T15:00:00Z' },
    ];
    const events = [];
    for (const row of rows) events.push(await store.insertEvent(row));
    const named = list => list.map(e => ({ ...e, fileName: null }));
    const first = ok(await call(app, 'GET', `/v3/events?after=${after}&nodeId=2-1&limit=1`));
    assert.deepEqual(first.events, named([events[0]]));
    const rest = ok(await call(app, 'GET', `/v3/events?after=${first.nextAfter}&nodeId=2:1`));
    assert.deepEqual(rest.events, named([events[1], events[3]]));
    const narrowed = ok(await call(app, 'GET', `/v3/events?after=${after}&fileKey=${OTHER}`));
    assert.deepEqual(narrowed.events, named([events[1]]));
    for (const route of ['/v3/events', `/v3/files/${FK}/events`]) {
      const result = ok(await call(app, 'GET', `${route}?after=${after}&nodeId=2:1&since=2026-10-01T15:00:00Z`));
      assert.deepEqual(result.events, route === '/v3/events' ? named([events[3]]) : [events[3]]);
      const empty = ok(await call(app, 'GET', `${route}?after=${after}&nodeId=99:99`));
      assert.equal(empty.nextAfter, after);
      assert.equal(empty.events.length, 0);
      assert.equal((await call(app, 'GET', `${route}?since=garbage`)).statusCode, 400);
    }
    const typed = ok(await call(app, 'GET', `/v3/events?after=${after}&types=nodes.cleared&nodeId=2:1`));
    assert.deepEqual(typed.events, named([events[1]]));
    const ndjson = await call(app, 'GET', `/v3/events?after=${after}&nodeId=2:1&format=ndjson`);
    assert.deepEqual(ndjson.body.trim().split('\n').map(JSON.parse), named([events[0], events[1], events[3]]));
    assert.equal((await call(app, 'GET', '/v3/events?fileKey=Unknown')).statusCode, 404);
  });

  test(`[${kind}] order=desc pages newest first with before: no gaps, no repeats, filters, fileName`, async t => {
    const { app, store, close } = await openApp(kind, { seed: false });
    t.after(close);
    await batch(app, { fileKey: FK, fileName: 'Design File', upserts: [] });
    await batch(app, { fileKey: OTHER, fileName: 'Other File', upserts: [] });
    for (let i = 0; i < 7; i++) {
      await store.insertEvent({
        fileKey: i % 3 ? FK : OTHER, type: i % 2 || i === 6 ? 'node.blocked' : 'nodes.cleared',
        data: i % 2 ? { nodeId: i < 6 ? '2:1' : '2:2' } : { nodeIds: ['2:1', '2:3'] },
        createdAt: new Date(Date.parse('2026-10-01T12:00:00Z') + i * HOUR).toISOString(),
      });
    }
    const names = { [FK]: 'Design File', [OTHER]: 'Other File' };
    const asc = ok(await call(app, 'GET', '/v3/events?limit=1000'));
    assert.equal(asc.nextBefore, undefined);
    assert.ok(asc.events.every(e => e.fileName === names[e.fileKey]));
    assert.deepEqual(ok(await call(app, 'GET', '/v3/events?limit=1000&order=asc')), asc);

    const readDesc = async (qs, limit) => {
      const seen = [];
      let before = null, pages = 0;
      for (;;) {
        const res = ok(await call(app, 'GET', `/v3/events?order=desc&limit=${limit}${before === null ? '' : `&before=${before}`}${qs}`));
        assert.equal(res.nextAfter, undefined);
        seen.push(...res.events);
        pages++;
        if (res.events.length) assert.equal(res.nextBefore, res.events.at(-1).id);
        if (res.events.length < limit) return { seen, pages, last: res };
        before = res.nextBefore;
      }
    };
    const all = await readDesc('', 2);
    assert.deepEqual(all.seen, [...asc.events].reverse());
    assert.equal(new Set(all.seen.map(e => e.id)).size, all.seen.length);
    assert.equal(all.pages, Math.floor(asc.events.length / 2) + 1);
    assert.deepEqual(all.last.events, [asc.events[0]]);

    const filters = `&fileKey=${FK}&types=node.blocked&nodeId=2:1&since=2026-10-01T12:30:00Z`;
    const filtered = asc.events.filter(e => e.fileKey === FK && e.type === 'node.blocked' && e.data.nodeId === '2:1' && e.createdAt >= '2026-10-01T12:30');
    assert.ok(filtered.length >= 2);
    assert.deepEqual((await readDesc(filters, 1)).seen, [...filtered].reverse());
    const byNode = asc.events.filter(e => e.data.nodeId === '2:1' || (e.data.nodeIds || []).includes('2:1'));
    assert.deepEqual((await readDesc('&nodeId=2-1', 3)).seen, [...byNode].reverse());

    const perFile = ok(await call(app, 'GET', `/v3/files/${FK}/events?order=desc&limit=2`));
    assert.equal(perFile.fileKey, FK);
    assert.deepEqual(perFile.events.map(e => e.id), asc.events.filter(e => e.fileKey === FK).reverse().slice(0, 2).map(e => e.id));
    assert.ok(perFile.events.every(e => !('fileName' in e)));
    assert.equal(perFile.nextBefore, perFile.events.at(-1).id);

    const oldest = asc.events[0].id;
    assert.deepEqual(ok(await call(app, 'GET', `/v3/events?order=desc&before=${oldest}`)), { events: [], nextBefore: oldest });
    assert.deepEqual(ok(await call(app, 'GET', '/v3/events?order=desc&nodeId=99:99')), { events: [], nextBefore: 0 });
    const ndjson = await call(app, 'GET', '/v3/events?order=desc&format=ndjson');
    assert.deepEqual(ndjson.body.trim().split('\n').map(JSON.parse), all.seen);
    assert.equal((await call(app, 'GET', '/v3/events?order=sideways')).statusCode, 400);
    assert.equal((await call(app, 'GET', '/v3/events?order=desc&before=-1')).statusCode, 400);
  });

  test(`[${kind}] all-file SSE interleaves files, narrows, filters and resumes`, async t => {
    const { app, store, bus, listen, close } = await openApp(kind, { seed: false });
    t.after(close);
    await batch(app, { fileKey: FK, upserts: [] });
    await batch(app, { fileKey: OTHER, upserts: [] });
    const after = await store.lastEventId(null);
    const base = await listen();
    const live = openStream(base, '/v3/events?nodeId=2:1');
    const narrow = openStream(base, `/v3/events?fileKey=${FK}&nodeId=2:1`);
    t.after(() => { live.close(); narrow.close(); });
    await Promise.all([live.connected(), narrow.connected()]);
    const events = [];
    for (const [fileKey, data] of [[FK, { nodeId: '9:9' }], [OTHER, { nodeIds: ['2:1'] }], [FK, { nodeId: '2:1' }]]) {
      const e = await store.insertEvent({ fileKey, type: 'node.blocked', data });
      bus.publish(fileKey, e.id);
      events.push(e);
    }
    await Promise.all([live.until(() => live.messages.length === 2), narrow.until(() => narrow.messages.length === 1)]);
    assert.deepEqual(live.messages.map(m => m.data), events.slice(1));
    assert.deepEqual(narrow.messages.map(m => m.data), [events[2]]);
    const replay = openStream(base, `/v3/events?after=${after}&nodeId=2:1`, { 'last-event-id': String(events[1].id) });
    t.after(() => replay.close());
    await replay.until(() => replay.messages.length === 1);
    assert.deepEqual(replay.messages.map(m => m.data), [events[2]]);
    const narrowedReplay = openStream(base, `/v3/events?fileKey=${FK}&nodeId=2:1`, { 'last-event-id': String(events[1].id) });
    t.after(() => narrowedReplay.close());
    await narrowedReplay.until(() => narrowedReplay.messages.length === 1);
    assert.deepEqual(narrowedReplay.messages.map(m => m.data), [events[2]]);
    narrowedReplay.close(); replay.close(); live.close(); narrow.close();
    await waitFor(() => bus.subscriberCount() === 0, 'all-file subscribers cleaned up');
    await store.insertEvent({ fileKey: FK, type: 'sync.completed', createdAt: new Date(Date.now() - 2 * DAY).toISOString() });
    const oldId = await store.lastEventId(null);
    const reset = openStream(base, '/v3/events', { 'last-event-id': String(oldId) });
    t.after(() => reset.close());
    await reset.until(() => reset.messages.length === 1);
    assert.equal(reset.messages[0].event, 'reset');
  });
}

test('Postgres bus polling wakes all-file subscribers for previously unseen files', async t => {
  const store = new MemoryStore();
  const bus = new PostgresBus({ store });
  t.after(() => bus.close());
  const all = [], one = [];
  const offAll = bus.subscribe(null, id => all.push(id));
  bus.subscribe(FK, id => one.push(id));
  const first = await store.insertEvent({ fileKey: OTHER, type: 'sync.completed' });
  await bus.poll();
  const second = await store.insertEvent({ fileKey: FK, type: 'sync.completed' });
  await bus.poll();
  await bus.poll();
  assert.deepEqual(all, [first.id, second.id]);
  assert.deepEqual(one, [second.id]);
  offAll();
  await store.insertEvent({ fileKey: OTHER, type: 'sync.completed' });
  await bus.poll();
  assert.deepEqual(all, [first.id, second.id]);
});

for (const kind of Object.keys(STORES)) {
  test(`events are written with their changes (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);

    await t.test('sync → sync.completed with rootNodeId and the sync_event counts', async () => {
      await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true) });
      const { events } = await page(app);
      assert.equal(events.length, 2);
      const [baseline, sync] = events;
      assert.equal(baseline.type, 'sync.completed');
      assert.deepEqual(baseline.data.counts, { uploaded: 4, changed: 0, added: 0, deleted: 0, baselined: 4 });
      assert.ok(sync.id > baseline.id);
      assert.equal(sync.fileKey, FK);
      assert.equal(sync.actor, 'plugin');
      assert.deepEqual(sync.data, { rootNodeId: '1:1', counts: { uploaded: 4, changed: 3, added: 0, deleted: 0, baselined: 0 } });
      assert.equal(typeof sync.createdAt, 'string');
    });

    await t.test('v3 claim create / renew / release → claim.* with claim metadata and node ids', async () => {
      const claim = ok(await call(app, 'POST', `/v3/files/${FK}/claims`, { worker: 'w-1', label: 'Cards', nodeIds: ['2:1', '2-2'] }));
      let e = await lastEvent(app);
      assert.equal(e.type, 'claim.created');
      assert.equal(e.actor, 'w-1');
      assert.deepEqual(e.data, { claimId: claim.claimId, worker: 'w-1', label: 'Cards', expiresAt: claim.expiresAt, nodeIds: ['2:1', '2:2'], nodeCount: 2 });

      const renewed = ok(await call(app, 'POST', `/v3/files/${FK}/claims/${claim.claimId}/renew`, { ttlSeconds: 60 }));
      e = await lastEvent(app);
      assert.equal(e.type, 'claim.renewed');
      assert.equal(e.data.expiresAt, renewed.expiresAt);
      assert.deepEqual([...e.data.nodeIds].sort(), ['2:1', '2:2']);

      ok(await call(app, 'DELETE', `/v3/files/${FK}/claims/${claim.claimId}`));
      e = await lastEvent(app);
      assert.equal(e.type, 'claim.released');
      assert.deepEqual(e.data, { claimId: claim.claimId, worker: 'w-1', label: 'Cards', expiresAt: e.data.expiresAt, nodeIds: ['2:1', '2:2'], nodeCount: 2 });
    });

    await t.test('an unknown claim writes no event', async () => {
      const before = (await lastEvent(app)).id;
      const res = await call(app, 'POST', `/v3/files/${FK}/claims/00000000-0000-4000-8000-000000000000/renew`, {});
      assert.equal(res.statusCode, 404);
      assert.equal((await lastEvent(app)).id, before);
    });

    await t.test('claim by filter → one claim.created for the nodes leased', async () => {
      const claim = ok(await call(app, 'POST', `/v3/files/${FK}/claims`, { worker: 'w-2', filter: { under: '1:1', type: 'FRAME' } }));
      const e = await lastEvent(app);
      assert.equal(e.type, 'claim.created');
      assert.equal(e.actor, 'w-2');
      assert.equal(e.data.claimId, claim.claimId);
      assert.equal(e.data.worker, 'w-2');
      assert.deepEqual([...e.data.nodeIds].sort(), claim.nodes.map(n => n.nodeId).sort());
      assert.equal(e.data.nodeCount, claim.nodes.length);
      assert.ok(claim.nodes.some(n => n.nodeId === '2:1') && claim.nodes.some(n => n.nodeId === '2:2'), JSON.stringify(claim.nodes));
    });

    await t.test('v3 bulk clear → one nodes.cleared per request; nothing when nothing cleared', async () => {
      const before = (await lastEvent(app)).id;
      ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { commitRef: 'c1', items: [{ nodeId: '2:3', contentHash: 'stale' }] }));
      assert.equal((await lastEvent(app)).id, before);
      ok(await call(app, 'POST', `/v3/files/${FK}/clear`, {
        commitRef: 'c1',
        items: [{ nodeId: '2:1', contentHash: hashOf('2:1') }, { nodeId: '2-2', contentHash: hashOf('2:2') }, { nodeId: '9:9', contentHash: 'x' }],
      }));
      const { events } = await page(app, `after=${before}`);
      assert.equal(events.length, 1);
      const [e] = events;
      assert.equal(e.type, 'nodes.cleared');
      assert.match(e.actor, /^token:[0-9a-f]{12}$/);
      assert.deepEqual(e.data, { nodeIds: ['2:1', '2:2'], commitRef: 'c1', worker: 'w-2' });
    });

    await t.test('clearing an unclaimed node → nodes.cleared with worker null', async () => {
      const before = (await lastEvent(app)).id;
      ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { items: [{ nodeId: '2:3', contentHash: 'old' }] }));
      assert.equal((await lastEvent(app)).id, before);
      ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { commitRef: 'c2', items: [{ nodeId: '2:3', contentHash: hashOf('2:3') }] }));
      const e = await lastEvent(app);
      assert.equal(e.type, 'nodes.cleared');
      assert.match(e.actor, /^token:/);
      assert.deepEqual(e.data, { nodeIds: ['2:3'], commitRef: 'c2', worker: null });
    });

    await t.test('a content change on a blocked node → node.unblocked with auto: true', async () => {
      await app.store.updateNode(FK, '2:2', { blockedAt: new Date().toISOString(), blockedBy: 'w-3', blockedReason: 'Ambiguous spacing' });
      const before = (await lastEvent(app)).id;
      await batch(app, { fileKey: FK, upserts: [up('2:2', 'FRAME', 'Header', { itemSpacing: 20 }, R), up('2:1', 'FRAME', 'Card', { paddingLeft: 99 }, R)] });
      const { events } = await page(app, `after=${before}`);
      assert.deepEqual(events.map(e => e.type), ['sync.completed', 'node.unblocked']);
      assert.deepEqual(events[1].data, { nodeId: '2:2', reason: 'Ambiguous spacing', by: null, auto: true });
      assert.equal(events[1].actor, 'plugin');
      // Same hash again: still unblocked, nothing to report.
      await batch(app, { fileKey: FK, upserts: [up('2:2', 'FRAME', 'Header', { itemSpacing: 20 }, R)] });
      assert.equal((await lastEvent(app)).type, 'sync.completed');
    });

    await t.test('event data never carries design content', async () => {
      const { events } = await page(app, 'limit=1000');
      for (const e of events) assert.doesNotMatch(JSON.stringify(e.data), /paddingLeft|itemSpacing|characters|attrs/);
    });
  });

  test(`a failing transaction writes and publishes no event (${kind} store)`, async t => {
    const { app, store, bus, close } = await openApp(kind);
    t.after(close);
    const heard = [];
    bus.subscribe(FK, id => heard.push(id));
    const before = await store.lastEventId(FK);
    await assert.rejects(withEvents(store, bus, async (tx, emit) => {
      await tx.updateNode(FK, '2:1', { name: 'Renamed' });
      await emit(FK, 'nodes.cleared', { data: { nodeIds: ['2:1'] } });
      throw new Error('boom');
    }), /boom/);
    assert.equal(await store.lastEventId(FK), before);
    assert.deepEqual(heard, []);
    assert.equal((await store.getNode(FK, '2:1')).name, 'Card');

    const id = await withEvents(store, bus, async (tx, emit) => (await emit(FK, 'nodes.cleared', { data: { nodeIds: ['2:1'] } })).id);
    assert.ok(id > before);
    assert.deepEqual(heard, [id]);
    assert.ok(app);
  });

  test(`JSON page: after, types, limit, nextAfter (${kind} store)`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    for (let i = 0; i < 4; i++) await store.insertEvent({ fileKey: FK, type: i % 2 ? 'claim.created' : 'nodes.cleared', data: { i } });
    await store.insertEvent({ fileKey: OTHER, type: 'nodes.cleared', data: {} });

    const all = await page(app);
    assert.equal(all.fileKey, FK);
    assert.deepEqual(all.events.map(e => e.type), ['sync.completed', 'nodes.cleared', 'claim.created', 'nodes.cleared', 'claim.created']);
    assert.equal(all.nextAfter, all.events.at(-1).id);
    assert.ok(all.events.every((e, i, a) => i === 0 || e.id > a[i - 1].id));

    const first = await page(app, 'limit=2');
    assert.equal(first.events.length, 2);
    const rest = await page(app, `after=${first.nextAfter}&limit=2`);
    assert.deepEqual(rest.events.map(e => e.id), all.events.slice(2, 4).map(e => e.id));
    const end = await page(app, `after=${all.nextAfter}`);
    assert.deepEqual(end, { fileKey: FK, events: [], nextAfter: all.nextAfter });

    const claims = await page(app, 'types=claim.created');
    assert.deepEqual(claims.events.map(e => e.data.i), [1, 3]);
    const two = await page(app, 'types=claim.created,sync.completed&limit=2');
    assert.deepEqual(two.events.map(e => e.type), ['sync.completed', 'claim.created']);

    const bad = await call(app, 'GET', `/v3/files/${FK}/events?types=claim.expired`);
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'invalid_parameter');
    assert.equal((await call(app, 'GET', `/v3/files/${FK}/events?limit=1001`)).statusCode, 400);
    assert.equal((await call(app, 'GET', `/v3/files/${FK}/events?after=-1`)).statusCode, 400);
    assert.equal((await call(app, 'GET', `/v3/files/${FK}/events?cursor=1`)).json().code, 'unknown_parameter');
    assert.equal((await call(app, 'GET', `/v3/files/${OTHER}/events`)).json().code, 'file_not_found');
    const noToken = await app.inject({ method: 'GET', url: `/v3/files/${FK}/events` });
    assert.equal(noToken.statusCode, 401);
    const pluginToken = await app.inject({ method: 'GET', url: `/v3/files/${FK}/events`, headers: plugin });
    assert.equal(pluginToken.json().code, 'wrong_token_class');
  });

  test(`SSE: replay, then live; Last-Event-ID; types (${kind} store)`, async t => {
    const { app, listen, close } = await openApp(kind);
    t.after(close);
    const base = await listen();
    const [seed] = (await page(app)).events;

    const live = openStream(base, `/v3/files/${FK}/events`);
    t.after(() => live.close());
    const res = await live.opened;
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /^text\/event-stream/);
    assert.equal(res.headers['cache-control'], 'no-cache, no-transform');
    await live.connected();
    assert.deepEqual(live.events(), [], 'no Last-Event-ID / after: live only');

    await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true) });
    ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { items: [{ nodeId: '2:1', contentHash: hashOf('2:1') }] }));
    await live.until(() => live.events().length === 2, 'two live events');
    const [sync, cleared] = live.events();
    assert.equal(sync.event, 'sync.completed');
    assert.equal(sync.data.id, sync.id);
    assert.equal(sync.data.fileKey, FK);
    assert.equal(cleared.event, 'nodes.cleared');
    assert.deepEqual(cleared.data.data.nodeIds, ['2:1']);

    const replay = openStream(base, `/v3/files/${FK}/events?after=${seed.id}`);
    t.after(() => replay.close());
    await replay.until(() => replay.events().length === 2, 'replay');
    assert.deepEqual(replay.events().map(m => m.id), [sync.id, cleared.id]);

    const resumed = openStream(base, `/v3/files/${FK}/events?after=0`, { 'last-event-id': String(sync.id) });
    t.after(() => resumed.close());
    await resumed.until(() => resumed.events().length === 1, 'resume after Last-Event-ID');
    assert.deepEqual(resumed.events().map(m => m.id), [cleared.id], 'Last-Event-ID wins over ?after=');

    const typed = openStream(base, `/v3/files/${FK}/events?after=0&types=nodes.cleared`);
    t.after(() => typed.close());
    await typed.until(() => typed.events().length === 1, 'typed replay');
    await batch(app, { fileKey: FK, upserts: TREE(false) });
    ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { items: [{ nodeId: '2:2', contentHash: TREE(false)[2].contentHash }] }));
    await typed.until(() => typed.events().length === 2, 'typed live');
    assert.deepEqual(typed.events().map(m => m.event), ['nodes.cleared', 'nodes.cleared']);
    await live.until(() => live.events().length === 4, 'all four live');
    assert.deepEqual(replay.events().length, 4);

    const bad = openStream(base, `/v3/files/${FK}/events`, { 'last-event-id': 'abc' });
    assert.equal((await bad.opened).statusCode, 400);
    bad.close();
  });

  test(`SSE: reset outside the replay window, heartbeat, disconnect cleanup (${kind} store)`, async t => {
    const { app, store, bus, listen, close } = await openApp(kind, { config: { eventHeartbeatMs: 50 } });
    t.after(close);
    const base = await listen();
    const old = await store.insertEvent({ fileKey: FK, type: 'nodes.cleared', data: { nodeIds: ['2:1'] }, createdAt: new Date(Date.now() - 25 * HOUR).toISOString() });
    const recent = await store.insertEvent({ fileKey: FK, type: 'nodes.cleared', data: { nodeIds: ['2:2'] } });

    const stale = openStream(base, `/v3/files/${FK}/events`, { 'last-event-id': String(old.id) });
    t.after(() => stale.close());
    await stale.until(() => stale.events('reset').length, 'reset');
    const [reset] = stale.events();
    assert.equal(stale.events().length, 1, 'reset replaces the replay');
    assert.equal(reset.id, recent.id);
    assert.equal(reset.data.lastEventId, recent.id);

    const fresh = openStream(base, `/v3/files/${FK}/events`, { 'last-event-id': String(recent.id) });
    t.after(() => fresh.close());
    await fresh.connected();

    await batch(app, { fileKey: FK, upserts: TREE(true) });
    await stale.until(() => stale.events('sync.completed').length === 1, 'live after reset');
    await fresh.until(() => fresh.events().length === 1, 'live');
    assert.deepEqual(fresh.events('reset'), []);

    await stale.until(() => stale.comments.filter(c => c === 'heartbeat').length >= 2, 'heartbeats');

    // An id that was pruned is outside the window too.
    const pruned = openStream(base, `/v3/files/${FK}/events`, { 'last-event-id': String(old.id - 1) });
    t.after(() => pruned.close());
    await pruned.until(() => pruned.events('reset').length, 'reset for a missing id');

    assert.equal(bus.subscriberCount(FK), 3);
    stale.close();
    fresh.close();
    await waitFor(() => bus.subscriberCount(FK) === 1, 'subscriptions released');
    pruned.close();
    await waitFor(() => bus.subscriberCount(FK) === 0, 'all subscriptions released');
  });

  test(`app.close() ends open streams (${kind} store)`, async () => {
    const { app, bus, listen, close } = await openApp(kind);
    const base = await listen();
    const s = openStream(base, `/v3/files/${FK}/events`);
    await s.connected();
    const ended = new Promise(resolve => s.response().on('end', resolve));
    await close();
    await ended;
    assert.equal(bus.subscriberCount(), 0);
  });

  test(`retention prunes events older than RDS_EVENT_RETENTION_DAYS (${kind} store)`, async t => {
    const { store, cleanup } = await STORES[kind]();
    t.after(cleanup);
    const at = ms => new Date(Date.now() - ms).toISOString();
    const gone = await store.insertEvent({ fileKey: FK, type: 'nodes.cleared', createdAt: at(31 * DAY) });
    const kept = await store.insertEvent({ fileKey: FK, type: 'nodes.cleared', createdAt: at(29 * DAY) });
    await store.insertEvent({ fileKey: OTHER, type: 'nodes.cleared', createdAt: at(40 * DAY) });
    assert.equal(await pruneEvents(store, { retentionDays: 30 }), 2);
    assert.deepEqual((await store.listEvents({ fileKey: null, after: 0 })).map(e => e.id), [kept.id]);
    assert.equal(await store.getEvent(FK, gone.id), null);

    const stop = startRetention(store, { retentionDays: 1, intervalMs: 20 });
    t.after(stop);
    await stop.ready;
    assert.deepEqual(await store.listEvents({ fileKey: null, after: 0 }), []);
    await store.insertEvent({ fileKey: FK, type: 'nodes.cleared', createdAt: at(2 * DAY) });
    await waitFor(async () => !(await store.listEvents({ fileKey: FK })).length, 'the interval prune');
  });
}

test('config: event settings and their defaults', () => {
  const d = loadConfig({ DATABASE_URL: 'postgres://db/x' });
  assert.equal(d.listenUrl, 'postgres://db/x');
  assert.equal(d.eventReplayHours, 24);
  assert.equal(d.eventRetentionDays, 30);
  const c = loadConfig({ DATABASE_URL: 'postgres://db/x', RDS_LISTEN_URL: 'postgres://direct/x', RDS_EVENT_REPLAY_HOURS: '6', RDS_EVENT_RETENTION_DAYS: '7' });
  assert.equal(c.listenUrl, 'postgres://direct/x');
  assert.equal(c.eventReplayHours, 6);
  assert.equal(c.eventRetentionDays, 7);
});

test('MemoryBus fans out per file and unsubscribes', async () => {
  const bus = new MemoryBus();
  const a = [], b = [], other = [];
  const offA = bus.subscribe(FK, id => a.push(id));
  bus.subscribe(FK, id => b.push(id));
  bus.subscribe(OTHER, id => other.push(id));
  bus.subscribe(FK, () => { throw new Error('a broken subscriber does not stop the others'); });
  bus.publish(FK, 1);
  offA();
  bus.publish(FK, 2);
  assert.deepEqual(a, [1]);
  assert.deepEqual(b, [1, 2]);
  assert.deepEqual(other, []);
  assert.equal(bus.subscriberCount(FK), 2);
  assert.equal(bus.subscriberCount(), 3);
  await bus.close();
  assert.equal(bus.subscriberCount(), 0);
});

/** A pg.Client stand-in: `LISTEN` fails while `fail.listen`; `drop()` simulates a lost connection. */
function fakeClients(fail) {
  const clients = [];
  const create = () => {
    const c = new EventEmitter();
    c.queries = [];
    c.connect = async () => { if (fail.connect) throw new Error('connect refused'); };
    c.query = async sql => {
      c.queries.push(sql);
      if (fail.listen && /^LISTEN/.test(sql)) throw new Error('LISTEN is not supported by this pooler');
      return { rows: [] };
    };
    c.end = async () => { c.ended = true; };
    c.notify = payload => c.emit('notification', { channel: 'rds_events', payload: JSON.stringify(payload) });
    c.drop = () => c.emit('error', new Error('connection terminated'));
    clients.push(c);
    return c;
  };
  return { clients, create };
}

/** A MemoryStore with the `query` PostgresBus sends NOTIFY through. */
function notifyStore() {
  const store = new MemoryStore();
  store.notified = [];
  store.query = async (sql, params) => { store.notified.push(params); return { rows: [] }; };
  return store;
}

test('PostgresBus: LISTEN delivers notifications; publish NOTIFYs { fileKey, id }', async t => {
  const store = notifyStore();
  const fake = fakeClients({});
  const bus = new PostgresBus({ store, createClient: fake.create, pollMs: 20, reconnectMs: 20 });
  t.after(() => bus.close());
  await bus.start();
  assert.equal(bus.mode, 'listening');
  assert.deepEqual(fake.clients[0].queries, ['LISTEN rds_events']);
  const heard = [];
  bus.subscribe(FK, id => heard.push(id));
  fake.clients[0].notify({ fileKey: FK, id: 7 });
  fake.clients[0].notify({ fileKey: OTHER, id: 8 });
  fake.clients[0].emit('notification', { channel: 'rds_events', payload: 'not json' });
  bus.publish(FK, 9);
  await waitFor(() => store.notified.length === 1, 'NOTIFY');
  assert.deepEqual(store.notified[0], ['rds_events', JSON.stringify({ fileKey: FK, id: 9 })]);
  assert.deepEqual(heard, [7, 9]);
  await bus.close();
  assert.equal(fake.clients[0].ended, true);
});

test('PostgresBus: falls back to polling when LISTEN fails, and reconnects', async t => {
  const store = notifyStore();
  const fail = { listen: true };
  const fake = fakeClients(fail);
  const bus = new PostgresBus({ store, createClient: fake.create, pollMs: 20, reconnectMs: 60 });
  t.after(() => bus.close());
  await bus.start();
  assert.equal(bus.mode, 'polling');
  const heard = [];
  bus.subscribe(FK, id => heard.push(id));

  // Another process commits an event: no notification reaches us, the poll finds it.
  const e = await store.insertEvent({ fileKey: FK, type: 'nodes.cleared' });
  await waitFor(() => heard.includes(e.id), 'polled event');
  const seen = heard.length;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(heard.length, seen, 'a poll dispatches each new id once');

  fail.listen = false;
  await waitFor(() => bus.mode === 'listening', 'reconnect');
  const client = fake.clients.at(-1);
  assert.ok(fake.clients.length >= 2);

  // The connection drops: back to polling, then to LISTEN again.
  client.drop();
  assert.equal(bus.mode, 'polling');
  assert.equal(client.ended, true);
  const later = await store.insertEvent({ fileKey: FK, type: 'claim.created' });
  await waitFor(() => heard.includes(later.id), 'polled after drop');
  await waitFor(() => bus.mode === 'listening' && fake.clients.at(-1) !== client, 'reconnect after drop');
  await bus.close();
  assert.equal(bus.mode, 'stopped');
});

test('PostgresBus: polls while the connection cannot even connect', async t => {
  const store = notifyStore();
  const fake = fakeClients({ connect: true });
  const bus = new PostgresBus({ store, createClient: fake.create, pollMs: 20, reconnectMs: 10000 });
  t.after(() => bus.close());
  await bus.start();
  assert.equal(bus.mode, 'polling');
  const heard = [];
  bus.subscribe(OTHER, id => heard.push(id));
  const e = await store.insertEvent({ fileKey: OTHER, type: 'sync.completed' });
  await waitFor(() => heard.includes(e.id), 'polled event');
});

test('PostgresBus: LISTEN retries back off exponentially up to the cap', async t => {
  const store = notifyStore();
  const fake = fakeClients({ listen: true });
  const bus = new PostgresBus({ store, createClient: fake.create, pollMs: 1000, reconnectMs: 20, maxReconnectMs: 80 });
  t.after(() => bus.close());
  await bus.start();
  assert.equal(bus.mode, 'polling');
  await waitFor(() => fake.clients.length >= 4, 'three retries');
  assert.equal(bus.reconnectDelay, 80, 'delay doubled 20 \u2192 40 \u2192 80 and stays at the cap');
  await new Promise(r => setTimeout(r, 120));
  assert.ok(fake.clients.length <= 7, `retries are spaced by the cap, not every 20 ms (${fake.clients.length} attempts)`);
});

test('PostgresBus: authentication failures wait the full cap before retrying', async t => {
  const store = notifyStore();
  const clients = [];
  const create = () => {
    const c = new EventEmitter();
    c.connect = async () => { const err = new Error('password authentication failed for user "postgres"'); err.code = '28P01'; throw err; };
    c.query = async () => ({ rows: [] });
    c.end = async () => {};
    clients.push(c);
    return c;
  };
  const bus = new PostgresBus({ store, createClient: create, pollMs: 1000, reconnectMs: 10, maxReconnectMs: 10000 });
  t.after(() => bus.close());
  await bus.start();
  assert.equal(bus.mode, 'polling');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(clients.length, 1, 'no retry within the cap after a 28P01');
  const { isAuthFailure } = require('../src/events/postgres');
  assert.equal(isAuthFailure({ code: 'XX000', message: '(ECIRCUITBREAKER) too many authentication failures' }), true);
  assert.equal(isAuthFailure(new Error('LISTEN is not supported by this pooler')), false);
});

test('capped node ids', () => {
  assert.equal(MAX_EVENT_NODE_IDS, 500);
});
