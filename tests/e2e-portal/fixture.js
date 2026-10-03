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
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
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

const claim = (fileKey, nodeIds, worker) => api('POST', `/v3/files/${fileKey}/claims`, TOKENS.agent, { worker, ttlSeconds: 300, nodeIds });

const clear = (fileKey, nodeIds) =>
  api('POST', `/v3/files/${fileKey}/clear`, TOKENS.agent, {
    items: nodeIds.map(nodeId => ({ nodeId, contentHash: TREE.find(n => n.nodeId === nodeId).contentHash })),
  });

module.exports = { TOKENS, ROOT, FRAME, INSTANCE, MAIN, MAIN_CHILD, seedFile, claim, clear };
