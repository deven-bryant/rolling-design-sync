'use strict';

/* Only RDS_* env vars are read; a leftover pre-0.10 FDS_* name is ignored with one warning naming its replacement. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { envVar, readConfig, ConfigError } = require('../src/config');

const recorder = () => {
  const warnings = [];
  return { warnings, options: { warn: m => warnings.push(m), warned: new Set() } };
};

test('envVar reads RDS_* only', () => {
  assert.equal(envVar({ RDS_FILE_KEY: 'k' }, 'FILE_KEY'), 'k');
  assert.equal(envVar({ RDS_FILE_KEY: '' }, 'FILE_KEY'), undefined);
  assert.equal(envVar({ FDS_FILE_KEY: 'k' }, 'FILE_KEY'), undefined);
});

test('readConfig ignores every FDS_* variable and warns once for each', () => {
  const { warnings, options } = recorder();
  const env = {
    RDS_API_BASE_URL: 'http://127.0.0.1:8787/', RDS_AGENT_TOKEN: 't', FDS_AGENT_TOKEN: 'old', FDS_FILE_KEY: 'old',
    FDS_MCP_DEFAULT_LIMIT: '10', FDS_EMPTY: '',
  };
  assert.deepEqual(readConfig(env, options), { baseUrl: 'http://127.0.0.1:8787', token: 't', defaultFileKey: null, defaultLimit: 25, maxResultChars: 50000 });
  readConfig(env, options);
  assert.deepEqual(warnings, [
    'rds-mcp: FDS_AGENT_TOKEN is no longer read; set RDS_AGENT_TOKEN instead',
    'rds-mcp: FDS_FILE_KEY is no longer read; set RDS_FILE_KEY instead',
    'rds-mcp: FDS_MCP_DEFAULT_LIMIT is no longer read; set RDS_MCP_DEFAULT_LIMIT instead',
  ]);
});

test('readConfig: FDS_* alone does not satisfy the required RDS_* variables', () => {
  const { warnings, options } = recorder();
  assert.throws(() => readConfig({ FDS_API_BASE_URL: 'http://127.0.0.1:8787', FDS_AGENT_TOKEN: 't' }, options),
    err => err instanceof ConfigError && /RDS_API_BASE_URL, RDS_AGENT_TOKEN/.test(err.message));
  assert.equal(warnings.length, 2);
});
