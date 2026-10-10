'use strict';

// End-to-end tests for API v3 (docs/api-v3-design.md): drive a RUNNING API
// over HTTP only. Required env: RDS_API_URL (e.g. http://127.0.0.1:8787),
// RDS_PLUGIN_TOKEN, RDS_AGENT_TOKEN, RDS_VIEWER_TOKEN. See tests/README.md and
// .github/workflows/e2e.yml.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const core = require('@rolling-design-sync/core');
const { Client } = require('pg');

const API = (process.env.RDS_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const PLUGIN_TOKEN = process.env.RDS_PLUGIN_TOKEN || 'e2e-plugin-token';
const AGENT_TOKEN = process.env.RDS_AGENT_TOKEN || 'e2e-agent-token';
const VIEWER_TOKEN = process.env.RDS_VIEWER_TOKEN || 'e2e-viewer-token';

const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };

const ERRORS_MD = fs.readFileSync(path.join(__dirname, '..', 'docs', 'errors.md'), 'utf8');

// --- fixtures (shape of the plugin's sync upload) --------------------------------

function upsert(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}

/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Card      built paddingLeft 16 → now 24 (layout)
 * │  └─ 3:1 TEXT Label   unchanged (clean)
 * ├─ 2:2 TEXT Title      built 'Hi' → now 'Hello' (content)
 * ├─ 2:3 TEXT Caption    built fontSize 12 → now 14 (typography)
 * └─ 2:4 FRAME Badge     new in the second sync (added)
 */
const ROOT = '1:1';
const BUILT = [
  upsert('1:1', 'SECTION', 'Page', { width: 1000 }),
  upsert('2:1', 'FRAME', 'Card', { paddingLeft: 16, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }, [ROOT]),
  upsert('3:1', 'TEXT', 'Label', { characters: 'Label' }, [ROOT, '2:1']),
  upsert('2:2', 'TEXT', 'Title', { characters: 'Hi' }, [ROOT]),
  upsert('2:3', 'TEXT', 'Caption', { characters: 'Cap', fontSize: 12 }, [ROOT]),
];
const NOW = [
  BUILT[0],
  upsert('2:1', 'FRAME', 'Card', { paddingLeft: 24, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }, [ROOT]),
  BUILT[2],
  upsert('2:2', 'TEXT', 'Title', { characters: 'Hello' }, [ROOT]),
  upsert('2:3', 'TEXT', 'Caption', { characters: 'Cap', fontSize: 14 }, [ROOT]),
  upsert('2:4', 'FRAME', 'Badge', { cornerRadius: 4 }, [ROOT]),
];
const DIRTY = ['2:1', '2:2', '2:3', '2:4'];
const hashOf = (rows, nodeId) => rows.find(r => r.nodeId === nodeId).contentHash;

/** Every run uses its own file key (letters and digits, like a real Figma key). */
const newFileKey = () => `e2ev3${randomUUID().replace(/-/g, '')}`;
const figmaLink = (fileKey, nodeId) => `https://www.figma.com/design/${fileKey}/E2E-File${nodeId ? `?node-id=${nodeId.replace(':', '-')}` : ''}`;

// --- HTTP helpers ---------------------------------------------------------------

async function call(method, route, { headers = agent, body, query } = {}) {
  const url = new URL(API + route);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return {
    status: res.status, contentType: res.headers.get('content-type') || '', server: res.headers.get('x-rds-server'),
    nextCursor: res.headers.get('x-rds-next-cursor'), setCookies: res.headers.getSetCookie(), body: json,
  };
}

async function ok(promise) {
  const res = await promise;
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

const sync = (fileKey, body) => call('POST', `/v3/files/${encodeURIComponent(fileKey)}/sync`, { headers: plugin, body });
const batch = (fileKey, body) => ok(sync(fileKey, body));
const hashesUnder = (fileKey, under) => ok(call('GET', `/v3/files/${encodeURIComponent(fileKey)}/hashes`, { headers: plugin, query: { under } }));
const existing = (fileKey, nodeIds) => ok(call('POST', `/v3/files/${encodeURIComponent(fileKey)}/exists`, { headers: plugin, body: { nodeIds } }));
const files = (fileKey, suffix = '', options) => call('GET', `/v3/files/${encodeURIComponent(fileKey)}${suffix}`, options);
const list = (fileKey, query) => ok(files(fileKey, '/nodes', { query }));
const listIds = async (fileKey, query) => (await list(fileKey, query)).nodes.map(n => n.nodeId);
const node = (fileKey, nodeId, query) => ok(files(fileKey, `/nodes/${encodeURIComponent(nodeId)}`, { query }));
const sameSet = (actual, expected) => assert.deepEqual([...actual].sort(), [...expected].sort());

test('component sets travel with references and group=set merges variants across expanded scope with paging', async () => {
  const fileKey = newFileKey();
  const set = { id: '6:0', key: 'BUTTONS', name: 'Button' };
  const primary = { id: '6:1', key: 'PRIMARY', name: 'State=Default', remote: true, set };
  const secondary = { id: '6:2', key: 'SECONDARY', name: 'State=Hover', remote: true, set };
  await batch(fileKey, { upserts: [
    upsert('1:1', 'FRAME', 'Portal', {}),
    { ...upsert('2:1', 'INSTANCE', 'Button', { componentReference: primary }, ['1:1']), mainComponentId: primary.id },
    { ...upsert('2:2', 'INSTANCE', 'Button', { componentReference: secondary }, ['1:1']), mainComponentId: secondary.id },
    upsert(primary.id, 'COMPONENT', primary.name, { componentReference: primary }),
    upsert('7:1', 'TEXT', 'Label', { characters: 'OK' }, [primary.id]),
    upsert(secondary.id, 'COMPONENT', secondary.name, { componentReference: secondary }),
  ] });
  assert.deepEqual((await node(fileKey, '2:1')).component, primary);
  assert.deepEqual((await list(fileKey, { instance: true })).nodes[0].component.set, set);
  const query = { group: 'set', under: '1:1', expand: 'instances', changes: 'names', limit: 1 };
  const first = await ok(files(fileKey, '/work', { query }));
  assert.equal(first.total, 2);
  assert.equal(first.items[0].key, set.key);assert.equal(first.items[0].name, set.name);
  assert.deepEqual(first.items[0].set, set);
  assert.deepEqual(first.items[0].nodeIds, ['6:1', '7:1', '6:2']);
  assert.deepEqual(first.items[0].variants, [{ key: 'PRIMARY', name: primary.name, nodeCount: 2 }, { key: 'SECONDARY', name: secondary.name, nodeCount: 1 }]);
  const second = await ok(files(fileKey, '/work', { query: { ...query, cursor: first.nextCursor } }));
  assert.equal(second.items[0].key, null);assert.equal(second.nextCursor, null);
  const text = await ok(files(fileKey, '/nodes', { query: { under: '1:1', format: 'outline' } }));
  assert.match(text.raw, /→ 6:1 Button \/ State=Default/);
  await batch(fileKey, { upserts: [
    upsert(set.id, 'COMPONENT_SET', set.name, { childOrder: [primary.id, secondary.id] }),
    upsert(primary.id, 'COMPONENT', primary.name, { componentReference: primary }, [set.id]),
    upsert('7:1', 'TEXT', 'Label', { characters: 'OK' }, [set.id, primary.id]),
    upsert(secondary.id, 'COMPONENT', secondary.name, { componentReference: secondary }, [set.id]),
  ] });
  const withRoot = await ok(files(fileKey, '/work', { query: { group: 'set', changes: 'names' } }));
  assert.equal(withRoot.items.filter(i => i.set).length, 1);
  assert.equal(withRoot.items[0].key, set.key);
  assert.equal(withRoot.items[0].nodeCount, 4);
});

/** A v3 error: RFC 9457 problem with `code` and `hint`, typed by its docs/errors.md section. */
function assertProblem(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.match(res.contentType, /^application\/problem\+json/);
  const anchor = code.replace(/_/g, '-');
  assert.equal(res.body.type, `https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#${anchor}`);
  assert.equal(res.body.status, status);
  assert.equal(res.body.code, code);
  assert.equal(typeof res.body.title, 'string');
  assert.equal(typeof res.body.detail, 'string');
  assert.equal(typeof res.body.hint, 'string');
  assert.ok(ERRORS_MD.includes(`<a id="${anchor}"></a>`), `docs/errors.md has a section for ${code}`);
  return res.body;
}

/** Baseline sync (already built), then a design edit — as the plugin sends them. */
async function seed(fileKey) {
  const baseline = await batch(fileKey, { fileName: 'E2E File', rootNodeId: ROOT, upserts: BUILT, markImplemented: true });
  assert.equal(baseline.baselined, BUILT.length);
  const edit = await batch(fileKey, { fileName: 'E2E File', rootNodeId: ROOT, upserts: NOW });
  assert.deepEqual(edit, { fileKey, upserted: NOW.length, dirty: DIRTY.length, tombstoned: 0, skippedInstances: 0 });
}

/**
 * `GET /v3/files/{fileKey}/events` as a server-sent-event stream: collects
 * `{ id, event, data }` messages and comments; `until(pred)` waits for them.
 */
function openEvents(fileKey, headers = {}, query = {}) {
  const controller = new AbortController();
  const messages = [], comments = [];
  const waiters = [];
  const settle = () => {
    for (const w of [...waiters]) if (w.pred()) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(); }
  };
  const done = (async () => {
    const url = new URL(fileKey === null ? `${API}/v3/events` : `${API}/v3/files/${encodeURIComponent(fileKey)}/events`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const res = await fetch(url, {
      headers: { ...agent, accept: 'text/event-stream', ...headers },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^text\/event-stream/);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let at;
      while ((at = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const msg = {};
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) comments.push(line.slice(1).trim());
          else if (line.startsWith('id: ')) msg.id = Number(line.slice(4));
          else if (line.startsWith('event: ')) msg.event = line.slice(7);
          else if (line.startsWith('data: ')) msg.data = JSON.parse(line.slice(6));
        }
        if (msg.event) messages.push(msg);
      }
      settle();
    }
  })().catch(err => { if (err.name !== 'AbortError') throw err; });
  return {
    messages,
    until(pred, what, ms = 10000) {
      return new Promise((resolve, reject) => {
        const w = { pred, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timed out waiting for ${what}: ${JSON.stringify(messages)}`)); }, ms) };
        waiters.push(w);
        settle();
      });
    },
    connected() { return this.until(() => comments.includes('connected'), 'the stream to open'); },
    async close() { controller.abort(); await done; },
  };
}

// --- tests ----------------------------------------------------------------------

test('portal status and token metadata are viewer-readable and track use without exposing tokens', async () => {
  const fileKey = newFileKey();
  await ok(call('POST', `/v3/files/${fileKey}/sync`, { headers: { ...plugin, 'x-rds-client': 'portal-e2e' }, body: { rootNodeId: ROOT, upserts: BUILT } }));
  const syncs = await ok(files(fileKey, '/events'));
  const status = await ok(call('GET', '/v3/status', { headers: viewer }));
  assert.equal(typeof status.version, 'string');
  assert.ok(['memory', 'local', 'postgres'].includes(status.store));
  assert.ok(['listening', 'polling'].includes(status.events));
  assert.equal(typeof status.replayHours, 'number');
  assert.deepEqual(status.plugin, { lastSyncAt: syncs.events.at(-1).createdAt, client: 'portal-e2e' });
  const tokens = await ok(call('GET', '/v3/tokens', { headers: viewer }));
  for (const tokenClass of ['plugin', 'agent', 'viewer']) {
    const token = tokens.find(token => token.class === tokenClass);
    assert.equal(typeof token.label, 'string');
    assert.ok(Number.isFinite(Date.parse(token.lastUsedAt)));
  }
  const text = JSON.stringify(tokens);
  for (const value of [PLUGIN_TOKEN, AGENT_TOKEN, VIEWER_TOKEN]) assert.ok(!text.includes(value));
  assertProblem(await call('GET', '/v3/tokens', { headers: plugin }), 403, 'wrong_token_class');
});

test('portal claims list active leases across files with capped IDs; work progress ignores state', async () => {
  const fileKey = newFileKey(), other = newFileKey();
  const children = Array.from({ length: 505 }, (_, i) => upsert(`2:${i}`, 'TEXT', `Text ${i}`, { characters: 'Hello' }, [ROOT]));
  await batch(fileKey, { rootNodeId: ROOT, upserts: [BUILT[0], ...children] });
  await seed(other);
  const large = await ok(call('POST', `/v3/files/${fileKey}/claims`, { body: { worker: 'portal-e2e', label: 'Large item', ttlSeconds: 180, nodeIds: children.map(n => n.nodeId) } }));
  const early = await ok(call('POST', `/v3/files/${other}/claims`, { body: { worker: 'portal-e2e-other', ttlSeconds: 60, nodeIds: ['2:3'] } }));
  const perFile = await ok(files(fileKey, '/claims', { headers: viewer }));
  assert.equal(perFile.claims[0].claimId, large.claimId);
  assert.equal(perFile.claims[0].nodeCount, 505);
  assert.equal(perFile.claims[0].nodeIds.length, 500);
  assert.equal(perFile.claims[0].label, 'Large item');
  assert.ok(!('fileKey' in perFile.claims[0]));
  const all = await ok(call('GET', '/v3/claims', { headers: viewer }));
  const ours = all.claims.filter(c => [large.claimId, early.claimId].includes(c.claimId));
  assert.deepEqual(ours.map(c => [c.claimId, c.fileKey]), [[early.claimId, other], [large.claimId, fileKey]]);
  assert.deepEqual(ours.map(c => c.fileName), ['E2E File', null]);
  assert.deepEqual(ours[0].nodes, [{ nodeId: '2:3', name: 'Caption', type: 'TEXT' }]);
  const documentFirst = (await listIds(fileKey, { state: 'all', limit: 4 })).filter(id => id !== ROOT).slice(0, 3);
  assert.deepEqual(perFile.claims[0].nodes, documentFirst.map(id => ({ nodeId: id, name: `Text ${id.slice(2)}`, type: 'TEXT' })));
  assert.ok(!('fileName' in perFile.claims[0]));
  await ok(call('POST', `/v3/files/${fileKey}/clear`, { body: { items: [{ nodeId: children[0].nodeId, contentHash: children[0].contentHash }] } }));
  const cleared = await ok(call('GET', '/v3/events', { query: { fileKey, nodeId: '2-0', types: 'nodes.cleared', since: perFile.claims[0].createdAt } }));
  assert.deepEqual(cleared.events[0].data.nodeIds, ['2:0']);
  assert.equal((await ok(files(fileKey, '/claims'))).claims[0].nodeCount, 504);
  const work = await ok(files(fileKey, '/work', { query: { include: 'progress', state: 'dirty' } }));
  assert.deepEqual(work.items[0].progress, { total: 506, clean: 1 });
  assert.equal(work.items[0].nodeCount, 505);
  assert.equal(work.items[0].nodeIds.length, 50);
  assert.deepEqual((await ok(files(fileKey, '/work', { query: { include: 'progress', state: 'clean' } }))).items[0].progress, work.items[0].progress);
  await ok(call('DELETE', `/v3/files/${fileKey}/claims/${large.claimId}`));
  await ok(call('DELETE', `/v3/files/${other}/claims/${early.claimId}`));
  const expiring = await ok(call('POST', `/v3/files/${other}/claims`, { body: { worker: 'portal-e2e-expired', ttlSeconds: 1, nodeIds: ['2:3'] } }));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiring.expiresAt) - Date.now() + 50)));
  assert.equal((await ok(files(other, '/claims'))).claims.length, 0);
  assert.ok(!(await ok(call('GET', '/v3/claims'))).claims.some(c => c.claimId === expiring.claimId));
  assert.equal((await ok(files(fileKey, '/claims'))).claims.length, 0);
});

test('portal events stream across files, filter by node, page and replay Last-Event-ID', async t => {
  const fileKey = newFileKey(), other = newFileKey();
  await seed(fileKey); await seed(other);
  const base = await ok(files(other, '/events'));
  const after = base.nextAfter;
  const live = openEvents(null, viewer, { nodeId: '2:3', types: 'node.blocked' });
  const narrow = openEvents(null, viewer, { fileKey, nodeId: '2:3' });
  t.after(() => live.close()); t.after(() => narrow.close());
  await Promise.all([live.connected(), narrow.connected()]);
  for (const [key, nodeId] of [[fileKey, '2:2'], [other, '2:3'], [fileKey, '2:3']]) {
    await ok(call('POST', `/v3/files/${key}/nodes/${nodeId}/block`, { body: { reason: 'Portal e2e', worker: 'portal-e2e' } }));
  }
  await Promise.all([live.until(() => live.messages.length === 2, 'two files'), narrow.until(() => narrow.messages.length === 1, 'narrowed file')]);
  assert.deepEqual(live.messages.map(m => m.data.fileKey), [other, fileKey]);
  assert.equal(narrow.messages[0].id, live.messages[1].id);
  const named = m => ({ ...m.data, fileName: 'E2E File' });
  const first = await ok(call('GET', '/v3/events', { query: { after, nodeId: '2:3', limit: 1 } }));
  assert.deepEqual(first.events, [named(live.messages[0])]);
  const rest = await ok(call('GET', '/v3/events', { query: { after: first.nextAfter, nodeId: '2:3' } }));
  assert.deepEqual(rest.events, [named(live.messages[1])]);
  const since = await ok(call('GET', '/v3/events', { query: { after, fileKey, nodeId: '2:3', since: live.messages[1].data.createdAt } }));
  assert.deepEqual(since.events, [named(live.messages[1])]);
  const newest = await ok(call('GET', '/v3/events', { query: { order: 'desc', nodeId: '2:3', types: 'node.blocked', limit: 1 } }));
  assert.deepEqual([newest.events, newest.nextBefore], [[named(live.messages[1])], live.messages[1].id]);
  const older = await ok(call('GET', '/v3/events', { query: { order: 'desc', after, before: newest.nextBefore, nodeId: '2:3', types: 'node.blocked', limit: 1 } }));
  assert.deepEqual([older.events, older.nextBefore], [[named(live.messages[0])], live.messages[0].id]);
  const oldest = await ok(call('GET', '/v3/events', { query: { order: 'desc', after, before: older.nextBefore, nodeId: '2:3', types: 'node.blocked' } }));
  assert.deepEqual(oldest, { events: [], nextBefore: older.nextBefore });
  const perFileDesc = await ok(files(fileKey, '/events', { query: { order: 'desc', after, limit: 2 } }));
  assert.deepEqual(perFileDesc.events.map(e => e.data.nodeId), ['2:3', '2:2']);
  assert.ok(perFileDesc.events.every(e => !('fileName' in e)));
  const replay = openEvents(null, { ...viewer, 'last-event-id': String(first.nextAfter) }, { after, fileKey, nodeId: '2:3' });
  t.after(() => replay.close());
  await replay.until(() => replay.messages.length === 1, 'cross-file replay');
  assert.deepEqual(replay.messages[0].data, live.messages[1].data);
  await replay.close(); await live.close(); await narrow.close();
});

test('v3 auth: agent token only; rejections are problems', async () => {
  assertProblem(await call('GET', '/v3/files', { headers: {} }), 401, 'unauthorized');
  assertProblem(await call('GET', '/v3/files', { headers: { authorization: 'Bearer not-a-token' } }), 401, 'invalid_token');
  assertProblem(await call('GET', '/v3/files', { headers: plugin }), 403, 'wrong_token_class');
});

test('v3 session: sign in with a viewer token, read with the cookie, sign out (docs/ui-portal.md)', async () => {
  const res = await call('POST', '/v3/session', { headers: {}, body: { token: VIEWER_TOKEN } });
  const signedIn = await ok(Promise.resolve(res));
  assert.equal(signedIn.role, 'viewer');
  assert.equal(typeof signedIn.label, 'string');
  assert.ok(Date.parse(signedIn.expiresAt) > Date.now());
  const setCookie = res.setCookies.find(c => c.startsWith('rds_session='));
  assert.ok(setCookie, 'the session cookie is set');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=43200/);
  const cookie = setCookie.split(';')[0];

  // The cookie alone reads v3 — the whole point: a browser cannot attach a bearer token to EventSource.
  assert.ok(Array.isArray((await ok(call('GET', '/v3/files', { headers: { cookie } }))).files));
  const me = await ok(call('GET', '/v3/session', { headers: { cookie } }));
  assert.equal(me.role, 'viewer');
  assert.equal(me.label, signedIn.label);

  assertProblem(await call('GET', '/v3/files', { headers: { cookie: 'rds_session=garbage' } }), 401, 'invalid_token');
  assertProblem(await call('POST', '/v3/session', { headers: {}, body: { token: PLUGIN_TOKEN } }), 403, 'wrong_token_class');
  assertProblem(await call('GET', '/v3/session', { headers: {} }), 401, 'unauthorized');

  // A viewer session still cannot write; an agent session's writes need the portal CSRF headers.
  const fileKey = newFileKey();
  await seed(fileKey);
  assertProblem(await call('POST', `/v3/files/${fileKey}/claims`, { headers: { cookie, 'x-rds-client': 'portal/e2e', origin: API }, body: { worker: 'w' } }), 403, 'wrong_token_class');
  const agentRes = await call('POST', '/v3/session', { headers: {}, body: { token: AGENT_TOKEN } });
  const agentCookie = agentRes.setCookies.find(c => c.startsWith('rds_session=')).split(';')[0];
  assert.equal((await ok(Promise.resolve(agentRes))).role, 'agent');
  assertProblem(await call('POST', `/v3/files/${fileKey}/claims`, { headers: { cookie: agentCookie }, body: { worker: 'w' } }), 403, 'csrf_rejected');
  // A foreign Origin on a cookie write is rejected — in embedded modes the
  // origin guard answers first (forbidden_origin); Postgres mode's check is
  // the session CSRF rule.
  const foreign = await call('POST', `/v3/files/${fileKey}/claims`, { headers: { cookie: agentCookie, 'x-rds-client': 'portal/e2e', origin: 'http://evil.example' }, body: { worker: 'w' } });
  assert.equal(foreign.status, 403);
  assert.ok(
    foreign.body.code === 'csrf_rejected' || foreign.body.error === 'forbidden_origin',
    `expected csrf_rejected/forbidden_origin, got ${JSON.stringify(foreign.body)}`,
  );
  assert.deepEqual(
    (await ok(call('POST', `/v3/files/${fileKey}/claims`, { headers: { cookie: agentCookie, 'x-rds-client': 'portal/e2e', origin: API }, body: { worker: 'w' } }))).worker,
    'w',
  );

  const out = await ok(call('DELETE', '/v3/session', { headers: { cookie } }));
  assert.deepEqual(out, { signedOut: true });
});

test('v3 end to end: sync → files/scopes → listing → detail → claims → bulk clear → re-edit', async t => {
  const fileKey = newFileKey();
  await seed(fileKey);

  await t.test('sync with fileName/rootNodeId → GET /v3/files and /scopes show it', async () => {
    const { files: all } = await ok(call('GET', '/v3/files'));
    const file = all.find(f => f.fileKey === fileKey);
    assert.ok(file, 'the synced file is listed');
    assert.equal(file.name, 'E2E File');
    assert.ok(Date.parse(file.lastSyncAt));
    assert.deepEqual(file.counts, { total: 6, dirty: 4, clean: 2, blocked: 0 });
    assert.deepEqual(await ok(files(fileKey)), file);

    const scopes = await ok(files(fileKey, '/scopes'));
    assert.equal(scopes.fileKey, fileKey);
    assert.equal(scopes.scopes.length, 1);
    const [scope] = scopes.scopes;
    assert.equal(scope.nodeId, ROOT);
    assert.equal(scope.name, 'Page');
    assert.equal(scope.type, 'SECTION');
    assert.equal(scope.deleted, false);
    assert.equal(scope.figmaUrl, core.link(fileKey, ROOT));
    assert.deepEqual(scope.lastSyncCounts, { uploaded: 6, changed: 3, added: 1, deleted: 0, baselined: 0 });
    assert.deepEqual(scope.counts, { total: 6, dirty: 4, clean: 2, blocked: 0 });
  });

  await t.test('listing: dirty by default, filters AND across parameters, OR within one', async () => {
    const page = await list(fileKey);
    assert.equal(page.fileKey, fileKey);
    assert.deepEqual(page.nodes.map(n => n.nodeId), ['2:1', '2:2', '2:3', '2:4'], 'tree (path) order');
    assert.equal(page.total, 4);
    assert.equal(page.nextCursor, null);
    const card = page.nodes[0];
    assert.deepEqual(card.changes, { paddingLeft: { built: 16, now: 24, category: 'layout' } });
    assert.equal(card.changeType, 'modified');
    assert.equal(card.state, 'dirty');
    assert.equal(card.figmaUrl, core.link(fileKey, '2:1'));
    assert.equal(card.claim, null);
    assert.ok(!('attrs' in card), 'compact by default');

    assert.deepEqual(await listIds(fileKey, { type: 'TEXT' }), ['2:2', '2:3']);
    assert.deepEqual(await listIds(fileKey, { changeType: 'added' }), ['2:4']);
    assert.deepEqual(await listIds(fileKey, { changed: 'padding*' }), ['2:1']);
    assert.deepEqual(await listIds(fileKey, { category: 'typography,content' }), ['2:2', '2:3']);
    assert.deepEqual(await listIds(fileKey, { type: 'TEXT', category: 'typography' }), ['2:3']);
    assert.deepEqual(await listIds(fileKey, { name: 'ca*' }), ['2:1', '2:3']);
    assert.deepEqual(await listIds(fileKey, { q: 'type:TEXT changed:characters' }), ['2:2']);
    assert.deepEqual(await listIds(fileKey, { state: 'clean' }), ['1:1', '3:1']);
    assert.deepEqual(await listIds(fileKey, { state: 'all', under: '2-1' }), ['2:1', '3:1']);
    assert.deepEqual(await listIds(fileKey, { state: 'all', under: ROOT, depth: 1 }), ['1:1', '2:1', '2:2', '2:3', '2:4']);
    assert.deepEqual(await listIds(fileKey, { sort: '-name' }), ['2:2', '2:1', '2:3', '2:4']);

    const full = (await list(fileKey, { view: 'full', changed: 'padding*' })).nodes[0];
    assert.deepEqual(full.attrs, NOW[1].attrs);
    assert.deepEqual(full.implementedAttrs, BUILT[1].attrs);
    assert.deepEqual(full.path, [ROOT, '2:1']);
    assert.deepEqual((await list(fileKey, { fields: 'nodeId,changeType', type: 'FRAME' })).nodes,
      [{ nodeId: '2:1', changeType: 'modified' }, { nodeId: '2:4', changeType: 'added' }]);
    const counted = (await list(fileKey, { state: 'all', under: ROOT, depth: 0, include: 'counts' })).nodes;
    assert.deepEqual(counted.map(n => [n.nodeId, n.descendants]), [[ROOT, { total: 5, dirty: 4, blocked: 0 }]]);
  });

  await t.test('listing pages with nextCursor; total is the full match count', async () => {
    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const page = await list(fileKey, { state: 'all', limit: 2, ...(cursor ? { cursor } : {}) });
      assert.equal(page.total, 6);
      assert.ok(page.nodes.length <= 2);
      seen.push(...page.nodes.map(n => n.nodeId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    assert.equal(pages, 3);
    assert.deepEqual(seen, ['1:1', '2:1', '3:1', '2:2', '2:3', '2:4']);

    const first = await list(fileKey, { state: 'all', limit: 2 });
    assertProblem(await files(fileKey, '/nodes', { query: { state: 'dirty', limit: 2, cursor: first.nextCursor } }), 400, 'invalid_cursor');
    assertProblem(await files(fileKey, '/nodes', { query: { cursor: 'garbage' } }), 400, 'invalid_cursor');
  });

  await t.test('node detail: changes against what was built, history, subtree counts', async () => {
    const card = await node(fileKey, '2-1');
    assert.equal(card.fileKey, fileKey);
    assert.equal(card.nodeId, '2:1', '1-2 ids are normalized');
    assert.equal(card.name, 'Card');
    assert.equal(card.type, 'FRAME');
    assert.equal(card.parentId, ROOT);
    assert.equal(card.changeType, 'modified');
    assert.equal(card.changesKnown, true);
    assert.deepEqual(card.changes, { paddingLeft: { built: 16, now: 24, category: 'layout' } });
    assert.equal(card.contentHash, hashOf(NOW, '2:1'));
    assert.deepEqual(card.implementedAttrs, BUILT[1].attrs);
    assert.equal(card.deleted, false);
    assert.equal(card.history.implementedCommit, 'baseline');
    assert.equal(card.history.implementedHash, hashOf(BUILT, '2:1'));
    assert.deepEqual(card.descendants, { total: 1, dirty: 0, blocked: 0 });

    const badge = await node(fileKey, '2:4');
    assert.equal(badge.changeType, 'added');
    assert.deepEqual(badge.changes, { cornerRadius: { built: null, now: 4, category: 'effects' } });
    assert.deepEqual(await node(fileKey, '2:3', { fields: 'changes' }), {
      fileKey, changes: { fontSize: { built: 12, now: 14, category: 'typography' } },
    });
  });

  let w1;
  await t.test('claims: lease by filter, no stealing, detail shows the holder, renew and release', async () => {
    w1 = await ok(call('POST', `/v3/files/${fileKey}/claims`, { body: { worker: 'e2e-w1', label: 'Sprite', ttlSeconds: 600, filter: { type: 'TEXT' } } }));
    assert.match(w1.claimId, /^[0-9a-f-]{36}$/);
    assert.equal(w1.worker, 'e2e-w1');
    assert.equal(w1.label, 'Sprite');
    assert.deepEqual(w1.nodes.map(n => n.nodeId), ['2:2', '2:3']);
    for (const n of w1.nodes) assert.deepEqual(n.claim, { claimId: w1.claimId, worker: 'e2e-w1', label: 'Sprite', expiresAt: w1.expiresAt });
    const ttl = Date.parse(w1.expiresAt) - Date.now();
    assert.ok(ttl > 500e3 && ttl <= 600e3, `ttl ${ttl}`);

    assert.deepEqual(await listIds(fileKey, { claimed: 'mine', worker: 'e2e-w1' }), ['2:2', '2:3']);
    assert.deepEqual(await listIds(fileKey, { claimed: 'false' }), ['2:1', '2:4']);

    const w2 = await ok(call('POST', `/v3/files/${fileKey}/claims`, { body: { worker: 'e2e-w2', nodeIds: ['2-1', '2:2', '9:9'] } }));
    assert.deepEqual(w2.nodes.map(n => n.nodeId), ['2:1'], 'live leases are not stolen; unknown ids are skipped');

    assert.equal((await node(fileKey, '2:2')).claim.worker, 'e2e-w1');
    assert.equal((await node(fileKey, '2:1')).claim.worker, 'e2e-w2');
    sameSet(await listIds(fileKey, { claimed: 'true' }), ['2:1', '2:2', '2:3']);

    const renewed = await ok(call('POST', `/v3/files/${fileKey}/claims/${w1.claimId}/renew`, { body: { ttlSeconds: 1200 } }));
    assert.ok(Date.parse(renewed.expiresAt) > Date.parse(w1.expiresAt));
    assert.deepEqual(renewed.nodes.map(n => n.nodeId), ['2:2', '2:3']);
    w1 = renewed;

    const released = await ok(call('DELETE', `/v3/files/${fileKey}/claims/${w2.claimId}`));
    assert.deepEqual(released, { claimId: w2.claimId, worker: 'e2e-w2', label: null, released: ['2:1'] });
    assert.equal((await node(fileKey, '2:1')).claim, null);
  });

  await t.test('bulk clear: per-item results with one stale item; clearing releases the lease', async () => {
    const res = await ok(call('POST', `/v3/files/${fileKey}/clear`, {
      body: {
        commitRef: 'e2e-c1',
        items: [
          { nodeId: '2:1', contentHash: hashOf(NOW, '2:1') },
          { nodeId: '2:2', contentHash: hashOf(BUILT, '2:2') },
          { nodeId: '2-3', contentHash: hashOf(NOW, '2:3') },
          { nodeId: '9:9', contentHash: 'x' },
        ],
      },
    }));
    assert.deepEqual(res, {
      fileKey,
      commitRef: 'e2e-c1',
      results: [
        { nodeId: '2:1', status: 'cleared', contentHash: hashOf(NOW, '2:1') },
        { nodeId: '2:2', status: 'stale', contentHash: hashOf(NOW, '2:2') },
        { nodeId: '2:3', status: 'cleared', contentHash: hashOf(NOW, '2:3') },
        { nodeId: '9:9', status: 'not_found', contentHash: null },
      ],
      totals: { cleared: 2, stale: 1, notFound: 1 },
    });
    assert.deepEqual(await listIds(fileKey), ['2:2', '2:4']);
    const caption = await node(fileKey, '2:3');
    assert.equal(caption.state, 'clean');
    assert.equal(caption.claim, null, 'clearing released the lease');
    assert.equal(caption.history.implementedCommit, 'e2e-c1');
    assert.deepEqual((await node(fileKey, '2:2')).claim.claimId, w1.claimId, 'the stale item keeps its lease');
    assert.deepEqual((await ok(call('POST', `/v3/files/${fileKey}/claims/${w1.claimId}/renew`))).nodes.map(n => n.nodeId), ['2:2']);
  });

  await t.test('editing a cleared node diffs against what was built (not the old baseline)', async () => {
    await batch(fileKey, { rootNodeId: ROOT, upserts: [upsert('2:1', 'FRAME', 'Card', { ...NOW[1].attrs, paddingLeft: 32 }, [ROOT])] });
    const card = await node(fileKey, '2:1');
    assert.equal(card.state, 'dirty');
    assert.equal(card.changeType, 'modified');
    assert.deepEqual(card.changes, { paddingLeft: { built: 24, now: 32, category: 'layout' } });
    assert.deepEqual(await listIds(fileKey), ['2:1', '2:2', '2:4']);
    assert.equal((await ok(files(fileKey, '/scopes'))).scopes[0].lastSyncCounts.changed, 1);
  });

  await t.test('?url= addressing: resolve, file, listing, node, claims', async () => {
    const link = figmaLink(fileKey, '2:1');
    assert.deepEqual(await ok(call('GET', '/v3/resolve', { query: { url: link } })), { fileKey, nodeId: '2:1' });
    assert.deepEqual(await ok(call('GET', '/v3/resolve', { query: { url: figmaLink(fileKey) } })), { fileKey, nodeId: null });
    assert.equal((await ok(files('-', '', { query: { url: figmaLink(fileKey) } }))).fileKey, fileKey);
    assert.deepEqual(await listIds('-', { url: link, state: 'all' }), ['2:1', '3:1'], '?url= with node-id scopes the listing to that subtree');
    assert.equal((await node('-', '-', { url: link })).nodeId, '2:1');
    assert.equal((await ok(call('GET', `/v3/files/-/nodes/2-1`, { query: { url: link } }))).nodeId, '2:1');

    const claimed = await ok(call('POST', '/v3/files/-/claims', { query: { url: link }, body: { worker: 'e2e-url' } }));
    assert.deepEqual(claimed.nodes.map(n => n.nodeId), ['2:1']);
    await ok(call('DELETE', `/v3/files/-/claims/${claimed.claimId}`, { query: { url: link } }));
  });

  await t.test('problems carry a code and a hint for the known traps', async () => {
    const link = figmaLink(fileKey, '2:1');
    const urlAsKey = assertProblem(await files(link, '/nodes'), 404, 'file_not_found');
    assert.match(urlAsKey.hint, new RegExp(`Use the file key '${fileKey}'`));
    assertProblem(await files(newFileKey()), 404, 'file_not_found');

    const hyphen = assertProblem(await files(fileKey, '/nodes/77-77'), 404, 'node_not_found');
    assert.match(hyphen.hint, /Neither '77:77' nor '77-77'/);
    assertProblem(await files(fileKey, '/nodes', { query: { under: '77:77' } }), 404, 'node_not_found');

    const typo = assertProblem(await files(fileKey, '/nodes', { query: { stat: 'dirty' } }), 400, 'unknown_parameter');
    assert.match(typo.hint, /'stat' → 'state'/);
    assert.ok(typo.validParameters.includes('state'));

    const badState = assertProblem(await files(fileKey, '/nodes', { query: { state: 'dirtyy' } }), 400, 'invalid_parameter');
    assert.match(badState.hint, /dirty, clean, blocked, all/);
    assertProblem(await files(fileKey, '/nodes', { query: { limit: 0 } }), 400, 'invalid_parameter');
    assertProblem(await files('-', '/nodes'), 400, 'invalid_parameter');

    assertProblem(await call('GET', '/v3/resolve', { query: { url: 'https://example.com/x' } }), 400, 'invalid_url');
    assertProblem(await files(fileKey, '/nodes', { query: { url: figmaLink(newFileKey(), '2:1') } }), 400, 'url_mismatch');

    const nodeIDs = assertProblem(await call('POST', `/v3/files/${fileKey}/claims`, { body: { worker: 'w', nodeIDs: ['2:1'] } }), 400, 'invalid_body');
    assert.match(nodeIDs.detail, /nodeIDs/);
    assertProblem(await call('POST', `/v3/files/${fileKey}/claims/${randomUUID()}/renew`), 404, 'claim_not_found');
    assertProblem(await call('DELETE', `/v3/files/${fileKey}/claims/not-a-claim`), 404, 'claim_not_found');

    assertProblem(await call('GET', '/v3/nope'), 404, 'route_not_found');
  });
});

test('v3 events: a stream receives sync and clear live; Last-Event-ID replays only newer ones; JSON page', async t => {
  const fileKey = newFileKey();
  await seed(fileKey);
  const seeded = await ok(files(fileKey, '/events'));
  assert.deepEqual(seeded.events.map(e => e.type), ['sync.completed', 'sync.completed']);

  const live = openEvents(fileKey);
  t.after(() => live.close());
  await live.connected();
  await batch(fileKey, { rootNodeId: ROOT, upserts: [upsert('2:4', 'FRAME', 'Badge', { cornerRadius: 8 }, [ROOT])] });
  const badge = hashOf([upsert('2:4', 'FRAME', 'Badge', { cornerRadius: 8 }, [ROOT])], '2:4');
  const cleared = await ok(call('POST', `/v3/files/${fileKey}/clear`, { body: { commitRef: 'e2e-events', items: [{ nodeId: '2:4', contentHash: badge }] } }));
  assert.equal(cleared.totals.cleared, 1);
  await live.until(() => live.messages.length >= 2, 'sync.completed and nodes.cleared');
  const [sync, clear] = live.messages;
  assert.equal(sync.event, 'sync.completed');
  assert.equal(sync.data.fileKey, fileKey);
  assert.equal(sync.data.data.rootNodeId, ROOT);
  assert.equal(clear.event, 'nodes.cleared');
  assert.deepEqual(clear.data.data.nodeIds, ['2:4']);
  assert.equal(clear.data.data.commitRef, 'e2e-events');
  assert.ok(sync.id > seeded.nextAfter && clear.id > sync.id);
  await live.close();

  const resumed = openEvents(fileKey, { 'last-event-id': String(sync.id) });
  t.after(() => resumed.close());
  await resumed.until(() => resumed.messages.length >= 1, 'the replay');
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(resumed.messages.map(m => [m.id, m.event]), [[clear.id, 'nodes.cleared']]);
  await resumed.close();

  const pageAfter = await ok(files(fileKey, '/events', { query: { after: seeded.nextAfter, types: 'nodes.cleared', limit: 5 } }));
  assert.deepEqual(pageAfter.events.map(e => e.id), [clear.id]);
  assert.equal(pageAfter.nextAfter, clear.id);
});

test('GET /v3/insights/trends counts the clears and newly dirty nodes of the last window, per file and in total', async () => {
  const fileKey = newFileKey();
  await seed(fileKey);
  await ok(call('POST', `/v3/files/${fileKey}/clear`, { body: { commitRef: 'e2e-trends', items: ['2:1', '2:2'].map(nodeId => ({ nodeId, contentHash: hashOf(NOW, nodeId) })) } }));
  const trend = { cleared: 2, clearedPrevious: 0, clearedChangePct: null, dirtied: DIRTY.length, netDirty: DIRTY.length - 2 };
  const one = await ok(call('GET', '/v3/insights/trends', { headers: viewer, query: { fileKey } }));
  assert.equal(one.windowDays, 7);
  assert.equal(Date.parse(one.to) - Date.parse(one.from), 7 * 24 * 60 * 60 * 1000);
  assert.equal(one.complete, one.retentionDays >= 14);
  assert.deepEqual(one.total, trend);
  assert.deepEqual(one.files, [{ fileKey, fileName: 'E2E File', ...trend }]);
  const all = await ok(call('GET', '/v3/insights/trends', { headers: viewer, query: { windowDays: 1 } }));
  assert.deepEqual(all.files.find(f => f.fileKey === fileKey), { fileKey, fileName: 'E2E File', ...trend });
  assert.ok(all.total.cleared >= 2 && all.total.dirtied >= DIRTY.length);
  assertProblem(await call('GET', '/v3/insights/trends', { query: { windowDays: 15 } }), 400, 'invalid_parameter');
  assertProblem(await call('GET', '/v3/insights/trends', { query: { fileKey: newFileKey() } }), 404, 'file_not_found');
});

test('GET /v3/openapi.json is reachable without a token and lists the phase-1 routes', async () => {
  const doc = await ok(call('GET', '/v3/openapi.json', { headers: {} }));
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.info.title, 'Rolling Design Sync API v3');
  const routes = {
    '/v3/files': ['get'],
    '/v3/files/{fileKey}': ['get'],
    '/v3/files/{fileKey}/scopes': ['get'],
    '/v3/files/{fileKey}/nodes': ['get'],
    '/v3/files/{fileKey}/nodes/{nodeId}': ['get'],
    '/v3/files/{fileKey}/clear': ['post'],
    '/v3/files/{fileKey}/claims': ['get', 'post'],
    '/v3/status': ['get'], '/v3/tokens': ['get'], '/v3/claims': ['get'], '/v3/events': ['get'],
    '/v3/files/{fileKey}/claims/{claimId}/renew': ['post'],
    '/v3/files/{fileKey}/claims/{claimId}': ['delete'],
    '/v3/files/{fileKey}/events': ['get'],
    '/v3/files/{fileKey}/nodes/{nodeId}/block': ['post'],
    '/v3/files/{fileKey}/nodes/{nodeId}/unblock': ['post'],
    '/v3/files/{fileKey}/summary': ['get'],
    '/v3/files/{fileKey}/work': ['get'],
    '/v3/insights/trends': ['get'],
    '/v3/files/{fileKey}/hashes': ['get'],
    '/v3/files/{fileKey}/sync': ['post'],
    '/v3/files/{fileKey}/exists': ['post'],
    '/v3/resolve': ['get'],
    '/v3/openapi.json': ['get'],
    '/v3/session': ['get', 'delete', 'post'],
  };
  for (const [route, methods] of Object.entries(routes)) {
    assert.ok(doc.paths[route], `${route} is documented`);
    for (const m of methods) assert.ok(doc.paths[route][m], `${m.toUpperCase()} ${route} is documented`);
  }
  assert.equal(doc.components.securitySchemes.agentToken.scheme, 'bearer');
  assert.equal(doc.components.securitySchemes.viewerToken.scheme, 'bearer');
  assert.equal(doc.components.securitySchemes.pluginToken.scheme, 'bearer');
});

test('v3 block: block releases the lease → listing shows blocked → unblock → dirty again', async () => {
  const fileKey = newFileKey();
  await seed(fileKey);
  const claim = await ok(call('POST', `/v3/files/${fileKey}/claims`, { body: { worker: 'e2e-worker', nodeIds: ['2:2'] } }));

  const blocked = await ok(call('POST', `/v3/files/${fileKey}/nodes/2-2/block`, { body: { reason: 'Copy not final', worker: 'e2e-worker' } }));
  assert.equal(blocked.node.state, 'blocked');
  assert.deepEqual(blocked.released, { claimId: claim.claimId, worker: 'e2e-worker' });
  assert.deepEqual(blocked.node.blocked && blocked.node.blocked.reason, 'Copy not final');
  const detail = await node(fileKey, '2:2');
  assert.equal(detail.state, 'blocked');
  assert.equal(detail.claim, null);
  sameSet(await listIds(fileKey), ['2:1', '2:3', '2:4']);
  assert.deepEqual(await listIds(fileKey, { state: 'blocked' }), ['2:2']);
  assert.equal((await ok(files(fileKey))).counts.blocked, 1);
  assertProblem(await call('POST', `/v3/files/${fileKey}/nodes/2:2/block`, { body: {} }), 400, 'invalid_parameter');

  const unblocked = await ok(call('POST', `/v3/files/${fileKey}/nodes/2:2/unblock`, { body: {} }));
  assert.equal(unblocked.unblocked, true);
  assert.equal(unblocked.node.state, 'dirty');
  sameSet(await listIds(fileKey), DIRTY);

  const { events } = await ok(files(fileKey, '/events', { query: { types: 'node.blocked,node.unblocked' } }));
  assert.deepEqual(events.map(e => [e.type, e.data.reason, e.data.auto]), [['node.blocked', 'Copy not final', false], ['node.unblocked', 'Copy not final', false]]);
});

test('v3 summary and work items after a sync; format=ndjson and format=md', async () => {
  const fileKey = newFileKey();
  await seed(fileKey);
  const zero = { layout: 0, color: 0, typography: 0, effects: 0, component: 0, content: 0, structure: 0, prototype: 0, other: 0 };

  assert.deepEqual(await ok(files(fileKey, '/summary')), {
    fileKey,
    total: 4,
    byState: { dirty: 4, clean: 0, blocked: 0 },
    byChangeType: { added: 1, modified: 3, deleted: 0 },
    byCategory: { ...zero, layout: 1, content: 1, typography: 1, effects: 1 },
    byType: { FRAME: 2, TEXT: 2 },
  });
  const under = await ok(files(fileKey, '/summary', { query: { url: figmaLink(fileKey, ROOT), state: 'all' } }));
  assert.equal(under.total, 6);
  assert.deepEqual(under.byState, { dirty: 4, clean: 2, blocked: 0 });
  assert.deepEqual(under.byFrame, [
    { nodeId: '2:1', name: 'Card', count: 2 }, { nodeId: '2:2', name: 'Title', count: 1 },
    { nodeId: '2:3', name: 'Caption', count: 1 }, { nodeId: '2:4', name: 'Badge', count: 1 },
  ]);
  assert.equal((await ok(files(fileKey, '/summary', { query: { type: 'TEXT' } }))).total, 2);

  const work = await ok(files(fileKey, '/work'));
  assert.deepEqual(work, {
    fileKey,
    group: 'component',
    items: [{
      key: null, name: null, type: null, nodeCount: 4, categories: ['content', 'effects', 'layout', 'typography'],
      changedProps: ['characters', 'cornerRadius', 'fontSize', 'paddingLeft'],
      changes: {
        '2:1': { paddingLeft: { built: 16, now: 24, category: 'layout' } },
        '2:2': { characters: { built: 'Hi', now: 'Hello', category: 'content' } },
        '2:3': { fontSize: { built: 12, now: 14, category: 'typography' } },
      },
      placements: null, nodeIds: DIRTY, more: 0,
    }],
    nextCursor: null,
    total: 1,
  });
  assert.deepEqual((await ok(files(fileKey, '/work', { query: { changes: 'diff' } }))).items[0].changes['2:4'], { cornerRadius: { built: null, now: 4, category: 'effects' } });
  assert.equal('changes' in (await ok(files(fileKey, '/work', { query: { changes: 'names' } }))).items[0], false);
  const frames = await ok(files(fileKey, '/work', { query: { group: 'frame', under: ROOT, limit: 3 } }));
  assert.deepEqual(frames.items.map(i => [i.key, i.name, i.nodeIds]), [['2:1', 'Card', ['2:1']], ['2:2', 'Title', ['2:2']], ['2:3', 'Caption', ['2:3']]]);
  assert.equal(frames.total, 4);
  const rest = await ok(files(fileKey, '/work', { query: { group: 'frame', under: ROOT, limit: 3, cursor: frames.nextCursor } }));
  assert.deepEqual([rest.items.map(i => i.key), rest.nextCursor], [['2:4'], null]);
  const missing = assertProblem(await files(fileKey, '/work', { query: { group: 'frame' } }), 400, 'invalid_parameter');
  assert.match(missing.hint, /under=/);

  const nd = await files(fileKey, '/nodes', { query: { format: 'ndjson', fields: 'nodeId,state' } });
  assert.equal(nd.status, 200);
  assert.match(nd.contentType, /^application\/x-ndjson/);
  assert.deepEqual(nd.body.raw.split('\n').filter(Boolean).map(l => JSON.parse(l)), DIRTY.map(nodeId => ({ nodeId, state: 'dirty' })));

  const md = await files(fileKey, '/nodes', { query: { format: 'md' } });
  assert.equal(md.status, 200);
  assert.match(md.contentType, /^text\/markdown/);
  assert.deepEqual(md.body.raw.split('\n').filter(Boolean), [
    `- [ ] **Card** (FRAME) — paddingLeft 16 → 24 · [Figma](${core.link(fileKey, '2:1')})`,
    `- [ ] **Title** (TEXT) — characters Hi → Hello · [Figma](${core.link(fileKey, '2:2')})`,
    `- [ ] **Caption** (TEXT) — fontSize 12 → 14 · [Figma](${core.link(fileKey, '2:3')})`,
    `- [ ] **Badge** (FRAME) — added · [Figma](${core.link(fileKey, '2:4')})`,
  ]);
  const workMd = await files(fileKey, '/work', { query: { format: 'md' } });
  assert.deepEqual(workMd.body.raw.split('\n').filter(Boolean), ['- [ ] **(no component)** — 4 nodes: characters, cornerRadius, fontSize, paddingLeft']);
  const eventsMd = await files(fileKey, '/events', { query: { format: 'md' } });
  assert.match(eventsMd.contentType, /^text\/markdown/);
  assert.equal(eventsMd.body.raw.split('\n').filter(Boolean).length, 2);
});

test('v3 fresh sync: the default listing is compact — changedProps, no added values, component links', async () => {
  const fileKey = newFileKey();
  const long = 'x'.repeat(1500);
  const rows = [
    upsert(ROOT, 'SECTION', 'Page', { width: 1000 }),
    upsert('2:1', 'TEXT', 'Body', { characters: long, fontSize: 14 }, [ROOT]),
    { ...upsert('2:2', 'INSTANCE', 'Button', { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] }, [ROOT]), mainComponentId: '9:1' },
  ];
  await batch(fileKey, { fileName: 'E2E Fresh', rootNodeId: ROOT, upserts: rows });

  const page = await list(fileKey);
  assert.deepEqual(page.nodes.map(n => n.nodeId), [ROOT, '2:1', '2:2']);
  assert.equal(page.truncated, undefined);
  for (const n of page.nodes) {
    assert.deepEqual(Object.keys(n).sort(), ['blocked', 'changeType', 'changedProps', 'changesKnown', 'claim', 'component', 'contentHash', 'figmaUrl',
      'isInstance', 'mainComponentId', 'name', 'nodeId', 'parentId', 'state', 'type']);
    assert.equal(n.changeType, 'added');
  }
  assert.deepEqual(page.nodes.map(n => [n.nodeId, n.changedProps, n.isInstance, n.mainComponentId]), [
    [ROOT, ['width'], false, null], ['2:1', ['characters', 'fontSize'], false, null], ['2:2', ['fills'], true, '9:1'],
  ]);
  assert.deepEqual(await listIds(fileKey, { instance: 'true' }), ['2:2']);
  assert.deepEqual(await listIds(fileKey, { q: 'instance:false' }), [ROOT, '2:1']);

  const diff = await list(fileKey, { changes: 'diff', under: '2:1' });
  assert.equal(diff.truncated, true);
  assert.deepEqual(diff.nodes[0].changes, {
    characters: { built: null, now: { truncated: true, bytes: long.length + 2 }, category: 'content' }, fontSize: { built: null, now: 14, category: 'typography' },
  });
  assert.equal((await node(fileKey, '2:1')).changes.characters.now, long);
  assert.deepEqual((await list(fileKey, { changes: 'names', fields: 'nodeId,changes,changedProps', under: '2:2' })).nodes, [{ nodeId: '2:2', changedProps: ['fills'] }]);
});

test('v3 viewer token: reads every GET, every write is 403 wrong_token_class', async () => {
  const fileKey = newFileKey();
  await seed(fileKey);
  for (const route of ['/v3/files', `/v3/files/${fileKey}`, `/v3/files/${fileKey}/scopes`, `/v3/files/${fileKey}/nodes`,
    `/v3/files/${fileKey}/nodes/2:1`, `/v3/files/${fileKey}/events`, `/v3/files/${fileKey}/summary`, `/v3/files/${fileKey}/work`]) {
    await ok(call('GET', route, { headers: viewer }));
  }
  await ok(call('GET', '/v3/resolve', { headers: viewer, query: { url: figmaLink(fileKey, '2:1') } }));

  const writes = [
    ['POST', `/v3/files/${fileKey}/clear`, { items: [{ nodeId: '2:1', contentHash: hashOf(NOW, '2:1') }] }],
    ['POST', `/v3/files/${fileKey}/claims`, { worker: 'viewer' }],
    ['POST', `/v3/files/${fileKey}/claims/00000000-0000-0000-0000-000000000000/renew`, {}],
    ['DELETE', `/v3/files/${fileKey}/claims/00000000-0000-0000-0000-000000000000`, undefined],
    ['POST', `/v3/files/${fileKey}/nodes/2:1/block`, { reason: 'viewer' }],
    ['POST', `/v3/files/${fileKey}/nodes/2:1/unblock`, {}],
  ];
  for (const [method, route, body] of writes) {
    const problem = assertProblem(await call(method, route, { headers: viewer, body }), 403, 'wrong_token_class');
    assert.match(problem.hint, /read-only/);
  }
  sameSet(await listIds(fileKey), DIRTY);
  assert.equal((await node(fileKey, '2:1')).claim, null);
});

test('v3 responses carry X-RDS-Server', async () => {
  const { version } = require('../apps/api/package.json');
  for (const res of [await call('GET', '/v3/files'), await call('GET', '/v3/files', { headers: {} }), await call('GET', '/v3/openapi.json', { headers: {} })]) {
    assert.equal(res.server, version);
  }
});

test('v3 plugin routes: a full sync as the plugin runs it', async () => {
  const dashed = id => id.replace(':', '-');
  const dashedUp = u => ({ ...u, nodeId: dashed(u.nodeId), parentId: u.parentId && dashed(u.parentId), path: u.path.map(dashed) });
  const client = { ...plugin, 'x-rds-client': 'plugin/e2e' };
  const fileKey = newFileKey();
  const url = { url: figmaLink(fileKey, ROOT) };
  const IDS = [...NOW.map(u => u.nodeId), '9:9'];

  // First scan: nothing stored yet, so the plugin baselines.
  assert.deepEqual(await ok(call('POST', `/v3/files/${fileKey}/exists`, { headers: client, body: { nodeIds: IDS.map(dashed) } })), { present: [], stale: [] });
  assert.deepEqual(await ok(call('GET', `/v3/files/${fileKey}/hashes`, { headers: client, query: { under: dashed(ROOT) } })), {});
  const baseline = await ok(call('POST', '/v3/files/-/sync', {
    headers: client, query: url, body: { fileName: 'E2E File', rootNodeId: dashed(ROOT), upserts: BUILT.map(dashedUp), markImplemented: true },
  }));
  assert.deepEqual(baseline, { fileKey, upserted: BUILT.length, dirty: 0, tombstoned: 0, skippedInstances: 0, baselined: BUILT.length });

  // Re-scan: send only what changed against the stored hashes, tombstone what vanished.
  const stored = await ok(call('GET', '/v3/files/-/hashes', { headers: client, query: url }));
  assert.deepEqual(Object.keys(stored).sort(), BUILT.map(u => u.nodeId).sort());
  const changed = NOW.filter(u => stored[u.nodeId] !== u.contentHash);
  const edit = await ok(call('POST', `/v3/files/${fileKey}/sync`, { headers: client, body: { fileName: 'E2E File', rootNodeId: ROOT, upserts: changed } }));
  assert.deepEqual(edit, { fileKey, upserted: changed.length, dirty: DIRTY.length, tombstoned: 0, skippedInstances: 0 });
  const gone = await ok(call('POST', `/v3/files/${fileKey}/sync`, { headers: client, body: { rootNodeId: ROOT, deletedNodeIds: ['2-3'] } }));
  assert.equal(gone.tombstoned, 1);

  const hashes = await hashesUnder(fileKey, ROOT);
  assert.deepEqual(Object.keys(hashes).sort(), NOW.map(u => u.nodeId).filter(id => id !== '2:3').sort());
  for (const u of NOW.filter(u => u.nodeId !== '2:3')) assert.equal(hashes[u.nodeId], u.contentHash);
  const present = await existing(fileKey, IDS);
  sameSet(present.present, NOW.map(u => u.nodeId).filter(id => id !== '2:3'));
  assert.deepEqual(present.stale, [], 'rows written by this server are never stale');

  // Agents see the work.
  sameSet(await listIds(fileKey), DIRTY); // the tombstoned 2:3 is still work: changeType deleted
  const caption = await node(fileKey, '2-3');
  assert.equal(caption.changeType, 'deleted');
  assert.equal(caption.deleted, true);
  assert.deepEqual(caption.attrs, NOW[4].attrs, 'the tombstone keeps its last-known attrs');

  const { events } = await ok(files(fileKey, '/events'));
  const syncs = events.filter(e => e.type === 'sync.completed');
  assert.equal(syncs.length, 3);
  for (const e of syncs) assert.equal(e.data.client, 'plugin/e2e');

  // Plugin tokens only.
  for (const headers of [agent, viewer]) {
    for (const [method, route, body] of [
      ['GET', `/v3/files/${fileKey}/hashes?under=1-1`, undefined],
      ['POST', `/v3/files/${fileKey}/sync`, { upserts: [] }],
      ['POST', `/v3/files/${fileKey}/exists`, { nodeIds: [] }],
    ]) {
      const res = await call(method, route, { headers, body });
      assertProblem(res, 403, 'wrong_token_class');
      assert.ok(res.server, 'X-RDS-Server');
    }
  }
});

// --- instance placements (docs/node-sync-design.md, "Instance placements") ------

/*
 * 1:1 SECTION Page
 * └─ 2:1 FRAME Card
 *    └─ 5:1 INSTANCE Button  (placement of main 10:1)
 * 10:1 COMPONENT Button      (definition, outside the page)
 * └─ 10:2 TEXT Label
 */
const INSTANCE = '5:1';
const MAIN = '10:1';
const MAIN_CHILD = '10:2';
const PLACEMENT_ATTRS = { x: 16, y: 8, componentProperties: { label: 'Go' } };
const MAIN_ATTRS = { width: 120, cornerRadius: 6 };
const instanceTree = (placement = PLACEMENT_ATTRS, main = MAIN_ATTRS) => [
  upsert(ROOT, 'SECTION', 'Page', { width: 1000 }),
  upsert('2:1', 'FRAME', 'Card', { paddingLeft: 16 }, [ROOT]),
  { ...upsert(INSTANCE, 'INSTANCE', 'Button', placement, [ROOT, '2:1']), isInstance: true, mainComponentId: MAIN },
  upsert(MAIN, 'COMPONENT', 'Button', main),
  upsert(MAIN_CHILD, 'TEXT', 'Label', { characters: 'Go' }, [MAIN]),
];

test('v3 instances: placements live in the page, the main once outside it; no fan-out; hash-guarded clear', async () => {
  const fileKey = newFileKey();
  const rows = instanceTree();
  const res = await batch(fileKey, { rootNodeId: ROOT, upserts: rows });
  assert.deepEqual(res, { fileKey, upserted: rows.length, dirty: rows.length, tombstoned: 0, skippedInstances: 0 });

  // The placement is a row in the page subtree under the frame it sits in; the main is not.
  sameSet(await listIds(fileKey, { under: ROOT }), [ROOT, '2:1', INSTANCE]);
  sameSet(await listIds(fileKey, { under: '2:1' }), ['2:1', INSTANCE]);
  sameSet(await listIds(fileKey, { under: MAIN }), [MAIN, MAIN_CHILD]);
  const inst = await node(fileKey, INSTANCE);
  assert.equal(inst.type, 'INSTANCE');
  assert.deepEqual([inst.isInstance, inst.mainComponentId], [true, MAIN]);
  assert.deepEqual(await listIds(fileKey, { instance: 'true' }), [INSTANCE]);
  assert.equal(inst.parentId, '2:1');
  assert.deepEqual(inst.path, [ROOT, '2:1', INSTANCE]);
  assert.deepEqual(inst.attrs, PLACEMENT_ATTRS);
  const main = await node(fileKey, MAIN);
  assert.equal(main.type, 'COMPONENT');
  assert.equal(main.parentId, null);
  assert.equal((await hashesUnder(fileKey, ROOT))[INSTANCE], rows[2].contentHash, 'the plugin hash map includes the placement');
  sameSet((await existing(fileKey, [MAIN, INSTANCE, '99:99'])).present, [MAIN, INSTANCE]);

  // Clear everything, then edit only the main: the main is dirty, the placement is not.
  const all = await ok(call('POST', `/v3/files/${fileKey}/clear`, { body: { commitRef: 'init', items: rows.map(u => ({ nodeId: u.nodeId, contentHash: u.contentHash })) } }));
  assert.equal(all.totals.cleared, rows.length);
  const editedMain = instanceTree(PLACEMENT_ATTRS, { ...MAIN_ATTRS, width: 160 });
  const mainEdit = await batch(fileKey, { upserts: [editedMain[3], editedMain[2]] });
  assert.deepEqual(mainEdit, { fileKey, upserted: 2, dirty: 1, tombstoned: 0, skippedInstances: 0 });
  assert.deepEqual(await listIds(fileKey, { under: MAIN }), [MAIN]);
  assert.deepEqual(await listIds(fileKey, { under: ROOT }), [], 'the page (with the instance) stays clean');

  // A placement edit dirties only the instance; clearing it is hash-guarded.
  const moved = instanceTree({ ...PLACEMENT_ATTRS, componentProperties: { label: 'Submit' } })[2];
  await batch(fileKey, { upserts: [moved] });
  assert.deepEqual(await listIds(fileKey, { under: ROOT }), [INSTANCE]);
  const again = await node(fileKey, INSTANCE);
  assert.equal(again.changeType, 'modified');
  assert.equal(again.history.implementedHash, rows[2].contentHash);
  const guarded = await ok(call('POST', `/v3/files/${fileKey}/clear`, {
    body: { commitRef: 'inst', items: [{ nodeId: INSTANCE, contentHash: rows[2].contentHash }] },
  }));
  assert.deepEqual(guarded.results, [{ nodeId: INSTANCE, status: 'stale', contentHash: moved.contentHash }]);
  const cleared = await ok(call('POST', `/v3/files/${fileKey}/clear`, { body: { commitRef: 'inst', items: [{ nodeId: INSTANCE, contentHash: moved.contentHash }] } }));
  assert.equal(cleared.totals.cleared, 1);
  const done = await node(fileKey, INSTANCE);
  assert.equal(done.state, 'clean');
  assert.equal(done.history.implementedCommit, 'inst');
  assert.deepEqual(await listIds(fileKey, { under: MAIN }), [MAIN], 'clearing the instance does not touch the main');
});

// --- expand=instances (docs/api-v3-agent-ergonomics.md, "4.") -------------------

test('v3 expand=instances: one call returns everything a synced screen uses, on the listing, summary and work', async () => {
  const fileKey = newFileKey();
  // The screen (2:1) places Button twice; Button contains an Icon instance; Icon's main is never synced.
  const rows = [
    upsert(ROOT, 'SECTION', 'Page', { width: 1000 }),
    upsert('2:1', 'FRAME', 'Screen', { paddingLeft: 16 }, [ROOT]),
    { ...upsert('5:1', 'INSTANCE', 'Button', { x: 0 }, [ROOT, '2:1']), isInstance: true, mainComponentId: '10:1' },
    { ...upsert('5:2', 'INSTANCE', 'Button', { x: 40 }, [ROOT, '2:1']), isInstance: true, mainComponentId: '10:1' },
    upsert('10:1', 'COMPONENT', 'Button', { width: 120 }),
    { ...upsert('10:2', 'INSTANCE', 'Icon', { size: 16 }, ['10:1']), isInstance: true, mainComponentId: '20:1' },
    upsert('20:1', 'COMPONENT', 'Icon', { size: 16 }),
    upsert('20:2', 'VECTOR', 'Glyph', { strokeWeight: 1 }, ['20:1']),
    { ...upsert('20:3', 'INSTANCE', 'Dot', { size: 2 }, ['20:1']), isInstance: true, mainComponentId: '99:9' },
  ];
  await batch(fileKey, { rootNodeId: ROOT, upserts: rows });

  const via = (instanceId, mainComponentId, depth) => ({ instanceId, mainComponentId, depth });
  const page = await list(fileKey, { under: '2:1', expand: 'instances', fields: 'nodeId,via' });
  assert.deepEqual(page.nodes, [
    { nodeId: '2:1', via: null }, { nodeId: '5:1', via: null }, { nodeId: '5:2', via: null },
    { nodeId: '10:1', via: via('5:1', '10:1', 1) }, { nodeId: '10:2', via: via('5:1', '10:1', 1) },
    { nodeId: '20:1', via: via('10:2', '20:1', 2) }, { nodeId: '20:2', via: via('10:2', '20:1', 2) }, { nodeId: '20:3', via: via('10:2', '20:1', 2) },
  ]);
  assert.deepEqual(page.expansion, { components: 2, truncated: false, unresolved: ['99:9'] });

  const paged = [];
  let cursor;
  do {
    const p = await list(fileKey, { under: '2:1', expand: 'instances', fields: 'nodeId', limit: 3, ...(cursor ? { cursor } : {}) });
    paged.push(...p.nodes.map(n => n.nodeId));
    cursor = p.nextCursor;
  } while (cursor);
  assert.deepEqual(paged, page.nodes.map(n => n.nodeId));
  assert.deepEqual(await listIds(fileKey, { under: '2:1', expand: 'instances', expandDepth: 1, type: 'COMPONENT' }), ['10:1']);

  const summary = await ok(files(fileKey, '/summary', { query: { under: '2:1', expand: 'instances' } }));
  assert.equal(summary.total, page.nodes.length);
  assert.deepEqual(summary.expansion, page.expansion);

  const work = await ok(files(fileKey, '/work', { query: { under: '2:1', expand: 'instances', changes: 'names' } }));
  assert.deepEqual(work.items.map(i => [i.key, i.placements, i.placementsInScope]), [['10:1', 2, 2], ['20:1', 1, 1], [null, null, null]]);

  assertProblem(await files(fileKey, '/nodes', { query: { under: '2:1', expandDepth: 2 } }), 400, 'invalid_parameter');
});

test('v3 under with several subtree roots: the union on the listing, outline, summary, work and claims; expand from every root', async () => {
  const fileKey = newFileKey();
  // Two screens place Button; Screen B also places Icon.
  const rows = [
    upsert(ROOT, 'SECTION', 'Page', { width: 1000 }),
    upsert('2:1', 'FRAME', 'Screen A', { paddingLeft: 16 }, [ROOT]),
    { ...upsert('5:1', 'INSTANCE', 'Button', { x: 0 }, [ROOT, '2:1']), isInstance: true, mainComponentId: '10:1' },
    upsert('2:2', 'FRAME', 'Screen B', { paddingLeft: 8 }, [ROOT]),
    { ...upsert('5:2', 'INSTANCE', 'Button', { x: 40 }, [ROOT, '2:2']), isInstance: true, mainComponentId: '10:1' },
    { ...upsert('5:3', 'INSTANCE', 'Icon', { size: 16 }, [ROOT, '2:2']), isInstance: true, mainComponentId: '20:1' },
    upsert('10:1', 'COMPONENT', 'Button', { width: 120 }),
    upsert('20:1', 'COMPONENT', 'Icon', { size: 16 }),
  ];
  await batch(fileKey, { rootNodeId: ROOT, upserts: rows });

  const both = ['2:2', '5:2', '5:3', '2:1', '5:1'];
  assert.deepEqual(await listIds(fileKey, { under: '2:2,2:1' }), both, 'roots in the order given, document order within each');
  assert.deepEqual(await listIds(fileKey, { under: '2-1, 2:2' }), ['2:1', '5:1', '2:2', '5:2', '5:3']);
  assert.deepEqual(await listIds(fileKey, { q: 'under:2:2,2:1' }), both);
  assert.deepEqual(await listIds(fileKey, { under: `${ROOT},2:1`, depth: 1 }), [ROOT, '2:1', '2:2', '5:1'], 'depth below each root; overlaps once');
  const paged = [];
  let cursor;
  do {
    const p = await list(fileKey, { under: '2:2,2:1', fields: 'nodeId', limit: 2, ...(cursor ? { cursor } : {}) });
    assert.equal(p.total, both.length);
    paged.push(...p.nodes.map(n => n.nodeId));
    cursor = p.nextCursor;
  } while (cursor);
  assert.deepEqual(paged, both);

  const outline = await files(fileKey, '/nodes', { query: { under: '2:2,2:1', format: 'outline' } });
  assert.equal(outline.status, 200, JSON.stringify(outline.body));
  assert.deepEqual(outline.body.raw.split('\n').slice(0, -1), [
    'Screen B (FRAME) · added',
    '  Button (INSTANCE → 10:1 Button) · added',
    '  Icon (INSTANCE → 20:1 Icon) · added',
    'Screen A (FRAME) · added',
    '  Button (INSTANCE → 10:1 Button) · added',
  ]);

  const unknown = assertProblem(await files(fileKey, '/nodes', { query: { under: '2:1,77:77' } }), 404, 'node_not_found');
  assert.match(unknown.detail, /77:77/);
  assertProblem(await files(fileKey, '/nodes', { query: { under: Array(51).fill('2:1').join(',') } }), 400, 'invalid_parameter');

  const summary = await ok(files(fileKey, '/summary', { query: { under: '2:1,2:2' } }));
  assert.equal(summary.total, both.length);
  assert.equal(summary.byFrame, undefined);
  const frame = assertProblem(await files(fileKey, '/work', { query: { group: 'frame', under: '2:1,2:2' } }), 400, 'invalid_parameter');
  assert.match(frame.hint, /one under/);
  const work = await ok(files(fileKey, '/work', { query: { under: '2:1,2:2', changes: 'names' } }));
  assert.equal(work.items.reduce((sum, i) => sum + i.nodeCount, 0), both.length);

  const expanded = await list(fileKey, { under: '2:1,2:2', expand: 'instances', fields: 'nodeId' });
  assert.deepEqual(expanded.nodes.map(n => n.nodeId), ['2:1', '5:1', '2:2', '5:2', '5:3', '10:1', '20:1'], 'each reachable component once');
  assert.equal(expanded.expansion.components, 2);

  const leased = await ok(call('POST', `/v3/files/${fileKey}/claims`, { body: { worker: 'e2e-multi', ttlSeconds: 600, filter: { under: '2:2,2:1', type: 'INSTANCE' } } }));
  assert.deepEqual(leased.nodes.map(n => n.nodeId), ['5:2', '5:3', '5:1']);
});

test('v3 format=outline: a synced screen as an indented tree, components nested under their first instance', async () => {
  const fileKey = newFileKey();
  const rows = [
    upsert(ROOT, 'SECTION', 'Page', { width: 1000 }),
    upsert('2:1', 'FRAME', 'Screen', { paddingLeft: 16 }, [ROOT]),
    { ...upsert('5:1', 'INSTANCE', 'Button', { x: 0 }, [ROOT, '2:1']), isInstance: true, mainComponentId: '10:1' },
    { ...upsert('5:2', 'INSTANCE', 'Button', { x: 40 }, [ROOT, '2:1']), isInstance: true, mainComponentId: '10:1' },
    upsert('10:1', 'COMPONENT', 'Button', { width: 120 }),
    { ...upsert('10:2', 'INSTANCE', 'Icon', { size: 16 }, ['10:1']), isInstance: true, mainComponentId: '20:1' },
    upsert('20:1', 'COMPONENT', 'Icon', { size: 16 }),
    upsert('20:2', 'VECTOR', 'Glyph', { strokeWeight: 1 }, ['20:1']),
  ];
  await batch(fileKey, { rootNodeId: ROOT, upserts: rows });
  const outlinePage = async ({ work, ...query }) => {
    const res = await files(fileKey, work ? '/work' : '/nodes', { query: { format: 'outline', ...query } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.contentType, /^text\/plain/);
    return { lines: res.body.raw.split('\n').slice(0, -1), next: res.nextCursor };
  };
  const outline = async query => (await outlinePage(query)).lines;

  assert.deepEqual(await outline({ under: '2:1' }), [
    'Screen (FRAME) · added',
    '  Button (INSTANCE → 10:1 Button) · added',
    '  Button (INSTANCE → 10:1 Button) · added',
  ]);
  assert.deepEqual(await outline({ url: figmaLink(fileKey, '2:1'), expand: 'instances' }), [
    'Screen (FRAME) · added',
    '  Button (INSTANCE → 10:1 Button) · added',
    '    ↳ Button (COMPONENT) · added',
    '      Icon (INSTANCE → 20:1 Icon) · added',
    '        ↳ Icon (COMPONENT) · added',
    '          Glyph (VECTOR) · added',
    '  Button (INSTANCE → 10:1 (shown above)) · added',
  ]);
  const first = await outlinePage({ under: '2:1', expand: 'instances', limit: 4 });
  assert.deepEqual(first.lines, [
    'Screen (FRAME) · added',
    '  Button (INSTANCE → 10:1 Button) · added',
    '    ↳ Button (COMPONENT) · added',
    '      Icon (INSTANCE → 20:1 Icon) · added',
  ], 'limit counts rendered lines of the whole tree');
  assert.ok(first.next, 'X-RDS-Next-Cursor names the next lines');
  const rest = await outlinePage({ under: '2:1', expand: 'instances', cursor: first.next });
  assert.deepEqual(rest.lines, [
    '        ↳ Icon (COMPONENT) · added',
    '          Glyph (VECTOR) · added',
    '  Button (INSTANCE → 10:1 (shown above)) · added',
  ], 'a later page keeps its nesting and (shown above)');
  assert.equal(rest.next, null);
  assertProblem(await files(fileKey, '/nodes', { query: { format: 'outline', under: '2:1', cursor: first.next } }), 400, 'invalid_cursor');
  assert.deepEqual(await outline({ work: true, under: '2:1', expand: 'instances', changes: 'names' }), [
    'Button (COMPONENT) · 2 nodes · changed (2: size, width) · 2 placements · 2 in scope',
    '  Button (COMPONENT) · added',
    '    Icon (INSTANCE → 20:1 Icon) · added',
    'Icon (COMPONENT) · 2 nodes · changed (2: size, strokeWeight) · 1 placement · 1 in scope',
    '  Icon (COMPONENT) · added',
    '    Glyph (VECTOR) · added',
    '(no component) · 3 nodes · changed (2: paddingLeft, x)',
    '  Screen (FRAME) · added',
    '    Button (INSTANCE → 10:1 Button) · added',
    '    Button (INSTANCE → 10:1 Button) · added',
  ]);
  assertProblem(await files(fileKey, '/nodes', { query: { format: 'outline', sort: 'name' } }), 400, 'invalid_parameter');
});

test('v3 document order: listing and outline follow the design\'s layer order, not node ids, and re-rank after a sync', async () => {
  const fileKey = newFileKey();
  const at = (x, y) => ({ relativeTransform: [[1, 0, x], [0, 1, y]] });
  const page = childOrder => upsert(ROOT, 'FRAME', 'Page', { layoutMode: 'VERTICAL', childOrder });
  await batch(fileKey, {
    rootNodeId: ROOT, upserts: [
      page(['1:99000', '1:95723', '1:94997']),
      upsert('1:95723', 'FRAME', 'Page header', { childOrder: ['4:2', '4:1'] }, [ROOT]),
      upsert('4:1', 'TEXT', 'Title', { characters: 'Orders', ...at(0, 0) }, [ROOT, '1:95723']),
      upsert('4:2', 'TEXT', 'Subtitle', { characters: 'All', ...at(0, 40) }, [ROOT, '1:95723']),
      upsert('1:94997', 'FRAME', 'Table', { layoutMode: 'VERTICAL', childOrder: ['5:2', '5:1'] }, [ROOT]),
      upsert('5:1', 'FRAME', 'Row A', { height: 40 }, [ROOT, '1:94997']),
      upsert('5:2', 'FRAME', 'Row B', { height: 40 }, [ROOT, '1:94997']),
      upsert('1:99000', 'FRAME', 'Badge', { layoutPositioning: 'ABSOLUTE', ...at(900, 0) }, [ROOT]),
    ],
  });
  const DOCUMENT = [ROOT, '1:95723', '4:1', '4:2', '1:94997', '5:2', '5:1', '1:99000'];
  assert.deepEqual(await listIds(fileKey, { state: 'all' }), DOCUMENT);
  assert.deepEqual(await listIds(fileKey, { state: 'all', sort: 'path' }), [ROOT, '1:94997', '5:1', '5:2', '1:95723', '4:1', '4:2', '1:99000']);
  const paged = [];
  let cursor = null;
  do {
    const body = await list(fileKey, { state: 'all', limit: 3, ...(cursor ? { cursor } : {}) });
    paged.push(...body.nodes.map(n => n.nodeId));
    cursor = body.nextCursor;
  } while (cursor);
  assert.deepEqual(paged, DOCUMENT);

  const outline = async () => {
    const res = await files(fileKey, '/nodes', { query: { format: 'outline', state: 'all' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.raw.split('\n').slice(0, -1);
  };
  assert.deepEqual(await outline(), [
    'Page (FRAME) · added',
    '  Page header (FRAME) · added',
    '    Title (TEXT) · added',
    '    Subtitle (TEXT) · added',
    '  Table (FRAME) · added',
    '    Row B (FRAME) · added',
    '    Row A (FRAME) · added',
    '  Badge (FRAME) (absolute) · added',
  ]);
  const work = await ok(files(fileKey, '/work', { query: { state: 'all', group: 'frame', under: ROOT } }));
  assert.deepEqual(work.items.map(i => i.key), ['1:95723', '1:94997', '1:99000', null]);
  const summary = await ok(files(fileKey, '/summary', { query: { state: 'all', under: ROOT } }));
  assert.deepEqual(summary.byFrame.map(f => f.nodeId), ['1:95723', '1:94997', '1:99000']);

  // The Table moves above the header; the Title moves below the Subtitle.
  await batch(fileKey, { upserts: [page(['1:94997', '1:95723', '1:99000']), upsert('4:1', 'TEXT', 'Title', { characters: 'Orders', ...at(0, 80) }, [ROOT, '1:95723'])] });
  assert.deepEqual(await listIds(fileKey, { state: 'all' }), [ROOT, '1:94997', '5:2', '5:1', '1:95723', '4:2', '4:1', '1:99000']);
});

// --- first-scan baseline (markImplemented) ------------------------------------

test('v3 sync markImplemented: never-seen nodes are baselined clean; existing and tombstoned rows are untouched', async () => {
  const fileKey = newFileKey();
  const bad = await sync(fileKey, { upserts: BUILT, markImplemented: 'yes' });
  assertProblem(bad, 400, 'invalid_parameter');
  assert.deepEqual(await hashesUnder(fileKey, ROOT), {}, 'a rejected sync writes nothing');

  // Existing dirty rows: 2:1 + 3:1 synced without the flag, then 3:1 tombstoned.
  await batch(fileKey, { upserts: BUILT.slice(1, 3) });
  assert.equal((await batch(fileKey, { deletedNodeIds: ['3:1'] })).tombstoned, 1);

  const res = await batch(fileKey, { upserts: BUILT, markImplemented: true });
  assert.deepEqual(res, { fileKey, upserted: BUILT.length, dirty: 2, tombstoned: 0, skippedInstances: 0, baselined: BUILT.length - 2 });
  sameSet(await listIds(fileKey), ['2:1', '3:1']);
  for (const id of ['2:1', '3:1']) {
    const n = await node(fileKey, id);
    assert.equal(n.changeType, 'added');
    assert.equal(n.history.implementedHash, null);
    assert.equal(n.deleted, false, 'the tombstone is revived exactly as without the flag');
  }

  // Baselined rows carry the baseline commit; a later edit diffs against it.
  await batch(fileKey, { upserts: [NOW[3]] });
  const title = await node(fileKey, '2:2');
  assert.equal(title.changeType, 'modified');
  assert.equal(title.history.implementedHash, BUILT[3].contentHash);
  assert.equal(title.history.implementedCommit, 'baseline');
  assert.deepEqual(title.changes, { characters: { built: 'Hi', now: 'Hello', category: 'content' } });

  assert.equal((await batch(fileKey, { upserts: BUILT, markImplemented: true })).baselined, 0, 'a second flagged scan baselines nothing');
});

// --- capture-version staleness --------------------------------------------------

test('v3 exists: rows stored by an older capture version are stale until re-synced', async t => {
  const fileKey = newFileKey();
  await batch(fileKey, { upserts: BUILT });
  const ids = BUILT.map(u => u.nodeId);
  const fresh = await existing(fileKey, [...ids, '9:9']);
  sameSet(fresh.present, ids);
  assert.deepEqual(fresh.stale, [], 'rows written by this server are never stale');
  await batch(fileKey, { deletedNodeIds: ['2:3'] });
  assert.deepEqual((await existing(fileKey, ['2:3', '2:1'])).present, ['2:1'], 'tombstoned rows are not present');

  // Only Postgres is reachable from outside the API; PGlite and the container are not.
  if (!process.env.DATABASE_URL) return t.diagnostic('no DATABASE_URL: older capture versions not seeded');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  t.after(() => db.end());
  await db.query("update node set capture_version = 1 where file_key = $1 and node_id in ('2:1', '2:2')", [fileKey]);
  const before = await existing(fileKey, ids);
  sameSet(before.stale, ['2:1', '2:2']);
  await batch(fileKey, { upserts: [BUILT[1]] });
  assert.deepEqual((await existing(fileKey, ids)).stale, ['2:2'], 're-syncing a stale row stamps the current version');
});

test('rate limits: a burst over the per-IP limit gets 429 rate_limited, then recovers after Retry-After', async t => {
  const route = `${API}/v3/openapi.json`;
  const probe = await fetch(route);
  await probe.arrayBuffer();
  const limit = Number(probe.headers.get('ratelimit-limit'));
  if (!limit) return t.skip('the per-IP limit is off (RDS_STORE modes default to 0)');
  let limited = null;
  for (let i = 0; i < limit + 1 && !limited; i++) {
    const res = await fetch(route);
    if (res.status === 429) limited = res;
    else { assert.equal(res.status, 200); await res.arrayBuffer(); }
  }
  assert.ok(limited, `no 429 within ${limit + 1} requests`);
  assert.match(limited.headers.get('content-type'), /^application\/problem\+json/);
  const body = await limited.json();
  assert.equal(body.code, 'rate_limited');
  assert.equal(typeof body.hint, 'string');
  assert.ok(ERRORS_MD.includes('<a id="rate-limited"></a>'));
  const retryAfter = Number(limited.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);
  assert.equal(body.retryAfter, retryAfter);
  assert.equal(limited.headers.get('ratelimit-remaining'), '0');
  assert.equal((await fetch(`${API}/health`)).status, 200, '/health is exempt');
  await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 250));
  const after = await fetch(route);
  await after.arrayBuffer();
  assert.equal(after.status, 200, 'the budget is back once the window ends');
});
