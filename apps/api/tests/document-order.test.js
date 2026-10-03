'use strict';

/*
 * Document order (docs/api-v3-agent-ergonomics.md, "9. Document order"): the
 * pure sibling rank, order-key maintenance on sync and at startup, and the v3
 * surfaces that promise tree order — against the memory store and PGlite
 * (same SQL as Postgres).
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
const { rankChildren, documentSortKey, childKey, ROOT_KEY } = require('../src/documentOrder');
const { backfillDocumentOrder } = require('../src/maintenance');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };

const at = (x, y) => ({ relativeTransform: [[1, 0, x], [0, 1, y]] });
const kid = (nodeId, attrs = {}) => ({ nodeId, attrs });

test('rank: auto-layout puts flow children in childOrder order, then absolute ones', () => {
  for (const layoutMode of ['HORIZONTAL', 'VERTICAL', 'GRID']) {
    const parent = { layoutMode, childOrder: ['a', 'b', 'c', 'd'] };
    const kids = [kid('d', at(0, 0)), kid('b', { layoutPositioning: 'ABSOLUTE', ...at(0, 0) }), kid('c', at(0, -50)), kid('a', at(0, 90))];
    assert.deepEqual(rankChildren(parent, kids), ['a', 'c', 'd', 'b'], layoutMode);
  }
});

test('rank: free-form parents read top to bottom, left to right; equal positions tie by childOrder', () => {
  const kids = [kid('a', at(0, 100)), kid('b', at(50, 0)), kid('c', at(10, 0)), kid('d', at(10, 0)), kid('e', at(-5, 100))];
  const expected = ['d', 'c', 'b', 'e', 'a'];
  assert.deepEqual(rankChildren({ childOrder: ['e', 'd', 'c', 'b', 'a'] }, kids), expected);
  assert.deepEqual(rankChildren({ layoutMode: 'NONE', childOrder: ['e', 'd', 'c', 'b', 'a'] }, kids), expected);
  assert.deepEqual(rankChildren({ childOrder: ['a', 'b', 'c', 'd', 'e'] }, kids), ['c', 'd', 'b', 'e', 'a']);
});

test('rank: free-form children without a transform go after, by childOrder', () => {
  const kids = [kid('a'), kid('b', at(0, 500)), kid('c', { relativeTransform: 'bogus' }), kid('d', at(0, 1))];
  assert.deepEqual(rankChildren({ childOrder: ['c', 'a', 'b', 'd'] }, kids), ['d', 'b', 'c', 'a']);
});

test('rank: children missing from a stale childOrder go last, by node id', () => {
  const kids = [kid('z', at(0, 0)), kid('b', at(0, 9)), kid('y', at(0, -9)), kid('a', at(0, 5))];
  assert.deepEqual(rankChildren({ childOrder: ['gone', 'b', 'a'] }, kids), ['a', 'b', 'y', 'z']);
  assert.deepEqual(rankChildren({ layoutMode: 'VERTICAL', childOrder: ['gone', 'b', 'a'] }, kids), ['b', 'a', 'y', 'z']);
  assert.deepEqual(rankChildren(null, kids), ['a', 'b', 'y', 'z']);
  assert.deepEqual(rankChildren({}, []), []);
});

test('order keys: child keys pad ranks; the sort key is root path then key (path alone without one)', () => {
  assert.equal(ROOT_KEY, '00000');
  assert.equal(childKey(childKey(ROOT_KEY, 0), 12), '00000.00000.00012');
  const p = buildPath('3:1', ['1:1', '2:1']);
  assert.equal(documentSortKey({ path: p, orderKey: '00000.00001.00000' }), '1_3a1 00000.00001.00000');
  assert.equal(documentSortKey({ path: p, orderKey: '00000' }), `${p} 00000`);
  assert.equal(documentSortKey({ path: p, orderKey: null }), `${p} `);
  assert.equal(documentSortKey({ path: null, orderKey: null }), '');
});

// --- the stores ---------------------------------------------------------------------

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}

/*
 * Node ids are not document order (the Figma file this came from: Page header
 * 1:95723 sits above Table 1:94997).
 *
 * 1:1 FRAME Page (VERTICAL; childOrder Badge, Page header, Table)
 * ├─ 1:95723 FRAME Page header (free-form)
 * │  ├─ 4:1 TEXT Title       y 0
 * │  └─ 4:2 TEXT Subtitle    y 40
 * ├─ 1:94997 FRAME Table (VERTICAL; childOrder Row B, Row A)
 * │  ├─ 5:2 FRAME Row B
 * │  └─ 5:1 FRAME Row A
 * │     └─ 6:1 TEXT Cell
 * └─ 1:99000 FRAME Badge (absolute)
 */
const R = ['1:1'];
const HEADER = [...R, '1:95723'];
const TABLE = [...R, '1:94997'];
const page = childOrder => up('1:1', 'FRAME', 'Page', { layoutMode: 'VERTICAL', childOrder });
const title = y => up('4:1', 'TEXT', 'Title', { characters: 'Orders', ...at(0, y) }, HEADER);
const TREE = () => [
  page(['1:99000', '1:95723', '1:94997']),
  up('1:95723', 'FRAME', 'Page header', { childOrder: ['4:2', '4:1'], ...at(0, 0) }, R),
  title(0),
  up('4:2', 'TEXT', 'Subtitle', { characters: 'All of them', ...at(0, 40) }, HEADER),
  up('1:94997', 'FRAME', 'Table', { layoutMode: 'VERTICAL', childOrder: ['5:2', '5:1'] }, R),
  up('5:2', 'FRAME', 'Row B', { height: 40 }, TABLE),
  up('5:1', 'FRAME', 'Row A', { height: 40, childOrder: ['6:1'] }, TABLE),
  up('6:1', 'TEXT', 'Cell', { characters: '42' }, [...TABLE, '5:1']),
  up('1:99000', 'FRAME', 'Badge', { layoutPositioning: 'ABSOLUTE', ...at(900, 0) }, R),
];
const DOCUMENT = ['1:1', '1:95723', '4:1', '4:2', '1:94997', '5:2', '5:1', '6:1', '1:99000'];
const BY_PATH = ['1:1', '1:94997', '5:1', '6:1', '5:2', '1:95723', '4:1', '4:2', '1:99000'];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-document-order-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

/** Drops every order key of `fileKey`, as rows synced before document order existed. */
async function clearOrderKeys(store, fileKey) {
  if (store.nodes) { for (const n of store.nodes.values()) if (n.fileKey === fileKey) n.orderKey = null; return; }
  await store.query('update node set order_key = null where file_key = $1', [fileKey]);
}

for (const [kind, open] of Object.entries(STORES)) {
  test.describe(`document order (${kind} store)`, () => {
    let store, cleanup, app;
    let seq = 0;
    const newFile = () => `DocOrder${kind}${++seq}`;

    test.before(async () => {
      ({ store, cleanup } = await open());
      app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
    });
    test.after(async () => { await app.close(); await cleanup(); });

    const sync = async (fileKey, body) => {
      const res = await app.inject({ method: 'POST', url: `/v3/files/${fileKey}/sync`, headers: plugin, payload: { fileKey, ...body } });
      assert.equal(res.statusCode, 200, res.body);
      return res.json();
    };
    const get = async url => {
      const res = await app.inject({ method: 'GET', url, headers: agent });
      assert.equal(res.statusCode, 200, res.body);
      return res;
    };
    const ids = async (fileKey, query = '') => (await get(`/v3/files/${fileKey}/nodes?state=all&limit=100${query}`)).json().nodes.map(n => n.nodeId);
    const keys = async fileKey => Object.fromEntries((await store.getNodes(fileKey, DOCUMENT)).map(n => [n.nodeId, n.orderKey]));
    const seeded = async () => {
      const fk = newFile();
      await sync(fk, { rootNodeId: '1:1', upserts: TREE() });
      return fk;
    };

    test('sync writes order keys; listings default to document order, sort=path keeps node-id path order', async () => {
      const fk = await seeded();
      assert.deepEqual(await keys(fk), {
        '1:1': '00000', '1:95723': '00000.00000', '4:1': '00000.00000.00000', '4:2': '00000.00000.00001',
        '1:94997': '00000.00001', '5:2': '00000.00001.00000', '5:1': '00000.00001.00001', '6:1': '00000.00001.00001.00000',
        '1:99000': '00000.00002',
      });
      assert.deepEqual(await ids(fk), DOCUMENT);
      assert.deepEqual(await ids(fk, '&sort=document'), DOCUMENT);
      assert.deepEqual(await ids(fk, '&sort=-document'), [...DOCUMENT].reverse());
      assert.deepEqual(await ids(fk, '&sort=path'), BY_PATH);
      assert.deepEqual(await ids(fk, '&under=1:94997'), ['1:94997', '5:2', '5:1', '6:1']);
      const ndjson = (await get(`/v3/files/${fk}/nodes?state=all&format=ndjson`)).body.split('\n').filter(Boolean).map(l => JSON.parse(l).nodeId);
      assert.deepEqual(ndjson, DOCUMENT);
    });

    test('pages in document order are stable and complete', async () => {
      const fk = await seeded();
      for (const sort of ['document', '-document']) {
        const seen = [];
        let cursor = null;
        do {
          const body = (await get(`/v3/files/${fk}/nodes?state=all&limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`)).json();
          assert.ok(body.nodes.length <= 2);
          seen.push(...body.nodes.map(n => n.nodeId));
          cursor = body.nextCursor;
        } while (cursor);
        assert.deepEqual(seen, sort === 'document' ? DOCUMENT : [...DOCUMENT].reverse());
      }
    });

    test('outline is in document order and marks absolute nodes', async () => {
      const fk = await seeded();
      const lines = (await get(`/v3/files/${fk}/nodes?state=all&format=outline`)).body.trimEnd().split('\n');
      assert.deepEqual(lines, [
        'Page (FRAME) · added',
        '  Page header (FRAME) · added',
        '    Title (TEXT) · added',
        '    Subtitle (TEXT) · added',
        '  Table (FRAME) · added',
        '    Row B (FRAME) · added',
        '    Row A (FRAME) · added',
        '      Cell (TEXT) · added',
        '  Badge (FRAME) (absolute) · added',
      ]);
      const byPath = (await get(`/v3/files/${fk}/nodes?state=all&format=outline&sort=path`)).body.trimEnd().split('\n');
      assert.equal(byPath[1], '  Table (FRAME) · added');
      const bad = await app.inject({ method: 'GET', url: `/v3/files/${fk}/nodes?format=outline&sort=-document`, headers: agent });
      assert.equal(bad.statusCode, 400, bad.body);
    });

    test('work items and summary byFrame follow document order', async () => {
      const fk = await seeded();
      const work = (await get(`/v3/files/${fk}/work?state=all&group=frame&under=1:1`)).json();
      assert.deepEqual(work.items.map(i => i.key), ['1:95723', '1:94997', '1:99000', null]);
      assert.deepEqual(work.items[1].nodeIds, ['1:94997', '5:2', '5:1', '6:1']);
      const paged = (await get(`/v3/files/${fk}/work?state=all&group=frame&under=1:1&limit=1`)).json();
      const rest = (await get(`/v3/files/${fk}/work?state=all&group=frame&under=1:1&limit=10&cursor=${paged.nextCursor}`)).json();
      assert.deepEqual([...paged.items, ...rest.items].map(i => i.key), ['1:95723', '1:94997', '1:99000', null]);
      const summary = (await get(`/v3/files/${fk}/summary?state=all&under=1:1`)).json();
      assert.deepEqual(summary.byFrame.map(f => [f.nodeId, f.count]), [['1:95723', 3], ['1:94997', 4], ['1:99000', 1]]);
    });

    test('a new childOrder re-ranks the parent\'s children and rewrites their descendants, keeping updatedAt', async () => {
      const fk = await seeded();
      const [cellBefore] = await store.getNodes(fk, ['6:1']);
      await sync(fk, { upserts: [page(['1:94997', '1:95723', '1:99000'])] });
      assert.deepEqual(await ids(fk), ['1:1', '1:94997', '5:2', '5:1', '6:1', '1:95723', '4:1', '4:2', '1:99000']);
      const [cell] = await store.getNodes(fk, ['6:1']);
      assert.equal(cell.orderKey, '00000.00000.00001.00000');
      assert.equal(cell.updatedAt, cellBefore.updatedAt);
      const since = (await get(`/v3/files/${fk}/nodes?state=all&since=${encodeURIComponent(new Date(Date.parse(cellBefore.updatedAt) + 1).toISOString())}`)).json();
      assert.ok(!since.nodes.some(n => n.nodeId === '6:1'), 'rekeying is not an update');
    });

    test('moving a free-form child, reparenting and deleting re-rank the siblings', async () => {
      const fk = await seeded();
      await sync(fk, { upserts: [title(80)] });
      assert.deepEqual((await ids(fk, '&under=1:95723')), ['1:95723', '4:2', '4:1']);

      // Row A (with its Cell) moves into the header: not in its childOrder yet, so last.
      await sync(fk, { upserts: [up('5:1', 'FRAME', 'Row A', { height: 40, childOrder: ['6:1'] }, HEADER), up('6:1', 'TEXT', 'Cell', { characters: '42' }, [...HEADER, '5:1'])] });
      assert.deepEqual(await ids(fk), ['1:1', '1:95723', '4:2', '4:1', '5:1', '6:1', '1:94997', '5:2', '1:99000']);
      assert.equal((await keys(fk))['6:1'], '00000.00000.00002.00000');

      await sync(fk, { upserts: [], deletedNodeIds: ['4:2'] });
      const after = await keys(fk);
      assert.equal(after['4:1'], '00000.00000.00000');
      assert.equal(after['4:2'], '00000.00000.00000', 'a tombstone keeps its last key');
      assert.equal(after['5:1'], '00000.00000.00001');
      assert.deepEqual(await ids(fk, '&under=1:95723'), ['1:95723', '4:1', '4:2', '5:1', '6:1'], 'key ties break by node id');
    });

    test('startup backfill (document-order) fills null keys, parents first, in batches, without touching updatedAt', async () => {
      const fk = await seeded();
      const before = await store.getNodes(fk, DOCUMENT);
      await clearOrderKeys(store, fk);
      assert.ok((await store.getNodes(fk, DOCUMENT)).every(n => n.orderKey === null));
      assert.deepEqual(await ids(fk), BY_PATH, 'keyless rows sort by path');
      assert.ok(await backfillDocumentOrder(store, { batchSize: 2 }) >= DOCUMENT.length);
      assert.deepEqual(await store.getNodes(fk, DOCUMENT), before);
      assert.deepEqual(await ids(fk), DOCUMENT);
      assert.equal(await backfillDocumentOrder(store, { batchSize: 2 }), 0);
    });

    test('a batch rooted below an unsynced parent keys its root as a root', async () => {
      const fk = newFile();
      await sync(fk, { rootNodeId: '1:94997', upserts: TREE().filter(u => u.path.includes('1:94997') || u.nodeId === '1:94997') });
      const [table] = await store.getNodes(fk, ['1:94997']);
      assert.equal(table.orderKey, ROOT_KEY);
      assert.deepEqual(await ids(fk), ['1:94997', '5:2', '5:1', '6:1']);
      await sync(fk, { upserts: [page(['1:95723', '1:94997'])] });
      assert.equal((await store.getNodes(fk, ['6:1']))[0].orderKey, '00000.00000.00001.00000');
      assert.deepEqual(await ids(fk), ['1:1', '1:94997', '5:2', '5:1', '6:1']);
    });
  });
}
