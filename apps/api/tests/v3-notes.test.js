'use strict';

/*
 * v3 node notes (docs/api-v3-design.md, "Node notes") — against the memory
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
const { openLocalStore } = require('../src/store/pglite');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };
const FK = 'AbCdEf123456GhIjKl7890';

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}
const R = ['1:1'];
const TREE = v => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: v ? 24 : 16 }, R),
  up('2:2', 'FRAME', 'Header', { itemSpacing: 8 }, R),
  up('2:3', 'TEXT', 'Title', { characters: 'Hi' }, R),
];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-notes-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

/** A built file whose 2:1 then changed: 2:1 dirty, the rest clean. */
async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({
    store,
    config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN }),
  });
  await sync(app, { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE(false), markImplemented: true });
  await sync(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE(true) });
  return { app, close: async () => { await app.close(); await cleanup(); } };
}

async function sync(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: { fileKey: FK, ...body } });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

const call = (app, method, url, { headers = agent, payload } = {}) =>
  app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const addNote = (app, nodeId, payload, headers = agent) => call(app, 'POST', `/v3/files/${FK}/nodes/${nodeId}/notes`, { payload, headers });
const notesOf = async (app, nodeId, qs = '') => ok(await call(app, 'GET', `/v3/files/${FK}/nodes/${nodeId}/notes${qs}`)).notes;
const getNode = async (app, nodeId) => ok(await call(app, 'GET', `/v3/files/${FK}/nodes/${nodeId}`));
const listIds = async (app, qs = '') => ok(await call(app, 'GET', `/v3/files/${FK}/nodes?${qs}`)).nodes.map(n => n.nodeId);
const events = async app => ok(await call(app, 'GET', `/v3/files/${FK}/events?limit=1000`)).events;
const clear = async (app, items) => ok(await call(app, 'POST', `/v3/files/${FK}/clear`, { payload: { commitRef: 'c1', items } }));
const hashOf = nodeId => TREE(true).find(n => n.nodeId === nodeId).contentHash;

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  assert.equal(res.json().code, code, res.body);
}

for (const kind of Object.keys(STORES)) {
  test(`node notes (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    let viewerNote;

    await t.test('a viewer note dirties a clean node as requested; events never carry the body', async () => {
      assert.deepEqual(await listIds(app), ['2:1']);
      const trends = async () => ok(await call(app, 'GET', `/v3/insights/trends?fileKey=${FK}`)).total.dirtied;
      const dirtiedBefore = await trends();
      const res = ok(await addNote(app, '2-2', { body: 'Spacing should be 12px' }, viewer));
      assert.equal(await trends(), dirtiedBefore + 1, 'a note on a clean node counts as dirtied');
      viewerNote = res.note;
      assert.equal(res.fileKey, FK);
      assert.equal(res.note.status, 'open');
      assert.equal(res.note.nodeId, '2:2');
      assert.equal(res.node.state, 'dirty');
      assert.equal(res.node.changeType, 'requested');
      assert.deepEqual(res.node.changedProps, []);
      assert.deepEqual(res.node.notes, [{ noteId: res.note.noteId, body: 'Spacing should be 12px', author: res.note.author, createdAt: res.note.createdAt }]);

      assert.deepEqual(await listIds(app), ['2:1', '2:2']);
      assert.deepEqual(await listIds(app, 'state=requested'), ['2:2']);
      assert.deepEqual(await listIds(app, 'changeType=requested'), ['2:2']);
      assert.deepEqual(await listIds(app, 'state=all&hasNotes=true'), ['2:2']);
      assert.deepEqual(await listIds(app, 'hasNotes=false'), ['2:1']);
      const detail = await getNode(app, '2:2');
      assert.equal(detail.notesResolved, 0);
      assert.equal(detail.notes.length, 1);

      const added = (await events(app)).filter(e => e.type === 'note.added');
      assert.equal(added.length, 1);
      assert.deepEqual(added[0].data, { nodeId: '2:2', noteId: res.note.noteId, author: res.note.author, dirtied: true });
      assert.ok(!JSON.stringify(await events(app)).includes('Spacing should be 12px'));
    });

    await t.test('re-sync keeps a noted node dirty; a design change keeps its type and adds the note category', async () => {
      await sync(app, { rootNodeId: '1:1', upserts: TREE(true) });
      assert.equal((await getNode(app, '2:2')).changeType, 'requested');
      const res = ok(await addNote(app, '2:1', { body: 'Card corners are square', worker: 'w-1' }));
      assert.equal(res.node.changeType, 'modified');
      assert.equal(res.note.worker, 'w-1');
      assert.equal((await getNode(app, '2:1')).notes.length, 1);
      const work = ok(await call(app, 'GET', `/v3/files/${FK}/work`));
      assert.equal(work.items.reduce((sum, i) => sum + i.notes, 0), 2);
      const summary = ok(await call(app, 'GET', `/v3/files/${FK}/summary`));
      assert.equal(summary.byChangeType.requested, 1);
    });

    await t.test('authors edit and delete their own open notes; agents dismiss any', async () => {
      const mine = ok(await addNote(app, '2:3', { body: 'Wrong weight' })).note;
      assertProblem(await call(app, 'PATCH', `/v3/files/${FK}/notes/${mine.noteId}`, { headers: viewer, payload: { body: 'x' } }), 403, 'forbidden');
      assertProblem(await call(app, 'DELETE', `/v3/files/${FK}/notes/${mine.noteId}`, { headers: viewer }), 403, 'forbidden');
      assertProblem(await call(app, 'POST', `/v3/files/${FK}/notes/${mine.noteId}/dismiss`, { headers: viewer, payload: {} }), 403, 'forbidden');
      const edited = ok(await call(app, 'PATCH', `/v3/files/${FK}/notes/${mine.noteId}`, { payload: { body: 'Wrong font weight' } }));
      assert.equal(edited.note.body, 'Wrong font weight');
      assert.deepEqual((await notesOf(app, '2:3')).map(n => n.body), ['Wrong font weight']);

      const deleted = ok(await call(app, 'DELETE', `/v3/files/${FK}/notes/${mine.noteId}`));
      assert.equal(deleted.deleted, true);
      assert.equal(deleted.node.state, 'clean');
      assert.equal(deleted.node.changeType, null);
      assertProblem(await call(app, 'DELETE', `/v3/files/${FK}/notes/${mine.noteId}`), 404, 'note_not_found');

      const again = ok(await addNote(app, '2:3', { body: 'Still wrong' }, viewer)).note;
      const dismissed = ok(await call(app, 'POST', `/v3/files/${FK}/notes/${again.noteId}/dismiss`, { payload: { reason: 'Matches the design' } }));
      assert.equal(dismissed.note.status, 'dismissed');
      assert.equal(dismissed.node.state, 'clean');
      assertProblem(await call(app, 'PATCH', `/v3/files/${FK}/notes/${again.noteId}`, { headers: viewer, payload: { body: 'y' } }), 400, 'invalid_parameter');
      const ev = (await events(app)).find(e => e.type === 'note.dismissed');
      assert.deepEqual(ev.data, { nodeId: '2:3', noteId: again.noteId, author: again.author, reason: 'Matches the design' });
      assert.deepEqual((await notesOf(app, '2:3', '?status=all')).map(n => n.status), ['dismissed']);
    });

    await t.test('a stale clear resolves nothing; a clear resolves the cleared nodes\' notes', async () => {
      const stale = await clear(app, [{ nodeId: '2:2', contentHash: 'stale' }]);
      assert.equal(stale.totals.cleared, 0);
      assert.equal((await notesOf(app, '2:2')).length, 1);

      const done = await clear(app, [{ nodeId: '2:2', contentHash: hashOf('2:2') }]);
      assert.equal(done.totals.cleared, 1);
      const node = await getNode(app, '2:2');
      assert.equal(node.state, 'clean');
      assert.deepEqual(node.notes, []);
      assert.equal(node.notesResolved, 1);
      const [resolved] = await notesOf(app, '2:2', '?status=all');
      assert.equal(resolved.status, 'resolved');
      assert.equal(resolved.commitRef, 'c1');
      const ev = (await events(app)).find(e => e.type === 'note.resolved');
      assert.deepEqual(ev.data, { nodeId: '2:2', noteId: viewerNote.noteId, author: viewerNote.author });
    });

    await t.test('errors: unknown node or note, deleted node, blank body; viewers stay read-only elsewhere', async () => {
      assertProblem(await addNote(app, '9:9', { body: 'x' }), 404, 'node_not_found');
      assertProblem(await addNote(app, '2:1', { body: '   ' }), 400, 'invalid_body');
      assertProblem(await addNote(app, '2:1', { body: 'x'.repeat(4001) }), 400, 'invalid_parameter');
      assertProblem(await call(app, 'POST', `/v3/files/${FK}/notes/00000000-0000-4000-8000-000000000000/dismiss`, { payload: {} }), 404, 'note_not_found');
      assertProblem(await call(app, 'DELETE', `/v3/files/${FK}/notes/not-a-uuid`), 404, 'note_not_found');
      await sync(app, { rootNodeId: '1:1', upserts: TREE(true).filter(n => n.nodeId !== '2:3'), deletedNodeIds: ['2:3'] });
      assertProblem(await addNote(app, '2:3', { body: 'x' }), 400, 'invalid_parameter');
      const claim = await call(app, 'POST', `/v3/files/${FK}/claims`, { headers: viewer, payload: { worker: 'v', nodeIds: ['2:1'] } });
      assert.equal(claim.statusCode, 403, claim.body);
    });
  });
}
