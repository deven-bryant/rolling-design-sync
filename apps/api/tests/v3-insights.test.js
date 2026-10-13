'use strict';

/*
 * v3 insights and response formats (docs/api-v3-phase2.md, "2. Summaries and
 * work items" and "4. Response formats"): summary counts, work items by
 * component and by frame, and json / ndjson / md on the listing, work items
 * and the events page — against the memory store and PGlite (same SQL as
 * Postgres).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/store/memory');
const { openLocalStore } = require('../src/store/pglite');
const { CATEGORIES, COMPACT_FIELDS, EXPANSION_LIMIT } = require('../src/v3/schemas');

const PLUGIN_TOKEN = 'plugin-secret';
const AGENT_TOKEN = 'agent-secret';
const VIEWER_TOKEN = 'viewer-secret';
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const viewer = { authorization: `Bearer ${VIEWER_TOKEN}` };

const FK = 'InSiGhTs0RuSpspQy2E3WMD';
const FIGMA = (key = FK, nodeId = null) => `https://www.figma.com/design/${key}/My-Design${nodeId ? `?node-id=${nodeId.replace(':', '-')}` : ''}`;

function up(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}

const bound = (fills, token) => ({ fills, boundVariables: { fills: [{ id: 'v1' }] }, resolvedVariables: { v1: { name: token } } });
const LONG = 'A very long caption that goes on and on well past the markdown value limit';

/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Screen A
 * │  ├─ 3:1 INSTANCE Btn (of 6:1)       dirty, modified [fills] (color; bound color/brand/500 → color/brand/600)
 * │  └─ 3:2 TEXT Title                  dirty, modified [characters, fontSize] (content, typography)
 * ├─ 2:2 FRAME Screen B                 clean, blocked
 * │  └─ 3:3 INSTANCE Btn (of 6:1)       clean
 * ├─ 2:3 FRAME Empty                    dirty, added [width] (layout)
 * └─ 6:0 COMPONENT_SET Buttons          clean
 *    ├─ 6:1 COMPONENT Primary           dirty, modified [cornerRadius] (effects)
 *    │  └─ 7:1 TEXT Label               dirty, modified [characters] (content)
 *    └─ 6:2 COMPONENT Secondary         clean
 */
const R = ['1:1'];
const TREE_V1 = () => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Screen A', { itemSpacing: 8 }, R),
  up('3:1', 'INSTANCE', 'Btn', bound(['blue'], 'color/brand/500'), [...R, '2:1'], { mainComponentId: '6:1' }),
  up('3:2', 'TEXT', 'Title', { characters: 'Hi', fontSize: 14 }, [...R, '2:1']),
  up('2:2', 'FRAME', 'Screen B', { itemSpacing: 4 }, R),
  up('3:3', 'INSTANCE', 'Btn', { fills: ['blue'] }, [...R, '2:2'], { mainComponentId: '6:1' }),
  up('6:0', 'COMPONENT_SET', 'Buttons', { width: 200 }, R),
  up('6:1', 'COMPONENT', 'Primary', { cornerRadius: 4 }, [...R, '6:0']),
  up('7:1', 'TEXT', 'Label', { characters: 'OK' }, [...R, '6:0', '6:1']),
  up('6:2', 'COMPONENT', 'Secondary', { cornerRadius: 2 }, [...R, '6:0']),
];
const TREE_V2 = () => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Screen A', { itemSpacing: 8 }, R),
  up('3:1', 'INSTANCE', 'Btn', bound(['green'], 'color/brand/600'), [...R, '2:1'], { mainComponentId: '6:1' }),
  up('3:2', 'TEXT', 'Title', { characters: LONG, fontSize: 16 }, [...R, '2:1']),
  up('2:2', 'FRAME', 'Screen B', { itemSpacing: 4 }, R),
  up('3:3', 'INSTANCE', 'Btn', { fills: ['blue'] }, [...R, '2:2'], { mainComponentId: '6:1' }),
  up('2:3', 'FRAME', 'Empty', { width: 10 }, R),
  up('6:0', 'COMPONENT_SET', 'Buttons', { width: 200 }, R),
  up('6:1', 'COMPONENT', 'Primary', { cornerRadius: 8 }, [...R, '6:0']),
  up('7:1', 'TEXT', 'Label', { characters: 'Go' }, [...R, '6:0', '6:1']),
  up('6:2', 'COMPONENT', 'Secondary', { cornerRadius: 2 }, [...R, '6:0']),
];

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-insights-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return {
      store,
      cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
    };
  },
};

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] component sets: references, remote variants, filtered counts, progress, caps and paging`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const set = { id: '8:0', key: 'TABLE', name: 'Table cell' };
    const ref = (id, key, name) => ({ id, key, name, remote: true, set });
    const first = ref('8:1', 'BADGE', 'Type=Badge');
    const second = ref('8:2', 'TEXT', 'Type=Text');
    const rows = [
      up('1:1', 'FRAME', 'Portal', { childOrder: ['2:1', '2:2'] }),
      up('2:1', 'INSTANCE', 'Cell', { componentReference: first }, ['1:1'], { mainComponentId: first.id }),
      up('2:2', 'INSTANCE', 'Cell', { componentReference: second }, ['1:1'], { mainComponentId: second.id }),
      up(first.id, 'COMPONENT', first.name, { componentReference: first, childOrder: Array.from({ length: 55 }, (_, i) => `9:${i}`) }),
      ...Array.from({ length: 55 }, (_, i) => up(`9:${i}`, 'TEXT', 'Label', { characters: 'Badge' }, [first.id])),
      up(second.id, 'COMPONENT', second.name, { componentReference: second }),
      up('7:1', 'COMPONENT', 'Standalone', { componentReference: { id: '7:1', key: 'PLAIN', name: 'Standalone' } }),
    ];
    await batch(app, { fileKey: FK, upserts: rows });
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/nodes/2:1`)).component, first);
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/nodes/8:1`)).component, first);
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/nodes?instance=true`)).nodes.map(n => n.component), [first, second]);
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/nodes?fields=nodeId,component&instance=true`)).nodes[0], { nodeId: '2:1', component: first });
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/work?group=frame&under=1:1&changes=names`)).items[0].set, set);
    assert.equal(ok(await get(app, `/v3/files/${FK}/nodes/7:1`)).component.set, undefined);
    assert.equal(ok(await get(app, `/v3/files/${FK}/nodes/1:1`)).component, null);
    const query = `/v3/files/${FK}/work?group=set&changes=names&include=progress`;
    const all = ok(await get(app, query));
    assert.equal(all.total, 3);
    const merged = all.items.find(i => i.key === 'TABLE');
    assert.deepEqual(merged.set, set);
    assert.equal(merged.name, 'Table cell');assert.equal(merged.type, 'COMPONENT_SET');
    assert.equal(merged.nodeCount, 57);assert.equal(merged.nodeIds.length, 50);assert.equal(merged.more, 7);
    assert.deepEqual(merged.variants, [{ key: 'BADGE', name: first.name, nodeCount: 56 }, { key: 'TEXT', name: second.name, nodeCount: 1 }]);
    assert.deepEqual(merged.progress, { total: 57, clean: 0 });
    const pages = [];
    let cursor = null;
    do {
      const page = ok(await get(app, `${query}&limit=1${cursor ? `&cursor=${cursor}` : ''}`));
      assert.equal(page.total, all.total);pages.push(...page.items);cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(pages, all.items);
    const expanded = ok(await get(app, `${query}&under=1:1&expand=instances`));
    assert.equal(expanded.items.find(i => i.key === 'TABLE').nodeCount, 57);
    const filtered = ok(await get(app, `${query}&type=TEXT`)).items[0];
    assert.equal(filtered.nodeCount, 55);assert.deepEqual(filtered.variants, [{ key: 'BADGE', name: first.name, nodeCount: 55 }]);
    const components = ok(await get(app, `/v3/files/${FK}/work?changes=names`)).items;
    assert.equal(components.filter(i => i.set?.key === 'TABLE').length, 2);
    await app.inject({ method: 'POST', url: `/v3/files/${FK}/clear`, headers: agent, payload: { items: [{ nodeId: second.id, contentHash: rows.find(n => n.nodeId === second.id).contentHash }] } });
    const dirty = ok(await get(app, query)).items.find(i => i.key === 'TABLE');
    assert.equal(dirty.nodeCount, 56);assert.deepEqual(dirty.progress, { total: 57, clean: 1 });
    const lines = outline(await get(app, `/v3/files/${FK}/nodes?under=1:1&format=outline`));
    assert.ok(lines.some(l => l.includes('→ 8:1 Table cell / Type=Badge')));
    const workLines = outline(await get(app, `/v3/files/${FK}/work?group=set&format=outline&state=all`));
    assert.ok(workLines.some(l => l.startsWith('Table cell (COMPONENT_SET) · 57 nodes')));
    assert.deepEqual(await outlinePages(app, `/v3/files/${FK}/work?group=set&format=outline&state=all`, 3), workLines);
  });

  test(`[${kind}] group=set merges stored set roots and variants without captured set metadata`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);await seed(app, store);
    const result = ok(await get(app, `/v3/files/${FK}/work?group=set&state=all&changes=names`));
    const item = result.items.find(i => i.key === '6:0');
    assert.deepEqual(item.set, { id: '6:0', key: '6:0', name: 'Buttons' });
    assert.equal(item.nodeCount, 4);
    assert.deepEqual(item.nodeIds, ['6:0', '6:1', '7:1', '6:2']);
    assert.deepEqual(item.variants, [{ key: '6:1', name: 'Primary', nodeCount: 2 }, { key: '6:2', name: 'Secondary', nodeCount: 1 }]);
  });

  test(`[${kind}] group=set uses the captured set key for its stored root and older variants too`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const fileKey = 'AbCdEf123456GhIjKl7890';
    const set = { id: '6:0', key: 'BUTTONS', name: 'Button' };
    const reference = { id: '6:1', key: 'PRIMARY', name: 'State=Default', set };
    await batch(app, { fileKey, upserts: [
      up(set.id, 'COMPONENT_SET', set.name, { childOrder: ['6:1', '6:2'] }),
      up('6:1', 'COMPONENT', reference.name, { componentReference: reference }, [set.id]),
      up('6:2', 'COMPONENT', 'State=Hover', {}, [set.id]),
    ] });
    const result = ok(await get(app, `/v3/files/${fileKey}/work?group=set&changes=names`));
    assert.equal(result.total, 1);
    assert.deepEqual(result.items[0].set, set);
    assert.equal(result.items[0].key, set.key);
    assert.equal(result.items[0].nodeCount, 3);
    assert.deepEqual(result.items[0].nodeIds, ['6:0', '6:1', '6:2']);
    assert.deepEqual(result.items[0].variants, [{ key: 'PRIMARY', name: reference.name, nodeCount: 1 }, { key: '6:2', name: 'State=Hover', nodeCount: 1 }]);
    const defaults = ok(await get(app, `/v3/files/${fileKey}/work?changes=names`));
    assert.deepEqual(defaults.items.map(i => i.key), ['6:0', '6:1', '6:2']);
    for (const item of defaults.items) assert.deepEqual(item.set, set);
  });
}

async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN }) });
  return { app, store, close: async () => { await app.close(); await cleanup(); } };
}

async function batch(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${body.fileKey}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

async function seed(app, store) {
  await batch(app, { fileKey: FK, fileName: 'Insights', rootNodeId: '1:1', upserts: TREE_V1(), markImplemented: true });
  await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: TREE_V2() });
  await store.updateNode(FK, '2:2', { blockedAt: new Date().toISOString(), blockedBy: 'agent-7', blockedReason: 'Copy not final' });
}

const get = (app, url, headers = agent) => app.inject({ method: 'GET', url, headers });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const zeros = keys => Object.fromEntries(keys.map(k => [k, 0]));
const cats = counts => ({ ...zeros(CATEGORIES), ...counts });

function assertProblem(res, status, code) {
  assert.equal(res.statusCode, status, res.body);
  assert.match(res.headers['content-type'], /^application\/problem\+json/);
  const body = res.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.hint, 'string');
  return body;
}

const ndjson = res => {
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers['content-type'], /^application\/x-ndjson/);
  assert.ok(res.body === '' || res.body.endsWith('\n'));
  return res.body.split('\n').filter(Boolean).map(line => JSON.parse(line));
};
const markdown = res => {
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers['content-type'], /^text\/markdown/);
  return res.body.split('\n').filter(Boolean);
};
/** A format=outline body: text/plain, one line each, ending in a newline. */
const outline = res => {
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers['content-type'], /^text\/plain; charset=utf-8/);
  assert.ok(res.body === '' || res.body.endsWith('\n'));
  return res.body === '' ? [] : res.body.slice(0, -1).split('\n');
};
/** The cursor of an outline's final `… N more … — cursor=<c>` line. */
const outlineCursor = lines => lines[lines.length - 1].match(/ — cursor=(\S+)$/)[1];
/** The X-RDS-Next-Cursor of an outline response (null on its last page). */
const nextCursor = res => res.headers['x-rds-next-cursor'] ?? null;
/** Every page of outline `url` at `limit` lines, following X-RDS-Next-Cursor, concatenated. */
async function outlinePages(app, url, limit) {
  const lines = [];
  let cursor = null;
  do {
    const res = await get(app, `${url}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
    const page = outline(res);
    assert.ok(page.length <= limit, `${page.length} lines at limit=${limit}`);
    lines.push(...page);
    cursor = nextCursor(res);
  } while (cursor);
  return lines;
}

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] work progress counts all states for component and frame items`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);
    const route = `/v3/files/${FK}/work`;
    const dirty = ok(await get(app, `${route}?include=progress&changes=names`));
    assert.deepEqual(dirty.items.map(i => [i.key, i.nodeCount, i.progress]), [
      ['6:1', 2, { total: 2, clean: 0 }], [null, 3, { total: 7, clean: 3 }],
    ]);
    const clean = ok(await get(app, `${route}?include=progress&state=clean&changes=names`));
    assert.deepEqual(clean.items.map(i => [i.key, i.nodeCount, i.progress]), [
      ['6:0', 1, { total: 1, clean: 1 }], ['6:2', 1, { total: 1, clean: 1 }], [null, 3, { total: 7, clean: 3 }],
    ]);
    const frames = ok(await get(app, `${route}?group=frame&under=1:1&include=progress&changes=names`));
    assert.deepEqual(frames.items.map(i => [i.key, i.nodeCount, i.progress]), [
      ['2:1', 2, { total: 3, clean: 1 }], ['2:3', 1, { total: 1, clean: 0 }], ['6:0', 2, { total: 4, clean: 2 }],
    ]);
    const blocked = ok(await get(app, `${route}?group=frame&under=1:1&include=progress&state=blocked`));
    assert.deepEqual(blocked.items.map(i => [i.key, i.progress]), [['2:2', { total: 2, clean: 1 }]]);
    assert.ok(ok(await get(app, route)).items.every(i => !('progress' in i)));
    const page = ok(await get(app, `${route}?include=progress&limit=1`));
    assert.deepEqual(ok(await get(app, `${route}?include=progress&limit=1&cursor=${page.nextCursor}`)).items[0].progress, { total: 7, clean: 3 });
    assertProblem(await get(app, `${route}?limit=1&cursor=${page.nextCursor}`), 400, 'invalid_cursor');
    const ndjson = await get(app, `${route}?include=progress&format=ndjson&changes=names`);
    assert.deepEqual(ndjson.body.trim().split('\n').map(JSON.parse).map(i => i.progress), dirty.items.map(i => i.progress));
    assert.equal((await get(app, `${route}?include=unknown`)).statusCode, 400);
  });

  test(`[${kind}] progress is independent of capped nodeIds and excludes cleared tombstones`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const nodes = [up('1:1', 'COMPONENT', 'Large', { width: 1 }),
      ...Array.from({ length: 60 }, (_, i) => up(`2:${i}`, 'TEXT', `Label ${i}`, { characters: 'text' }, ['1:1']))];
    await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: nodes });
    await store.updateNode(FK, '2:0', { dirty: false, implementedHash: nodes[1].contentHash });
    await store.updateNode(FK, '2:1', { dirty: false, deletedAt: new Date().toISOString() });
    const { items } = ok(await get(app, `/v3/files/${FK}/work?include=progress`));
    assert.equal(items[0].nodeIds.length, 50);
    assert.equal(items[0].nodeCount, 59);
    assert.deepEqual(items[0].progress, { total: 60, clean: 1 });
  });

  test(`[${kind}] summary: counts of the listing filter, default state=dirty, byFrame only with under`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);

    const dirty = ok(await get(app, `/v3/files/${FK}/summary`));
    assert.deepEqual(dirty, {
      fileKey: FK,
      total: 5,
      byState: { dirty: 5, clean: 0, blocked: 0 },
      byChangeType: { added: 1, modified: 4, deleted: 0, requested: 0 },
      byCategory: cats({ color: 1, content: 2, typography: 1, effects: 1, layout: 1 }),
      byType: { COMPONENT: 1, FRAME: 1, INSTANCE: 1, TEXT: 2 },
    });

    const all = ok(await get(app, `/v3/files/${FK}/summary?state=all`));
    assert.equal(all.total, 11);
    assert.deepEqual(all.byState, { dirty: 5, clean: 5, blocked: 1 });
    assert.deepEqual(all.byChangeType, { added: 1, modified: 4, deleted: 0, requested: 0 });
    assert.deepEqual(all.byType, { COMPONENT: 2, COMPONENT_SET: 1, FRAME: 3, INSTANCE: 2, SECTION: 1, TEXT: 2 });
    assert.equal(all.byFrame, undefined);

    const under = ok(await get(app, `/v3/files/${FK}/summary?under=1-1`));
    assert.equal(under.total, 5);
    assert.deepEqual(under.byFrame, [
      { nodeId: '2:1', name: 'Screen A', count: 2 },
      { nodeId: '2:3', name: 'Empty', count: 1 },
      { nodeId: '6:0', name: 'Buttons', count: 2 },
    ]);

    const filtered = ok(await get(app, `/v3/files/${FK}/summary?under=1:1&category=content`));
    assert.equal(filtered.total, 2);
    assert.deepEqual(filtered.byCategory, cats({ content: 2, typography: 1 }));
    assert.deepEqual(filtered.byType, { TEXT: 2 });
    assert.deepEqual(filtered.byFrame, [{ nodeId: '2:1', name: 'Screen A', count: 1 }, { nodeId: '6:0', name: 'Buttons', count: 1 }]);

    const deep = ok(await get(app, `/v3/files/${FK}/summary?state=all&under=6:0`));
    assert.equal(deep.total, 4, 'the under node itself counts in total');
    assert.deepEqual(deep.byFrame, [{ nodeId: '6:1', name: 'Primary', count: 2 }, { nodeId: '6:2', name: 'Secondary', count: 1 }]);

    const q = ok(await get(app, `/v3/files/${FK}/summary?q=${encodeURIComponent('state:blocked,clean type:FRAME')}`));
    assert.deepEqual([q.total, q.byState], [2, { dirty: 0, clean: 1, blocked: 1 }]);
    const url = ok(await get(app, `/v3/files/-/summary?url=${encodeURIComponent(FIGMA(FK, '2:1'))}`));
    assert.deepEqual([url.total, url.byFrame], [2, [{ nodeId: '3:1', name: 'Btn', count: 1 }, { nodeId: '3:2', name: 'Title', count: 1 }]]);
    const none = ok(await get(app, `/v3/files/${FK}/summary?name=nothing*`));
    assert.deepEqual([none.total, none.byType, none.byState], [0, {}, { dirty: 0, clean: 0, blocked: 0 }]);

    assertProblem(await get(app, `/v3/files/${FK}/summary?state=nope`), 400, 'invalid_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/summary?limit=5`), 400, 'unknown_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/summary?under=99:9`), 404, 'node_not_found');
    assertProblem(await get(app, '/v3/files/NoSuchFile/summary'), 404, 'file_not_found');
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/summary`, viewer)), dirty);
  });

  test(`[${kind}] work items: group=component with placements, group=frame, key null last, filters`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);

    const byComponent = ok(await get(app, `/v3/files/${FK}/work?changes=names`));
    assert.deepEqual(byComponent, {
      fileKey: FK,
      group: 'component',
      items: [
        { key: '6:1', name: 'Primary', type: 'COMPONENT', set: { id: '6:0', key: '6:0', name: 'Buttons' }, nodeCount: 2, notes: 0, categories: ['content', 'effects'], changedProps: ['characters', 'cornerRadius'],
          placements: 2, nodeIds: ['6:1', '7:1'], more: 0 },
        { key: null, name: null, type: null, nodeCount: 3, notes: 0, categories: ['color', 'content', 'layout', 'typography'],
          changedProps: ['characters', 'fills', 'fontSize', 'width'], placements: null, nodeIds: ['3:1', '3:2', '2:3'], more: 0 },
      ],
      nextCursor: null,
      total: 2,
    });
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/work?group=component&changes=names`)), byComponent);

    const all = ok(await get(app, `/v3/files/${FK}/work?state=all`));
    assert.deepEqual(all.items.map(i => [i.key, i.type, i.nodeCount, i.placements]), [
      ['6:0', 'COMPONENT_SET', 1, 0], ['6:1', 'COMPONENT', 2, 2], ['6:2', 'COMPONENT', 1, 0], [null, null, 7, null],
    ]);

    const byFrame = ok(await get(app, `/v3/files/${FK}/work?group=frame&under=1:1&changes=names`));
    assert.equal(byFrame.group, 'frame');
    assert.deepEqual(byFrame.items, [
      { key: '2:1', name: 'Screen A', type: 'FRAME', nodeCount: 2, notes: 0, categories: ['color', 'content', 'typography'], changedProps: ['characters', 'fills', 'fontSize'], nodeIds: ['3:1', '3:2'], more: 0 },
      { key: '2:3', name: 'Empty', type: 'FRAME', nodeCount: 1, notes: 0, categories: ['layout'], changedProps: ['width'], nodeIds: ['2:3'], more: 0 },
      { key: '6:0', name: 'Buttons', type: 'COMPONENT_SET', set: { id: '6:0', key: '6:0', name: 'Buttons' }, nodeCount: 2, notes: 0, categories: ['content', 'effects'], changedProps: ['characters', 'cornerRadius'], nodeIds: ['6:1', '7:1'], more: 0 },
    ]);
    const withRoot = ok(await get(app, `/v3/files/${FK}/work?group=frame&state=all&url=${encodeURIComponent(FIGMA(FK, '6:0'))}`));
    assert.deepEqual(withRoot.items.map(i => [i.key, i.nodeIds]), [['6:1', ['6:1', '7:1']], ['6:2', ['6:2']], [null, ['6:0']]]);

    const filtered = ok(await get(app, `/v3/files/${FK}/work?group=frame&under=1:1&changed=char*`));
    assert.deepEqual(filtered.items.map(i => [i.key, i.nodeIds]), [['2:1', ['3:2']], ['6:0', ['7:1']]]);
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/work?type=INSTANCE`)).items.map(i => [i.key, i.nodeIds]), [[null, ['3:1']]]);

    const missing = assertProblem(await get(app, `/v3/files/${FK}/work?group=frame`), 400, 'invalid_parameter');
    assert.match(missing.detail, /under/);
    assert.match(missing.hint, /under=/);
    assertProblem(await get(app, `/v3/files/${FK}/work?group=page`), 400, 'invalid_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/work?grop=frame`), 400, 'unknown_parameter');
    assert.deepEqual(ok(await get(app, `/v3/files/${FK}/work?changes=names`, viewer)), byComponent);
  });

  test(`[${kind}] work items honor changes=auto|diff|names, truncating sides over 1 KB`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);
    const work = async qs => ok(await get(app, `/v3/files/${FK}/work${qs ? `?${qs}` : ''}`));
    const changesOf = page => Object.fromEntries(page.items.map(i => [i.key, i.changes]));

    const auto = await work('');
    assert.deepEqual(await work('changes=auto'), auto);
    assert.equal(auto.truncated, undefined);
    assert.deepEqual(changesOf(auto), {
      '6:1': {
        '6:1': { cornerRadius: { built: 4, now: 8, category: 'effects' } },
        '7:1': { characters: { built: 'OK', now: 'Go', category: 'content' } },
      },
      null: {
        '3:1': { fills: { built: { token: 'color/brand/500', value: ['blue'] }, now: { token: 'color/brand/600', value: ['green'] }, category: 'color' } },
        '3:2': { characters: { built: 'Hi', now: LONG, category: 'content' }, fontSize: { built: 14, now: 16, category: 'typography' } },
      },
    });
    const names = await work('changes=names');
    assert.deepEqual(auto.items.map(({ changes, ...rest }) => rest), names.items);
    for (const i of names.items) assert.equal('changes' in i, false);

    const diff = await work('changes=diff');
    assert.deepEqual(changesOf(diff)[null]['2:3'], { width: { built: null, now: 10, category: 'layout' } });
    assert.deepEqual(changesOf(diff)['6:1'], changesOf(auto)['6:1']);
    assert.deepEqual(Object.keys(changesOf(diff)[null]), ['3:1', '3:2', '2:3']);
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/work?format=ndjson&changes=diff`)), diff.items);

    const clean = await work('state=all&changes=diff');
    assert.deepEqual(changesOf(clean)['6:2'], {});
    assertProblem(await get(app, `/v3/files/${FK}/work?changes=full`), 400, 'invalid_parameter');
    const page = await work('state=all&limit=2');
    assertProblem(await get(app, `/v3/files/${FK}/work?state=all&limit=2&changes=names&cursor=${page.nextCursor}`), 400, 'invalid_cursor');

    const huge = 'x'.repeat(2000);
    await batch(app, { fileKey: FK, upserts: [up('7:1', 'TEXT', 'Label', { characters: huge }, [...R, '6:0', '6:1'])] });
    const cut = await work('');
    assert.equal(cut.truncated, true);
    assert.deepEqual(changesOf(cut)['6:1']['7:1'].characters, { built: 'OK', now: { truncated: true, bytes: huge.length + 2 }, category: 'content' });
    assert.equal(ok(await get(app, `/v3/files/${FK}/nodes/7:1`)).changes.characters.now, huge);
    assert.equal((await work('changes=names')).truncated, undefined);
  });

  test(`[${kind}] work items page with the listing's cursors; nodeIds is capped at 50 with more`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);

    const first = ok(await get(app, `/v3/files/${FK}/work?state=all&limit=2`));
    assert.deepEqual([first.items.map(i => i.key), first.total], [['6:0', '6:1'], 4]);
    assert.equal(typeof first.nextCursor, 'string');
    const second = ok(await get(app, `/v3/files/${FK}/work?state=all&limit=2&cursor=${first.nextCursor}`));
    assert.deepEqual([second.items.map(i => i.key), second.nextCursor, second.total], [['6:2', null], null, 4]);
    const tail = ok(await get(app, `/v3/files/${FK}/work?state=all&limit=3&cursor=${first.nextCursor}`));
    assert.deepEqual(tail.items.map(i => i.key), ['6:2', null]);

    assertProblem(await get(app, `/v3/files/${FK}/work?state=dirty&limit=2&cursor=${first.nextCursor}`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/work?state=all&group=frame&under=1:1&cursor=${first.nextCursor}`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?state=all&cursor=${first.nextCursor}`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/work?cursor=bogus`), 400, 'invalid_cursor');

    const kids = Array.from({ length: 60 }, (_, i) => up(`8:${String(i).padStart(3, '0')}`, 'TEXT', `Line ${i}`, { characters: `L${i}` }, [...R, '8:0']));
    await batch(app, { fileKey: FK, upserts: [up('8:0', 'COMPONENT', 'List', { width: 1 }, R), ...kids] });
    const [list] = ok(await get(app, `/v3/files/${FK}/work?limit=1`)).items;
    assert.equal(list.key, '6:1', 'tree order: 1:1.6:0.6:1 before 1:1.8:0');
    const big = ok(await get(app, `/v3/files/${FK}/work`)).items.find(i => i.key === '8:0');
    assert.equal(big.nodeCount, 61);
    assert.equal(big.nodeIds.length, 50);
    assert.equal(big.more, 11);
    assert.deepEqual(big.nodeIds, ['8:0', ...kids.slice(0, 49).map(k => k.nodeId)]);
    assert.equal(big.placements, 0);
  });

  test(`[${kind}] formats: ndjson and md on the listing, work items and the events page`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);

    const json = ok(await get(app, `/v3/files/${FK}/nodes?format=json`));
    const lines = ndjson(await get(app, `/v3/files/${FK}/nodes?format=ndjson`));
    assert.deepEqual(lines, json.nodes);
    assert.deepEqual(Object.keys(lines[0]).sort(), [...COMPACT_FIELDS].sort());
    const res = await get(app, `/v3/files/${FK}/nodes?format=ndjson`);
    assert.equal(res.headers['x-total-count'], '5');
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/nodes?format=ndjson&fields=nodeId,state&limit=2`)), [
      { nodeId: '3:1', state: 'dirty' }, { nodeId: '3:2', state: 'dirty' },
    ]);
    const page = ok(await get(app, `/v3/files/${FK}/nodes?limit=2`));
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/nodes?format=ndjson&cursor=${page.nextCursor}`)).map(n => n.nodeId), ['2:3', '6:1', '7:1']);

    const md = markdown(await get(app, `/v3/files/${FK}/nodes?format=md&state=all&sort=path`));
    assert.equal(md.length, 11);
    const line = id => md.find(l => l.includes(`node-id=${id.replace(':', '-')})`));
    assert.equal(line('3:1'), `- [ ] **Btn** (INSTANCE) — fills color/brand/500 → color/brand/600 · [Figma](${core.link(FK, '3:1')})`);
    assert.equal(line('3:2'), `- [ ] **Title** (TEXT) — characters Hi → ${LONG.slice(0, 39)}…; fontSize 14 → 16 · [Figma](${core.link(FK, '3:2')})`);
    assert.equal(line('6:1'), `- [ ] **Primary** (COMPONENT) — cornerRadius 4 → 8 · [Figma](${core.link(FK, '6:1')})`);
    assert.equal(line('2:3'), `- [ ] **Empty** (FRAME) — added · [Figma](${core.link(FK, '2:3')})`);
    assert.equal(line('2:2'), `- [ ] **Screen B** (FRAME) — no design changes · blocked: Copy not final · [Figma](${core.link(FK, '2:2')})`);
    assert.equal(line('6:0'), `- [x] **Buttons** (COMPONENT\\_SET) — clean · [Figma](${core.link(FK, '6:0')})`);
    assert.deepEqual(markdown(await get(app, `/v3/files/${FK}/nodes?format=md&limit=1`)), [line('3:1')]);

    const work = ok(await get(app, `/v3/files/${FK}/work`));
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/work?format=ndjson`)), work.items);
    assert.deepEqual(markdown(await get(app, `/v3/files/${FK}/work?format=md`)), [
      `- [ ] **Primary** (COMPONENT) — 2 nodes: characters, cornerRadius · 2 placements · [Figma](${core.link(FK, '6:1')})`,
      '- [ ] **(no component)** — 3 nodes: characters, fills, fontSize, width',
    ]);
    assert.deepEqual(markdown(await get(app, `/v3/files/${FK}/work?format=md&group=frame&under=1:1&limit=1`)), [
      `- [ ] **Screen A** (FRAME) — 2 nodes: characters, fills, fontSize · [Figma](${core.link(FK, '2:1')})`,
    ]);

    const events = ok(await get(app, `/v3/files/${FK}/events`));
    assert.ok(events.events.length >= 2);
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/events?format=ndjson`)), events.events);
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/events?format=ndjson&after=${events.events[0].id}&limit=1`)), [events.events[1]]);
    const eventLines = markdown(await get(app, `/v3/files/${FK}/events?format=md`));
    assert.equal(eventLines.length, events.events.length);
    const e = events.events[0];
    assert.ok(eventLines[0].startsWith(`- ${e.createdAt} **sync.completed** #${e.id} by plugin — `), eventLines[0]);
    assert.match(eventLines[0], /rootNodeId: 1:1/);

    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/nodes?format=ndjson&name=nothing*`)), []);
    assert.deepEqual(ndjson(await get(app, `/v3/files/${FK}/nodes?format=ndjson`, viewer)), json.nodes);
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=csv`), 400, 'invalid_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/summary?format=md`), 400, 'unknown_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=md&state=nope`), 400, 'invalid_parameter');
  });

  test(`[${kind}] format=outline: the listing as an indented tree relative to under, filters, limit and cursor, work items`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    await seed(app, store);

    const res = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all`);
    assert.equal(res.headers['x-total-count'], '11');
    assert.deepEqual(outline(res), [
      'Page (SECTION) · clean',
      '  Screen A (FRAME) · clean',
      '    Btn (INSTANCE → 6:1 Primary) · modified (1: fills)',
      '    Title (TEXT) · modified (2: characters, fontSize)',
      '  Screen B (FRAME) · clean · blocked',
      '    Btn (INSTANCE → 6:1 Primary) · clean',
      '  Empty (FRAME) · added',
      '  Buttons (COMPONENT_SET) · clean',
      '    Primary (COMPONENT) · modified (1: cornerRadius)',
      '      Label (TEXT) · modified (1: characters)',
      '    Secondary (COMPONENT) · clean',
    ]);
    const screenA = [
      'Screen A (FRAME) · clean',
      '  Btn (INSTANCE → 6:1 Primary) · modified (1: fills)',
      '  Title (TEXT) · modified (2: characters, fontSize)',
    ];
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&under=2:1`)), screenA, 'depth is relative to under');
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&under=2:1&fields=nodeId&view=full&changes=diff`)), screenA,
      'fields, view and changes leave the lines as they are');
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline&url=${encodeURIComponent(FIGMA(FK, '2:1'))}&state=all`)), screenA);

    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline`)), [
      'Btn (INSTANCE → 6:1 Primary) · modified (1: fills)',
      'Title (TEXT) · modified (2: characters, fontSize)',
      'Empty (FRAME) · added',
      'Primary (COMPONENT) · modified (1: cornerRadius)',
      '  Label (TEXT) · modified (1: characters)',
    ], 'default state=dirty hides the clean ancestors: each node is indented under its nearest shown ancestor, none left at the margin');
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&type=TEXT,COMPONENT_SET`)), [
      'Title (TEXT) · modified (2: characters, fontSize)',
      'Buttons (COMPONENT_SET) · clean',
      '  Label (TEXT) · modified (1: characters)',
    ]);
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline&name=nothing*`)), []);

    const whole = outline(res);
    assert.equal(nextCursor(res), null, 'no X-RDS-Next-Cursor when every line is there');
    const firstRes = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&limit=4`);
    const first = outline(firstRes);
    assert.deepEqual(first, whole.slice(0, 4), 'limit counts rendered lines; no more line in the body');
    assert.equal(firstRes.headers['x-total-count'], '11');
    assert.ok(nextCursor(firstRes));
    const secondRes = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&limit=4&cursor=${nextCursor(firstRes)}`);
    assert.deepEqual(outline(secondRes), [
      '  Screen B (FRAME) · clean · blocked',
      '    Btn (INSTANCE → 6:1 Primary) · clean',
      '  Empty (FRAME) · added',
      '  Buttons (COMPONENT_SET) · clean',
    ], 'a later page keeps its indentation: the tree was rendered whole');
    const lastRes = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&cursor=${nextCursor(secondRes)}`);
    assert.deepEqual(outline(lastRes), whole.slice(8), 'without limit, every line from the cursor on');
    assert.equal(nextCursor(lastRes), null);
    for (const size of [1, 7, 25]) {
      assert.deepEqual(await outlinePages(app, `/v3/files/${FK}/nodes?format=outline&state=all`, size), whole, `pages of ${size} lines`);
    }
    const exact = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&limit=11`);
    assert.equal(outline(exact).length, 11);
    assert.equal(nextCursor(exact), null, 'no cursor when limit covers everything');
    const json = ok(await get(app, `/v3/files/${FK}/nodes?state=all&limit=4`));
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&limit=4&cursor=${json.nextCursor}`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&under=2:1&cursor=${nextCursor(firstRes)}`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?state=all&cursor=${nextCursor(firstRes)}`), 400, 'invalid_cursor');

    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=outline&sort=-path`), 400, 'invalid_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=outline&sort=name`), 400, 'invalid_parameter');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=outline&cursor=bogus`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/events?format=outline`), 400, 'invalid_parameter');
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&sort=path&under=2:1`, viewer)), screenA);

    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/work?format=outline`)), [
      'Primary (COMPONENT) · 2 nodes · changed (2: characters, cornerRadius) · 2 placements',
      '  Primary (COMPONENT) · modified (1: cornerRadius)',
      '    Label (TEXT) · modified (1: characters)',
      '(no component) · 3 nodes · changed (4: characters, fills, …)',
      '  Btn (INSTANCE → 6:1 Primary) · modified (1: fills)',
      '  Title (TEXT) · modified (2: characters, fontSize)',
      '  Empty (FRAME) · added',
    ]);
    const allItems = outline(await get(app, `/v3/files/${FK}/work?format=outline&state=all`));
    assert.deepEqual(allItems.filter(l => !l.startsWith(' ')), [
      'Buttons (COMPONENT_SET) · 1 node · 0 placements',
      'Primary (COMPONENT) · 2 nodes · changed (2: characters, cornerRadius) · 2 placements',
      'Secondary (COMPONENT) · 1 node · 0 placements',
      '(no component) · 7 nodes · changed (4: characters, fills, …)',
    ]);
    const items = await get(app, `/v3/files/${FK}/work?format=outline&state=all&limit=4`);
    assert.deepEqual(outline(items), allItems.slice(0, 4), 'limit counts lines, not items');
    const rest = await get(app, `/v3/files/${FK}/work?format=outline&state=all&cursor=${nextCursor(items)}`);
    assert.deepEqual(outline(rest), allItems.slice(4));
    assert.equal(nextCursor(rest), null);
    for (const size of [1, 7, 25]) {
      assert.deepEqual(await outlinePages(app, `/v3/files/${FK}/work?format=outline&state=all`, size), allItems, `work pages of ${size} lines`);
    }
    assertProblem(await get(app, `/v3/files/${FK}/work?format=outline&state=all&group=frame&under=1:1&cursor=${nextCursor(items)}`), 400, 'invalid_cursor');
    assertProblem(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&cursor=${nextCursor(items)}`), 400, 'invalid_cursor');
    assert.deepEqual(outline(await get(app, `/v3/files/${FK}/work?format=outline&group=frame&under=1:1&limit=3`)), [
      'Screen A (FRAME) · 2 nodes · changed (3: characters, fills, …)',
      '  Btn (INSTANCE → 6:1 Primary) · modified (1: fills)',
      '  Title (TEXT) · modified (2: characters, fontSize)',
    ]);
  });
}

/*
 * expand=instances fixture (file XK):
 * 1:1 SECTION Screens
 * ├─ 2:1 FRAME Screen
 * │  ├─ 3:1 INSTANCE A (of 10:1)
 * │  ├─ 3:2 TEXT Title                dirty, modified
 * │  ├─ 3:3 INSTANCE A (of 10:1)
 * │  └─ 3:4 INSTANCE C (of 30:1)
 * └─ 2:2 FRAME Other
 *    └─ 4:1 INSTANCE A (of 10:1)
 * 9:0 SECTION Components
 * ├─ 10:1 COMPONENT A
 * │  ├─ 10:2 TEXT A label             dirty, modified
 * │  └─ 10:3 INSTANCE B (of 20:1)
 * ├─ 20:1 COMPONENT B
 * │  ├─ 20:2 INSTANCE A (of 10:1)     (cycle A → B → A)
 * │  └─ 20:3 RECTANGLE B bg           dirty, modified
 * └─ 30:1 COMPONENT C
 *    └─ 30:2 INSTANCE Ghost (of 99:9) (never synced)
 */
const XK = 'ExPaNd0RuSpspQy2E3WMD';
const S = ['1:1'], C = ['9:0'];
const inst = (id, name, ancestors, main) => up(id, 'INSTANCE', name, { w: 1 }, ancestors, { mainComponentId: main });
const EXPAND_SCREENS = (v = 1) => [
  up('1:1', 'SECTION', 'Screens', { width: 1000 }),
  up('2:1', 'FRAME', 'Screen', { itemSpacing: 8 }, S),
  inst('3:1', 'A', [...S, '2:1'], '10:1'),
  up('3:2', 'TEXT', 'Title', { characters: v === 1 ? 'Hi' : 'Hello' }, [...S, '2:1']),
  inst('3:3', 'A', [...S, '2:1'], '10:1'),
  inst('3:4', 'C', [...S, '2:1'], '30:1'),
  up('2:2', 'FRAME', 'Other', { itemSpacing: 4 }, S),
  inst('4:1', 'A', [...S, '2:2'], '10:1'),
];
const EXPAND_COMPONENTS = (v = 1) => [
  up('9:0', 'SECTION', 'Components', { width: 1000 }),
  up('10:1', 'COMPONENT', 'A', { cornerRadius: 4 }, C),
  up('10:2', 'TEXT', 'A label', { characters: v === 1 ? 'A' : 'AA' }, [...C, '10:1']),
  inst('10:3', 'B', [...C, '10:1'], '20:1'),
  up('20:1', 'COMPONENT', 'B', { cornerRadius: 2 }, C),
  inst('20:2', 'A', [...C, '20:1'], '10:1'),
  up('20:3', 'RECTANGLE', 'B bg', { opacity: v === 1 ? 1 : 0.5 }, [...C, '20:1']),
  up('30:1', 'COMPONENT', 'C', { cornerRadius: 1 }, C),
  inst('30:2', 'Ghost', [...C, '30:1'], '99:9'),
];
const SCOPE = ['2:1', '3:1', '3:2', '3:3', '3:4'];
const VIA_A = { instanceId: '3:1', mainComponentId: '10:1', depth: 1 };
const VIA_C = { instanceId: '3:4', mainComponentId: '30:1', depth: 1 };
const VIA_B = { instanceId: '10:3', mainComponentId: '20:1', depth: 2 };
/** The expansion of 2:1, in listing order, with each node's `via`. */
const EXPANDED = [
  ...SCOPE.map(id => [id, null]),
  ['10:1', VIA_A], ['10:2', VIA_A], ['10:3', VIA_A],
  ['30:1', VIA_C], ['30:2', VIA_C],
  ['20:1', VIA_B], ['20:2', VIA_B], ['20:3', VIA_B],
];

async function seedExpand(app) {
  await batch(app, { fileKey: XK, fileName: 'Expand', rootNodeId: '1:1', upserts: EXPAND_SCREENS(1), markImplemented: true });
  await batch(app, { fileKey: XK, rootNodeId: '9:0', upserts: EXPAND_COMPONENTS(1), markImplemented: true });
  await batch(app, { fileKey: XK, rootNodeId: '1:1', upserts: EXPAND_SCREENS(2) });
  await batch(app, { fileKey: XK, rootNodeId: '9:0', upserts: EXPAND_COMPONENTS(2) });
}

const nodesUrl = query => `/v3/files/${XK}/nodes?${query}`;
const viaPairs = body => body.nodes.map(n => [n.nodeId, n.via]);

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] expand=instances: breadth-first, each component once, via, filters after expansion, paging`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await seedExpand(app);

    const all = ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances')));
    assert.deepEqual(viaPairs(all), EXPANDED, 'scope first, then A, C (depth 1) and B (depth 2); the B → A cycle ends');
    assert.equal(all.total, EXPANDED.length);
    assert.deepEqual(all.expansion, { components: 3, truncated: false, unresolved: ['99:9'] });
    assert.deepEqual(Object.keys(all.nodes[0]), [...COMPACT_FIELDS, 'via'], 'via is a compact field with expand');

    const plain = ok(await get(app, `/v3/files/${XK}/nodes?under=2:1&state=all`));
    assert.deepEqual(plain.nodes.map(n => n.nodeId), SCOPE);
    assert.equal(plain.expansion, undefined);
    assert.equal('via' in plain.nodes[0], false, 'no via without expand');

    assert.deepEqual(viaPairs(ok(await get(app, nodesUrl('under=2:1&expand=instances')))),
      [['3:2', null], ['10:2', VIA_A], ['20:3', VIA_B]], 'default state=dirty applies after expansion');
    assert.deepEqual(viaPairs(ok(await get(app, nodesUrl('under=2:1&expand=instances&type=TEXT')))), [['3:2', null], ['10:2', VIA_A]]);
    assert.deepEqual(ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances&instance=false'))).nodes.map(n => n.nodeId),
      ['2:1', '3:2', '10:1', '10:2', '30:1', '20:1', '20:3'], 'instances are traversed even when filtered out');

    const shallow = ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances&expandDepth=1')));
    assert.deepEqual(viaPairs(shallow), EXPANDED.slice(0, 10));
    assert.deepEqual(shallow.expansion, { components: 2, truncated: false, unresolved: [] });

    const whole = ok(await get(app, nodesUrl('state=all&expand=instances&limit=1000')));
    assert.equal(whole.total, EXPAND_SCREENS().length + EXPAND_COMPONENTS().length, 'the whole file already holds every synced main');
    assert.ok(whole.nodes.every(n => n.via === null));
    assert.deepEqual(whole.expansion, { components: 3, truncated: false, unresolved: ['99:9'] });

    const paged = [];
    let cursor = null;
    do {
      const page = ok(await get(app, nodesUrl(`under=2:1&state=all&expand=instances&limit=4${cursor ? `&cursor=${cursor}` : ''}`)));
      assert.equal(page.total, EXPANDED.length);
      paged.push(...viaPairs(page));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(paged, EXPANDED, 'pages cross the scope / component boundary without gaps or repeats');
    const first = ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances&limit=4')));
    assertProblem(await get(app, nodesUrl(`under=2:1&state=all&limit=4&cursor=${first.nextCursor}`)), 400, 'invalid_cursor');
    assert.deepEqual(viaPairs(ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances&sort=-path')))), EXPANDED.slice().reverse());

    assert.deepEqual(ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances&fields=nodeId,via&limit=6'))).nodes.slice(4),
      [{ nodeId: '3:4', via: null }, { nodeId: '10:1', via: VIA_A }]);
    assert.deepEqual(ndjson(await get(app, nodesUrl('under=2:1&state=all&expand=instances&format=ndjson'))), all.nodes);

    assertProblem(await get(app, nodesUrl('under=2:1&expandDepth=2')), 400, 'invalid_parameter');
    assertProblem(await get(app, nodesUrl('under=2:1&expand=everything')), 400, 'invalid_parameter');
    assertProblem(await get(app, nodesUrl('under=2:1&expand=instances&expandDepth=21')), 400, 'invalid_parameter');
    assertProblem(await get(app, nodesUrl('under=2:1&expand=instances&expandDepth=0')), 400, 'invalid_parameter');
    assertProblem(await get(app, nodesUrl('under=2:1&expand=instances&depth=1')), 400, 'invalid_parameter');
    assertProblem(await get(app, nodesUrl('under=2:1&fields=nodeId,via')), 400, 'invalid_parameter');
  });

  test(`[${kind}] format=outline with expand=instances: components nested under the first instance, later ones shown above`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await seedExpand(app);

    const screen = [
      'Screen (FRAME) · clean',
      '  A (INSTANCE → 10:1 A) · clean',
      '    ↳ A (COMPONENT) · clean',
      '      A label (TEXT) · modified (1: characters)',
      '      B (INSTANCE → 20:1 B) · clean',
      '        ↳ B (COMPONENT) · clean',
      '          A (INSTANCE → 10:1 (shown above)) · clean',
      '          B bg (RECTANGLE) · modified (1: opacity)',
      '  Title (TEXT) · modified (1: characters)',
      '  A (INSTANCE → 10:1 (shown above)) · clean',
      '  C (INSTANCE → 30:1 C) · clean',
      '    ↳ C (COMPONENT) · clean',
      '      Ghost (INSTANCE → 99:9) · clean',
    ];
    const res = await get(app, nodesUrl('under=2:1&state=all&expand=instances&format=outline'));
    assert.deepEqual(outline(res), screen);
    assert.equal(res.headers['x-total-count'], String(EXPANDED.length));
    assert.deepEqual(outline(await get(app, nodesUrl('under=2:1&state=all&format=outline'))), [
      'Screen (FRAME) · clean',
      '  A (INSTANCE → 10:1 A) · clean',
      '  Title (TEXT) · modified (1: characters)',
      '  A (INSTANCE → 10:1 A) · clean',
      '  C (INSTANCE → 30:1 C) · clean',
    ], 'without expand, every instance names its main');
    assert.deepEqual(outline(await get(app, nodesUrl('under=2:1&expand=instances&format=outline'))), [
      '↳ A label (TEXT) · modified (1: characters)',
      '↳ B bg (RECTANGLE) · modified (1: opacity)',
      'Title (TEXT) · modified (1: characters)',
    ], 'hidden hosts: an expanded subtree sits where its instance would be, under its nearest shown ancestor');

    const pageRes = await get(app, nodesUrl('under=2:1&state=all&expand=instances&format=outline&limit=6'));
    assert.deepEqual(outline(pageRes), screen.slice(0, 6), 'the first lines of the whole tree, not the tree of the first rows');
    const restRes = await get(app, nodesUrl(`under=2:1&state=all&expand=instances&format=outline&cursor=${nextCursor(pageRes)}`));
    assert.deepEqual(outline(restRes), screen.slice(6), 'the rest keeps its nesting and (shown above)');
    assert.equal(nextCursor(restRes), null);
    for (const size of [1, 7, 25]) {
      const paged = await outlinePages(app, nodesUrl('under=2:1&state=all&expand=instances&format=outline'), size);
      assert.deepEqual(paged, screen, `pages of ${size} lines`);
      assert.ok(paged.includes('      B (INSTANCE → 20:1 B) · clean') && paged.includes('        ↳ B (COMPONENT) · clean'), `nesting at ${size}`);
      assert.equal(paged.filter(l => l.includes('(shown above)')).length, 2, `(shown above) at ${size}`);
    }
    assertProblem(await get(app, nodesUrl(`under=2:1&state=all&format=outline&cursor=${nextCursor(pageRes)}`)), 400, 'invalid_cursor');

    assert.deepEqual(outline(await get(app, `/v3/files/${XK}/work?under=2:1&state=all&expand=instances&format=outline`)), [
      'A (COMPONENT) · 3 nodes · changed (1: characters) · 4 placements · 3 in scope',
      '  A (COMPONENT) · clean',
      '    A label (TEXT) · modified (1: characters)',
      '    B (INSTANCE → 20:1 B) · clean',
      'B (COMPONENT) · 3 nodes · changed (1: opacity) · 1 placement · 1 in scope',
      '  B (COMPONENT) · clean',
      '    A (INSTANCE → 10:1 A) · clean',
      '    B bg (RECTANGLE) · modified (1: opacity)',
      'C (COMPONENT) · 2 nodes · 1 placement · 1 in scope',
      '  C (COMPONENT) · clean',
      '    Ghost (INSTANCE → 99:9) · clean',
      '(no component) · 5 nodes · changed (1: characters)',
      '  Screen (FRAME) · clean',
      '    A (INSTANCE → 10:1 A) · clean',
      '    Title (TEXT) · modified (1: characters)',
      '    A (INSTANCE → 10:1 A) · clean',
      '    C (INSTANCE → 30:1 C) · clean',
    ]);
  });

  test(`[${kind}] expand=instances on summary and work: counts over the expanded set, placementsInScope`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    await seedExpand(app);

    const s = ok(await get(app, `/v3/files/${XK}/summary?under=2:1&state=all&expand=instances`));
    assert.equal(s.total, EXPANDED.length);
    assert.deepEqual(s.byState, { dirty: 3, clean: 10, blocked: 0 });
    assert.deepEqual(s.byChangeType, { added: 0, modified: 3, deleted: 0, requested: 0 });
    assert.deepEqual(s.byType, { COMPONENT: 3, FRAME: 1, INSTANCE: 6, RECTANGLE: 1, TEXT: 2 });
    assert.deepEqual(s.byFrame.map(f => [f.nodeId, f.count]), [['3:1', 1], ['3:2', 1], ['3:3', 1], ['3:4', 1]], 'byFrame counts only nodes under `under`');
    assert.deepEqual(s.expansion, { components: 3, truncated: false, unresolved: ['99:9'] });
    const dirty = ok(await get(app, `/v3/files/${XK}/summary?under=2:1&expand=instances`));
    assert.equal(dirty.total, 3);
    const plain = ok(await get(app, `/v3/files/${XK}/summary?under=2:1&state=all`));
    assert.equal(plain.total, SCOPE.length);
    assert.equal(plain.expansion, undefined);

    const w = ok(await get(app, `/v3/files/${XK}/work?under=2:1&state=all&expand=instances&changes=names`));
    assert.deepEqual(w.items.map(i => [i.key, i.nodeCount, i.placements, i.placementsInScope]), [
      ['10:1', 3, 4, 3],
      ['20:1', 3, 1, 1],
      ['30:1', 2, 1, 1],
      [null, SCOPE.length, null, null],
    ], 'A: 4 placements in the file, 3 reached from the screen (3:1, 3:3 and B\'s 20:2)');
    assert.deepEqual(w.expansion, { components: 3, truncated: false, unresolved: ['99:9'] });
    assert.deepEqual(w.items[0].nodeIds, ['10:1', '10:2', '10:3']);
    const wd = ok(await get(app, `/v3/files/${XK}/work?under=2:1&expand=instances&expandDepth=1`));
    assert.deepEqual(wd.items.map(i => [i.key, i.nodeIds, i.placementsInScope]), [['10:1', ['10:2'], 2], [null, ['3:2'], null]]);
    const unexpanded = ok(await get(app, `/v3/files/${XK}/work?under=2:1&state=all`));
    assert.ok(unexpanded.items.every(i => !('placementsInScope' in i)));
    assert.equal(unexpanded.expansion, undefined);

    const frames = ok(await get(app, `/v3/files/${XK}/work?under=2:1&state=all&expand=instances&group=frame&changes=names`));
    assert.deepEqual(frames.items.map(i => [i.key, i.nodeCount]), [['3:1', 1], ['3:2', 1], ['3:3', 1], ['3:4', 1], [null, 1 + 8]],
      'expanded nodes outside `under` fall in the key: null item');
    assert.ok(frames.items.every(i => !('placementsInScope' in i)));

    const pages = [];
    let cursor = null;
    do {
      const page = ok(await get(app, `/v3/files/${XK}/work?under=2:1&state=all&expand=instances&limit=2${cursor ? `&cursor=${cursor}` : ''}`));
      pages.push(...page.items.map(i => i.key));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(pages, ['10:1', '20:1', '30:1', null]);

    assertProblem(await get(app, `/v3/files/${XK}/work?under=2:1&expandDepth=3`), 400, 'invalid_parameter');
    assertProblem(await get(app, `/v3/files/${XK}/summary?under=2:1&expand=instances&depth=1`), 400, 'invalid_parameter');
  });

  test(`[${kind}] expand=instances stops at ${EXPANSION_LIMIT} components with expansion.truncated and a hint`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const n = EXPANSION_LIMIT + 1;
    const screen = [up('1:1', 'SECTION', 'Screens', { width: 1 }), up('2:1', 'FRAME', 'Screen', { width: 1 }, S)];
    for (let i = 1; i <= n; i += 1) screen.push(inst(`3:${i}`, `I${i}`, [...S, '2:1'], `10:${i}`));
    const mains = [up('9:0', 'SECTION', 'Components', { width: 1 })];
    for (let i = 1; i <= n; i += 1) mains.push(up(`10:${i}`, 'COMPONENT', `M${i}`, { w: i }, C));
    await batch(app, { fileKey: XK, fileName: 'Expand', rootNodeId: '1:1', upserts: screen, markImplemented: true });
    await batch(app, { fileKey: XK, rootNodeId: '9:0', upserts: mains, markImplemented: true });

    const body = ok(await get(app, nodesUrl('under=2:1&state=all&expand=instances&fields=nodeId&limit=1')));
    assert.equal(body.total, screen.length - 1 + EXPANSION_LIMIT);
    assert.equal(body.expansion.components, EXPANSION_LIMIT);
    assert.equal(body.expansion.truncated, true);
    assert.deepEqual(body.expansion.unresolved, []);
    assert.match(body.expansion.hint, /expandDepth/);
    const s = ok(await get(app, `/v3/files/${XK}/summary?under=2:1&state=all&expand=instances`));
    assert.equal(s.total, body.total);
    assert.equal(s.expansion.truncated, true);
  });
}

test('/v3/openapi.json documents expand and expandDepth on the listing, summary and work', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  for (const route of ['/v3/files/{fileKey}/nodes', '/v3/files/{fileKey}/summary', '/v3/files/{fileKey}/work']) {
    const op = doc.paths[route].get;
    const params = Object.fromEntries(op.parameters.map(p => [p.name, p]));
    assert.deepEqual(params.expand.schema.enum, ['instances'], route);
    assert.deepEqual([params.expandDepth.schema.minimum, params.expandDepth.schema.maximum], [1, 20], route);
    assert.match(params.expand.description, /everything this screen uses/, route);
    assert.match(op.description, /expand=instances/, route);
  }
  assert.match(doc.paths['/v3/files/{fileKey}/work'].get.description, /which components do I need to build/);
  assert.equal(doc.paths['/v3/files/{fileKey}/nodes/{nodeId}'].get.parameters.some(p => p.name === 'expand'), false);
});

test('/v3/openapi.json documents format=outline on the listing and work items for models', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  for (const route of ['/v3/files/{fileKey}/nodes', '/v3/files/{fileKey}/work']) {
    const op = doc.paths[route].get;
    const param = op.parameters.find(p => p.name === 'format');
    assert.deepEqual(param.schema.enum, ['json', 'ndjson', 'md', 'outline'], route);
    assert.match(param.description, /use this first to see a screen's structure/, route);
    assert.match(param.description, /… N more.*cursor/, route);
    assert.match(param.description, /rendered once, then paged by rendered lines.*X-RDS-Next-Cursor/, route);
    assert.match(op.parameters.find(p => p.name === 'limit').description, /With format=outline: rendered lines per page/, route);
    assert.match(op.parameters.find(p => p.name === 'cursor').description, /With format=outline: the previous response's `X-RDS-Next-Cursor` header/, route);
    assert.ok(op.responses[200].content['text/plain'], route);
  }
  const nodes = doc.paths['/v3/files/{fileKey}/nodes'].get.parameters.find(p => p.name === 'format').description;
  assert.match(nodes, /nearest shown ancestor/);
  assert.match(nodes, /shown above/);
  assert.match(nodes, /2000 rows/);
  const events = doc.paths['/v3/files/{fileKey}/events'].get;
  assert.deepEqual(events.parameters.find(p => p.name === 'format').schema.enum, ['json', 'ndjson', 'md']);
  assert.equal(events.responses[200].content['text/plain'], undefined);
});

test('format=outline renders at most 2000 rows, its last page ending with a … N more line that continues with its cursor', async t => {
  const { app, close } = await openApp('memory');
  t.after(close);
  const N = 2105;
  const nodes = [up('1:1', 'SECTION', 'Page', { width: 1 }), ...Array.from({ length: N - 1 }, (_, i) => up(`2:${String(i).padStart(4, '0')}`, 'TEXT', `T${i}`, { characters: `c${i}` }, R))];
  for (let i = 0; i < nodes.length; i += 500) await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: nodes.slice(i, i + 500) });

  const firstRes = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all`);
  const first = outline(firstRes);
  assert.equal(first.length, 2001);
  assert.equal(nextCursor(firstRes), outlineCursor(first), 'the header carries the more line\'s cursor');
  assert.deepEqual(first.slice(0, 3), ['Page (SECTION) · added', '  T0 (TEXT) · added', '  T1 (TEXT) · added']);
  assert.equal(first[1999], '  T1998 (TEXT) · added');
  assert.match(first[2000], /^… 105 more \(use cursor\/limit\) — cursor=\S+$/);
  const rest = outline(await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&cursor=${outlineCursor(first)}`));
  assert.equal(rest.length, 105);
  assert.deepEqual([rest[0], rest[104]], ['T1999 (TEXT) · added', 'T2103 (TEXT) · added']);
  const half = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&limit=1000`);
  assert.deepEqual(outline(half), first.slice(0, 1000), 'no more line before the last page of the rendered part');
  const tail = await get(app, `/v3/files/${FK}/nodes?format=outline&state=all&cursor=${nextCursor(half)}`);
  assert.deepEqual(outline(tail), first.slice(1000), 'the last page ends with the same … 105 more line');
  assert.equal(nextCursor(tail), outlineCursor(first));
  for (const size of [700, 1000]) {
    assert.deepEqual(await outlinePages(app, `/v3/files/${FK}/nodes?format=outline&state=all`, size), [...first, ...rest], `pages of ${size} lines, the more line counted as one`);
  }
});

test('a large ndjson listing streams: lines reach the client before the store has read the last page', async t => {
  const { app, store, close } = await openApp('local');
  t.after(close);
  const N = 1600;
  const nodes = [up('1:1', 'SECTION', 'Page', { width: 1 }), ...Array.from({ length: N - 1 }, (_, i) => up(`2:${i}`, 'TEXT', `T${i}`, { characters: `c${i}` }, R))];
  for (let i = 0; i < nodes.length; i += 400) await batch(app, { fileKey: FK, rootNodeId: '1:1', upserts: nodes.slice(i, i + 400) });

  let calls = 0, pagesRead = 0, release;
  const firstChunk = new Promise(resolve => { release = resolve; });
  const listNodes = store.listNodes.bind(store);
  store.listNodes = async (...args) => {
    calls += 1;
    if (calls > 1) await firstChunk; // later pages wait until the client has received data
    const page = await listNodes(...args);
    pagesRead += 1;
    return page;
  };
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();

  let readBeforeFirstChunk = null;
  const body = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no data before the whole listing was read: the response is buffered')), 10000);
    http.get({ host: '127.0.0.1', port, path: `/v3/files/${FK}/nodes?format=ndjson&state=all&fields=nodeId`, headers: agent }, res => {
      let text = '', chunks = 0;
      res.setEncoding('utf8');
      res.on('data', c => {
        if (chunks === 0) readBeforeFirstChunk = pagesRead;
        chunks += 1;
        text += c;
        release();
      });
      res.on('end', () => { clearTimeout(timer); resolve({ text, chunks, status: res.statusCode, headers: res.headers }); });
      res.on('error', reject);
    }).on('error', reject);
  });
  assert.equal(body.status, 200);
  assert.match(body.headers['content-type'], /^application\/x-ndjson/);
  assert.equal(body.headers['transfer-encoding'], 'chunked');
  assert.equal(body.headers['x-total-count'], String(N));
  const ids = body.text.split('\n').filter(Boolean).map(l => JSON.parse(l).nodeId);
  assert.equal(ids.length, N);
  assert.equal(new Set(ids).size, N);
  assert.ok(calls >= Math.ceil(N / 500), `${calls} store pages`);
  assert.ok(body.chunks > 1);
  assert.equal(readBeforeFirstChunk, 1, 'the first lines arrive after one store page');
});

// --- trends ----------------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const TRENDS_NOW = Date.parse('2030-01-15T12:00:00.000Z');
const TFK = 'TrEnDsFiLe0RuSpspQy2E3W';
const at = ms => new Date(ms).toISOString();

async function openTrends(kind, env = {}) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_VIEWER_TOKENS: VIEWER_TOKEN, ...env }) });
  await batch(app, { fileKey: FK, fileName: 'Insights', rootNodeId: '1:1', upserts: TREE_V1(), markImplemented: true });
  await batch(app, { fileKey: TFK, fileName: 'Trends', rootNodeId: '1:1', upserts: TREE_V1(), markImplemented: true });
  app.nodeService.now = () => new Date(TRENDS_NOW);
  return { app, store, close: async () => { await app.close(); await cleanup(); } };
}

/** Clears and syncs around the 7-day windows ending at TRENDS_NOW; `x` marks events outside both. */
async function seedTrends(store) {
  const from = TRENDS_NOW - 7 * DAY, before = TRENDS_NOW - 14 * DAY;
  const ids = n => Array.from({ length: n }, (_, i) => `9:${i}`);
  const clear = (fileKey, createdAt, data) => store.insertEvent({ fileKey, type: 'nodes.cleared', data: { commitRef: null, worker: null, ...data }, createdAt: at(createdAt) });
  const sync = (fileKey, createdAt, dirty) => store.insertEvent({ fileKey, type: 'sync.completed', data: { rootNodeId: '1:1', counts: { uploaded: dirty, dirty } }, createdAt: at(createdAt) });
  await clear(FK, from, { nodeIds: ids(500), count: 600 });
  await clear(FK, TRENDS_NOW - 1, { nodeIds: ['2:1', '2:2'] });
  await clear(FK, TRENDS_NOW, { nodeIds: ids(5), count: 5 }); // x
  await clear(FK, from - 1, { nodeIds: ids(10), count: 10 });
  await clear(FK, before, { nodeIds: ids(3), count: 3 });
  await clear(FK, before - 1, { nodeIds: ids(100), count: 100 }); // x
  await sync(FK, from, 50);
  await sync(FK, from - 1, 7); // previous window: not counted
  await sync(FK, TRENDS_NOW, 9); // x
  await sync(FK, from + DAY, 0);
  await clear(TFK, TRENDS_NOW - DAY, { nodeIds: ids(4), count: 4 });
  await sync(TFK, TRENDS_NOW - 2 * DAY, 10);
  await clear('UntrackedFile00000000000', TRENDS_NOW - DAY, { nodeIds: ids(8), count: 8 });
}

const TREND_FK = { cleared: 602, clearedPrevious: 13, clearedChangePct: 4531, dirtied: 50, netDirty: -552 };
const TREND_TFK = { cleared: 4, clearedPrevious: 0, clearedChangePct: null, dirtied: 10, netDirty: 6 };

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] GET /v3/insights/trends: half-open windows, per file and in total, viewer-readable`, async t => {
    const { app, store, close } = await openTrends(kind);
    t.after(close);
    await seedTrends(store);

    const body = ok(await get(app, '/v3/insights/trends', viewer));
    assert.deepEqual(body, {
      windowDays: 7,
      from: at(TRENDS_NOW - 7 * DAY),
      to: at(TRENDS_NOW),
      complete: true,
      retentionDays: 30,
      total: { cleared: 606, clearedPrevious: 13, clearedChangePct: 4562, dirtied: 60, netDirty: -546 },
      files: [{ fileKey: FK, fileName: 'Insights', ...TREND_FK }, { fileKey: TFK, fileName: 'Trends', ...TREND_TFK }],
    });

    const one = ok(await get(app, `/v3/insights/trends?fileKey=${TFK}&windowDays=7`));
    assert.deepEqual(one.total, TREND_TFK, 'fileKey narrows the total too');
    assert.deepEqual(one.files, [{ fileKey: TFK, fileName: 'Trends', ...TREND_TFK }]);

    const day = ok(await get(app, `/v3/insights/trends?windowDays=1&fileKey=${FK}`));
    assert.equal(day.from, at(TRENDS_NOW - DAY));
    assert.deepEqual(day.total, { cleared: 2, clearedPrevious: 0, clearedChangePct: null, dirtied: 0, netDirty: -2 });

    for (const bad of ['0', '15', '1.5', 'week']) assertProblem(await get(app, `/v3/insights/trends?windowDays=${bad}`), 400, 'invalid_parameter');
    assertProblem(await get(app, '/v3/insights/trends?fileKey=NoSuchFile'), 404, 'file_not_found');
    assertProblem(await get(app, '/v3/insights/trends?file=x'), 400, 'unknown_parameter');
  });

  test(`[${kind}] GET /v3/insights/trends: complete only when retention keeps two windows`, async t => {
    const { app, close } = await openTrends(kind, { RDS_EVENT_RETENTION_DAYS: '10' });
    t.after(close);
    const week = ok(await get(app, '/v3/insights/trends'));
    assert.equal(week.complete, false);
    assert.equal(week.retentionDays, 10);
    assert.deepEqual(week.total, { cleared: 0, clearedPrevious: 0, clearedChangePct: null, dirtied: 0, netDirty: 0 });
    assert.equal(ok(await get(app, '/v3/insights/trends?windowDays=5')).complete, true);
  });

  test(`[${kind}] trends count real clears (data.count) and the nodes syncs made dirty`, async t => {
    const { app, store, close } = await openTrends(kind);
    t.after(close);
    const now = Date.now() + 10 * 60 * 1000; // after the events this test writes
    app.nodeService.now = () => new Date(now);
    const rows = Array.from({ length: 520 }, (_, i) => ({ nodeId: `5:${i}`, nodeType: 'TEXT', name: `T${i}`, parentId: null, path: [], attrs: { characters: `${i}` }, contentHash: `h${i}` }));
    await batch(app, { fileKey: TFK, upserts: rows });
    for (const part of [rows.slice(0, 500), rows.slice(500)]) {
      const res = ok(await app.inject({ method: 'POST', url: `/v3/files/${TFK}/clear`, headers: agent, payload: { items: part.map(r => ({ nodeId: r.nodeId, contentHash: r.contentHash })) } }));
      assert.equal(res.totals.cleared, part.length);
    }
    const events = await store.listEvents({ fileKey: TFK, types: ['nodes.cleared'] });
    assert.deepEqual(events.map(e => [e.data.count, e.data.nodeIds.length]), [[500, 500], [20, 20]]);
    const { total } = ok(await get(app, `/v3/insights/trends?fileKey=${TFK}`));
    assert.deepEqual(total, { cleared: 520, clearedPrevious: 0, clearedChangePct: null, dirtied: 520, netDirty: 0 });
  });
}

