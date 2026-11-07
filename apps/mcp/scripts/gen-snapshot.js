#!/usr/bin/env node
'use strict';

/**
 * Writes src/openapi.snapshot.json: the API's OpenAPI document cut down to its
 * x-rds-mcp operations, which the stdio server serves while the API is down.
 * `--check` exits 1 when the committed snapshot differs from the API's.
 */

const fs = require('node:fs');
const { buildApp } = require('@rolling-design-sync/api');
const { loadConfig } = require('@rolling-design-sync/api/src/config');
const { MemoryStore } = require('@rolling-design-sync/api/src/store/memory');
const { SNAPSHOT_FILE } = require('../src/server');

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** `doc` with only its x-rds-mcp operations (and their paths' shared parameters). */
function snapshotOf(doc) {
  /** @type {Record<string, any>} */
  const paths = {};
  for (const [route, item] of Object.entries(doc.paths || {})) {
    /** @type {Record<string, any>} */
    const kept = {};
    for (const m of METHODS) if (item[m] && item[m]['x-rds-mcp']) kept[m] = item[m];
    if (!Object.keys(kept).length) continue;
    if (item.parameters) kept.parameters = item.parameters;
    paths[route] = kept;
  }
  const out = { openapi: doc.openapi, info: doc.info, paths };
  if (doc.components) out.components = doc.components;
  return out;
}

/** The live API's OpenAPI document (memory store, nothing listening). */
async function liveDoc() {
  const config = loadConfig({ RDS_STORE: 'memory', HOST: '127.0.0.1', PORT: '0', RDS_AGENT_TOKENS: 'a'.repeat(64), RDS_PLUGIN_TOKENS: 'p'.repeat(64) });
  const app = buildApp({ store: new MemoryStore(), config });
  try {
    const res = await app.inject({ method: 'GET', url: '/v3/openapi.json', headers: { host: '127.0.0.1' } });
    if (res.statusCode !== 200) throw new Error(`GET /v3/openapi.json: HTTP ${res.statusCode}`);
    return res.json();
  } finally {
    await app.close();
  }
}

const serialize = doc => `${JSON.stringify(doc, null, 2)}\n`;

async function run(argv = process.argv.slice(2)) {
  const next = serialize(snapshotOf(await liveDoc()));
  if (argv.includes('--check')) {
    const current = fs.existsSync(SNAPSHOT_FILE) ? fs.readFileSync(SNAPSHOT_FILE, 'utf8') : '';
    if (current !== next) {
      process.stderr.write(`${SNAPSHOT_FILE} is out of date with the API's OpenAPI document: run \`npm run gen:snapshot -w apps/mcp\`.\n`);
      return 1;
    }
    return 0;
  }
  fs.writeFileSync(SNAPSHOT_FILE, next);
  return 0;
}

if (require.main === module) run().then(code => { process.exitCode = code; }, err => { console.error(err); process.exitCode = 1; });

module.exports = { snapshotOf, liveDoc, serialize, run };
