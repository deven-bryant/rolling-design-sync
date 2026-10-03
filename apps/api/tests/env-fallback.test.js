'use strict';

/* Only RDS_* env vars are read; a leftover pre-0.10 FDS_* name is ignored with one warning naming its replacement. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { envVar, loadConfig, warnLegacyEnv } = require('../src/config');

const recorder = () => {
  const warnings = [];
  return { warnings, options: { warn: m => warnings.push(m), warned: new Set() } };
};

test('envVar reads RDS_* only', () => {
  assert.equal(envVar({ RDS_STORE: 'local' }, 'STORE'), 'local');
  assert.equal(envVar({ RDS_STORE: '' }, 'STORE'), undefined);
  assert.equal(envVar({ FDS_STORE: 'memory' }, 'STORE'), undefined);
});

test('warnLegacyEnv: one warning per set FDS_* variable, naming its RDS_* replacement', () => {
  const { warnings, options } = recorder();
  warnLegacyEnv({ FDS_STORE: 'memory', FDS_EMPTY: '', RDS_STORE: 'local', PATH: '/bin' }, options);
  warnLegacyEnv({ FDS_STORE: 'memory' }, options);
  assert.deepEqual(warnings, ['FDS_STORE is no longer read; set RDS_STORE instead']);
});

test('loadConfig ignores every FDS_* variable and warns once for each', () => {
  const { warnings, options } = recorder();
  const env = {
    FDS_STORE: 'memory', FDS_DATA_DIR: '/tmp/x', FDS_PLUGIN_TOKENS: 'p', RDS_AGENT_TOKENS: 'a', FDS_AGENT_TOKENS: 'old',
    FDS_BODY_LIMIT_BYTES: '10', FDS_UI_ORIGINS: 'http://localhost:5173',
  };
  const c = loadConfig(env, options);
  assert.equal(c.store, '');
  assert.equal(c.embedded, false);
  assert.equal(c.dataDir, path.resolve('data'));
  assert.deepEqual([c.pluginTokens, c.agentTokens, c.viewerTokens], [[], ['a'], []]);
  assert.equal(c.bodyLimit, 64 * 1024 * 1024);
  assert.deepEqual(c.uiOrigins, []);
  assert.deepEqual(warnings, [
    'FDS_AGENT_TOKENS is no longer read; set RDS_AGENT_TOKENS instead',
    'FDS_BODY_LIMIT_BYTES is no longer read; set RDS_BODY_LIMIT_BYTES instead',
    'FDS_DATA_DIR is no longer read; set RDS_DATA_DIR instead',
    'FDS_PLUGIN_TOKENS is no longer read; set RDS_PLUGIN_TOKENS instead',
    'FDS_STORE is no longer read; set RDS_STORE instead',
    'FDS_UI_ORIGINS is no longer read; set RDS_UI_ORIGINS instead',
  ]);
  loadConfig(env, options);
  assert.equal(warnings.length, 6);
});
