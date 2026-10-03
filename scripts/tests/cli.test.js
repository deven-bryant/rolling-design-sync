'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, buildRequest, buildUrl, execute, run, usage, CliError, CLIENT, COMMANDS } = require('../rds-agent');
const SPEC = require('../commands.generated.json');
const { version: VERSION } = require('../package.json');

const env = { RDS_API_BASE_URL: 'https://api.example.com/', RDS_AGENT_TOKEN: 'agent-secret' };

function mockFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  };
  return { calls, fetchImpl };
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sink() {
  const chunks = [];
  return { write: s => chunks.push(s), text: () => chunks.join('') };
}

test('parseArgs: command words, values, --k=v and boolean flags', () => {
  const parsed = parseArgs(['nodes', 'ls', '--file-key', 'fk', '--type=TEXT', '--all', 'extra']);
  assert.deepEqual(parsed, { command: 'nodes ls', options: { 'file-key': 'fk', type: 'TEXT', all: true }, args: ['extra'] });
  assert.deepEqual(parseArgs(['claim', '--worker', 'w', '--all=false']).options, { worker: 'w', all: 'false' });
  assert.throws(() => parseArgs(['nodes', 'ls', '--file-key']), /Missing value for --file-key/);
  assert.throws(() => parseArgs(['nodes', 'ls', '--type', 'A', '--type', 'B']), /Pass --type once/);
  assert.throws(() => parseArgs(['nodes']), /'nodes' needs a subcommand: ls or show/);
  assert.throws(() => parseArgs(['nodes', 'rm']), /Unknown subcommand: nodes rm/);
});

test('every generated command is accepted, and only those', () => {
  assert.deepEqual([...COMMANDS.keys()], SPEC.commands.map(c => c.command));
  for (const name of COMMANDS.keys()) assert.equal(parseArgs([...name.split(' '), '--help']).command, name);
  assert.throws(() => parseArgs(['nope']), err => err instanceof CliError && err.exitCode === 1 && /^Unknown command: nope/.test(err.message));
});

test('legacy forms are gone: get-delta, clear --node, v1 commands', () => {
  for (const legacy of ['get-delta', 'list-pending', 'get-details', 'record-verification']) {
    assert.throws(() => parseArgs([legacy, '--scope', 's1']), new RegExp(`Unknown command: ${legacy}\\n`));
  }
  assert.throws(
    () => buildRequest(parseArgs(['clear', '--node', '2:1', '--file-key', 'fk', '--hash', 'h', '--commit-ref', 'c'])),
    /Unknown options for 'clear': --node, --hash\./,
  );
  assert.doesNotMatch(usage(), /get-delta|--node\b|list-pending|get-details|record-verification/);
});

test('--help lists the generated commands, and a command\'s flags with types, defaults and descriptions', async () => {
  const out = sink();
  assert.equal(await run(['--help'], { env, stdout: out, stderr: sink() }), 0);
  for (const c of SPEC.commands) assert.match(out.text(), new RegExp(`^ {2}${c.command}\\b.*${escapeRe(c.summary)}$`, 'm'));
  assert.equal(await run([], { env, stdout: sink(), stderr: sink() }), 1);

  for (const c of SPEC.commands) {
    const help = sink();
    assert.equal(await run([...c.command.split(' '), '--help'], { env, stdout: help, stderr: sink() }), 0);
    assert.match(help.text(), new RegExp(`^Usage: rds-agent ${c.command}\\b`));
    assert.match(help.text(), new RegExp(`^${c.method} ${escapeRe(c.path)}$`, 'm'));
    for (const f of c.flags.filter(x => x.name !== 'format')) {
      const line = help.text().split('\n').find(l => l.startsWith(`  --${f.flag} `));
      assert.ok(line, `${c.command}: --${f.flag} listed`);
      if (f.description) assert.ok(line.includes(f.description), `${c.command}: --${f.flag} description`);
      if (f.default !== undefined) assert.ok(line.includes(`default ${JSON.stringify(f.default)}`), `${c.command}: --${f.flag} default`);
      if (f.required && f.name !== 'fileKey') assert.ok(line.includes('required'), `${c.command}: --${f.flag} required`);
    }
    if (c.paging) assert.match(help.text(), /^ {2}--all /m);
  }

  const claim = sink();
  await run(['help', 'claim'], { env, stdout: claim, stderr: sink() });
  assert.match(claim.text(), /^ {2}--file-key <string> +\(required unless --url\)/m);
  assert.match(claim.text(), /^ {2}--worker <string> +\(required; default \$RDS_WORKER\)/m);
  assert.match(claim.text(), /^ {2}--ttl-seconds <integer> /m);
  assert.match(claim.text(), /^ {2}--node-ids <string,…> /m);
  assert.match(claim.text(), /^ {2}--format <json\|table> /m);

  const ls = sink();
  await run(['nodes', 'ls', '-h'], { env, stdout: ls, stderr: sink() });
  assert.match(ls.text(), /^ {2}--format <json\|table\|ndjson\|md\|outline> /m);
});

test('execute sends bearer auth, X-RDS-Client and a JSON body; trims trailing slash', async () => {
  const { calls, fetchImpl } = mockFetch(200, { ok: true });
  const request = buildRequest(parseArgs(['block', '2-1', '--file-key', 'fk', '--reason', 'Needs a token']), { env: { RDS_WORKER: 'w1' } });
  const data = await execute(request, { env, fetchImpl });
  assert.deepEqual(data, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/v3/files/fk/nodes/2%3A1/block');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer agent-secret');
  assert.equal(calls[0].init.headers['x-rds-client'], `cli/${VERSION}`);
  assert.equal(CLIENT, `cli/${VERSION}`);
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { reason: 'Needs a token', worker: 'w1' });
});

test('execute: GET has no body; missing env fails before any request', async () => {
  const { calls, fetchImpl } = mockFetch(200, { files: [] });
  await execute(buildRequest(parseArgs(['files', 'ls'])), { env, fetchImpl });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers['x-rds-client'], `cli/${VERSION}`);
  assert.equal(buildUrl('https://x', { path: '/v3/resolve', query: { url: 'a b' } }), 'https://x/v3/resolve?url=a+b');

  await assert.rejects(execute({ method: 'GET', path: '/v3/files' }, { env: { RDS_AGENT_TOKEN: 't' }, fetchImpl }), /RDS_API_BASE_URL/);
  await assert.rejects(execute({ method: 'GET', path: '/v3/files' }, { env: { RDS_API_BASE_URL: 'https://x' }, fetchImpl }), /RDS_AGENT_TOKEN/);
  assert.equal(calls.length, 1);
});

test('flag values are typed and validated from the generated schema', () => {
  const claim = buildRequest(parseArgs(['claim', '--file-key', 'fk', '--worker', 'w', '--ttl-seconds', '90', '--limit', '3', '--depth', '1', '--under', '1-1', '--component', '3-1,3:2']));
  assert.deepEqual(claim.body, { worker: 'w', ttlSeconds: 90, limit: 3, filter: { under: '1:1', depth: 1, component: '3:1,3:2' } });
  const ls = buildRequest(parseArgs(['nodes', 'ls', '--file-key', 'fk', '--limit', '5', '--depth', '0', '--under', '1-1']));
  assert.deepEqual(ls.query, { under: '1:1', depth: '0', limit: '5' });
  assert.throws(() => buildRequest(parseArgs(['nodes', 'ls', '--file-key', 'fk', '--limit', 'x'])), /--limit must be an integer >= 1/);
  assert.throws(() => buildRequest(parseArgs(['nodes', 'ls', '--file-key', 'fk', '--limit', '0'])), /--limit must be an integer >= 1/);
  assert.throws(() => buildRequest(parseArgs(['claim', '--file-key', 'fk', '--worker', 'w', '--ttl-seconds', '1.5'])), /--ttl-seconds must be an integer/);
  assert.throws(() => buildRequest(parseArgs(['work', '--file-key', 'fk', '--group', 'page'])), /--group must be one of: /);
  assert.throws(() => buildRequest(parseArgs(['files', 'ls', 'stray'])), /Unexpected argument for 'files ls': stray/);
  assert.throws(() => buildRequest(parseArgs(['resolve', 'a', '--url', 'b'])), /as an argument or --url, not both/);
});

test('clear splits item lists over the API limit into batches and merges the results', async () => {
  const max = COMMANDS.get('clear').items.maxItems;
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { items } = JSON.parse(init.body);
    calls.push(items.length);
    const body = { fileKey: 'fk', commitRef: 'c', results: items.map(i => ({ nodeId: i.nodeId, status: 'cleared', contentHash: i.contentHash })), totals: { cleared: items.length, stale: 0, notFound: 0 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const items = Array.from({ length: max + 2 }, (_, i) => `1-${i}=h${i}`);
  const out = sink();
  assert.equal(await run(['clear', '--file-key', 'fk', '--commit-ref', 'c', ...items], { env, fetchImpl, stdout: out, stderr: sink() }), 0);
  assert.deepEqual(calls, [max, 2]);
  const merged = JSON.parse(out.text());
  assert.equal(merged.results.length, max + 2);
  assert.equal(merged.results.at(-1).nodeId, `1:${max + 1}`);
  assert.deepEqual(merged.totals, { cleared: max + 2, stale: 0, notFound: 0 });
});

test('non-problem API errors still print HTTP status and body', async () => {
  const other = mockFetch(502, { error: 'bad_gateway', message: 'x' });
  const err = sink();
  const code = await run(['files', 'ls'], { env, fetchImpl: other.fetchImpl, stdout: sink(), stderr: err });
  assert.equal(code, 1);
  assert.match(err.text(), /^HTTP 502 GET \/v3\/files — bad_gateway: x/);
  assert.match(err.text(), /"error": "bad_gateway"/);
});

// --- v3 commands against a real API (memory store) ------------------------------

const core = require('@rolling-design-sync/core');
const { buildApp } = require('../../apps/api/src/app');
const { loadConfig } = require('../../apps/api/src/config');
const { MemoryStore } = require('../../apps/api/src/store/memory');

const FK = 'AbCdEf123456GhIjKl7890';
const FIGMA = `https://www.figma.com/design/${FK}/Demo`;

function up(nodeId, nodeType, name, attrs, ancestors = []) {
  return { nodeId, nodeType, name, parentId: ancestors[ancestors.length - 1] || null, path: ancestors, attrs, contentHash: core.contentHash(attrs) };
}

/*
 * 1:1 SECTION Page      clean
 * ├─ 2:1 FRAME Card     dirty [paddingLeft]   layout
 * ├─ 2:2 FRAME Header   dirty [itemSpacing]   layout
 * └─ 2:3 TEXT Title     dirty [characters]    content
 */
const TREE = v => [
  up('1:1', 'SECTION', 'Page', { width: 1000 }),
  up('2:1', 'FRAME', 'Card', { paddingLeft: v ? 24 : 16 }, ['1:1']),
  up('2:2', 'FRAME', 'Header', { itemSpacing: v ? 12 : 8 }, ['1:1']),
  up('2:3', 'TEXT', 'Title', { characters: v ? 'Hello' : 'Hi' }, ['1:1']),
];
const hashOf = nodeId => TREE(true).find(n => n.nodeId === nodeId).contentHash;

/** A seeded API on an ephemeral port and a `cli(argv, { stdin })` that runs the CLI against it. */
async function server(t) {
  const app = buildApp({ store: new MemoryStore(), config: loadConfig({ RDS_AGENT_TOKENS: 'agent-secret', RDS_PLUGIN_TOKENS: 'plugin-secret' }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sync = async body => {
    const res = await fetch(`${base}/v3/files/${FK}/sync`, { method: 'POST', headers: { authorization: 'Bearer plugin-secret', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 200, await res.text());
  };
  await sync({ rootNodeId: '1:1', upserts: TREE(false), markImplemented: true });
  await sync({ upserts: TREE(true) });
  const liveEnv = { RDS_API_BASE_URL: base, RDS_AGENT_TOKEN: 'agent-secret' };
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return fetch(url, init); };
  const cli = async (argv, { stdin = '', env: extra = {} } = {}) => {
    const out = sink();
    const err = sink();
    const code = await run(argv, { env: { ...liveEnv, ...extra }, fetchImpl, stdout: out, stderr: err, stdin });
    const text = out.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { code, out: text, err: err.text(), json };
  };
  return { cli, calls, base };
}

test('nodes ls: dirty by default, filters, --url addressing and hyphen node ids', async t => {
  const { cli, calls } = await server(t);

  const all = await cli(['nodes', 'ls', '--file-key', FK]);
  assert.equal(all.code, 0, all.err);
  assert.equal(all.json.fileKey, FK);
  assert.deepEqual(all.json.nodes.map(n => n.nodeId), ['2:1', '2:2', '2:3']);
  assert.equal(all.json.total, 3);
  assert.equal(all.json.nextCursor, null);

  const text = await cli(['nodes', 'ls', '--url', `${FIGMA}?node-id=1-1`, '--type', 'TEXT']);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.json.nodes.map(n => n.nodeId), ['2:3']);
  assert.match(calls.at(-1).url, /\/v3\/files\/-\/nodes\?(.+&)?url=https%3A%2F%2Fwww\.figma\.com/);

  const under = await cli(['nodes', 'ls', '--file-key', FK, '--under', '1-1', '--category', 'layout', '--changed', 'paddingLeft', '--fields', 'nodeId,name']);
  assert.equal(under.code, 0, under.err);
  assert.deepEqual(under.json.nodes, [{ nodeId: '2:1', name: 'Card' }]);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('under'), '1:1');

  const named = await cli(['nodes', 'ls', '--file-key', FK, '--name', 'H*', '--state', 'all', '--view', 'full']);
  assert.deepEqual(named.json.nodes.map(n => n.nodeId), ['2:2']);
  assert.deepEqual(named.json.nodes[0].attrs, { itemSpacing: 12 });

  const q = await cli(['nodes', 'ls', '--file-key', FK, '--q', 'type:FRAME name:Card']);
  assert.equal(q.code, 0, q.err);
  assert.deepEqual(q.json.nodes.map(n => n.nodeId), ['2:1']);

  const clean = await cli(['nodes', 'ls', '--file-key', FK, '--state', 'clean', '--fields', 'nodeId,state']);
  assert.deepEqual(clean.json.nodes, [{ nodeId: '1:1', state: 'clean' }]);
});

test('nodes ls: --limit/--cursor page, --all follows nextCursor to the end', async t => {
  const { cli, calls } = await server(t);

  const first = await cli(['nodes', 'ls', '--file-key', FK, '--limit', '2', '--fields', 'nodeId']);
  assert.deepEqual(first.json.nodes, [{ nodeId: '2:1' }, { nodeId: '2:2' }]);
  assert.ok(first.json.nextCursor);
  const second = await cli(['nodes', 'ls', '--file-key', FK, '--limit', '2', '--fields', 'nodeId', '--cursor', first.json.nextCursor]);
  assert.deepEqual(second.json.nodes, [{ nodeId: '2:3' }]);
  assert.equal(second.json.nextCursor, null);

  const before = calls.length;
  const all = await cli(['nodes', 'ls', '--file-key', FK, '--limit', '1', '--all', '--fields', 'nodeId']);
  assert.equal(all.code, 0, all.err);
  assert.deepEqual(all.json.nodes.map(n => n.nodeId), ['2:1', '2:2', '2:3']);
  assert.equal(all.json.nextCursor, null);
  assert.equal(all.json.total, 3);
  assert.equal(calls.length - before, 3);
});

test('nodes ls --format table: aligned node/name/type/change/categories/claimed columns', async t => {
  const { cli } = await server(t);
  await cli(['claim', '--file-key', FK, '--worker', 'w1', '--label', 'Bot', '--node-ids', '2-3']);
  const table = await cli(['nodes', 'ls', '--file-key', FK, '--format', 'table']);
  assert.equal(table.code, 0, table.err);
  assert.equal(table.out, [
    'NODE  NAME    TYPE   CHANGE    CATEGORIES  CLAIMED',
    '2:1   Card    FRAME  modified  layout      -',
    '2:2   Header  FRAME  modified  layout      -',
    '2:3   Title   TEXT   modified  content     w1 (Bot)',
    '3 of 3 nodes',
    '',
  ].join('\n'));

  const paged = await cli(['nodes', 'ls', '--file-key', FK, '--format', 'table', '--limit', '1']);
  assert.match(paged.out, /^1 of 3 nodes {2}\(more: --cursor \S+, or --all\)$/m);

  const empty = await cli(['nodes', 'ls', '--file-key', FK, '--format', 'table', '--type', 'VECTOR']);
  assert.equal(empty.out, '0 of 0 nodes\n');

  assert.match((await cli(['nodes', 'ls', '--file-key', FK, '--format', 'xml'])).err, /--format must be one of: json, table, ndjson, md/);
});

test('nodes show: by id (1-2 or 1:2), by --url node-id, --fields, table', async t => {
  const { cli, calls } = await server(t);

  const colon = await cli(['nodes', 'show', '2:1', '--file-key', FK]);
  assert.equal(colon.code, 0, colon.err);
  assert.equal(colon.json.nodeId, '2:1');
  assert.equal(colon.json.name, 'Card');
  assert.equal(colon.json.contentHash, hashOf('2:1'));

  const hyphen = await cli(['nodes', 'show', '2-1', '--file-key', FK, '--fields', 'nodeId,type']);
  assert.deepEqual(hyphen.json, { fileKey: FK, nodeId: '2:1', type: 'FRAME' });
  assert.match(calls.at(-1).url, /\/v3\/files\/AbCdEf123456GhIjKl7890\/nodes\/2%3A1\?fields=nodeId%2Ctype$/);

  const byUrl = await cli(['nodes', 'show', '--url', `${FIGMA}?node-id=2-3`, '--fields', 'nodeId']);
  assert.equal(byUrl.code, 0, byUrl.err);
  assert.deepEqual(byUrl.json, { fileKey: FK, nodeId: '2:3' });

  const table = await cli(['nodes', 'show', '2-2', '--file-key', FK, '--format', 'table']);
  assert.equal(table.out, 'NODE  NAME    TYPE   CHANGE    CATEGORIES  CLAIMED\n2:2   Header  FRAME  modified  layout      -\n');

  assert.match((await cli(['nodes', 'show', '--file-key', FK])).err, /'nodes show' needs a <nodeId> \(or --url with a node-id\)/);
  assert.match((await cli(['nodes', 'rm', '--file-key', FK])).err, /Unknown subcommand: nodes rm \(valid: ls, show\)/);
});

test('clear: bulk <nodeId>=<hash> arguments, per-item statuses and stale notes', async t => {
  const { cli, calls } = await server(t);

  const res = await cli(['clear', '--file-key', FK, '--commit-ref', 'abc123', `2-1=${hashOf('2:1')}`, '2:2=stale-hash', '9:9=x']);
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    commitRef: 'abc123',
    items: [{ nodeId: '2:1', contentHash: hashOf('2:1') }, { nodeId: '2:2', contentHash: 'stale-hash' }, { nodeId: '9:9', contentHash: 'x' }],
  });
  assert.deepEqual(res.json.results.map(r => [r.nodeId, r.status]), [['2:1', 'cleared'], ['2:2', 'stale'], ['9:9', 'not_found']]);
  assert.deepEqual(res.json.totals, { cleared: 1, stale: 1, notFound: 1 });
  assert.match(res.err, new RegExp(`^stale: 2:2 changed since it was read; current hash ${hashOf('2:2')}\\.`, 'm'));
  assert.match(res.err, /^not found: 9:9 is not in this file\.$/m);

  const left = await cli(['nodes', 'ls', '--file-key', FK, '--fields', 'nodeId']);
  assert.deepEqual(left.json.nodes.map(n => n.nodeId), ['2:2', '2:3']);

  assert.match((await cli(['clear', '--file-key', FK, '--commit', 'c', `2:3=${hashOf('2:3')}`])).err, /^Unknown option for 'clear': --commit\./);
  assert.match((await cli(['clear', '--file-key', FK, '--commit-ref', 'c'])).err, /'clear' needs <nodeId>=<contentHash> items/);
  assert.match((await cli(['clear', '--file-key', FK, '--commit-ref', 'c', '2:3'])).err, /Expected <nodeId>=<contentHash>, got '2:3'/);
});

test('clear: reads nodeId=hash lines from stdin with -, alongside arguments; table output', async t => {
  const { cli, calls } = await server(t);
  const stdin = `2-2=${hashOf('2:2')}\n\n  2:3=${hashOf('2:3')}  \n`;
  const res = await cli(['clear', '--url', FIGMA, '--commit-ref', 'c1', `2:1=${hashOf('2:1')}`, '-', '--format', 'table'], { stdin });
  assert.equal(res.code, 0, res.err);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).items.map(i => i.nodeId), ['2:1', '2:2', '2:3']);
  assert.equal(res.out, [
    'NODE  STATUS   CONTENTHASH',
    `2:1   cleared  ${hashOf('2:1')}`,
    `2:2   cleared  ${hashOf('2:2')}`,
    `2:3   cleared  ${hashOf('2:3')}`,
    'cleared 3, stale 0, not found 0',
    '',
  ].join('\n'));
  assert.equal(res.err, '');
  assert.equal((await cli(['nodes', 'ls', '--file-key', FK])).json.total, 0);
});

test('claim, renew, release: lifecycle by filters or --node-ids, RDS_WORKER default', async t => {
  const { cli, calls } = await server(t);

  const byFilter = await cli(['claim', '--file-key', FK, '--worker', 'w1', '--label', 'Bot', '--ttl-seconds', '120', '--type', 'FRAME', '--limit', '1']);
  assert.equal(byFilter.code, 0, byFilter.err);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { worker: 'w1', label: 'Bot', ttlSeconds: 120, limit: 1, filter: { type: 'FRAME' } });
  assert.equal(byFilter.json.worker, 'w1');
  assert.deepEqual(byFilter.json.nodes.map(n => n.nodeId), ['2:1']);
  const { claimId } = byFilter.json;

  const mine = await cli(['nodes', 'ls', '--file-key', FK, '--claimed', 'mine', '--worker', 'w1', '--fields', 'nodeId']);
  assert.deepEqual(mine.json.nodes, [{ nodeId: '2:1' }]);

  const byIds = await cli(['claim', '--url', FIGMA, '--node-ids', '2-2,2:3'], { env: { RDS_WORKER: 'w2' } });
  assert.equal(byIds.code, 0, byIds.err);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { worker: 'w2', nodeIds: ['2:2', '2:3'] });
  assert.deepEqual(byIds.json.nodes.map(n => n.nodeId), ['2:2', '2:3']);

  const table = await cli(['claim', '--file-key', FK, '--worker', 'w3', '--format', 'table']);
  assert.equal(table.out, `claim ${table.out.split(' ')[1]}  worker w3  expires ${table.out.match(/expires (\S+)/)[1]}\n0 nodes claimed\n`);

  const renewed = await cli(['renew', claimId, '--file-key', FK, '--ttl-seconds', '600']);
  assert.equal(renewed.code, 0, renewed.err);
  assert.equal(calls.at(-1).init.method, 'POST');
  assert.match(calls.at(-1).url, new RegExp(`/v3/files/${FK}/claims/${claimId}/renew$`));
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { ttlSeconds: 600 });
  assert.equal(renewed.json.claimId, claimId);

  const released = await cli(['release', claimId, '--url', FIGMA, '--format', 'table']);
  assert.equal(released.code, 0, released.err);
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(released.out, `released claim ${claimId}  worker w1 (Bot): 1 node\nNODE\n2:1\n`);

  const again = await cli(['release', claimId, '--file-key', FK]);
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(again.json.released, []);

  const unknown = await cli(['renew', '00000000-0000-4000-8000-000000000000', '--file-key', FK]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /^error: .+ — .+\nhint: Use the claimId returned by POST/);

  assert.match((await cli(['claim', '--file-key', FK])).err, /--worker is required \(or set RDS_WORKER\)/);
  assert.match((await cli(['claim', '--file-key', FK, '--worker', 'w', '--node-ids', '2:1', '--type', 'TEXT'])).err, /^error: .+ — Pass nodeIds or filter, not both\./);
  assert.match((await cli(['renew', '--file-key', FK])).err, /'renew' needs a <claimId>/);
  assert.match((await cli(['release', claimId])).err, /--file-key or --url is required/);
});

test('resolve: Figma link to file key + node id', async t => {
  const { cli, calls } = await server(t);
  const res = await cli(['resolve', `${FIGMA}?node-id=2-1`]);
  assert.equal(res.code, 0, res.err);
  assert.equal(res.json.fileKey, FK);
  assert.equal(res.json.nodeId, '2:1');
  assert.match(calls.at(-1).url, /\/v3\/resolve\?url=https%3A%2F%2F/);

  const flag = await cli(['resolve', '--url', FIGMA, '--format', 'table']);
  assert.match(flag.out, new RegExp(`^FILEKEY\\s+NODEID\\n${FK}\\s+-\\n$`));
  assert.match((await cli(['resolve'])).err, /^--url is required/);
});

test('a 429 prints the retry time (Retry-After) and the hint with a non-zero exit', async () => {
  const problem = { type: 'x', title: 'Too many requests', status: 429, code: 'rate_limited', detail: 'This token made more than 600 requests in a minute.', hint: 'Retry in 42 s (Retry-After).', retryAfter: 42 };
  const respond = (body, headers = {}) => async () => ({ ok: false, status: 429, headers: { get: name => headers[name] ?? null }, text: async () => body });
  const out = sink(), err = sink();
  const code = await run(['files', 'ls'], { env, fetchImpl: respond(JSON.stringify(problem), { 'retry-after': '42' }), stdout: out, stderr: err });
  assert.equal(code, 1);
  assert.equal(out.text(), '');
  assert.equal(err.text(), 'error: rate limited (HTTP 429) — retry in 42 s. This token made more than 600 requests in a minute.\nhint: Retry in 42 s (Retry-After).\n');
  await assert.rejects(execute({ method: 'GET', path: '/v3/files' }, { env, fetchImpl: respond('Too Many Requests') }),
    e => e instanceof CliError && e.message === 'error: rate limited (HTTP 429) — retry later. Too Many Requests');
  await assert.rejects(execute({ method: 'GET', path: '/v3/files' }, { env, fetchImpl: async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ ...problem, hint: undefined, retryAfter: 9 }) }) }),
    e => e.message === 'error: rate limited (HTTP 429) — retry in 9 s. This token made more than 600 requests in a minute.');
});

test('v3 problem errors print "error: <title> — <detail>" and "hint: …" with a non-zero exit', async t => {
  const { cli } = await server(t);

  const unknownFile = await cli(['nodes', 'ls', '--file-key', FIGMA]);
  assert.equal(unknownFile.code, 1);
  assert.equal(unknownFile.out, '');
  const [error, hint, ...rest] = unknownFile.err.trimEnd().split('\n');
  assert.equal(error, `error: File not found — No tracked file with key '${FIGMA}'.`);
  assert.match(hint, /^hint: That looks like a Figma URL\. Use the file key 'AbCdEf123456GhIjKl7890'/);
  assert.deepEqual(rest, []);

  const badFilter = await cli(['nodes', 'ls', '--file-key', FK, '--state', 'nope']);
  assert.equal(badFilter.code, 1);
  assert.match(badFilter.err, /^error: .+ — .*state.*\nhint: .+\n$/);

  const missingNode = await cli(['nodes', 'show', '7-7', '--file-key', FK]);
  assert.equal(missingNode.code, 1);
  assert.match(missingNode.err, /^error: Node not found — /);

  const typo = await cli(['nodes', 'ls', '--file-key', FK, '--stat', 'dirty']);
  assert.equal(typo.code, 1);
  assert.match(typo.err, /^Unknown option for 'nodes ls': --stat\./);

  const noAuth = await cli(['nodes', 'ls', '--file-key', FK], { env: { RDS_AGENT_TOKEN: 'wrong' } });
  assert.equal(noAuth.code, 1);
  assert.match(noAuth.err, /^error: /);
});

test('every generated command sends its method and path to buildApp and succeeds', async t => {
  const { cli, calls } = await server(t);
  const claim = await cli(['claim', '--file-key', FK, '--worker', 'w1', '--node-ids', '2:1']);
  const { claimId } = claim.json;
  const argv = {
    'files ls': ['files', 'ls'],
    'files show': ['files', 'show', '--file-key', FK],
    'scopes ls': ['scopes', 'ls', FIGMA],
    'nodes ls': ['nodes', 'ls', '--file-key', FK],
    'nodes show': ['nodes', 'show', '2-2', '--file-key', FK],
    resolve: ['resolve', `${FIGMA}?node-id=2-1`],
    clear: ['clear', '--file-key', FK, '--commit-ref', 'abc', `2:3=${hashOf('2:3')}`],
    claim: ['claim', '--file-key', FK, '--worker', 'w2', '--type', 'TEXT'],
    'claims ls': ['claims', 'ls', '--file-key', FK],
    renew: ['renew', claimId, '--file-key', FK, '--ttl-seconds', '60'],
    release: ['release', claimId, '--file-key', FK],
    events: ['events', '--file-key', FK, '--after', '0'],
    block: ['block', '2-2', '--file-key', FK, '--reason', 'Waiting on a token'],
    unblock: ['unblock', '2-2', '--url', FIGMA],
    summary: ['summary', '--file-key', FK],
    work: ['work', '--file-key', FK, '--group', 'component'],
  };
  assert.deepEqual(Object.keys(argv).sort(), SPEC.commands.map(c => c.command).sort());
  for (const c of SPEC.commands) {
    const res = await cli(argv[c.command], { env: { RDS_WORKER: 'w1' } });
    assert.equal(res.code, 0, `${c.command}: ${res.err}`);
    assert.ok(res.json && typeof res.json === 'object', c.command);
    const call = calls.at(-1);
    assert.equal(call.init.method, c.method, c.command);
    const template = new RegExp(`^${c.path.replace(/\{\w+\}/g, '[^/]+')}$`);
    assert.match(new URL(call.url).pathname, template, c.command);
    assert.equal(call.init.headers['x-rds-client'], `cli/${VERSION}`);
  }
  const blocked = calls.find(c => c.url.endsWith('/block'));
  assert.deepEqual(JSON.parse(blocked.init.body), { reason: 'Waiting on a token', worker: 'w1' });
});

test('--format outline prints every line; --all follows X-RDS-Next-Cursor and joins the pages', async t => {
  const { cli, calls } = await server(t);
  const base = ['nodes', 'ls', '--file-key', FK, '--format', 'outline', '--state', 'all'];
  const whole = await cli(base);
  assert.equal(whole.code, 0, whole.err);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('limit'), null, 'no limit by default');
  assert.equal(calls.at(-1).init.headers.accept, 'text/plain');
  const lines = whole.out.trimEnd().split('\n');
  assert.deepEqual(lines, ['Page (SECTION) · clean', '  Card (FRAME) · modified (1: paddingLeft)', '  Header (FRAME) · modified (1: itemSpacing)', '  Title (TEXT) · modified (1: characters)']);

  const one = await cli([...base, '--limit', '1']);
  assert.equal(one.out, `${lines[0]}\n`, 'without --all, one page');
  const before = calls.length;
  const all = await cli([...base, '--limit', '1', '--all']);
  assert.equal(all.code, 0, all.err);
  assert.equal(all.out, whole.out, 'the pages join to the whole outline, nesting kept');
  const cursors = calls.slice(before).map(c => new URL(c.url).searchParams.get('cursor'));
  assert.equal(cursors.length, lines.length);
  assert.equal(cursors[0], null);
  assert.ok(cursors.slice(1).every(Boolean), 'each later page passes the previous X-RDS-Next-Cursor');

  const work = await cli(['work', '--file-key', FK, '--format', 'outline', '--state', 'all']);
  assert.equal(work.code, 0, work.err);
  assert.equal((await cli(['work', '--file-key', FK, '--format', 'outline', '--state', 'all', '--limit', '2', '--all'])).out, work.out);
});

test('--format ndjson and md print the API\'s streamed text; table works for every command', async t => {
  const { cli, calls } = await server(t);
  const nd = await cli(['nodes', 'ls', '--file-key', FK, '--format', 'ndjson', '--limit', '2']);
  assert.equal(nd.code, 0, nd.err);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('format'), 'ndjson');
  assert.equal(calls.at(-1).init.headers.accept, 'application/x-ndjson');
  const lines = nd.out.trimEnd().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(n => n.nodeId), ['2:1', '2:2']);

  const md = await cli(['work', '--file-key', FK, '--group', 'component', '--format', 'md']);
  assert.equal(md.code, 0, md.err);
  assert.match(md.out, /^- \[ \] /);

  const allMd = await cli(['nodes', 'ls', '--file-key', FK, '--format', 'md', '--all']);
  assert.equal(allMd.out.trimEnd().split('\n').length, 3);
  assert.match(allMd.out, /^- \[ \] \*\*Card\*\* \(FRAME\) — paddingLeft 16 → 24 · \[Figma\]\(/);

  assert.match((await cli(['summary', '--file-key', FK, '--format', 'ndjson'])).err, /--format must be one of: json, table$/m);

  const files = await cli(['files', 'ls', '--format', 'table']);
  assert.equal(files.code, 0, files.err);
  assert.match(files.out, /^FILEKEY +NAME +LASTSYNCAT +CREATEDAT +COUNTS\n/);
  assert.match(files.out, new RegExp(`^${FK} `, 'm'));
  assert.match(files.out, /^1 file$/m);

  const summary = await cli(['summary', '--file-key', FK, '--format', 'table']);
  assert.match(summary.out, /^KEY +VALUE\nfileKey +AbCdEf123456GhIjKl7890\ntotal +3\n/);

  const block = await cli(['block', '2:1', '--file-key', FK, '--reason', 'No token', '--worker', 'w', '--format', 'table']);
  assert.equal(block.code, 0, block.err);
  assert.match(block.out, /^2:1 +Card +FRAME +modified +layout +-$/m);
  assert.match(block.out, /^blocked 2:1: No token$/m);
  const unblock = await cli(['unblock', '2:1', '--file-key', FK, '--format', 'table']);
  assert.match(unblock.out, /^unblocked 2:1$/m);
});

test('events --all follows nextAfter to the end', async t => {
  const { cli, calls } = await server(t);
  await cli(['block', '2:1', '--file-key', FK, '--reason', 'r1']);
  await cli(['unblock', '2:1', '--file-key', FK]);
  const every = await cli(['events', '--file-key', FK]);
  assert.ok(every.json.events.length >= 3, every.err);

  const before = calls.length;
  const paged = await cli(['events', '--file-key', FK, '--limit', '1', '--all']);
  assert.equal(paged.code, 0, paged.err);
  assert.deepEqual(paged.json.events.map(e => e.id), every.json.events.map(e => e.id));
  assert.equal(paged.json.nextAfter, every.json.nextAfter);
  assert.equal(calls.length - before, every.json.events.length + 1);
  assert.deepEqual([...new Set(calls.slice(before).map(c => new URL(c.url).searchParams.get('after')))].length, every.json.events.length + 1);
});
