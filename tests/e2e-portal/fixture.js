'use strict';

// The instance-placement tree from tests/e2e-v3.test.js (page → frame → instance
// of a main component with a text child), seeded the way the plugin uploads it.

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const core = require('@rolling-design-sync/core');

const API = (process.env.RDS_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

/** Tokens from the local-mode `tokens.json` at `RDS_TOKENS_FILE` when set, else from `RDS_*_TOKEN`. */
function tokens() {
  const file = process.env.RDS_TOKENS_FILE;
  const local = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const pick = (env, key) => {
    const value = file ? local[key] : process.env[env];
    if (!value) throw new Error(file ? `${file} has no "${key}" token` : `Set ${env}, or RDS_TOKENS_FILE to a local-mode tokens.json`);
    return value;
  };
  return { plugin: pick('RDS_PLUGIN_TOKEN', 'plugin'), agent: pick('RDS_AGENT_TOKEN', 'agent'), viewer: pick('RDS_VIEWER_TOKEN', 'viewer') };
}

const TOKENS = tokens();

function upsert(nodeId, nodeType, name, attrs, ancestors = []) {
  return {
    nodeId,
    nodeType,
    name,
    parentId: ancestors[ancestors.length - 1] || null,
    path: ancestors,
    attrs,
    contentHash: core.contentHash(attrs),
  };
}

const ROOT = '1:1';
const FRAME = '2:1';
const INSTANCE = '5:1';
const MAIN = '10:1';
const MAIN_CHILD = '10:2';

const TREE = [
  upsert(ROOT, 'SECTION', 'Page', { width: 1000 }),
  upsert(FRAME, 'FRAME', 'Card', { paddingLeft: 16 }, [ROOT]),
  { ...upsert(INSTANCE, 'INSTANCE', 'Button', { x: 16, y: 8, componentProperties: { label: 'Go' } }, [ROOT, FRAME]), isInstance: true, mainComponentId: MAIN },
  upsert(MAIN, 'COMPONENT', 'Button', { width: 120, cornerRadius: 6 }),
  upsert(MAIN_CHILD, 'TEXT', 'Label', { characters: 'Go' }, [MAIN]),
];

async function api(method, route, token, body) {
  const send = () =>
    fetch(`${API}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await send();
  // The per-address sign-in budget is shared with the browser's sign-ins: wait out the window once.
  if (res.status === 429) {
    await new Promise(resolve => setTimeout(resolve, (Number(res.headers.get('retry-after')) || 5) * 1000 + 250));
    res = await send();
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** A fresh file synced with `TREE` (all dirty); returns its key and display name. */
async function seedFile() {
  const fileKey = `portal${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const fileName = `Portal E2E ${fileKey.slice(-6)}`;
  await api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, { fileName, rootNodeId: ROOT, upserts: TREE });
  return { fileKey, fileName };
}

/** Syncs a second scope into `fileKey`: Section `50:1` "Settings" with Frame `50:2` "Panel". */
const SECOND = '50:1';
const syncSecondScope = fileKey =>
  api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, {
    rootNodeId: SECOND,
    upserts: [upsert(SECOND, 'SECTION', 'Settings', { width: 800 }), upsert('50:2', 'FRAME', 'Panel', { paddingTop: 8 }, [SECOND])],
  });

/**
 * Adds a built screen to `fileKey` (Frame `60:1` "Old screen" with a Button instance of `MAIN` and a title),
 * then deletes it in Figma: one `kind: "removed"` work item rooted at `60:1`.
 */
const REMOVED = '60:1';
async function syncRemovedScreen(fileKey) {
  const screen = [
    upsert(REMOVED, 'FRAME', 'Old screen', { width: 390 }, [ROOT]),
    { ...upsert('60:2', 'INSTANCE', 'Button', { x: 8, y: 8 }, [ROOT, REMOVED]), isInstance: true, mainComponentId: MAIN },
    upsert('60:3', 'TEXT', 'Title', { characters: 'Bye' }, [ROOT, REMOVED]),
  ];
  await api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, { rootNodeId: ROOT, upserts: screen, markImplemented: true });
  await api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, { rootNodeId: ROOT, deletedNodeIds: screen.map(n => n.nodeId) });
}

/**
 * Syncs a design-tokens scope into `fileKey` (collection "Semantic", Light/Dark; `bg-active` with code name
 * `--color-bg-active`, used by one layer `2:9`), built, then edits its Dark value: one dirty token.
 */
const TOKEN_COLLECTION = `tokens:${'a'.repeat(40)}`;
const TOKEN = `token:${'1'.repeat(40)}`;
async function syncTokens(fileKey) {
  const T = ['tokens'];
  const token = dark => upsert(TOKEN, 'VARIABLE', 'Colors/bg-active', {
    name: 'Colors/bg-active', resolvedType: 'COLOR', description: '', scopes: ['ALL_SCOPES'], codeSyntax: { WEB: '--color-bg-active' },
    variableId: 'VariableID:7:1', remote: false, 'value:Light': '#ffffff', 'value:Dark': dark,
  }, [...T, TOKEN_COLLECTION]);
  const scope = dark => [
    upsert('tokens', 'TOKENS', 'Design tokens', {}),
    upsert(TOKEN_COLLECTION, 'VARIABLE_COLLECTION', 'Semantic', { name: 'Semantic', modes: ['Light', 'Dark'], remote: false }, T),
    token(dark),
  ];
  await api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, {
    rootNodeId: ROOT,
    upserts: [upsert('2:9', 'TEXT', 'Label', { characters: 'Hi', resolvedVariables: { 'VariableID:7:1': { name: 'Colors/bg-active', key: '1'.repeat(40) } } }, [ROOT, FRAME])],
    markImplemented: true,
  });
  await api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, { rootNodeId: 'tokens', upserts: scope('#202527'), markImplemented: true });
  await api('POST', `/v3/files/${fileKey}/sync`, TOKENS.plugin, { rootNodeId: 'tokens', upserts: scope('#2b3033') });
}

const claim = (fileKey, nodeIds, worker) => api('POST', `/v3/files/${fileKey}/claims`, TOKENS.agent, { worker, ttlSeconds: 300, nodeIds });

const clear = (fileKey, nodeIds) =>
  api('POST', `/v3/files/${fileKey}/clear`, TOKENS.agent, {
    items: nodeIds.map(nodeId => ({ nodeId, contentHash: TREE.find(n => n.nodeId === nodeId).contentHash })),
  });

/** A 200×200 white PNG (base64), with a black `box`×`box` square at 20, 20 when given. */
async function png(box = 0) {
  const sharp = require('sharp');
  let img = sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } });
  if (box) img = img.composite([{ input: { create: { width: box, height: box, channels: 3, background: { r: 0, g: 0, b: 0 } } }, left: 20, top: 20 }]);
  return (await img.png().toBuffer()).toString('base64');
}

/** Makes `FRAME` a render-check screen (route `/card`, 200×200), builds it and uploads its reference: Ready. */
async function readyScreen(fileKey) {
  await api('PUT', `/v3/files/${fileKey}/screens/${FRAME}`, TOKENS.agent, { route: '/card', viewport: { width: 200, height: 200 } });
  await clear(fileKey, [FRAME, INSTANCE]);
  const { screens } = await api('GET', `/v3/files/${fileKey}/screens/references-needed`, TOKENS.plugin);
  const needed = screens.find(s => s.nodeId === FRAME);
  await api('PUT', `/v3/files/${fileKey}/screens/${FRAME}/reference`, TOKENS.plugin, { designVersion: needed.designVersion, image: await png() });
}

/** Submits the built screenshot for the screen's requested check (as `rds-agent check` does). */
async function submitCheck(fileKey, image) {
  const { checks } = await api('GET', `/v3/files/${fileKey}/checks?status=requested`, TOKENS.agent);
  const check = checks.find(c => c.nodeId === FRAME);
  return (await api('POST', `/v3/files/${fileKey}/checks/${check.checkId}/result`, TOKENS.agent, { image, commitRef: 'e2e1234567', source: 'e2e' })).check;
}

const notesOf = (fileKey, nodeId) => api('GET', `/v3/files/${fileKey}/nodes/${nodeId}/notes?status=all`, TOKENS.agent);

module.exports = { TOKENS, ROOT, FRAME, INSTANCE, MAIN, MAIN_CHILD, SECOND, REMOVED, TOKEN_COLLECTION, TOKEN, seedFile, syncSecondScope, syncRemovedScreen, syncTokens, claim, clear, notesOf, png, readyScreen, submitCheck };
