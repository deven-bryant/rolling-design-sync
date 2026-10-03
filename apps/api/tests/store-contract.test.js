'use strict';

// The store contract (src/store/types.d.ts) is enforced by `npm run typecheck`:
// a store that lacks a method or declares an incompatible one fails it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..', '..');

function diagnostics(file) {
  const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  const program = ts.createProgram([file], options);
  return ts.getPreEmitDiagnostics(program)
    .filter(d => d.file && d.file.fileName === file.split(path.sep).join('/'))
    .map(d => `${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

test('a store that misses or mismatches a contract method fails the typecheck', () => {
  const found = diagnostics(path.join(__dirname, 'fixtures', 'broken-stores.js'));
  assert.ok(found.some(m => m.startsWith('2420 ') && /MissingMethod/.test(m) && /transaction/.test(m)), found.join('\n'));
  assert.ok(found.some(m => m.startsWith('2416 ') && /getNodeV3/.test(m)), found.join('\n'));
  assert.equal(found.length, 2, found.join('\n'));
});
