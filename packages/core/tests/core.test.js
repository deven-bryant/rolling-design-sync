const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('..');

const HEX64 = /^[0-9a-f]{64}$/;
const props = { fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }], width: 120.00001, name: 'Button', visible: true };

test('contentHash is a hex sha256 of stable(props)', () => {
  const h = C.contentHash(props);
  assert.match(h, HEX64);
  assert.equal(h, crypto.createHash('sha256').update(C.stable(props), 'utf8').digest('hex'));
});

test('same input gives the same hash', () => {
  assert.equal(C.contentHash(props), C.contentHash(JSON.parse(JSON.stringify(props))));
});

test('property reordering gives the same hash (canonical)', () => {
  const reordered = { visible: true, name: 'Button', width: 120.00001, fills: [{ color: { b: 0, g: 0.5, r: 1 }, type: 'SOLID' }] };
  assert.equal(C.contentHash(props), C.contentHash(reordered));
});

test('a changed value gives a different hash', () => {
  assert.notEqual(C.contentHash(props), C.contentHash({ ...props, width: 121 }));
  assert.notEqual(C.contentHash(props), C.contentHash({ ...props, fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0.1 } }] }));
});

test('contentHash(node) hashes the node props', () => {
  const node = { name: 'Button', type: 'FRAME', path: 'Page/Button', props };
  assert.equal(C.contentHash(node), C.contentHash(props));
});

test('pure-JS sha256 fallback matches node:crypto', () => {
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'héllo wörld ✓ 😀', C.stable(props)];
  for (const s of inputs) {
    assert.equal(C.sha256Fallback(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s));
  }
  assert.equal(C.sha256Fallback('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('core evaluates without require and hashes identically (plugin sandbox)', () => {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), sandbox);
  const sandboxed = sandbox.module.exports;
  assert.equal(typeof sandboxed.contentHash, 'function');
  assert.equal(sandboxed.contentHash(props), C.contentHash(props));
});

test('categoryOf: exact names, prefix and suffix patterns, other', () => {
  assert.equal(C.categoryOf('width'), 'layout');
  assert.equal(C.categoryOf('fills'), 'color');
  assert.equal(C.categoryOf('characters'), 'content');
  assert.equal(C.categoryOf('name'), 'structure');
  assert.equal(C.categoryOf('componentProperties'), 'component');
  assert.equal(C.categoryOf('paddingLeft'), 'layout');
  assert.equal(C.categoryOf('primaryAxisAlignItems'), 'layout');
  assert.equal(C.categoryOf('gridRowGap'), 'layout');
  assert.equal(C.categoryOf('strokeTopWeight'), 'color');
  assert.equal(C.categoryOf('textDecorationColor'), 'typography');
  assert.equal(C.categoryOf('listSpacing'), 'typography');
  assert.equal(C.categoryOf('overlayPositionType'), 'prototype');
  assert.equal(C.categoryOf('topLeftRadius'), 'effects');
  assert.equal(C.categoryOf('cornerRadius'), 'effects');
  // exact names win over a matching pattern in another category
  assert.equal(C.categoryOf('strokesIncludedInLayout'), 'layout');
  assert.equal(C.categoryOf('innerRadius'), 'content');
  assert.equal(C.categoryOf('relativeTransform'), 'other');
  assert.equal(C.categoryOf('childOrder'), 'other');
  assert.equal(C.categoryOf('Radius'), 'effects');
  assert.equal(C.categoryOf('padding'), 'layout');
});

test('categoryOf: design-token properties', () => {
  assert.equal(C.categoryOf('value:Dark'), 'token');
  assert.equal(C.categoryOf('value:Mode 1'), 'token');
  assert.equal(C.categoryOf('description'), 'content');
  assert.equal(C.categoryOf('name'), 'structure');
  assert.equal(C.categoryOf('codeSyntax'), 'other');
  assert.equal(C.categoryOf('scopes'), 'other');
  assert.equal(C.categoryOf('resolvedType'), 'other');
  const alias = name => ({ alias: 'token:' + 'b'.repeat(40), name });
  const d = C.diffAttrs({ name: 'bg-active', 'value:Light': '#ffffff', 'value:Dark': '#202527' },
    { name: 'bg-active', 'value:Light': '#ffffff', 'value:Dark': alias('gray/900') });
  assert.deepEqual(d.changedProps, ['value:Dark']);
  assert.deepEqual(d.categories, ['token']);
  assert.deepEqual(d.changes['value:Dark'], { built: '#202527', now: alias('gray/900'), category: 'token' });
});

test('isTokenNodeId: the tokens root, collections and variables; layer ids are not tokens', () => {
  const key = 'a'.repeat(40);
  assert.equal(C.TOKENS_ROOT_ID, 'tokens');
  for (const id of ['tokens', `tokens:${key}`, `token:${key}`]) assert.equal(C.isTokenNodeId(id), true, id);
  for (const id of ['1:2', 'I1:2;3:4', 'tokensX', null, undefined, 42]) assert.equal(C.isTokenNodeId(id), false, String(id));
  assert.equal(C.normalizeNodeId(`token:${key}`), `token:${key}`);
});

test('CATEGORY_RULES is data covering every spec category', () => {
  assert.deepEqual(Object.keys(C.CATEGORY_RULES), ['layout', 'color', 'typography', 'effects', 'component', 'content', 'structure', 'prototype', 'token']);
  assert.ok(C.CATEGORY_RULES.layout.includes('padding*'));
  assert.ok(C.CATEGORY_RULES.effects.includes('*Radius'));
  assert.ok(Object.isFrozen(C.CATEGORY_RULES) && Object.isFrozen(C.CATEGORY_RULES.color));
});

test('diffAttrs: modified node reports only changed props, sorted, with categories', () => {
  const built = { width: 100, paddingLeft: 16, name: 'A', fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }], opacity: 1 };
  const now = { opacity: 1, name: 'B', paddingLeft: 24, width: 100, fills: [{ color: { b: 0, g: 0, r: 1 }, type: 'SOLID' }], textCase: 'UPPER' };
  const d = C.diffAttrs(built, now);
  assert.deepEqual(d.changedProps, ['name', 'paddingLeft', 'textCase']);
  assert.deepEqual(d.categories, ['layout', 'structure', 'typography']);
  assert.deepEqual(d.changes, {
    name: { built: 'A', now: 'B', category: 'structure' },
    paddingLeft: { built: 16, now: 24, category: 'layout' },
    textCase: { built: null, now: 'UPPER', category: 'typography' },
  });
  assert.deepEqual(Object.keys(d.changes), d.changedProps);
});

test('diffAttrs: removed key is a change with now null', () => {
  const d = C.diffAttrs({ width: 1, itemSpacing: 8 }, { width: 1 });
  assert.deepEqual(d.changes, { itemSpacing: { built: 8, now: null, category: 'layout' } });
});

test('diffAttrs: identical attrs give no changes', () => {
  assert.deepEqual(C.diffAttrs({ width: 1, fills: [] }, { fills: [], width: 1 }), { changes: {}, changedProps: [], categories: [] });
});

test('diffAttrs: added node (built null) has built null for every property', () => {
  const d = C.diffAttrs(null, { width: 10, characters: 'Hi', relativeTransform: [[1, 0, 0], [0, 1, 0]] });
  assert.deepEqual(d.changedProps, ['characters', 'relativeTransform', 'width']);
  assert.deepEqual(d.categories, ['content', 'layout', 'other']);
  for (const p of d.changedProps) assert.equal(d.changes[p].built, null);
  assert.equal(d.changes.width.now, 10);
});

test('diffAttrs: deleted node (now null) has now null for every property', () => {
  const d = C.diffAttrs({ height: 5, visible: true }, null);
  assert.deepEqual(d.changedProps, ['height', 'visible']);
  assert.deepEqual(d.changes.visible, { built: true, now: null, category: 'effects' });
  assert.deepEqual(d.changes.height, { built: 5, now: null, category: 'layout' });
});

test('diffAttrs: both sides null gives no changes', () => {
  assert.deepEqual(C.diffAttrs(null, null), { changes: {}, changedProps: [], categories: [] });
});

test('diffAttrs: lookup keys are not diffed', () => {
  const built = { width: 1, resolvedVariables: { a: { name: 'x' } }, styleDefinitions: { s: { name: 'S' } }, resolvedVariableModes: { m: 1 }, explicitVariableModes: { m: 1 }, boundVariables: {} };
  const now = { width: 1, resolvedVariables: { a: { name: 'y' } }, styleDefinitions: { s: { name: 'T' } }, resolvedVariableModes: { m: 2 }, explicitVariableModes: { m: 2 } };
  assert.deepEqual(C.diffAttrs(built, now), { changes: {}, changedProps: [], categories: [] });
  const added = C.diffAttrs(null, now);
  assert.deepEqual(added.changedProps, ['width']);
});

test('diffAttrs: a boundVariables change on fills shows as a fills change', () => {
  const fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }];
  const built = { fills, boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'V:1' }] }, resolvedVariables: { 'V:1': { name: 'color/brand/500' }, 'V:2': { name: 'color/brand/600' } } };
  const now = { fills, boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'V:2' }] }, resolvedVariables: { 'V:1': { name: 'color/brand/500' }, 'V:2': { name: 'color/brand/600' } } };
  const d = C.diffAttrs(built, now);
  assert.deepEqual(d.changedProps, ['fills']);
  assert.deepEqual(d.categories, ['color']);
  assert.deepEqual(d.changes.fills, {
    built: { token: 'color/brand/500', value: fills },
    now: { token: 'color/brand/600', value: fills },
    category: 'color',
  });
});

test('diffAttrs: binding added to a property not captured at top level still surfaces', () => {
  const d = C.diffAttrs({ width: 1 }, { width: 1, boundVariables: { itemSpacing: { type: 'VARIABLE_ALIAS', id: 'V:9' } }, resolvedVariables: { 'V:9': { name: 'space/4' } } });
  assert.deepEqual(d.changes, { itemSpacing: { built: null, now: { token: 'space/4', value: null }, category: 'layout' } });
});

test('diffAttrs: token resolution via variable (object binding)', () => {
  const vars = { 'V:1': { name: 'space/4' } };
  const d = C.diffAttrs({ paddingLeft: 16 }, { paddingLeft: 24, boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: 'V:1' } }, resolvedVariables: vars });
  assert.deepEqual(d.changes.paddingLeft, { built: 16, now: { token: 'space/4', value: 24 }, category: 'layout' });
});

test('diffAttrs: token resolution via style', () => {
  const styles = { 'S:a': { name: 'Brand/Primary' }, 'S:b': { name: 'Brand/Secondary' }, 'S:t': { name: 'Heading/H1' }, 'S:e': { name: 'Shadow/Md' }, 'S:g': { name: 'Grid/12' } };
  const built = { fills: [1], fillStyleId: 'S:a', strokes: [1], strokeStyleId: 'S:a', fontSize: 12, textStyleId: 'S:t', effects: [], effectStyleId: 'S:e', layoutGrids: [], gridStyleId: 'S:g', styleDefinitions: styles };
  const now = { fills: [2], fillStyleId: 'S:b', strokes: [2], strokeStyleId: 'S:b', fontSize: 14, textStyleId: 'S:t', effects: [1], effectStyleId: 'S:e', layoutGrids: [1], gridStyleId: 'S:g', styleDefinitions: styles };
  const d = C.diffAttrs(built, now);
  assert.deepEqual(d.changes.fills, { built: { token: 'Brand/Primary', value: [1] }, now: { token: 'Brand/Secondary', value: [2] }, category: 'color' });
  assert.deepEqual(d.changes.strokes.now, { token: 'Brand/Secondary', value: [2] });
  assert.deepEqual(d.changes.fontSize, { built: { token: 'Heading/H1', value: 12 }, now: { token: 'Heading/H1', value: 14 }, category: 'typography' });
  assert.deepEqual(d.changes.effects.now, { token: 'Shadow/Md', value: [1] });
  assert.deepEqual(d.changes.layoutGrids.now, { token: 'Grid/12', value: [1] });
  // the style ID property itself is returned raw
  assert.deepEqual(d.changes.fillStyleId, { built: 'S:a', now: 'S:b', category: 'color' });
});

test('diffAttrs: variable wins over style', () => {
  const now = { fills: [2], fillStyleId: 'S:a', styleDefinitions: { 'S:a': { name: 'Style' } }, boundVariables: { fills: [{ id: 'V:1' }] }, resolvedVariables: { 'V:1': { name: 'Var' } } };
  assert.deepEqual(C.diffAttrs({ fills: [1] }, now).changes.fills.now, { token: 'Var', value: [2] });
});

test('diffAttrs: falls back to raw when no token resolves', () => {
  const now = {
    fills: [2], fillStyleId: 'S:missing', styleDefinitions: { 'S:null': null },
    strokes: [2], strokeStyleId: 'S:null',
    opacity: 0.5, boundVariables: { opacity: { id: 'V:missing' }, strokes: [{ id: 'V:null' }] }, resolvedVariables: { 'V:null': null },
    width: 3, textStyleId: '',
  };
  const d = C.diffAttrs({ fills: [1], strokes: [1], opacity: 1, width: 2 }, now);
  assert.deepEqual(d.changes.fills.now, [2]);
  assert.deepEqual(d.changes.strokes.now, [2]);
  assert.equal(d.changes.opacity.now, 0.5);
  assert.equal(d.changes.width.now, 3);
  // a non-text property never uses textStyleId
  const t = C.diffAttrs({ width: 1 }, { width: 2, textStyleId: 'S:t', styleDefinitions: { 'S:t': { name: 'Heading' } } });
  assert.equal(t.changes.width.now, 2);
});

test('diffAttrs: identical raw value with a changed binding still counts', () => {
  const d = C.diffAttrs({ opacity: 1 }, { opacity: 1, boundVariables: { opacity: { id: 'V:1' } }, resolvedVariables: { 'V:1': { name: 'alpha/full' } } });
  assert.deepEqual(d.changes, { opacity: { built: 1, now: { token: 'alpha/full', value: 1 }, category: 'color' } });
});

test('normalizeNodeId', () => {
  assert.equal(C.normalizeNodeId('1-2'), '1:2');
  assert.equal(C.normalizeNodeId('123-4567'), '123:4567');
  assert.equal(C.normalizeNodeId('1:2'), '1:2');
  assert.equal(C.normalizeNodeId('I1:2;3:4'), 'I1:2;3:4');
  assert.equal(C.normalizeNodeId('I1-2;3-4'), 'I1-2;3-4');
  assert.equal(C.normalizeNodeId('1-2-3'), '1-2-3');
  assert.equal(C.normalizeNodeId(' 1-2'), ' 1-2');
  assert.equal(C.normalizeNodeId(''), '');
  assert.equal(C.normalizeNodeId(null), null);
});

test('parseFigmaUrl', () => {
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbCdEf123456GhIjKl7890/My-File?node-id=1-93312&t=abc'), { fileKey: 'AbCdEf123456GhIjKl7890', nodeId: '1:93312' });
  assert.deepEqual(C.parseFigmaUrl('https://figma.com/file/AbC123?t=x&node-id=12%3A34'), { fileKey: 'AbC123', nodeId: '12:34' });
  assert.deepEqual(C.parseFigmaUrl('  https://www.figma.com/design/AbC123/Name?node-id=I1%3A2%3B3%3A4  '), { fileKey: 'AbC123', nodeId: 'I1:2;3:4' });
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbC123/Name'), { fileKey: 'AbC123', nodeId: null });
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbC123'), { fileKey: 'AbC123', nodeId: null });
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbC123/Name?node-id='), { fileKey: 'AbC123', nodeId: null });
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbC123/Name?xnode-id=1-2'), { fileKey: 'AbC123', nodeId: null });
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbC123/Name#node-id=1-2'), { fileKey: 'AbC123', nodeId: null });
  assert.deepEqual(C.parseFigmaUrl('https://www.figma.com/design/AbC123/Name?node-id=%E0%A4%A'), { fileKey: 'AbC123', nodeId: '%E0%A4%A' });
  for (const bad of ['https://example.com/design/AbC123', 'http://www.figma.com/design/AbC123', 'https://www.figma.com/proto/AbC123', 'AbCdEf123456GhIjKl7890', '', null, undefined, 42]) {
    assert.equal(C.parseFigmaUrl(bad), null, String(bad));
  }
});

test('fileKey still returns the key and throws on non-Figma input', () => {
  assert.equal(C.fileKey('https://www.figma.com/design/AbC123/Name?node-id=1-2'), 'AbC123');
  assert.throws(() => C.fileKey('https://example.com/x'), /Figma design file URL/);
});

test('v3 helpers work in the plugin sandbox (no require)', () => {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), sandbox);
  const S = sandbox.module.exports;
  const now = { fills: [2], boundVariables: { fills: [{ id: 'V:1' }] }, resolvedVariables: { 'V:1': { name: 'c' } } };
  assert.deepEqual(JSON.parse(JSON.stringify(S.diffAttrs({ fills: [1] }, now))), C.diffAttrs({ fills: [1] }, now));
  assert.equal(S.categoryOf('paddingTop'), 'layout');
  assert.equal(S.normalizeNodeId('1-2'), '1:2');
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseFigmaUrl('https://www.figma.com/design/K1/N?node-id=1-2'))), { fileKey: 'K1', nodeId: '1:2' });
});
