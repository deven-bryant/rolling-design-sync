'use strict';

// A realistic demo workspace for the README screenshots: a banking app's
// screens and a design-system file, synced as the plugin would (built baseline,
// then a design edit), with a few clears, claims and a block by named agents.
// Dummy file keys only.

const core = require('@rolling-design-sync/core');

const APP = { fileKey: 'AbCdEf123456GhIjKl7890', fileName: 'Acme Banking — App', root: '1:1' };
const DS = { fileKey: 'ZyXwVu987654TsRqPo3210', fileName: 'Acme Design System', root: '1:1' };

const solid = hex => [{ type: 'SOLID', color: { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 } }];

// Design tokens: variables the plugin resolves, so the drawer shows their names.
const VARS = {
  'VariableID:1:1': { name: 'Spacing/spacing-xl' },
  'VariableID:1:2': { name: 'Spacing/spacing-2xl' },
  'VariableID:1:3': { name: 'Radius/radius-md' },
  'VariableID:1:4': { name: 'Radius/radius-lg' },
  'VariableID:2:1': { name: 'Colors/Background/bg-brand-solid' },
  'VariableID:2:2': { name: 'Colors/Background/bg-primary' },
  'VariableID:2:3': { name: 'Colors/Text/text-primary' },
  'VariableID:2:4': { name: 'Colors/Background/bg-secondary' },
};

/** Attrs with some properties bound to variables (`{ paddingLeft: 'VariableID:1:1' }`). */
function tokens(attrs, bindings) {
  const boundVariables = {};
  const resolvedVariables = {};
  for (const [prop, id] of Object.entries(bindings)) {
    boundVariables[prop] = prop === 'fills' ? [{ type: 'VARIABLE_ALIAS', id }] : { type: 'VARIABLE_ALIAS', id };
    resolvedVariables[id] = VARS[id];
  }
  return { ...attrs, boundVariables, resolvedVariables };
}

function node(nodeId, nodeType, name, attrs, ancestors = [], extra = {}) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs), ...extra };
}

const ref = (id, key, name, set) => ({ id, key, name, remote: false, ...(set ? { set } : {}) });
const BUTTON_SET = { id: '20:0', key: 'c0ffee000000000000000000000000000000b770', name: 'Button' };
const BUTTON_PRIMARY = ref('20:1', 'c0ffee0000000000000000000000000000000001', 'Hierarchy=Primary, Size=md', BUTTON_SET);
const BUTTON_SECONDARY = ref('20:3', 'c0ffee0000000000000000000000000000000002', 'Hierarchy=Secondary, Size=md', BUTTON_SET);
const INPUT = ref('21:1', 'c0ffee0000000000000000000000000000000003', 'Input field');
const NAV = ref('22:1', 'c0ffee0000000000000000000000000000000004', 'Tab bar');
const TXN = ref('23:1', 'c0ffee0000000000000000000000000000000005', 'Transaction row');
const AVATAR = ref('24:1', 'c0ffee0000000000000000000000000000000006', 'Avatar');
const TOGGLE = ref('25:1', 'c0ffee0000000000000000000000000000000007', 'Toggle row');

const instance = (nodeId, name, main, attrs, ancestors) =>
  node(nodeId, 'INSTANCE', name, { componentReference: main, ...attrs }, ancestors, { isInstance: true, mainComponentId: main.id });

/** The app file: `v` 0 is what is built, 1 the design edit, 2 a later tweak. */
function appTree(v) {
  const R = APP.root;
  const pad = v ? 'VariableID:1:2' : 'VariableID:1:1';
  const rows = [
    node(R, 'SECTION', 'Mobile app', { width: 1720, height: 960 }),
    node('2:1', 'FRAME', 'Sign in', { width: 390, height: 844, layoutMode: 'VERTICAL', itemSpacing: 24, fills: solid('#FFFFFF') }, [R]),
    node('2:2', 'TEXT', 'Title', { characters: v ? 'Welcome back' : 'Sign in', fontSize: 30, fontWeight: 600 }, [R, '2:1']),
    node('2:6', 'TEXT', 'Subtitle', { characters: 'Use the email you signed up with.', fontSize: 16, fontWeight: 400 }, [R, '2:1']),
    instance('2:3', 'Email', INPUT, { componentProperties: { Label: 'Email', Placeholder: 'you@example.com' } }, [R, '2:1']),
    instance('2:4', 'Password', INPUT, { componentProperties: { Label: 'Password', Placeholder: '••••••••' } }, [R, '2:1']),
    instance('2:5', 'Sign in', BUTTON_PRIMARY, { componentProperties: { Label: v ? 'Continue' : 'Sign in' } }, [R, '2:1']),
    node('3:1', 'FRAME', 'Dashboard', { width: 390, height: 844, layoutMode: 'VERTICAL', itemSpacing: v ? 20 : 16, fills: solid('#F9FAFB') }, [R]),
    instance('3:2', 'Tab bar', NAV, { componentProperties: { Active: 'Home' } }, [R, '3:1']),
    node('3:3', 'FRAME', 'Balance card', tokens(
      { paddingLeft: v ? 24 : 20, paddingRight: v ? 24 : 20, paddingTop: v === 2 ? 24 : 20, paddingBottom: v === 2 ? 24 : 20,
        cornerRadius: v === 2 ? 16 : 12, fills: solid(v ? '#7F56D9' : '#6941C6') },
      { paddingLeft: pad, paddingRight: pad, paddingTop: v === 2 ? 'VariableID:1:2' : 'VariableID:1:1', paddingBottom: v === 2 ? 'VariableID:1:2' : 'VariableID:1:1',
        cornerRadius: v === 2 ? 'VariableID:1:4' : 'VariableID:1:3', fills: 'VariableID:2:1' },
    ), [R, '3:1']),
    node('3:4', 'TEXT', 'Balance label', { characters: 'Available balance', fontSize: 14 }, [R, '3:1', '3:3']),
    node('3:5', 'TEXT', 'Amount', { characters: '$12,480.20', fontSize: v ? 36 : 32, fontWeight: 600 }, [R, '3:1', '3:3']),
    node('3:6', 'FRAME', 'Recent transactions', { layoutMode: 'VERTICAL', itemSpacing: 8 }, [R, '3:1']),
    instance('3:7', 'Coffee shop', TXN, { componentProperties: { Merchant: 'Blue Bottle', Amount: '−$5.40' } }, [R, '3:1', '3:6']),
    instance('3:8', 'Salary', TXN, { componentProperties: { Merchant: 'Payroll', Amount: '+$4,200.00' } }, [R, '3:1', '3:6']),
    instance('3:9', 'Groceries', TXN, { componentProperties: { Merchant: 'Market Hall', Amount: '−$62.15' } }, [R, '3:1', '3:6']),
    node('4:1', 'FRAME', 'Transfer', { width: 390, height: 844, layoutMode: 'VERTICAL', itemSpacing: 24 }, [R]),
    instance('4:2', 'Recipient', AVATAR, { componentProperties: { Size: v ? 'lg' : 'md' } }, [R, '4:1']),
    instance('4:3', 'Amount', INPUT, { componentProperties: { Label: 'Amount', Placeholder: '$0.00' } }, [R, '4:1']),
    instance('4:4', 'Send money', BUTTON_PRIMARY, { componentProperties: { Label: 'Send money' } }, [R, '4:1']),
    instance('4:6', 'Cancel', BUTTON_SECONDARY, { componentProperties: { Label: 'Cancel' } }, [R, '4:1']),
    node('5:1', 'FRAME', 'Settings', { width: 390, height: 844, layoutMode: 'VERTICAL', itemSpacing: 0 }, [R]),
    instance('5:2', 'Notifications', TOGGLE, { componentProperties: { Label: 'Push notifications', On: true } }, [R, '5:1']),
    instance('5:3', 'Face ID', TOGGLE, { componentProperties: { Label: 'Sign in with Face ID', On: false } }, [R, '5:1']),
    // Main components, on the file's Components page.
    node(BUTTON_SET.id, 'COMPONENT_SET', BUTTON_SET.name, { childOrder: [BUTTON_PRIMARY.id, BUTTON_SECONDARY.id] }),
    node(BUTTON_PRIMARY.id, 'COMPONENT', BUTTON_PRIMARY.name, tokens(
      { componentReference: BUTTON_PRIMARY, paddingLeft: 16, paddingRight: 16, cornerRadius: v ? 8 : 6, fills: solid('#7F56D9') },
      { fills: 'VariableID:2:1', cornerRadius: 'VariableID:1:3' },
    ), [BUTTON_SET.id]),
    node('20:2', 'TEXT', 'Label', { characters: 'Button', fontSize: 14, fontWeight: v ? 600 : 500 }, [BUTTON_SET.id, BUTTON_PRIMARY.id]),
    node(BUTTON_SECONDARY.id, 'COMPONENT', BUTTON_SECONDARY.name, tokens(
      { componentReference: BUTTON_SECONDARY, paddingLeft: 16, paddingRight: 16, cornerRadius: v ? 8 : 6, fills: solid('#FFFFFF'), strokes: solid('#D5D7DA') },
      { fills: 'VariableID:2:2', cornerRadius: 'VariableID:1:3' },
    ), [BUTTON_SET.id]),
    node('20:4', 'TEXT', 'Label', { characters: 'Button', fontSize: 14, fontWeight: v ? 600 : 500 }, [BUTTON_SET.id, BUTTON_SECONDARY.id]),
    node(INPUT.id, 'COMPONENT', INPUT.name, { componentReference: INPUT, height: v ? 44 : 40, cornerRadius: 8, strokes: solid('#D5D7DA') }),
    node('21:2', 'TEXT', 'Placeholder', { characters: 'Placeholder', fontSize: 16 }, [INPUT.id]),
    node(NAV.id, 'COMPONENT', NAV.name, { componentReference: NAV, height: 84, itemSpacing: 0 }),
    node(TXN.id, 'COMPONENT', TXN.name, { componentReference: TXN, paddingTop: 12, paddingBottom: 12, itemSpacing: v ? 16 : 12 }),
    node('23:2', 'TEXT', 'Merchant', { characters: 'Merchant', fontSize: 16, fontWeight: 500 }, [TXN.id]),
    node(AVATAR.id, 'COMPONENT', AVATAR.name, { componentReference: AVATAR, width: 40, height: 40, cornerRadius: 999 }),
    node(TOGGLE.id, 'COMPONENT', TOGGLE.name, { componentReference: TOGGLE, paddingLeft: 16, paddingRight: 16, height: 56 }),
  ];
  if (v) {
    rows.push(
      node('3:10', 'FRAME', 'Spending chart', { width: 342, height: 180, cornerRadius: 12, fills: solid('#FFFFFF') }, [R, '3:1']),
      node('4:5', 'TEXT', 'Fee notice', { characters: 'No fee for transfers between Acme accounts.', fontSize: 12 }, [R, '4:1']),
    );
  }
  return rows;
}

function dsTree(v) {
  const R = DS.root;
  return [
    node(R, 'SECTION', 'Components', { width: 2400, height: 1600 }),
    node('2:1', 'COMPONENT', 'Badge', { paddingLeft: 8, paddingRight: 8, cornerRadius: 16, fills: solid(v ? '#F4EBFF' : '#F9F5FF') }, [R]),
    node('2:2', 'TEXT', 'Badge label', { characters: 'Label', fontSize: 12, fontWeight: 500 }, [R, '2:1']),
    node('3:1', 'COMPONENT', 'Card', { paddingLeft: 24, paddingRight: 24, cornerRadius: 12, effects: v ? [{ type: 'DROP_SHADOW', radius: 4 }] : [] }, [R]),
    node('4:1', 'COMPONENT', 'Toast', { paddingLeft: 16, paddingRight: 16, cornerRadius: 8 }, [R]),
    node('4:2', 'TEXT', 'Message', { characters: v ? 'Changes saved' : 'Saved', fontSize: 14 }, [R, '4:1']),
    node('5:1', 'COMPONENT', 'Modal', { width: v ? 480 : 400, cornerRadius: 12 }, [R]),
  ];
}

/** The app's design tokens: one collection (Light / Dark); `v` 1 changes bg-brand-solid's Dark value. */
const COLORS = `tokens:${'c0105'.padEnd(40, '0')}`;
const tokenId = n => `token:${String(n).padStart(40, 'e')}`;
function tokenTree(v) {
  const T = ['tokens'];
  const variable = (n, variableId, light, dark, web) => {
    const name = VARS[variableId].name;
    return node(tokenId(n), 'VARIABLE', name, {
      name, resolvedType: 'COLOR', description: '', scopes: ['ALL_SCOPES'], codeSyntax: { WEB: web }, variableId, remote: false,
      'value:Light': light, 'value:Dark': dark,
    }, [...T, COLORS]);
  };
  return [
    node('tokens', 'TOKENS', 'Design tokens', {}),
    node(COLORS, 'VARIABLE_COLLECTION', 'Colors', { name: 'Colors', modes: ['Light', 'Dark'], remote: false }, T),
    variable(1, 'VariableID:2:1', '#7f56d9', v ? '#9e77ed' : '#7f56d9', '--color-bg-brand-solid'),
    variable(2, 'VariableID:2:2', '#ffffff', '#0c111d', '--color-bg-primary'),
    variable(3, 'VariableID:2:4', '#f9fafb', '#161b26', '--color-bg-secondary'),
    variable(4, 'VariableID:2:3', '#101828', '#f5f5f6', '--color-text-primary'),
  ];
}

const hashes = rows => Object.fromEntries(rows.map(r => [r.nodeId, r.contentHash]));

/** Seeds both files and the agent activity; `api(method, route, token, body)` as in fixture.js. */
/**
 * `shiftClock(days)` moves the API's clock (see clock.js): the design system's
 * first build and fixes land last week, so the Files trends have a week to
 * compare with.
 */
async function seedDemo(api, tokens, shiftClock = async () => {}) {
  const sync = (file, upserts, extra = {}) =>
    api('POST', `/v3/files/${file.fileKey}/sync`, tokens.plugin, { fileName: file.fileName, rootNodeId: file.root, upserts, ...extra });
  const clear = (file, rows, nodeIds, worker, commitRef) => {
    const h = hashes(rows);
    return api('POST', `/v3/files/${file.fileKey}/clear`, tokens.agent, { worker, commitRef, items: nodeIds.map(nodeId => ({ nodeId, contentHash: h[nodeId] })) });
  };
  const claim = (file, nodeIds, worker, label) =>
    api('POST', `/v3/files/${file.fileKey}/claims`, tokens.agent, { worker, label, ttlSeconds: 1800, nodeIds });

  // Design system, last week: built, edited, partly rebuilt.
  await shiftClock(-8);
  await sync(DS, dsTree(0), { markImplemented: true });
  await sync(DS, dsTree(1));
  await clear(DS, dsTree(1), ['2:1', '4:2'], 'cursor-2', '4e1d0b7');
  await shiftClock(0);
  await sync(DS, dsTree(1));

  // App: built, then the design edit, then agents at work.
  await sync(APP, appTree(0), { markImplemented: true });
  // Design tokens, before the app's edit so the app stays the most recently synced scope.
  await api('POST', `/v3/files/${APP.fileKey}/sync`, tokens.plugin, { rootNodeId: 'tokens', upserts: tokenTree(0), markImplemented: true });
  await api('POST', `/v3/files/${APP.fileKey}/sync`, tokens.plugin, { rootNodeId: 'tokens', upserts: tokenTree(1) });
  const edit = appTree(1);
  await sync(APP, edit);
  const done = [
    [await claim(APP, ['2:2', '3:3', '3:5'], 'claude-1', 'Copy and balance card refresh'), await clear(APP, edit, ['2:2', '3:3', '3:5'], 'claude-1', '9c2f1e4')],
    [await claim(APP, [BUTTON_PRIMARY.id, '20:2'], 'cursor-2', 'Primary button'), await clear(APP, edit, [BUTTON_PRIMARY.id, '20:2'], 'cursor-2', '1a7b3d9')],
  ];
  for (const [{ claimId }] of done) await api('DELETE', `/v3/files/${APP.fileKey}/claims/${claimId}`, tokens.agent);
  await sync(APP, appTree(2));
  // The Settings screen was built, then deleted in Figma: one removed work item.
  await sync(APP, [], { deletedNodeIds: ['5:1', '5:2', '5:3'] });
  await claim(APP, ['3:1', '3:3', '3:10'], 'claude-1', 'Dashboard');
  await claim(APP, [BUTTON_SECONDARY.id, '20:4', INPUT.id, '21:2'], 'cursor-2', 'Button and Input components');
  await claim(APP, ['4:1', '4:2', '4:5'], 'codex-3', 'Transfer screen');
  await api('POST', `/v3/files/${APP.fileKey}/nodes/${encodeURIComponent('3:10')}/block`, tokens.agent, {
    worker: 'claude-1',
    reason: 'Waiting on the chart’s empty and loading states from design',
  });
}

module.exports = { APP, DS, COLORS, BRAND_TOKEN: tokenId(1), seedDemo };
