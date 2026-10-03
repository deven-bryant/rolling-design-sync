'use strict';

/* Only RDS_* names remain: FDS_* appears only in the tests that check a leftover FDS_* variable is ignored with a warning. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWED = ['apps/api/tests/env-fallback.test.js', 'apps/mcp/tests/env-fallback.test.js', 'scripts/tests/env-fallback.test.js', 'scripts/tests/no-fds.test.js'];
const HISTORY = ['dev-handoffs', 'CHANGELOG.md', '.beads', 'docs/api-v3-agent-ergonomics.md'];

const grep = (pattern, exclude) => spawnSync('git', ['grep', '-n', '-E', pattern, '--', '.', ...exclude.map(p => `:!${p}`)], { cwd: ROOT, encoding: 'utf8' });

test('no FDS_* variable outside the legacy-variable tests', t => {
  const res = grep('FDS_[A-Z]', [...ALLOWED, ...HISTORY]);
  if (res.error || res.status > 1) return t.skip('not a git checkout');
  assert.equal(res.stdout, '');
});

test('fds-agent / fds-mcp no longer exist', t => {
  const res = grep('fds-agent|fds-mcp', [...HISTORY, 'scripts/tests/no-fds.test.js']);
  if (res.error || res.status > 1) return t.skip('not a git checkout');
  assert.equal(res.stdout, '');
});
