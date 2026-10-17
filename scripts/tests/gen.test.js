'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generate, commandsFrom, openapiDocument, main, BEGIN, END } = require('../gen-commands');

const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'commands.generated.json');
const README_PATH = path.join(ROOT, 'README.md');
const kebab = s => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

function sink() {
  const chunks = [];
  return { write: s => chunks.push(s), text: () => chunks.join('') };
}

function annotated(doc) {
  const ops = [];
  for (const [route, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) if (op && op['x-rds-cli']) ops.push({ route, method: method.toUpperCase(), op });
  }
  return ops;
}

test('one command per x-rds-cli operation, with its method, path, summary and every parameter', async () => {
  const doc = await openapiDocument();
  const spec = commandsFrom(doc);
  const ops = annotated(doc);
  assert.ok(ops.length > 0);
  assert.deepEqual(spec.commands.map(c => [c.command, c.method, c.path]), ops.map(o => [o.op['x-rds-cli'].command, o.method, o.route]));
  assert.equal(spec.api, doc.info.version);

  for (const { op } of ops) {
    const cmd = spec.commands.find(c => c.command === op['x-rds-cli'].command);
    assert.equal(cmd.summary, op.summary);
    assert.equal(cmd.description, op.description);
    const params = (op.parameters || []).filter(p => p.name !== 'fileKey' && p.in === 'path').map(p => p.name);
    assert.deepEqual((cmd.positionals || []).map(p => p.name), params, cmd.command);

    const expected = [];
    for (const p of op.parameters || []) {
      if (p.in === 'path' && p.name !== 'fileKey') continue;
      expected.push({ in: p.in, name: p.name, required: !!p.required, schema: p.schema });
    }
    const body = op.requestBody && op.requestBody.content['application/json'].schema;
    for (const [name, schema] of Object.entries((body && body.properties) || {})) {
      const binary = schema.format === 'byte' || Object.values((schema.items && schema.items.properties) || {}).some(x => x.format === 'byte');
      if (binary) assert.ok(!cmd.flags.some(f => f.name === name) && !(cmd.items && cmd.items.name === name), `${cmd.command}: ${name} is API / MCP only`);
      else if (schema.type === 'object') for (const [sub, s] of Object.entries(schema.properties)) expected.push({ in: 'body', name: sub, object: name, required: false, schema: s });
      else if (schema.type === 'array' && schema.items.type === 'object') {
        if ((schema.items.required || []).length === 2) assert.equal(cmd.items.name, name);
        else assert.ok(!(cmd.items && cmd.items.name === name), `${cmd.command}: ${name} is API / MCP only`);
      }
      else expected.push({ in: 'body', name, required: (body.required || []).includes(name), schema });
    }
    assert.equal(cmd.flags.length, expected.length, cmd.command);
    for (const e of expected) {
      const f = cmd.flags.find(x => x.name === e.name && x.in === e.in);
      assert.ok(f, `${cmd.command}: ${e.in} ${e.name}`);
      assert.equal(f.flag, kebab(e.name));
      assert.equal(!!f.required, e.required, `${cmd.command} --${f.flag} required`);
      assert.equal(f.object, e.object);
      assert.deepEqual(f.default, e.schema.default);
      assert.deepEqual(f.enum, e.schema.enum);
      assert.equal(f.description, e.schema.description || (op.parameters || []).find(p => p.name === e.name && p.in === e.in)?.description);
      assert.ok([].concat(e.schema.type).includes(f.type), `${cmd.command} --${f.flag} type`);
    }
    assert.equal(!!cmd.body, !!op.requestBody, cmd.command);
  }

  const clear = spec.commands.find(c => c.command === 'clear');
  assert.deepEqual(clear.items.keys, ['nodeId', 'contentHash']);
  assert.deepEqual(spec.commands.filter(c => c.paging).map(c => [c.command, c.paging]), [
    ['nodes ls', { param: 'cursor', next: 'nextCursor', items: 'nodes' }],
    ['events', { param: 'after', next: 'nextAfter', items: 'events' }],
    ['work', { param: 'cursor', next: 'nextCursor', items: 'items' }],
  ]);
});

test('plugin routes and openapi.json are never commands', async () => {
  const spec = commandsFrom(await openapiDocument());
  for (const c of spec.commands) assert.doesNotMatch(c.path, /\/(sync|hashes|exists|openapi\.json)$/);
});

test('the committed commands.generated.json and README reference are current', async () => {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const next = await generate({ readme });
  assert.equal(fs.readFileSync(JSON_PATH, 'utf8'), next.json, 'run `npm run gen` in scripts/');
  assert.equal(readme, next.readme, 'run `npm run gen` in scripts/');
  for (const c of JSON.parse(next.json).commands) assert.ok(readme.includes(`### rds-agent ${c.command}\n`), c.command);
});

test('the drift check fails on a stale file and passes once regenerated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-commands-'));
  const json = path.join(dir, 'commands.generated.json');
  const readme = path.join(dir, 'README.md');
  const stale = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  stale.commands[0].flags.push({ flag: 'stale', in: 'query', name: 'stale', type: 'string' });
  fs.writeFileSync(json, `${JSON.stringify(stale, null, 2)}\n`);
  fs.writeFileSync(readme, fs.readFileSync(README_PATH, 'utf8'));

  const err = sink();
  assert.equal(await main(['--check', '--json', json, '--readme', readme], { stdout: sink(), stderr: err }), 1);
  assert.match(err.text(), /Out of date: .*commands\.generated\.json/);
  assert.doesNotMatch(err.text(), /README/);

  assert.equal(await main(['--json', json, '--readme', readme], { stdout: sink(), stderr: sink() }), 0);
  assert.equal(fs.readFileSync(json, 'utf8'), fs.readFileSync(JSON_PATH, 'utf8'));
  const out = sink();
  assert.equal(await main(['--check', '--json', json, '--readme', readme], { stdout: out, stderr: sink() }), 0);
  assert.match(out.text(), /up to date/);

  fs.writeFileSync(readme, fs.readFileSync(README_PATH, 'utf8').replace('### rds-agent claim', '### rds-agent claim-old'));
  assert.equal(await main(['--check', '--json', json, '--readme', readme], { stdout: sink(), stderr: err }), 1);
  assert.match(err.text(), /Out of date: .*README\.md/);

  fs.writeFileSync(readme, '# no markers\n');
  await assert.rejects(main(['--check', '--json', json, '--readme', readme], { stdout: sink(), stderr: sink() }), new RegExp(BEGIN.replace(/[()]/g, '\\$&')));
  assert.ok(END);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CI runs the drift check', () => {
  const ci = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /run: npm run gen:check\n\s+working-directory: scripts/);
});
