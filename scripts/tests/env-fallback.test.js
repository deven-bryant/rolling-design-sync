'use strict';

/* Only RDS_* env vars are read; a leftover pre-0.10 FDS_* name is ignored with one warning naming its replacement. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { envVar, warnLegacyEnv, run } = require('../rds-agent');

test('envVar reads RDS_* only', () => {
  assert.equal(envVar({ RDS_WORKER: 'w1' }, 'WORKER'), 'w1');
  assert.equal(envVar({ RDS_WORKER: '' }, 'WORKER'), undefined);
  assert.equal(envVar({ FDS_WORKER: 'w1' }, 'WORKER'), undefined);
});

test('warnLegacyEnv: one warning per set FDS_* variable, naming its RDS_* replacement', () => {
  const warnings = [];
  const options = { warn: m => warnings.push(m), warned: new Set() };
  warnLegacyEnv({ FDS_WORKER: 'w1', FDS_AGENT_TOKEN: 't', FDS_EMPTY: '', RDS_WORKER: 'w2' }, options);
  warnLegacyEnv({ FDS_WORKER: 'w1' }, options);
  assert.deepEqual(warnings, [
    'rds-agent: FDS_AGENT_TOKEN is no longer read; set RDS_AGENT_TOKEN instead',
    'rds-agent: FDS_WORKER is no longer read; set RDS_WORKER instead',
  ]);
});

test('run: FDS_* values are ignored, with the warning on stderr', async () => {
  const chunks = [];
  const stderr = { write: s => chunks.push(s) };
  const code = await run(['files', 'ls'], { env: { FDS_API_BASE_URL: 'https://api.example.com', FDS_AGENT_TOKEN: 'old' }, stdout: { write() {} }, stderr, fetchImpl: async () => assert.fail('no request') });
  assert.equal(code, 1);
  const err = chunks.join('');
  assert.match(err, /^rds-agent: FDS_AGENT_TOKEN is no longer read; set RDS_AGENT_TOKEN instead\n/m);
  assert.match(err, /^rds-agent: FDS_API_BASE_URL is no longer read; set RDS_API_BASE_URL instead\n/m);
  assert.match(err, /RDS_API_BASE_URL is not set/);
});
