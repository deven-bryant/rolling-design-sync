'use strict';

/*
 * Design tokens (docs/api-v3-design.md, "Design tokens"): `tokens`,
 * `tokens:<collectionKey>` and `token:<variableKey>` nodes through the
 * existing sync, hashes, listing, detail, work, claim, clear and event paths —
 * against the memory store and PGlite (same SQL as Postgres).
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
const plugin = { authorization: `Bearer ${PLUGIN_TOKEN}` };
const agent = { authorization: `Bearer ${AGENT_TOKEN}` };
const FK = 'ToKeNs0RuSpspQy2E3WMDx';

const key = c => c.repeat(40);
const SEMANTIC = `tokens:${key('a')}`;
const PRIMITIVES = `tokens:${key('b')}`;
const ACTIVE = `token:${key('1')}`;
const HOVER = `token:${key('2')}`;
const GRAY = `token:${key('3')}`;
const ACCENT = `token:${key('4')}`;

function up(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}

const variable = (name, variableId, values, extra = {}) => ({
  name, resolvedType: 'COLOR', description: '', scopes: ['ALL_SCOPES'], codeSyntax: {}, variableId, remote: false, ...values, ...extra,
});
const alias = (id, name) => ({ alias: id, name });

/*
 * 1:1 SECTION Page
 * ├─ 2:1 FRAME Card        uses bg/active
 * ├─ 2:2 TEXT Label        uses bg/active and bg/hover
 * ├─ 2:3 FRAME Old         uses bg/active; deleted later (a removed item; not counted)
 * └─ 2:5 COMPONENT Chip    edited later (a component item)
 * tokens TOKENS Design tokens
 * ├─ tokens:bbb… VARIABLE_COLLECTION Primitives
 * │  └─ token:333… gray/900 (remote)
 * └─ tokens:aaa… VARIABLE_COLLECTION Semantic
 *    ├─ token:444… bg/accent
 *    ├─ token:111… bg/active   value:Dark #202527 → #2b3033
 *    └─ token:222… bg/hover    value:Dark → alias gray/900
 */
const R = ['1:1'];
const uses = (...ids) => ({ resolvedVariables: Object.fromEntries(ids.map(id => [id, { name: id }])) });
const LAYERS = () => [
  up('1:1', 'SECTION', 'Page', { childOrder: ['2:1', '2:2', '2:3', '2:5'] }),
  up('2:1', 'FRAME', 'Card', { width: 10, ...uses('VariableID:1:1') }, R),
  up('2:2', 'TEXT', 'Label', { characters: 'x', ...uses('VariableID:1:1', 'VariableID:1:2') }, R),
  up('2:3', 'FRAME', 'Old', { width: 5, ...uses('VariableID:1:1') }, R),
  up('2:5', 'COMPONENT', 'Chip', { cornerRadius: 4 }, R),
];
const T = ['tokens'];
const TOKENS = ({ dark = '#202527', hover = '#303030', grayDescription = '' } = {}) => [
  up('tokens', 'TOKENS', 'Design tokens', {}),
  up(SEMANTIC, 'VARIABLE_COLLECTION', 'Semantic', { name: 'Semantic', modes: ['Light', 'Dark'], remote: false }, T),
  up(PRIMITIVES, 'VARIABLE_COLLECTION', 'Primitives', { name: 'Primitives', modes: ['Mode 1'], remote: true }, T),
  up(HOVER, 'VARIABLE', 'bg/hover', variable('bg/hover', 'VariableID:1:2', { 'value:Light': '#eeeeee', 'value:Dark': hover }), [...T, SEMANTIC]),
  up(ACTIVE, 'VARIABLE', 'bg/active', variable('bg/active', 'VariableID:1:1', { 'value:Light': '#ffffff', 'value:Dark': dark }, { codeSyntax: { WEB: '--bg-active' } }), [...T, SEMANTIC]),
  up(ACCENT, 'VARIABLE', 'bg/accent', variable('bg/accent', 'VariableID:1:4', { 'value:Light': '#ff0000', 'value:Dark': '#aa0000' }), [...T, SEMANTIC]),
  up(GRAY, 'VARIABLE', 'gray/900', variable('gray/900', 'VariableID:1:3', { 'value:Mode 1': '#111111' }, { remote: true, description: grayDescription }), [...T, PRIMITIVES]),
];
const EDITED = () => TOKENS({ dark: '#2b3033', hover: alias(GRAY, 'gray/900'), grayDescription: 'Darkest gray' });

const STORES = {
  memory: async () => ({ store: new MemoryStore(), cleanup: async () => {} }),
  local: async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-v3-tokens-'));
    const { store } = await openLocalStore({ dataDir: path.join(dir, 'data') });
    return { store, cleanup: async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
  },
};

async function sync(app, body) {
  const res = await app.inject({ method: 'POST', url: `/v3/files/${FK}/sync`, headers: plugin, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

async function openApp(kind) {
  const { store, cleanup } = await STORES[kind]();
  const app = buildApp({ store, config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
  await sync(app, { fileName: 'Tokens', rootNodeId: '1:1', upserts: LAYERS(), markImplemented: true });
  await sync(app, { rootNodeId: 'tokens', upserts: TOKENS(), markImplemented: true });
  await sync(app, { rootNodeId: '1:1', upserts: [up('2:5', 'COMPONENT', 'Chip', { cornerRadius: 8 }, R)], deletedNodeIds: ['2:3'] });
  const edit = await sync(app, { rootNodeId: 'tokens', upserts: EDITED() });
  return { app, store, edit, close: async () => { await app.close(); await cleanup(); } };
}

const get = (app, url, headers = agent) => app.inject({ method: 'GET', url, headers });
const ok = res => { assert.equal(res.statusCode, 200, res.body); return res.json(); };
const hashOf = id => EDITED().find(n => n.nodeId === id).contentHash;

for (const kind of Object.keys(STORES)) {
  test(`[${kind}] token ids work as path segments, diff per mode by category, carry usage and no Figma link`, async t => {
    const { app, edit, close } = await openApp(kind);
    t.after(close);
    assert.equal(edit.dirty, 3);
    for (const url of [`/v3/files/${FK}/nodes/${ACTIVE}`, `/v3/files/${FK}/nodes/${encodeURIComponent(ACTIVE)}`]) {
      const n = ok(await get(app, url));
      assert.equal(n.nodeId, ACTIVE);
      assert.equal(n.type, 'VARIABLE');
      assert.equal(n.changeType, 'modified');
      assert.deepEqual(n.changedProps, ['value:Dark']);
      assert.deepEqual(n.changes, { 'value:Dark': { built: '#202527', now: '#2b3033', category: 'token' } });
      assert.equal(n.figmaUrl, null);
      assert.deepEqual(n.usage, { layers: 2 }, 'the tombstoned layer is not counted');
      assert.deepEqual(n.path, ['tokens', SEMANTIC, ACTIVE]);
    }
    const hover = ok(await get(app, `/v3/files/${FK}/nodes/${HOVER}`));
    assert.deepEqual(hover.changes['value:Dark'], { built: '#303030', now: alias(GRAY, 'gray/900'), category: 'token' });
    assert.deepEqual(hover.usage, { layers: 1 });
    const gray = ok(await get(app, `/v3/files/${FK}/nodes/${GRAY}`));
    assert.deepEqual(gray.changes, { description: { built: '', now: 'Darkest gray', category: 'content' } });
    assert.deepEqual(gray.usage, { layers: 0 });
    const collection = ok(await get(app, `/v3/files/${FK}/nodes/${SEMANTIC}`));
    assert.equal(collection.type, 'VARIABLE_COLLECTION');
    assert.equal(collection.usage, undefined);
    assert.equal(collection.descendants.total, 3);
    const layer = ok(await get(app, `/v3/files/${FK}/nodes/2:1`));
    assert.equal(layer.figmaUrl, core.link(FK, '2:1'));
    assert.equal(layer.usage, undefined);

    const byCategory = ok(await get(app, `/v3/files/${FK}/nodes?category=token&fields=nodeId`)).nodes.map(n => n.nodeId);
    assert.deepEqual(byCategory, [ACTIVE, HOVER]);
    const md = (await get(app, `/v3/files/${FK}/nodes?under=tokens&format=md`)).body;
    assert.match(md, /\*\*bg\/active\*\* \(VARIABLE\) — value:Dark \\#202527 → \\#2b3033\n/);
    assert.match(md, /\*\*bg\/hover\*\* \(VARIABLE\) — value:Dark \\#303030 → \{gray\/900\}\n/);
    assert.doesNotMatch(md, /\[Figma\]/);
  });

  test(`[${kind}] under=tokens lists collections and variables by name; include=usage; scopes list "Design tokens"`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const all = ok(await get(app, `/v3/files/${FK}/nodes?under=tokens&state=all&fields=nodeId,name&include=usage`)).nodes;
    assert.deepEqual(all.map(n => n.name), ['Design tokens', 'Primitives', 'gray/900', 'Semantic', 'bg/accent', 'bg/active', 'bg/hover']);
    assert.deepEqual(all.map(n => n.usage?.layers ?? null), [null, null, 0, null, 0, 2, 1]);
    const plain = ok(await get(app, `/v3/files/${FK}/nodes?under=tokens&state=all&fields=nodeId`)).nodes;
    assert.ok(plain.every(n => n.usage === undefined), 'usage only with include=usage');
    const both = ok(await get(app, `/v3/files/${FK}/nodes?under=tokens&state=all&include=counts,usage&limit=2`));
    assert.ok(both.nodes[0].descendants);
    assert.ok(both.nextCursor);
    const next = ok(await get(app, `/v3/files/${FK}/nodes?under=tokens&state=all&include=counts,usage&limit=2&cursor=${both.nextCursor}`));
    assert.deepEqual(next.nodes.map(n => n.nodeId), [GRAY, SEMANTIC]);
    const bad = await get(app, `/v3/files/${FK}/nodes?include=counts,everything`);
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().code, 'invalid_parameter');

    const { scopes } = ok(await get(app, `/v3/files/${FK}/scopes`));
    const tokens = scopes.find(s => s.nodeId === 'tokens');
    assert.equal(tokens.name, 'Design tokens');
    assert.equal(tokens.type, 'TOKENS');
    assert.equal(tokens.figmaUrl, null);
    assert.deepEqual(tokens.counts, { total: 7, dirty: 3, clean: 4, blocked: 0 });
    assert.equal(scopes.find(s => s.nodeId === '1:1').figmaUrl, core.link(FK, '1:1'));
  });

  test(`[${kind}] hashes under=tokens carry the tokens map; layer scopes do not`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const hashes = ok(await get(app, `/v3/files/${FK}/hashes?under=tokens`, plugin));
    assert.deepEqual(hashes.tokens, {
      [ACTIVE]: { variableId: 'VariableID:1:1', remote: false },
      [HOVER]: { variableId: 'VariableID:1:2', remote: false },
      [GRAY]: { variableId: 'VariableID:1:3', remote: true },
      [ACCENT]: { variableId: 'VariableID:1:4', remote: false },
    });
    assert.equal(hashes[ACTIVE], hashOf(ACTIVE));
    assert.equal(hashes[SEMANTIC], hashOf(SEMANTIC));
    const layers = ok(await get(app, `/v3/files/${FK}/hashes?under=1:1`, plugin));
    assert.equal(layers.tokens, undefined);
    assert.equal(layers['2:1'], LAYERS()[1].contentHash);
  });

  test(`[${kind}] work items: one tokens item per collection after components, before key null; set and frame groups agree`, async t => {
    const { app, close } = await openApp(kind);
    t.after(close);
    const { items } = ok(await get(app, `/v3/files/${FK}/work?changes=names&include=progress,usage`));
    assert.deepEqual(items.map(i => [i.kind ?? null, i.key]), [[null, '2:5'], ['removed', '2:3'], ['tokens', PRIMITIVES], ['tokens', SEMANTIC]]);
    const [, , primitives, semantic] = items;
    assert.deepEqual(semantic, {
      kind: 'tokens', key: SEMANTIC, name: 'Semantic', type: 'VARIABLE_COLLECTION', nodeCount: 2,
      categories: ['token'], changedProps: ['value:Dark'], progress: { total: 4, clean: 2 },
      usage: { [ACTIVE]: { layers: 2 }, [HOVER]: { layers: 1 } }, nodeIds: [ACTIVE, HOVER], more: 0,
    });
    assert.equal(primitives.name, 'Primitives');
    assert.deepEqual(primitives.nodeIds, [GRAY]);
    assert.deepEqual(primitives.usage, { [GRAY]: { layers: 0 } });
    assert.equal(semantic.placements, undefined);

    const plain = ok(await get(app, `/v3/files/${FK}/work?changes=names`)).items;
    assert.ok(plain.every(i => i.usage === undefined && i.progress === undefined));
    const withDiff = ok(await get(app, `/v3/files/${FK}/work`)).items.find(i => i.key === SEMANTIC);
    assert.deepEqual(withDiff.changes[ACTIVE], { 'value:Dark': { built: '#202527', now: '#2b3033', category: 'token' } });

    const sets = ok(await get(app, `/v3/files/${FK}/work?group=set&changes=names&include=progress`)).items;
    assert.deepEqual(sets.map(i => [i.kind ?? null, i.key, i.name]), [[null, '2:5', 'Chip'], ['removed', '2:3', 'Old'], ['tokens', PRIMITIVES, 'Primitives'], ['tokens', SEMANTIC, 'Semantic']]);
    assert.deepEqual(sets[3].progress, { total: 4, clean: 2 });
    assert.deepEqual(sets[3].nodeIds, [ACTIVE, HOVER]);

    const frames = ok(await get(app, `/v3/files/${FK}/work?group=frame&under=tokens&changes=names`)).items;
    assert.deepEqual(frames.map(i => [i.kind ?? null, i.key]), [['tokens', PRIMITIVES], ['tokens', SEMANTIC]]);

    const paged = ok(await get(app, `/v3/files/${FK}/work?changes=names&limit=2`));
    assert.deepEqual(paged.items.map(i => i.key), ['2:5', '2:3']);
    const rest = ok(await get(app, `/v3/files/${FK}/work?changes=names&limit=2&cursor=${paged.nextCursor}`));
    assert.deepEqual(rest.items.map(i => i.key), [PRIMITIVES, SEMANTIC]);

    const md = (await get(app, `/v3/files/${FK}/work?format=md`)).body;
    assert.match(md, /Tokens: \*\*Semantic\*\* \(VARIABLE\\_COLLECTION\) — 2 nodes: value:Dark\n/);

    // A removed screen, a dirty layer outside any component and a dirty tokens root keep their places.
    await sync(app, { rootNodeId: '1:1', upserts: [up('2:1', 'FRAME', 'Card', { width: 12, ...uses('VariableID:1:1') }, R)] });
    await sync(app, { rootNodeId: 'tokens', upserts: [up('tokens', 'TOKENS', 'Design tokens', { collections: 2 })] });
    const after = ok(await get(app, `/v3/files/${FK}/work?changes=names`)).items;
    assert.deepEqual(after.map(i => [i.kind ?? null, i.key]), [[null, '2:5'], ['removed', '2:3'], ['tokens', 'tokens'], ['tokens', PRIMITIVES], ['tokens', SEMANTIC], [null, null]]);
  });

  test(`[${kind}] tokens claim, clear and emit events like any node; a deleted variable is tombstoned only by deletedNodeIds`, async t => {
    const { app, store, close } = await openApp(kind);
    t.after(close);
    const claim = ok(await app.inject({ method: 'POST', url: `/v3/files/${FK}/claims`, headers: agent, payload: { worker: 'w-1', nodeIds: [ACTIVE, HOVER] } }));
    assert.deepEqual(claim.nodes.map(n => n.nodeId).sort(), [ACTIVE, HOVER]);
    assert.equal(ok(await get(app, `/v3/files/${FK}/nodes/${ACTIVE}`)).claim.worker, 'w-1');
    const cleared = ok(await app.inject({
      method: 'POST', url: `/v3/files/${FK}/clear`, headers: agent,
      payload: { commitRef: 'abc123', worker: 'w-1', items: [ACTIVE, HOVER, GRAY].map(nodeId => ({ nodeId, contentHash: hashOf(nodeId) })) },
    }));
    assert.deepEqual(cleared.results.map(r => r.status), ['cleared', 'cleared', 'cleared']);
    const n = ok(await get(app, `/v3/files/${FK}/nodes/${ACTIVE}`));
    assert.equal(n.state, 'clean');
    assert.equal(n.claim, null);
    assert.equal(n.history.implementedCommit, 'abc123');
    const [event] = await store.listEvents({ fileKey: FK, types: ['nodes.cleared'] });
    assert.deepEqual([...event.data.nodeIds].sort(), [ACTIVE, HOVER, GRAY].sort());
    assert.equal(ok(await get(app, `/v3/files/${FK}/work?changes=names`)).items.filter(i => i.kind === 'tokens').length, 0);

    // A sync that does not mention a token leaves it alone.
    await sync(app, { rootNodeId: 'tokens', upserts: [] });
    assert.ok(ok(await get(app, `/v3/files/${FK}/hashes?under=tokens`, plugin)).tokens[ACCENT]);
    // Its variable is gone: the plugin tombstones it; the built token is work in its collection's item, not a removed item.
    const gone = await sync(app, { rootNodeId: 'tokens', deletedNodeIds: [ACCENT] });
    assert.equal(gone.tombstoned, 1);
    assert.equal(gone.autoResolved, 0);
    assert.equal(ok(await get(app, `/v3/files/${FK}/hashes?under=tokens`, plugin)).tokens[ACCENT], undefined);
    const { items } = ok(await get(app, `/v3/files/${FK}/work?changes=names`));
    const semantic = items.find(i => i.key === SEMANTIC);
    assert.equal(semantic.kind, 'tokens');
    assert.deepEqual(semantic.nodeIds, [ACCENT]);
    assert.equal(items.some(i => i.kind === 'removed' && i.nodeIds.includes(ACCENT)), false);
    const deleted = ok(await get(app, `/v3/files/${FK}/nodes/${ACCENT}`));
    assert.equal(deleted.changeType, 'deleted');
    ok(await app.inject({ method: 'POST', url: `/v3/files/${FK}/clear`, headers: agent, payload: { items: [{ nodeId: ACCENT, contentHash: deleted.contentHash }] } }));
    assert.equal(ok(await get(app, `/v3/files/${FK}/nodes/${ACCENT}`)).state, 'clean');
  });
}

test('/v3/openapi.json documents token work items, usage and the hashes tokens map', async t => {
  const app = buildApp({ store: new MemoryStore(), config: loadConfig({ RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN }) });
  t.after(() => app.close());
  const doc = ok(await app.inject({ method: 'GET', url: '/v3/openapi.json' }));
  const item = doc.paths['/v3/files/{fileKey}/work'].get.responses['200'].content['application/json'].schema.properties.items.items;
  assert.ok(item.properties.kind.enum.includes('tokens'));
  assert.ok(item.properties.usage);
  const node = doc.paths['/v3/files/{fileKey}/nodes/{nodeId}'].get.responses['200'].content['application/json'].schema;
  assert.ok(node.properties.usage.properties.layers);
  assert.ok(doc.paths['/v3/files/{fileKey}/hashes'].get.responses['200'].content['application/json'].schema.properties.tokens);
});
