'use strict';

/*
 * v3 read routes (docs/api-v3-design.md): files, scopes, the node listing,
 * one node, link resolution, problem errors and the OpenAPI document — against
 * the memory store and PGlite (same SQL as Postgres).
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
const { CODES } = require('../src/v3/problem');
const { COMPACT_FIELDS, FULL_FIELDS } = require('../src/v3/schemas');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };

const FK = 'AbCdEf123456GhIjKl7890';
const FIGMA = (key = FK, nodeId = null) => `https://www.figma.com/design/${key}/My-Design${nodeId ? `?node-id=${nodeId.replace(':', '-')}` : ''}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function up(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}

/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Card            dirty, modified [paddingLeft] (layout), claimed by w1
 * │  ├─ 3:1 TEXT Title         blocked (modified [characters])
 * │  └─ 3:2 INSTANCE Button/Primary (of 5:1)  dirty, modified [fills] (color), expired claim by w2
 * ├─ 2:2 FRAME Header          clean
 * │  ├─ 3:3 TEXT Label         dirty, deleted
 * │  ├─ 3:4 TEXT Caption       dirty, added (edited again after T)
 * │  └─ 3:5 FRAME Legacy card  dirty, modified, implemented attrs unknown (migrated)
 * └─ 5:1 COMPONENT Button      clean
 */
const R = ['1:1'];
const TREE_V1 = () => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: 16, fills: ['red'] }, R),
  up('3:1', 'TEXT', 'Title', { characters: 'Hi', fontSize: 14 }, [...R, '2:1']),
  up('3:2', 'INSTANCE', 'Button/Primary', { fills: ['blue'] }, [...R, '2:1'], { mainComponentId: '5:1' }),
  up('2:2', 'FRAME', 'Header', { itemSpacing: 8 }, R),
  up('3:3', 'TEXT', 'Label', { characters: 'L', fontSize: 12 }, [...R, '2:2']),
  up('3:5', 'FRAME', 'Legacy card', { opacity: 1 }, [...R, '2:2']),
  up('5:1', 'COMPONENT', 'Button', { cornerRadius: 4 }, R),
];
const TREE_V2 = () => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: 24, fills: ['red'] }, R),
  up('3:1', 'TEXT', 'Title', { characters: 'Hello', fontSize: 14 }, [...R, '2:1']),
  up('3:2', 'INSTANCE', 'Button/Primary', { fills: ['green'] }, [...R, '2:1'], { mainComponentId: '5:1' }),
  up('2:2', 'FRAME', 'Header', { itemSpacing: 8 }, R),
  up('3:4', 'TEXT', 'Caption', { characters: 'C', fontSize: 10 }, [...R, '2:2']),
  up('3:5', 'FRAME', 'Legacy card', { opacity: 0.5 }, [...R, '2:2']),
  up('5:1', 'COMPONENT', 'Button', { cornerRadius: 4 }, R),
];
const ALL = ['1:1', '2:1', '3:1', '3:2', '2:2', '3:3', '3:4', '3:5', '5:1'];
const DIRTY = ['2:1', '3:2', '3:3', '3:4', '3:5'];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-read-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
  return { app, store, close: async () => { await app.close(); await cleanup(); } };
}

async function batch(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${body.fileKey}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

/** The fixture above; returns the time `T` between the last setup write and the 3:4 re-edit. */
async function seed(app, store) {
  await batch(app, { fileKey: FK, fileName: 'Design File', rootNodeId: '1:1', upserts: TREE_V1(), markImplemented: true });
  await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE_V2(), deletedNodeIds: ['3:3'] });
  const future = new Date(Date.now() + 3600e3).toISOString();
  const past = new Date(Date.now() - 3600e3).toISOString();
  await store.updateNode(FK, '3:1', { blockedAt: new Date().toISOString(), blockedBy: 'agent-7', blockedReason: 'Ambiguous spacing' });
  await store.updateNode(FK, '2:1', { claimedBy: 'w1', claimExpiresAt: future });
  await store.updateNode(FK, '3:2', { claimedBy: 'w2', claimExpiresAt: past });
  await store.updateNode(FK, '3:5', { implementedAttrs: null, changedProps: [], changeCategories: [] });
  await sleep(15);
  const T = new Date().toISOString();
  await sleep(15);
  await batch(app, { fileKey: FK, upserts: [up('3:4', 'TEXT', 'Caption', { characters: 'Caption', fontSize: 10 }, [...R, '2:2'])] });
  return T;
}

const get = (app, url, headers = agent) => app.inject({ method: 'GET', url, headers });
const ids = res => { assert.equal(res.statusCode, 200, res.body); return res.json().nodes.map(n => n.nodeId); };
const sameSet = (actual, expected) => assert.deepEqual([...actual].sort(), [...expected].sort());

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.ok(CODES[code], `code ${code} is listed in problem.js`);
  assert.equal(body.type, `https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#${code.replace(/_/g, '-')}`);
  assert.equal(typeof body.title, 'string');
  assert.equal(typeof body.detail, 'string');
  assert.equal(typeof body.hint, 'string');
  return body;
}

for (const kind of Object.keys(STORES)) {
  test(`v3 read routes (${kind} store)`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const T = await seed(app, store);
    const nodes = qs => get(app, `/v3/files/${FK}/nodes${qs ? `?${qs}` : ''}`);

    await t.test('listing defaults to state=dirty in tree order, with total', async () => {
      const res = await nodes('');
      assert.deepEqual(ids(res), DIRTY);
      assert.equal(res.json().total, 5);
      assert.equal(res.json().nextCursor, null);
      assert.equal(res.json().fileKey, FK);
    });

    await t.test('state', async () => {
      sameSet(ids(await nodes('state=dirty')), DIRTY);
      sameSet(ids(await nodes('state=clean')), ['1:1', '2:2', '5:1']);
      sameSet(ids(await nodes('state=blocked')), ['3:1']);
      sameSet(ids(await nodes('state=all')), ALL);
      sameSet(ids(await nodes('state=clean,blocked')), ['1:1', '2:2', '5:1', '3:1']);
      assertProblem(await nodes('state=done'), 400, 'invalid_parameter');
    });

    await t.test('under (inclusive), with colon or hyphen ids', async () => {
      sameSet(ids(await nodes('under=2:1')), ['2:1', '3:2']);
      sameSet(ids(await nodes('under=2-1')), ['2:1', '3:2']);
      sameSet(ids(await nodes('under=2:2&state=all')), ['2:2', '3:3', '3:4', '3:5']);
      const body = assertProblem(await nodes('under=9-9'), 404, 'node_not_found');
      assert.match(body.hint, /9:9/);
    });

    await t.test('depth needs under and limits levels below it', async () => {
      assert.deepEqual(ids(await nodes('under=1:1&depth=1&state=all')), ['1:1', '2:1', '2:2', '5:1']);
      assert.deepEqual(ids(await nodes('under=1:1&depth=0&state=all')), ['1:1']);
      sameSet(ids(await nodes('under=1:1&depth=2&state=all')), ALL);
      const body = assertProblem(await nodes('depth=1'), 400, 'invalid_parameter');
      assert.match(body.hint, /under/);
      assertProblem(await nodes('under=1:1&depth=-1'), 400, 'invalid_parameter');
    });

    await t.test('under takes a list of roots: their union, roots in the order given, each node once', async () => {
      const both = ids(await nodes('under=2:2,2:1&state=all'));
      assert.deepEqual(both, [...ids(await nodes('under=2:2&state=all')), ...ids(await nodes('under=2:1&state=all'))]);
      assert.deepEqual(ids(await nodes('under=2-2,%202:1%20&state=all')), both);
      assert.deepEqual(ids(await nodes('q=state:all under:2:2,2-1')), both);
      assert.deepEqual(ids(await nodes('under=2:1,2:2&depth=0&state=all')), ['2:1', '2:2'], 'depth applies below each root');
      assert.deepEqual(ids(await nodes('under=1:1,2:1&depth=1&state=all')), ['1:1', '2:1', '2:2', '5:1', '3:1', '3:2']);
      const overlap = ids(await nodes('under=1:1,2:1,2-1&state=all'));
      sameSet(overlap, ALL);
      assert.equal(overlap.length, ALL.length);
      const paged = [];
      let cursor = null;
      do {
        const page = (await nodes(`under=2:2,2:1&state=all&limit=2${cursor ? `&cursor=${cursor}` : ''}`)).json();
        assert.equal(page.total, both.length);
        paged.push(...page.nodes.map(n => n.nodeId));
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(paged, both);
      const outline = (await nodes('under=2:2,2:1&state=all&format=outline')).body.split('\n').filter(Boolean);
      assert.deepEqual(outline.filter(l => !l.startsWith(' ')).map(l => l.split(' (')[0]), ['Header', 'Card']);
      const unknown = assertProblem(await nodes('under=2:1,9-9'), 404, 'node_not_found');
      assert.match(unknown.hint, /9:9/);
      assert.deepEqual(ids(await nodes(`under=${Array(50).fill('2:1').join(',')}`)), ids(await nodes('under=2:1')));
      const many = assertProblem(await nodes(`under=${Array(51).fill('2:1').join(',')}`), 400, 'invalid_parameter');
      assert.match(many.detail, /50/);
      assertProblem(await nodes('under=,'), 400, 'invalid_parameter');
    });

    await t.test('summary and work over several roots; frame grouping needs one', async () => {
      const json = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
      const summary = json(await get(app, `/v3/files/${FK}/summary?under=2:1,2:2&state=all`));
      assert.equal(summary.total, ids(await nodes('under=2:1,2:2&state=all')).length);
      assert.equal(summary.byFrame, undefined);
      assert.ok(Array.isArray(json(await get(app, `/v3/files/${FK}/summary?under=2:1&state=all`)).byFrame));
      const work = json(await get(app, `/v3/files/${FK}/work?under=2:1,2:2&state=all&changes=names`));
      assert.equal(work.items.reduce((sum, i) => sum + i.nodeCount, 0), summary.total);
      const frame = assertProblem(await get(app, `/v3/files/${FK}/work?group=frame&under=2:1,2:2`), 400, 'invalid_parameter');
      assert.match(frame.hint, /one under/);
      json(await get(app, `/v3/files/${FK}/work?group=frame&under=2:1,2-1`));
    });

    await t.test('type (OR within, case-insensitive)', async () => {
      sameSet(ids(await nodes('type=TEXT')), ['3:3', '3:4']);
      sameSet(ids(await nodes('type=text')), ['3:3', '3:4']);
      sameSet(ids(await nodes('type=TEXT,INSTANCE')), ['3:2', '3:3', '3:4']);
    });

    await t.test('changeType', async () => {
      sameSet(ids(await nodes('changeType=added')), ['3:4']);
      sameSet(ids(await nodes('changeType=added,deleted')), ['3:3', '3:4']);
      sameSet(ids(await nodes('changeType=modified')), ['2:1', '3:2', '3:5']);
      assertProblem(await nodes('changeType=moved'), 400, 'invalid_parameter');
    });

    await t.test('changed (exact names and trailing wildcards)', async () => {
      sameSet(ids(await nodes('changed=fills')), ['3:2']);
      sameSet(ids(await nodes('changed=padding*')), ['2:1']);
      sameSet(ids(await nodes('changed=font*')), ['3:3', '3:4']);
      sameSet(ids(await nodes('changed=paddingLeft,fills')), ['2:1', '3:2']);
      assertProblem(await nodes('changed=*Left'), 400, 'invalid_parameter');
    });

    await t.test('category', async () => {
      sameSet(ids(await nodes('category=layout')), ['2:1']);
      sameSet(ids(await nodes('category=typography')), ['3:3', '3:4']);
      sameSet(ids(await nodes('category=layout,color')), ['2:1', '3:2']);
      sameSet(ids(await nodes('category=content&state=all')), ['3:1', '3:3', '3:4']);
      assertProblem(await nodes('category=colour'), 400, 'invalid_parameter');
    });

    await t.test('component (instances plus the main)', async () => {
      sameSet(ids(await nodes('component=5:1')), ['3:2']);
      sameSet(ids(await nodes('component=5-1&state=all')), ['3:2', '5:1']);
    });

    await t.test('name (case-insensitive globs)', async () => {
      sameSet(ids(await nodes('name=card')), ['2:1']);
      sameSet(ids(await nodes('name=*card')), ['2:1', '3:5']);
      sameSet(ids(await nodes('name=Button*')), ['3:2']);
      sameSet(ids(await nodes('name=la?el,Header&state=all')), ['3:3', '2:2']);
      sameSet(ids(await nodes('name=100%25')), []);
    });

    await t.test('since', async () => {
      sameSet(ids(await nodes(`since=${encodeURIComponent(T)}`)), ['3:4']);
      sameSet(ids(await nodes('since=2000-01-01T00:00Z')), DIRTY);
      assertProblem(await nodes('since=yesterday'), 400, 'invalid_parameter');
    });

    await t.test('claimed (true, false, mine with worker; expired leases are unclaimed)', async () => {
      sameSet(ids(await nodes('claimed=true')), ['2:1']);
      sameSet(ids(await nodes('claimed=false')), ['3:2', '3:3', '3:4', '3:5']);
      sameSet(ids(await nodes('claimed=mine&worker=w1')), ['2:1']);
      sameSet(ids(await nodes('claimed=mine&worker=w2')), []);
      sameSet(ids(await nodes('claimed=mine,false&worker=w1')), DIRTY);
      assertProblem(await nodes('claimed=mine'), 400, 'invalid_parameter');
    });

    await t.test('parameters combine with AND, values within one with OR', async () => {
      sameSet(ids(await nodes('under=2:1&type=INSTANCE')), ['3:2']);
      sameSet(ids(await nodes('type=TEXT&changeType=added')), ['3:4']);
      sameSet(ids(await nodes('type=TEXT,INSTANCE&category=typography,color')), ['3:2', '3:3', '3:4']);
      sameSet(ids(await nodes('under=2:2&changeType=modified,added&claimed=false')), ['3:4', '3:5']);
      sameSet(ids(await nodes('state=all&under=2:1&changed=characters,fills&claimed=false')), ['3:1', '3:2']);
    });

    await t.test('q is equivalent to the same parameters', async () => {
      const pairs = [
        ['q=under:2:1 type:INSTANCE', 'under=2:1&type=INSTANCE'],
        ['q=state:all component:5:1', 'state=all&component=5:1'],
        ['q=changed:font*,fills', 'changed=font*,fills'],
        ['q=name:"Legacy card"', 'name=Legacy card'],
        ['q=state:all under:1:1 depth:1', 'state=all&under=1:1&depth=1'],
        ['q=claimed:mine worker:w1', 'claimed=mine&worker=w1'],
        [`q=since:${T}`, `since=${encodeURIComponent(T)}`],
        ['q=type:TEXT type:INSTANCE', 'type=TEXT,INSTANCE'],
        ['q=category:typography&type=TEXT', 'category=typography&type=TEXT'],
      ];
      for (const [q, params] of pairs) {
        const a = await nodes(q.replace(/ /g, '%20').replace(/"/g, '%22'));
        const b = await nodes(params.replace(/ /g, '%20'));
        assert.equal(a.statusCode, 200, `${q}: ${a.body}`);
        assert.deepEqual(a.json(), b.json(), q);
      }
      assertProblem(await nodes('q=colour:red'), 400, 'invalid_parameter');
      assertProblem(await nodes('q=type:TEXT&type=FRAME'), 400, 'invalid_parameter');
      assertProblem(await nodes('q=nonsense'), 400, 'invalid_parameter');
    });

    await t.test('depth=1 + include=counts expands a tree level with subtree counts', async () => {
      const res = await nodes('under=1:1&depth=1&state=all&include=counts');
      const byId = Object.fromEntries(res.json().nodes.map(n => [n.nodeId, n.descendants]));
      assert.deepEqual(byId, {
        '1:1': { total: 8, dirty: 5, blocked: 1 },
        '2:1': { total: 2, dirty: 1, blocked: 1 },
        '2:2': { total: 3, dirty: 3, blocked: 0 },
        '5:1': { total: 0, dirty: 0, blocked: 0 },
      });
      assert.equal((await nodes('state=all')).json().nodes[0].descendants, undefined);
    });

    await t.test('cursor paging: stable order, same total, every node once', async () => {
      for (const sort of ['path', '-path', 'name', '-name', 'updatedAt', '-updatedAt']) {
        const full = (await nodes(`state=all&sort=${sort}`)).json();
        assert.equal(full.total, 9);
        const seen = [];
        let cursor = null, pages = 0;
        do {
          const res = await nodes(`state=all&sort=${sort}&limit=4${cursor ? `&cursor=${cursor}` : ''}`);
          assert.equal(res.statusCode, 200, res.body);
          const page = res.json();
          assert.equal(page.total, 9);
          assert.ok(page.nodes.length <= 4);
          seen.push(...page.nodes.map(n => n.nodeId));
          cursor = page.nextCursor;
          pages += 1;
        } while (cursor);
        assert.equal(pages, 3, sort);
        assert.deepEqual(seen, full.nodes.map(n => n.nodeId), sort);
      }
      const byName = (await nodes('state=all&sort=name')).json().nodes.map(n => n.name);
      assert.deepEqual(byName, [...byName].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      assert.deepEqual(ids(await nodes('state=all&sort=-name')), ids(await nodes('state=all&sort=name')).reverse());
      assert.equal(ids(await nodes('state=all&sort=updatedAt')).at(-1), '3:4');
      assert.deepEqual(ids(await nodes('state=all')), ALL.slice().sort((a, b) => {
        const p = { '1:1': 0, '2:1': 1, '3:1': 2, '3:2': 3, '2:2': 4, '3:3': 5, '3:4': 6, '3:5': 7, '5:1': 8 };
        return p[a] - p[b];
      }));
    });

    await t.test('bad or foreign cursors are rejected', async () => {
      const { nextCursor } = (await nodes('state=all&limit=2')).json();
      assertProblem(await nodes(`state=dirty&limit=2&cursor=${nextCursor}`), 400, 'invalid_cursor');
      assertProblem(await nodes(`state=all&limit=2&sort=name&cursor=${nextCursor}`), 400, 'invalid_cursor');
      assertProblem(await nodes('cursor=not-a-cursor'), 400, 'invalid_cursor');
      assertProblem(await nodes('limit=0'), 400, 'invalid_parameter');
      assertProblem(await nodes('limit=1001'), 400, 'invalid_parameter');
      assert.equal((await nodes('state=all&limit=1000')).json().nodes.length, 9);
    });

    await t.test('compact shape, claim and blocked objects', async () => {
      const list = (await nodes('state=all')).json().nodes;
      for (const n of list) assert.deepEqual(Object.keys(n).sort(), COMPACT_FIELDS.filter(k => k !== 'changes' || n.changeType !== 'added').sort());
      const card = list.find(n => n.nodeId === '2:1');
      assert.equal(card.state, 'dirty');
      assert.equal(card.changeType, 'modified');
      assert.deepEqual(card.changes, { paddingLeft: { built: 16, now: 24, category: 'layout' } });
      assert.equal(card.changesKnown, true);
      assert.equal(card.figmaUrl, core.link(FK, '2:1'));
      assert.equal(card.type, 'FRAME');
      assert.equal(card.parentId, '1:1');
      assert.equal(card.claim.worker, 'w1');
      assert.equal(card.claim.claimId, null);
      assert.equal(card.claim.label, null);
      assert.ok(Date.parse(card.claim.expiresAt) > Date.now());
      assert.equal(list.find(n => n.nodeId === '3:2').claim, null);
      const title = list.find(n => n.nodeId === '3:1');
      assert.equal(title.state, 'blocked');
      assert.deepEqual({ ...title.blocked, at: undefined }, { reason: 'Ambiguous spacing', by: 'agent-7', at: undefined });
      assert.equal(card.blocked, null);
      const clean = list.find(n => n.nodeId === '2:2');
      assert.deepEqual([clean.state, clean.changeType, clean.changes], ['clean', null, {}]);
      const added = list.find(n => n.nodeId === '3:4');
      assert.deepEqual([added.changeType, added.changes, added.changedProps], ['added', undefined, ['characters', 'fontSize']]);
      const deleted = list.find(n => n.nodeId === '3:3');
      assert.equal(deleted.changeType, 'deleted');
      assert.deepEqual(deleted.changes.characters, { built: 'L', now: null, category: 'content' });
    });

    await t.test('changesKnown: false for migrated rows without implemented attrs', async () => {
      const legacy = (await nodes('under=3:5')).json().nodes[0];
      assert.deepEqual([legacy.changeType, legacy.changes, legacy.changesKnown], ['modified', null, false]);
      const detail = (await get(app, `/v3/files/${FK}/nodes/3:5`)).json();
      assert.deepEqual([detail.changeType, detail.changes, detail.changesKnown, detail.implementedAttrs], ['modified', null, false, null]);
    });

    await t.test('view=full and fields', async () => {
      const full = (await nodes('view=full&under=2:1&depth=0')).json().nodes[0];
      assert.deepEqual(Object.keys(full).sort(), [...FULL_FIELDS].sort());
      assert.deepEqual(full.attrs, { paddingLeft: 24, fills: ['red'] });
      assert.deepEqual(full.implementedAttrs, { paddingLeft: 16, fills: ['red'] });
      assert.deepEqual(full.path, ['1:1', '2:1']);
      const picked = (await nodes('fields=nodeId,changes&view=full&changes=diff')).json().nodes;
      for (const n of picked) assert.deepEqual(Object.keys(n).sort(), ['changes', 'nodeId']);
      const withCounts = (await nodes('fields=nodeId&include=counts&under=1:1&depth=0&state=all')).json().nodes[0];
      assert.deepEqual(Object.keys(withCounts).sort(), ['descendants', 'nodeId']);
      assertProblem(await nodes('fields=nodeId,colour'), 400, 'invalid_parameter');
      assertProblem(await nodes('view=tiny'), 400, 'invalid_parameter');
    });

    await t.test('isInstance, mainComponentId and changedProps on listing, detail and fields', async () => {
      const list = (await nodes('state=all')).json().nodes;
      const pickKeys = n => [n.nodeId, n.isInstance, n.mainComponentId, n.changedProps];
      assert.deepEqual(pickKeys(list.find(n => n.nodeId === '3:2')), ['3:2', true, '5:1', ['fills']]);
      assert.deepEqual(pickKeys(list.find(n => n.nodeId === '2:1')), ['2:1', false, null, ['paddingLeft']]);
      assert.deepEqual(pickKeys(list.find(n => n.nodeId === '5:1')), ['5:1', false, null, []]);
      assert.deepEqual(pickKeys(list.find(n => n.nodeId === '3:3')), ['3:3', false, null, ['characters', 'fontSize']]);
      const detail = (await get(app, `/v3/files/${FK}/nodes/3-2`)).json();
      assert.deepEqual([detail.isInstance, detail.mainComponentId, detail.changedProps], [true, '5:1', ['fills']]);
      assert.deepEqual((await nodes('fields=nodeId,isInstance,mainComponentId&under=3:2')).json().nodes, [{ nodeId: '3:2', isInstance: true, mainComponentId: '5:1' }]);
      assert.deepEqual((await get(app, `/v3/files/${FK}/nodes/3:2?fields=mainComponentId,changedProps`)).json(), { fileKey: FK, mainComponentId: '5:1', changedProps: ['fills'] });
    });

    await t.test('instance=true|false (also in q)', async () => {
      assert.deepEqual(ids(await nodes('instance=true&state=all')), ['3:2']);
      assert.deepEqual(ids(await nodes('instance=false')), DIRTY.filter(id => id !== '3:2'));
      assert.deepEqual(ids(await nodes('q=instance:true state:all')), ['3:2']);
      assert.deepEqual(ids(await nodes('q=instance:false')), DIRTY.filter(id => id !== '3:2'));
      assert.deepEqual(ids(await nodes('instance=true&component=5:1&state=all')), ['3:2']);
      assertProblem(await nodes('instance=yes'), 400, 'invalid_parameter');
      assertProblem(await nodes('q=instance:yes'), 400, 'invalid_parameter');
      assertProblem(await nodes('instance=true&q=instance:false'), 400, 'invalid_parameter');
    });

    await t.test('changes=auto (default) | diff | names on the listing', async () => {
      const byId = list => Object.fromEntries(list.map(n => [n.nodeId, n]));
      const auto = byId((await nodes('')).json().nodes);
      assert.deepEqual(byId((await nodes('changes=auto')).json().nodes), auto);
      assert.equal('changes' in auto['3:4'], false);
      assert.deepEqual(auto['3:4'].changedProps, ['characters', 'fontSize']);
      assert.deepEqual(auto['2:1'].changes, { paddingLeft: { built: 16, now: 24, category: 'layout' } });
      assert.deepEqual(auto['3:3'].changes.characters, { built: 'L', now: null, category: 'content' });
      assert.deepEqual([auto['3:5'].changes, auto['3:5'].changesKnown], [null, false]);

      const diff = byId((await nodes('changes=diff')).json().nodes);
      assert.deepEqual(diff['3:4'].changes, {
        characters: { built: null, now: 'Caption', category: 'content' }, fontSize: { built: null, now: 10, category: 'typography' },
      });
      assert.deepEqual(diff['2:1'].changes, auto['2:1'].changes);

      const names = (await nodes('changes=names&state=all')).json().nodes;
      for (const n of names) assert.equal('changes' in n, false, n.nodeId);
      assert.deepEqual(byId(names)['2:1'].changedProps, ['paddingLeft']);
      assert.equal(byId(names)['3:5'].changesKnown, false);
      assert.deepEqual((await nodes('changes=names&fields=nodeId,changes&under=2:1&depth=0')).json().nodes, [{ nodeId: '2:1' }]);
      assertProblem(await nodes('changes=values'), 400, 'invalid_parameter');
      const page = (await nodes('limit=2')).json();
      assertProblem(await nodes(`limit=2&changes=diff&cursor=${page.nextCursor}`), 400, 'invalid_cursor');
    });

    await t.test('node detail: changes=diff by default, auto and names on request', async () => {
      const detail = (await get(app, `/v3/files/${FK}/nodes/3:4`)).json();
      assert.deepEqual(detail.changes.characters, { built: null, now: 'Caption', category: 'content' });
      assert.deepEqual((await get(app, `/v3/files/${FK}/nodes/3:4?changes=diff`)).json().changes, detail.changes);
      assert.equal('changes' in (await get(app, `/v3/files/${FK}/nodes/3:4?changes=auto`)).json(), false);
      assert.deepEqual((await get(app, `/v3/files/${FK}/nodes/2:1?changes=auto`)).json().changes, { paddingLeft: { built: 16, now: 24, category: 'layout' } });
      const names = (await get(app, `/v3/files/${FK}/nodes/2:1?changes=names`)).json();
      assert.deepEqual(['changes' in names, names.changedProps], [false, ['paddingLeft']]);
      assertProblem(await get(app, `/v3/files/${FK}/nodes/2:1?changes=all`), 400, 'invalid_parameter');
    });

    await t.test('node detail: hyphen ids, history, counts, fields', async () => {
      const res = await get(app, `/v3/files/${FK}/nodes/2-1`);
      assert.equal(res.statusCode, 200, res.body);
      const n = res.json();
      assert.equal(n.fileKey, FK);
      assert.equal(n.nodeId, '2:1');
      assert.deepEqual(n.descendants, { total: 2, dirty: 1, blocked: 1 });
      assert.equal(n.history.implementedCommit, 'baseline');
      assert.equal(typeof n.history.implementedHash, 'string');
      assert.equal(n.deleted, false);
      assert.deepEqual((await get(app, `/v3/files/${FK}/nodes/3:3`)).json().deleted, true);
      assert.deepEqual(Object.keys((await get(app, `/v3/files/${FK}/nodes/2:1?fields=state,claim`)).json()).sort(), ['claim', 'fileKey', 'state']);
      const miss = assertProblem(await get(app, `/v3/files/${FK}/nodes/9-9`), 404, 'node_not_found');
      assert.match(miss.hint, /9:9/);
      assert.match(miss.hint, /9-9/);
      const inner = assertProblem(await get(app, `/v3/files/${FK}/nodes/${encodeURIComponent('I1:2;3:4')}`), 404, 'node_not_found');
      assert.match(inner.detail, /I1:2;3:4/);
    });

    await t.test('unknown query parameter → 400 with the valid ones', async () => {
      const body = assertProblem(await nodes('stat=dirty'), 400, 'unknown_parameter');
      assert.match(body.detail, /stat/);
      assert.match(body.hint, /'state'/);
      assert.ok(body.validParameters.includes('state'));
      assertProblem(await get(app, '/v3/files?limit=5'), 400, 'unknown_parameter');
      assertProblem(await get(app, `/v3/files/${FK}/nodes/2:1?view=full`), 400, 'unknown_parameter');
    });

    await t.test('a URL as the file key gets the extracted-key hint', async () => {
      const encoded = encodeURIComponent(FIGMA(FK, '2:1'));
      for (const url of [`/v3/files/${encoded}`, `/v3/files/${encoded}/nodes`, `/v3/files/${encoded}/nodes/2:1`, `/v3/files/${encoded}/scopes`]) {
        const body = assertProblem(await get(app, url), 404, 'file_not_found');
        assert.match(body.hint, new RegExp(`'${FK}'`), url);
      }
      const raw = assertProblem(await get(app, `/v3/files/https://www.figma.com/design/${FK}/x/nodes`), 404, 'route_not_found');
      assert.match(raw.hint, new RegExp(FK));
      const unknown = assertProblem(await get(app, '/v3/files/NOPE/nodes'), 404, 'file_not_found');
      assert.match(unknown.hint, /GET \/v3\/files/);
    });

    await t.test('?url= replaces the path parameters', async () => {
      const link = encodeURIComponent(FIGMA(FK, '2:1'));
      sameSet(ids(await get(app, `/v3/files/-/nodes?url=${link}`)), ['2:1', '3:2']);
      sameSet(ids(await get(app, `/v3/files/${FK}/nodes?url=${link}&under=2:2`)), ['3:3', '3:4', '3:5']);
      const fileOnly = encodeURIComponent(FIGMA(FK));
      sameSet(ids(await get(app, `/v3/files/-/nodes?url=${fileOnly}`)), DIRTY);
      assert.equal((await get(app, `/v3/files/-/nodes/-?url=${link}`)).json().nodeId, '2:1');
      assert.equal((await get(app, `/v3/files/-?url=${link}`)).json().fileKey, FK);
      assert.equal((await get(app, `/v3/files/-/scopes?url=${link}`)).json().fileKey, FK);
      assertProblem(await get(app, `/v3/files/OTHER/nodes?url=${link}`), 400, 'url_mismatch');
      assertProblem(await get(app, `/v3/files/-/nodes/3:1?url=${link}`), 400, 'url_mismatch');
      assertProblem(await get(app, `/v3/files/-/nodes/-?url=${fileOnly}`), 400, 'invalid_parameter');
      assertProblem(await get(app, '/v3/files/-/nodes'), 400, 'invalid_parameter');
      assertProblem(await get(app, `/v3/files/-/nodes?url=${encodeURIComponent('https://example.com/x')}`), 400, 'invalid_url');
    });

    await t.test('/v3/resolve', async () => {
      const r = await get(app, `/v3/resolve?url=${encodeURIComponent(FIGMA(FK, '2:1'))}`);
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(r.json(), { fileKey: FK, nodeId: '2:1' });
      assert.deepEqual((await get(app, `/v3/resolve?url=${encodeURIComponent(`https://figma.com/file/${FK}/x`)}`)).json(), { fileKey: FK, nodeId: null });
      assertProblem(await get(app, `/v3/resolve?url=${encodeURIComponent('not a link')}`), 400, 'invalid_url');
      assertProblem(await get(app, '/v3/resolve'), 400, 'invalid_parameter');
    });

    await t.test('files and file summary', async () => {
      const res = await get(app, '/v3/files');
      assert.equal(res.statusCode, 200, res.body);
      const [file] = res.json().files;
      assert.equal(file.fileKey, FK);
      assert.equal(file.name, 'Design File', 'a later sync without fileName keeps the name');
      assert.deepEqual(file.counts, { total: 9, dirty: 5, clean: 3, blocked: 1 });
      assert.ok(file.lastSyncAt > T);
      const one = await get(app, `/v3/files/${FK}`);
      assert.deepEqual(one.json(), file);
    });

    await t.test('scopes: latest sync per root with current counts', async () => {
      const res = await get(app, `/v3/files/${FK}/scopes`);
      assert.equal(res.statusCode, 200, res.body);
      const { scopes } = res.json();
      assert.equal(scopes.length, 1, 'the last batch had no rootNodeId and recorded no scope');
      assert.equal(scopes[0].nodeId, '1:1');
      assert.equal(scopes[0].name, 'Page');
      assert.equal(scopes[0].type, 'SECTION');
      assert.equal(scopes[0].figmaUrl, core.link(FK, '1:1'));
      assert.deepEqual(scopes[0].lastSyncCounts, { uploaded: 8, changed: 4, added: 1, deleted: 1, baselined: 0, autoResolved: 0 });
      assert.deepEqual(scopes[0].counts, { total: 9, dirty: 5, clean: 3, blocked: 1 });
    });

    await t.test('token classes', async () => {
      const wrong = assertProblem(await get(app, '/v3/files', plugin), 403, 'wrong_token_class');
      assert.match(wrong.hint, /agent token/);
      assertProblem(await get(app, `/v3/files/${FK}/nodes`, plugin), 403, 'wrong_token_class');
      assertProblem(await get(app, '/v3/files', {}), 401, 'unauthorized');
      assertProblem(await get(app, '/v3/files', { authorization: 'Bearer nope' }), 401, 'invalid_token');
      assert.equal((await get(app, '/v3/openapi.json', {})).statusCode, 200);
    });

    await t.test('removed v1/v2 routes are route_not_found problems hinting at the v3 route', async () => {
      const cases = [
        ['GET', `/v2/scopes/1:1/hashes?fileKey=${FK}`, `GET /v3/files/${FK}/hashes?under=1:1`, plugin],
        ['POST', '/v2/nodes/batch', 'POST /v3/files/{fileKey}/sync', plugin],
        ['POST', '/v2/nodes/exists', 'POST /v3/files/{fileKey}/exists', plugin],
        ['GET', `/v2/nodes/1:1/delta?fileKey=${FK}`, `GET /v3/files/${FK}/nodes?under=1:1`, agent],
        ['POST', '/v2/nodes/clear', 'POST /v3/files/{fileKey}/clear', agent],
        ['POST', '/scopes', 'POST /v3/files/{fileKey}/sync', plugin],
        ['POST', '/scopes/1:1/snapshots', 'POST /v3/files/{fileKey}/sync', plugin],
        ['POST', '/snapshots/s1/parts', 'POST /v3/files/{fileKey}/sync', plugin],
        ['POST', '/snapshots/s1/publish', 'POST /v3/files/{fileKey}/sync', plugin],
        ['GET', '/scopes/1:1/pending', 'GET /v3/files/{fileKey}/nodes', agent],
        ['GET', '/items/i1', 'GET /v3/files/{fileKey}/nodes/{nodeId}', agent],
        ['POST', '/items/i1/verification', 'POST /v3/files/{fileKey}/clear', agent],
      ];
      for (const [method, url, v3, headers] of cases) {
        for (const h of [headers, {}]) {
          const res = await app.inject({ method, url, headers: h, ...(method === 'POST' ? { payload: {} } : {}) });
          const body = assertProblem(res, 404, 'route_not_found');
          assert.ok(body.hint.includes(v3), `${method} ${url}: ${body.hint}`);
        }
      }
      const other = assertProblem(await get(app, '/v2/anything', {}), 404, 'route_not_found');
      assert.match(other.hint, /v1\/v2 API was removed.*\/v3\/openapi\.json/);
      const v1 = assertProblem(await get(app, '/v1/scopes', {}), 404, 'route_not_found');
      assert.match(v1.hint, /v1\/v2 API was removed/);
      assert.match(assertProblem(await get(app, '/nope', {}), 404, 'route_not_found').hint, /^GET \/v3\/openapi\.json lists every v3 route\.$/);
    });
  });
}

/*
 * A fresh sync: every node is `added`, with realistic attrs, some bound to
 * tokens and one text whose content is far over 1 KB.
 */
const FRESH = 'FreshSync0000000000001';
const LONG = 'Lorem ipsum dolor sit amet. '.repeat(60);
const FRESH_TREE = () => {
  const rows = [up('1:1', 'FRAME', 'Screen', { width: 390, height: 844, layoutMode: 'VERTICAL', itemSpacing: 12 })];
  for (let i = 0; i < 40; i++) {
    rows.push(up(`2:${i}`, i % 4 === 0 ? 'INSTANCE' : 'TEXT', `Row ${i}`, {
      characters: i === 0 ? LONG : `Row ${i} label text`, fontSize: 14, fontFamily: 'Inter', lineHeight: { unit: 'PIXELS', value: 20 },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, token: 'color/text/primary' }], paddingLeft: 16, paddingRight: 16,
    }, R, i % 4 === 0 ? { mainComponentId: '9:1' } : {}));
  }
  return rows;
};
const bytes = v => Buffer.byteLength(JSON.stringify(v), 'utf8');

for (const kind of Object.keys(STORES)) {
  test(`v3 fresh sync: compact changes and truncation (${kind} store)`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await batch(app, { fileKey: FRESH, rootNodeId: '1:1', upserts: FRESH_TREE() });
    const nodes = qs => get(app, `/v3/files/${FRESH}/nodes?limit=1000${qs ? `&${qs}` : ''}`);

    await t.test('default listing: added nodes carry changedProps, no changes, and the page is much smaller', async () => {
      const res = await nodes('');
      assert.equal(res.statusCode, 200, res.body);
      const page = res.json();
      assert.equal(page.total, 41);
      for (const n of page.nodes) {
        assert.equal(n.changeType, 'added');
        assert.equal('changes' in n, false, n.nodeId);
        assert.ok(n.changedProps.length > 0, n.nodeId);
      }
      assert.deepEqual(page.nodes.find(n => n.nodeId === '2:1').changedProps,
        ['characters', 'fills', 'fontFamily', 'fontSize', 'lineHeight', 'paddingLeft', 'paddingRight']);
      assert.equal(page.truncated, undefined);
      const diff = await nodes('changes=diff');
      assert.ok(res.body.length * 2 < diff.body.length, `${res.body.length} vs ${diff.body.length}`);
      assert.ok(res.body.length < 41 * 600, `fresh-sync page is ${res.body.length} bytes`);
      const instances = (await nodes('instance=true')).json().nodes;
      sameSet(instances.map(n => `${n.nodeId} ${n.isInstance} ${n.mainComponentId}`), [0, 4, 8, 12, 16, 20, 24, 28, 32, 36].map(i => `2:${i} true 9:1`));
    });

    await t.test('changes=diff: sides over 1 KB are truncated with a top-level marker', async () => {
      const page = (await nodes('changes=diff')).json();
      assert.equal(page.truncated, true);
      const long = page.nodes.find(n => n.nodeId === '2:0');
      assert.deepEqual(long.changes.characters, { built: null, now: { truncated: true, bytes: bytes(LONG) }, category: 'content' });
      assert.deepEqual(long.changes.fontSize, { built: null, now: 14, category: 'typography' });
      assert.deepEqual(page.nodes.find(n => n.nodeId === '2:1').changes.characters, { built: null, now: 'Row 1 label text', category: 'content' });
      const small = (await nodes('changes=diff&under=2:1')).json();
      assert.equal(small.truncated, undefined);
      const nd = await nodes('changes=diff&format=ndjson&under=2:0');
      assert.deepEqual(JSON.parse(nd.body.trim()).changes.characters.now, { truncated: true, bytes: bytes(LONG) });
    });

    await t.test('view=full and node detail are never truncated', async () => {
      const full = (await nodes('view=full&changes=diff&under=2:0')).json();
      assert.equal(full.truncated, undefined);
      assert.equal(full.nodes[0].changes.characters.now, LONG);
      const detail = (await get(app, `/v3/files/${FRESH}/nodes/2:0`)).json();
      assert.equal(detail.changes.characters.now, LONG);
      assert.equal((await get(app, `/v3/files/${FRESH}/nodes/2:0?changes=diff&fields=changes`)).json().changes.characters.now, LONG);
    });

    await t.test('modified nodes keep their diff by default, truncated on both sides', async () => {
      await batch(app, { fileKey: FRESH, upserts: FRESH_TREE(), markImplemented: true });
      const cleared = await app.inject({
        method: 'POST', url: `/v3/files/${FRESH}/clear`, headers: agent,
        payload: { commitRef: 'c1', items: FRESH_TREE().map(r => ({ nodeId: r.nodeId, contentHash: r.contentHash })) },
      });
      assert.equal(cleared.statusCode, 200, cleared.body);
      const edited = FRESH_TREE().filter(r => r.nodeId === '2:0' || r.nodeId === '2:1').map(r => up(r.nodeId, r.nodeType, r.name,
        { ...r.attrs, characters: `${r.attrs.characters}!`, fontSize: 16 }, R, r.mainComponentId ? { mainComponentId: r.mainComponentId } : {}));
      await batch(app, { fileKey: FRESH, upserts: edited });
      const page = (await nodes('')).json();
      assert.deepEqual(page.nodes.map(n => [n.nodeId, n.changeType, n.changedProps]), [['2:0', 'modified', ['characters', 'fontSize']], ['2:1', 'modified', ['characters', 'fontSize']]]);
      assert.equal(page.truncated, true);
      assert.deepEqual(page.nodes[0].changes.characters, { built: { truncated: true, bytes: bytes(LONG) }, now: { truncated: true, bytes: bytes(`${LONG}!`) }, category: 'content' });
      assert.deepEqual(page.nodes[1].changes, {
        characters: { built: 'Row 1 label text', now: 'Row 1 label text!', category: 'content' }, fontSize: { built: 14, now: 16, category: 'typography' },
      });
      assert.equal((await get(app, `/v3/files/${FRESH}/nodes/2:0`)).json().changes.characters.built, LONG);
    });
  });
}

test('files and scopes after syncs with and without fileName', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const A = 'FileAAAA', B = 'FileBBBB';
  await batch(app, { fileKey: A, upserts: [up('1:1', 'FRAME', 'Root A', { width: 1 })], markImplemented: true });
  let files = (await get(app, '/v3/files')).json().files;
  assert.deepEqual(files.map(f => [f.fileKey, f.name]), [[A, null]]);
  assert.deepEqual((await get(app, `/v3/files/${A}/scopes`)).json().scopes, [], 'no rootNodeId → no scope');

  await sleep(5);
  await batch(app, { fileKey: B, fileName: 'File B', rootNodeId: '7:1', upserts: [up('7:1', 'SECTION', 'Section', { width: 2 })] });
  files = (await get(app, '/v3/files')).json().files;
  assert.deepEqual(files.map(f => [f.fileKey, f.name]), [[B, 'File B'], [A, null]], 'most recently synced first');
  assert.deepEqual(files[0].counts, { total: 1, dirty: 1, clean: 0, blocked: 0 });

  await sleep(5);
  await batch(app, { fileKey: A, fileName: 'File A', rootNodeId: '1:1', upserts: [up('1:1', 'FRAME', 'Root A', { width: 3 })] });
  await sleep(5);
  await batch(app, { fileKey: A, rootNodeId: '2:1', upserts: [up('2:1', 'FRAME', 'Second', { width: 4 })] });
  await sleep(5);
  await batch(app, { fileKey: A, rootNodeId: '1:1', upserts: [up('1:1', 'FRAME', 'Root A', { width: 5 })] });
  files = (await get(app, '/v3/files')).json().files;
  assert.deepEqual(files.map(f => [f.fileKey, f.name]), [[A, 'File A'], [B, 'File B']]);
  const scopes = (await get(app, `/v3/files/${A}/scopes`)).json().scopes;
  assert.deepEqual(scopes.map(s => [s.nodeId, s.name]), [['1:1', 'Root A'], ['2:1', 'Second']], 'latest per root, newest first');
  assert.deepEqual(scopes[0].lastSyncCounts, { uploaded: 1, changed: 1, added: 0, deleted: 0, baselined: 0, autoResolved: 0 });
  assert.deepEqual(scopes[1].counts, { total: 1, dirty: 1, clean: 0, blocked: 0 });

  const unsynced = await batch(app, { fileKey: A, rootNodeId: '9:9', upserts: [] });
  assert.equal(unsynced.upserted, 0);
  const ghost = (await get(app, `/v3/files/${A}/scopes`)).json().scopes.find(s => s.nodeId === '9:9');
  assert.deepEqual([ghost.name, ghost.counts], [null, { total: 0, dirty: 0, clean: 0, blocked: 0 }]);
});

test('/v3/openapi.json is an OpenAPI 3 document listing every v3 route', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/v3/openapi.json' });
  assert.equal(res.statusCode, 200);
  const doc = res.json();
  assert.match(doc.openapi, /^3\.\d+\.\d+$/);
  assert.equal(typeof doc.info.title, 'string');
  assert.equal(typeof doc.info.version, 'string');
  assert.equal(doc.components.securitySchemes.agentToken.scheme, 'bearer');

  const routes = {
    '/v3/files': ['get'], '/v3/files/{fileKey}': ['get'], '/v3/files/{fileKey}/scopes': ['get'], '/v3/files/{fileKey}/nodes': ['get'],
    '/v3/files/{fileKey}/nodes/{nodeId}': ['get'], '/v3/resolve': ['get'], '/v3/openapi.json': ['get'],
    '/v3/files/{fileKey}/clear': ['post'], '/v3/files/{fileKey}/claims': ['post', 'get'],
    '/v3/files/{fileKey}/claims/{claimId}/renew': ['post'], '/v3/files/{fileKey}/claims/{claimId}': ['delete'],
    '/v3/files/{fileKey}/events': ['get'],
    '/v3/files/{fileKey}/nodes/{nodeId}/block': ['post'], '/v3/files/{fileKey}/nodes/{nodeId}/unblock': ['post'],
    '/v3/files/{fileKey}/summary': ['get'], '/v3/files/{fileKey}/work': ['get'], '/v3/insights/trends': ['get'],
    '/v3/files/{fileKey}/hashes': ['get'], '/v3/files/{fileKey}/sync': ['post'], '/v3/files/{fileKey}/exists': ['post'],
    '/v3/session': ['get', 'delete', 'post'],
    '/v3/status': ['get'], '/v3/tokens': ['get'], '/v3/claims': ['get'],
    '/v3/events': ['get'],
  };
  const pluginRoutes = ['/v3/files/{fileKey}/hashes', '/v3/files/{fileKey}/sync', '/v3/files/{fileKey}/exists'];
  assert.deepEqual(Object.keys(doc.paths).sort(), Object.keys(routes).sort());
  for (const [route, item] of Object.entries(doc.paths)) {
    assert.deepEqual(Object.keys(item).sort(), [...routes[route]].sort(), route);
    for (const method of routes[route]) {
      const op = item[method];
      assert.ok(op.responses['200'], `${method} ${route} documents 200`);
      for (const [status, r] of Object.entries(op.responses)) assert.equal(typeof r.description, 'string', `${route} ${status}`);
      const pathParams = [...route.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      const declared = (op.parameters || []).filter(p => p.in === 'path').map(p => p.name);
      assert.deepEqual(declared.sort(), pathParams.sort(), `${route} path parameters`);
      for (const p of op.parameters || []) {
        assert.ok(['path', 'query'].includes(p.in));
        if (p.in === 'path') assert.equal(p.required, true);
        assert.ok(p.schema, `${route} ${p.name} has a schema`);
      }
      if (route === '/v3/openapi.json') assert.equal(op.security, undefined);
      else if (route === '/v3/session') {
        // Sign-in itself takes no credential; GET reads the session cookie.
        assert.deepEqual(op.security ?? null, method === 'get' ? [{ sessionCookie: [] }] : null, route);
      } else {
        const security = pluginRoutes.includes(route) ? [{ pluginToken: [] }]
          : method === 'get' ? [{ agentToken: [] }, { viewerToken: [] }, { sessionCookie: [] }] : [{ agentToken: [] }, { sessionCookie: [] }];
        assert.deepEqual(op.security, security, route);
        assert.ok(op.responses['403'], `${route} documents 403`);
      }
    }
  }
  const listing = doc.paths['/v3/files/{fileKey}/nodes'].get.parameters.filter(p => p.in === 'query').map(p => p.name);
  for (const name of ['state', 'under', 'depth', 'type', 'changeType', 'changed', 'category', 'component', 'name', 'since', 'claimed',
    'worker', 'q', 'view', 'fields', 'include', 'sort', 'limit', 'cursor', 'url']) assert.ok(listing.includes(name), name);

  const refs = [];
  (function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === '$ref' ? refs.push(x) : walk(x));
  })(doc);
  for (const ref of refs) {
    assert.match(ref, /^#\//);
    const target = ref.slice(2).split('/').reduce((o, k) => (o ? o[k] : undefined), doc);
    assert.ok(target, `${ref} resolves`);
  }
});

test('/v3/openapi.json annotates exactly the agent operations, with model-facing docs, and validates as OpenAPI 3.1', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const res = await app.inject({ method: 'GET', url: '/v3/openapi.json' });
  assert.equal(res.statusCode, 200);
  const doc = res.json();
  assert.equal(doc.openapi, '3.1.0');

  const expected = {
    'get /v3/files': ['list_files', 'files ls'],
    'get /v3/files/{fileKey}': ['get_file', 'files show'],
    'get /v3/files/{fileKey}/scopes': ['list_scopes', 'scopes ls'],
    'get /v3/files/{fileKey}/nodes': ['list_nodes', 'nodes ls'],
    'get /v3/files/{fileKey}/nodes/{nodeId}': ['get_node', 'nodes show'],
    'get /v3/files/{fileKey}/summary': ['summarize', 'summary'],
    'get /v3/files/{fileKey}/work': ['list_work_items', 'work'],
    'get /v3/insights/trends': ['get_trends', 'trends'],
    'post /v3/files/{fileKey}/clear': ['clear_nodes', 'clear'],
    'post /v3/files/{fileKey}/claims': ['claim_nodes', 'claim'],
    'get /v3/files/{fileKey}/claims': ['list_claims', 'claims ls'],
    'post /v3/files/{fileKey}/claims/{claimId}/renew': ['renew_claim', 'renew'],
    'delete /v3/files/{fileKey}/claims/{claimId}': ['release_claim', 'release'],
    'post /v3/files/{fileKey}/nodes/{nodeId}/block': ['block_node', 'block'],
    'post /v3/files/{fileKey}/nodes/{nodeId}/unblock': ['unblock_node', 'unblock'],
    'get /v3/files/{fileKey}/events': ['list_events', 'events'],
    'get /v3/resolve': ['resolve_url', 'resolve'],
  };
  const ops = Object.entries(doc.paths).flatMap(([route, item]) => Object.entries(item).map(([method, op]) => [`${method} ${route}`, op]));
  const annotated = {};
  for (const [key, op] of ops) {
    const mcp = op['x-rds-mcp'], cli = op['x-rds-cli'];
    assert.equal(!!mcp, !!cli, `${key}: both annotations or neither`);
    if (!mcp) {
      assert.deepEqual(Object.keys(op).filter(k => k.startsWith('x-')), [], `${key} has no x- annotations`);
      continue;
    }
    assert.deepEqual(Object.keys(mcp), ['tool'], key);
    assert.deepEqual(Object.keys(cli), ['command'], key);
    annotated[key] = [mcp.tool, cli.command];
  }
  assert.deepEqual(annotated, expected);
  for (const key of ['get /v3/openapi.json', 'get /v3/files/{fileKey}/hashes', 'post /v3/files/{fileKey}/sync', 'post /v3/files/{fileKey}/exists']) {
    const op = ops.find(([k]) => k === key)[1];
    assert.equal(op['x-rds-mcp'], undefined, key);
    assert.equal(op['x-rds-cli'], undefined, key);
  }
  assert.equal(new Set(Object.values(expected).map(([tool]) => tool)).size, 17);
  assert.equal(new Set(Object.values(expected).map(([, command]) => command)).size, 17);

  const described = s => typeof s === 'string' && s.trim().length > 0;
  for (const [key, op] of ops.filter(([k]) => expected[k])) {
    assert.ok(described(op.summary), `${key} summary`);
    assert.ok(described(op.description) && op.description.length > op.summary.length, `${key} description`);
    for (const p of op.parameters || []) assert.ok(described(p.description), `${key} parameter ${p.in}:${p.name} is described`);
    const body = op.requestBody && op.requestBody.content['application/json'].schema;
    for (const [name, prop] of Object.entries((body && body.properties) || {})) assert.ok(described(prop.description), `${key} body member ${name} is described`);
    assert.equal(JSON.stringify(op).includes('$ref'), false, `${key} is self-contained (no $ref)`);
  }
  const listOp = doc.paths['/v3/files/{fileKey}/nodes'].get;
  assert.match(listOp.description, /changes=diff/);
  assert.match(listOp.description, /get_node/);
  const changesParam = listOp.parameters.find(p => p.name === 'changes');
  assert.deepEqual(changesParam.schema.enum, ['auto', 'diff', 'names']);
  assert.match(changesParam.description, /added/);
  assert.deepEqual(doc.paths['/v3/files/{fileKey}/nodes/{nodeId}'].get.parameters.find(p => p.name === 'changes').schema.enum, ['auto', 'diff', 'names']);
  const clearOp = doc.paths['/v3/files/{fileKey}/clear'].post;
  assert.match(clearOp.description, /stale/);
  assert.match(clearOp.description, /get_node/);

  const { Validator } = await import('@seriousme/openapi-schema-validator');
  const validator = new Validator();
  const result = await validator.validate(doc);
  assert.equal(validator.version, '3.1');
  assert.ok(result.valid, JSON.stringify(result.errors));
});
