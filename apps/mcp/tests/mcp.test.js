'use strict';

/* DB-free: a real API (memory store, loopback) driven through the generated MCP tools. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const core = require('@rolling-design-sync/core');
const { buildApp } = require('@rolling-design-sync/api');
const { loadConfig } = require('@rolling-design-sync/api/src/config');
const { MemoryStore } = require('@rolling-design-sync/api/src/store/memory');
const { createServer, StartupError, CLIENT, TRUNCATED, moreResults } = require('../src/server');
const { toolsFromOpenApi } = require('../src/tools');
const { readConfig, ConfigError } = require('../src/config');
const pkg = require('../package.json');

const PLUGIN_TOKEN = 'p'.repeat(64);
const AGENT_TOKEN = 'a'.repeat(64);
const FILE_KEY = 'AbCdEf123456';
const ROOT = '1:1';
const CHILD = '2:1';
const BIN = path.join(__dirname, '..', 'bin', 'rds-mcp.js');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function upsert(nodeId, attrs, { parentId = null, path: p = [], nodeType = 'FRAME', ...extra } = {}) {
  return { nodeId, parentId, path: p, nodeType, name: `Node ${nodeId}`, attrs, contentHash: core.contentHash(attrs), ...extra };
}

/** Starts the API on an ephemeral loopback port with the embedded-mode Host/Origin checks on. */
async function startApi(t) {
  const port = await freePort();
  const config = loadConfig({
    RDS_STORE: 'memory', HOST: '127.0.0.1', PORT: String(port),
    RDS_PLUGIN_TOKENS: PLUGIN_TOKEN, RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_CLAIM_TTL_SECONDS: '60',
  });
  assert.ok(config.checkHost && config.checkOrigin);
  const app = buildApp({ store: new MemoryStore(), config });
  await app.listen({ port, host: '127.0.0.1' });
  t.after(() => app.close());
  const baseUrl = `http://127.0.0.1:${port}`;
  const sync = async upserts => {
    const res = await fetch(`${baseUrl}/v3/files/${FILE_KEY}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${PLUGIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ upserts }),
    });
    assert.equal(res.status, 200, await res.text());
  };
  /** A direct agent GET, for comparing tool results with the API's own response. */
  const get = async (route, query = {}) => {
    const url = new URL(baseUrl + route);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
    assert.equal(res.status, 200, `${route}: ${res.status}`);
    return res.json();
  };
  const openapi = await (await fetch(`${baseUrl}/v3/openapi.json`)).json();
  return { baseUrl, sync, get, openapi };
}

/** `[tool, METHOD, path]` for every x-rds-mcp operation in `doc`. */
const annotated = doc => Object.entries(doc.paths).flatMap(([p, item]) => METHODS
  .filter(m => item[m] && item[m]['x-rds-mcp'])
  .map(m => [item[m]['x-rds-mcp'].tool, m.toUpperCase(), p]));

async function connect(t, env, { fetchImpl } = {}) {
  const server = await createServer(readConfig(env), { fetchImpl });
  const client = new Client({ name: 'rds-mcp-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

const PAGING_LINE = /\n\nMore results: call again with cursor="([^"]*)"$/;

/**
 * `transform(doc)` rewrites the OpenAPI document the MCP server receives;
 * `env` adds server env vars; `upserts` replaces the synced ROOT + CHILD.
 */
async function setup(t, { fileKeyDefault = true, transform, env: extraEnv = {}, upserts } = {}) {
  const api = await startApi(t);
  await api.sync(upserts || [
    upsert(ROOT, { width: 800 }, { nodeType: 'SECTION' }),
    upsert(CHILD, { paddingLeft: 16 }, { parentId: ROOT, path: [ROOT] }),
  ]);
  const env = { RDS_API_BASE_URL: api.baseUrl, RDS_AGENT_TOKEN: AGENT_TOKEN, ...extraEnv };
  if (fileKeyDefault) env.RDS_FILE_KEY = FILE_KEY;
  const requests = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    requests.push({
      method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams),
      body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers,
    });
    const res = await fetch(url, init);
    if (!transform || u.pathname !== '/v3/openapi.json') return res;
    return new Response(JSON.stringify(transform(await res.json())), { status: res.status, headers: { 'content-type': 'application/json' } });
  };
  const client = await connect(t, env, { fetchImpl });
  const call = async (name, args) => {
    requests.length = 0;
    const res = await client.callTool({ name, arguments: args });
    const body = res.content[0].text;
    let json = null;
    const paging = body.match(PAGING_LINE);
    if (!res.isError) try { json = JSON.parse(paging ? body.slice(0, paging.index) : body); } catch (_) { json = null; }
    return { isError: !!res.isError, text: body, json, cursor: paging ? paging[1] : null, request: requests[requests.length - 1] };
  };
  return { ...api, client, call, requests };
}

test('the tool list is exactly the annotated operations, with their docs and parameter schemas', async t => {
  const { client, openapi } = await setup(t);
  const { tools } = await client.listTools();
  const ops = annotated(openapi);
  assert.ok(ops.length >= 10);
  assert.deepEqual(tools.map(tool => tool.name).sort(), ops.map(([name]) => name).sort());

  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  for (const [name, method, p] of ops) {
    const op = openapi.paths[p][method.toLowerCase()];
    const tool = byName[name];
    assert.equal(tool.title, op.summary, name);
    assert.ok(tool.description.startsWith(op.summary), name);
    assert.ok(tool.description.includes(op.description), name);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.annotations.readOnlyHint, method === 'GET', name);
    for (const param of op.parameters || []) {
      assert.deepEqual(tool.inputSchema.properties[param.name], { ...param.schema, description: param.description }, `${name}.${param.name}`);
    }
    const body = op.requestBody && op.requestBody.content['application/json'].schema;
    for (const [k, schema] of Object.entries((body && body.properties) || {})) assert.deepEqual(tool.inputSchema.properties[k], schema, `${name}.${k}`);
    const expected = [...(op.parameters || []).map(q => q.name), ...Object.keys((body && body.properties) || {})];
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), expected.sort(), name);
  }
  assert.deepEqual(byName.clear_nodes.inputSchema.required, ['items']);
  assert.deepEqual(byName.claim_nodes.inputSchema.required, ['worker']);
  assert.deepEqual(byName.release_claim.inputSchema.required, ['claimId']);
  assert.deepEqual(byName.resolve_url.inputSchema.required, ['url']);
  assert.equal(byName.get_node.inputSchema.required, undefined, 'fileKey / nodeId may come from url or RDS_FILE_KEY');
  for (const name of ['list_nodes', 'get_node', 'clear_nodes', 'claim_nodes', 'release_claim']) assert.ok(byName[name].inputSchema.properties.url, `${name} takes url`);
});

test('the server instructions teach the loop with the generated tool names', async t => {
  const { client } = await setup(t);
  const instructions = client.getInstructions();
  assert.match(instructions, /list_nodes .*claim_nodes/);
  assert.match(instructions, /Code Connect/);
  assert.match(instructions, /clear_nodes with the nodeId \+ contentHash pairs you read/);
  assert.match(instructions, /`stale`.*re-read that node with get_node/);
  assert.match(instructions, /RDS_FILE_KEY/);
  assert.match(instructions, /25 results per call unless you pass limit/);
  assert.match(instructions, /More results: call again with cursor=/);
  assert.match(instructions, /expand=instances follows instances into their main components/);
  assert.match(instructions, /format=outline .*what's in this screen/);
  assert.match(instructions, /changes=names .*changes=diff .*"what do I build"/);
  assert.match(instructions, /Where the connected API offers them/);
});

test('the legacy hand-written tools are gone', async t => {
  const { client } = await setup(t);
  const { tools } = await client.listTools();
  for (const name of ['get_design_delta', 'clear_node']) {
    assert.ok(!tools.some(tool => tool.name === name), name);
    await assert.rejects(client.callTool({ name, arguments: { nodeId: ROOT } }), /not found/);
  }
  assert.throws(() => require.resolve('../src/legacy'), /Cannot find module/);
});

test('every tool round-trips: inputs → HTTP request → JSON result', async t => {
  const { call, get, client } = await setup(t);
  const done = new Set();
  const expectCall = async (name, args, { method, path: p, query = {}, body }) => {
    const res = await call(name, args);
    assert.equal(res.isError, false, `${name}: ${res.text}`);
    assert.equal(res.request.method, method, name);
    assert.equal(res.request.path, p, name);
    assert.deepEqual(res.request.query, query, name);
    assert.deepEqual(res.request.body, body, name);
    done.add(name);
    return res.json;
  };
  const file = `/v3/files/${FILE_KEY}`;
  const same = async (name, args, route, query = {}) => {
    const json = await expectCall(name, args, { method: 'GET', path: route, query });
    assert.deepEqual(json, await get(route, query), name);
    return json;
  };

  const files = await same('list_files', {}, '/v3/files');
  assert.deepEqual(files.files.map(f => f.fileKey), [FILE_KEY]);
  await same('get_file', {}, file);
  await same('list_scopes', { fileKey: FILE_KEY }, `${file}/scopes`);
  const listed = await same('list_nodes', { under: ROOT, depth: 1, fields: 'nodeId,contentHash,changes', changes: 'diff', sort: '-path' },
    `${file}/nodes`, { under: ROOT, depth: '1', fields: 'nodeId,contentHash,changes', changes: 'diff', sort: '-path', limit: '25' });
  assert.deepEqual(listed.nodes.map(n => n.nodeId), [CHILD, ROOT]);
  assert.deepEqual(listed.nodes[0].changes.paddingLeft, { built: null, now: 16, category: 'layout' });
  const node = await same('get_node', { nodeId: '2-1' }, `${file}/nodes/2-1`);
  assert.equal(node.nodeId, CHILD);
  await same('resolve_url', { url: core.link(FILE_KEY, CHILD) }, '/v3/resolve', { url: core.link(FILE_KEY, CHILD) });
  const summary = await same('summarize', { state: 'all' }, `${file}/summary`, { state: 'all' });
  assert.ok(summary);
  await same('list_work_items', { limit: 10 }, `${file}/work`, { limit: '10' });
  const trends = await expectCall('get_trends', { windowDays: 7 }, { method: 'GET', path: '/v3/insights/trends', query: { windowDays: '7' } });
  const { from, to, ...rest } = await get('/v3/insights/trends', { windowDays: '7' });
  assert.deepEqual({ ...trends, from: undefined, to: undefined }, { ...rest, from: undefined, to: undefined });
  assert.deepEqual(trends.files.map(f => f.fileKey), [FILE_KEY]);

  const claim = await expectCall('claim_nodes', { worker: 'agent-a', nodeIds: [CHILD], ttlSeconds: 30 },
    { method: 'POST', path: `${file}/claims`, body: { worker: 'agent-a', nodeIds: [CHILD], ttlSeconds: 30 } });
  assert.deepEqual(claim.nodes.map(n => n.nodeId), [CHILD]);
  const claims = await same('list_claims', {}, `${file}/claims`);
  assert.equal(claims.claims[0].claimId, claim.claimId);
  const renewed = await expectCall('renew_claim', { claimId: claim.claimId, ttlSeconds: 45 },
    { method: 'POST', path: `${file}/claims/${claim.claimId}/renew`, body: { ttlSeconds: 45 } });
  assert.equal(renewed.claimId, claim.claimId);
  const released = await expectCall('release_claim', { claimId: claim.claimId },
    { method: 'DELETE', path: `${file}/claims/${claim.claimId}` });
  assert.deepEqual(released.released, [CHILD]);

  const blocked = await expectCall('block_node', { nodeId: ROOT, reason: 'Needs a new icon', worker: 'agent-a' },
    { method: 'POST', path: `${file}/nodes/${encodeURIComponent(ROOT)}/block`, body: { reason: 'Needs a new icon', worker: 'agent-a' } });
  assert.ok(blocked);
  assert.equal((await get(`${file}/nodes/${encodeURIComponent(ROOT)}`)).state, 'blocked');
  await expectCall('unblock_node', { nodeId: ROOT }, { method: 'POST', path: `${file}/nodes/${encodeURIComponent(ROOT)}/unblock`, body: {} });
  assert.equal((await get(`${file}/nodes/${encodeURIComponent(ROOT)}`)).state, 'dirty');

  const noted = await expectCall('add_note', { nodeId: ROOT, body: 'The icon should be 24px', worker: 'agent-a' },
    { method: 'POST', path: `${file}/nodes/${encodeURIComponent(ROOT)}/notes`, body: { body: 'The icon should be 24px', worker: 'agent-a' } });
  assert.equal(noted.note.status, 'open');
  assert.deepEqual(noted.node.notes.map(n => n.noteId), [noted.note.noteId]);
  const notes = await same('list_notes', { nodeId: ROOT }, `${file}/nodes/${encodeURIComponent(ROOT)}/notes`);
  assert.deepEqual(notes.notes.map(n => n.body), ['The icon should be 24px']);
  const dismissed = await expectCall('dismiss_note', { noteId: noted.note.noteId, reason: 'Duplicate' },
    { method: 'POST', path: `${file}/notes/${noted.note.noteId}/dismiss`, body: { reason: 'Duplicate' } });
  assert.equal(dismissed.note.status, 'dismissed');
  assert.deepEqual(dismissed.node.notes, []);

  const settings = await expectCall('update_file_settings', { settings: { trackLibraryComponents: true } },
    { method: 'PATCH', path: file, body: { settings: { trackLibraryComponents: true } } });
  assert.deepEqual(settings.settings, { trackLibraryComponents: true, storeImages: true });

  const cleared = await expectCall('clear_nodes', { commitRef: 'abc123', items: [{ nodeId: CHILD, contentHash: node.contentHash }] },
    { method: 'POST', path: `${file}/clear`, body: { commitRef: 'abc123', items: [{ nodeId: CHILD, contentHash: node.contentHash }] } });
  assert.deepEqual(cleared.results, [{ nodeId: CHILD, status: 'cleared', contentHash: node.contentHash }]);

  const events = await same('list_events', { after: 0, types: 'nodes.cleared' }, `${file}/events`, { after: '0', types: 'nodes.cleared', limit: '25' });
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].data.client, CLIENT, 'the API recorded X-RDS-Client');

  const { tools } = await client.listTools();
  // The screen / render-check tools and get_attachment have their own test below.
  const own = new Set(['set_screen', 'delete_screen', 'list_screens', 'request_render_check', 'list_render_checks', 'get_render_check', 'submit_render_check', 'get_attachment']);
  assert.deepEqual([...done].sort(), tools.map(tool => tool.name).filter(n => !own.has(n)).sort(), 'every tool is exercised');
});

test('every request sends X-RDS-Client: mcp/<version>', async t => {
  const { call, requests } = await setup(t);
  assert.equal(CLIENT, `mcp/${pkg.version}`);
  await call('list_nodes', {});
  await call('get_node', { nodeId: '9:9' });
  assert.ok(requests.length);
  for (const r of requests) assert.equal(r.headers['x-rds-client'], CLIENT, `${r.method} ${r.path}`);
});

test('non-JSON formats come back as the API\'s text', async t => {
  const { call } = await setup(t);
  const md = await call('list_nodes', { format: 'md' });
  assert.equal(md.isError, false, md.text);
  assert.equal(md.json, null);
  assert.match(md.text, /2:1/);
  const ndjson = await call('list_nodes', { format: 'ndjson', fields: 'nodeId' });
  assert.deepEqual(ndjson.text.trim().split('\n').map(line => JSON.parse(line).nodeId), [ROOT, CHILD]);
});

/** `count` sibling FRAMEs under a SECTION root, each named with `nameLength` characters. */
const manyNodes = (count, nameLength = 20) => [
  upsert(ROOT, { width: 800 }, { nodeType: 'SECTION' }),
  ...Array.from({ length: count }, (_, i) => {
    const id = `3:${i + 1}`;
    return upsert(id, { paddingLeft: i }, { parentId: ROOT, path: [ROOT], name: `${id} ${'x'.repeat(nameLength)}` });
  }),
];

test('listing tools default limit to RDS_MCP_DEFAULT_LIMIT (25) only when it is omitted', async t => {
  const { call, client } = await setup(t);
  assert.equal((await call('list_nodes', {})).request.query.limit, '25');
  assert.equal((await call('list_nodes', { limit: 3 })).request.query.limit, '3');
  assert.equal((await call('list_work_items', {})).request.query.limit, '25');
  assert.equal((await call('list_events', {})).request.query.limit, '25');
  assert.equal((await call('list_nodes', { format: 'md' })).request.query.limit, '25');

  const { tools } = await client.listTools();
  const paged = tools.filter(tool => tool.inputSchema.properties.limit && tool.annotations.readOnlyHint).map(tool => tool.name);
  assert.ok(paged.includes('list_nodes'));
  for (const [name, args] of [['get_node', { nodeId: ROOT }], ['summarize', {}], ['list_files', {}], ['get_file', {}]]) {
    const res = await call(name, args);
    assert.equal(res.isError, false, `${name}: ${res.text}`);
    assert.equal(res.request.query.limit, undefined, name);
  }
  const claim = await call('claim_nodes', { worker: 'agent-a', nodeIds: [ROOT, CHILD] });
  assert.equal(claim.isError, false, claim.text);
  assert.deepEqual(claim.request.body, { worker: 'agent-a', nodeIds: [ROOT, CHILD] }, 'write operations get no default limit');
  assert.equal(claim.json.nodes.length, 2);

  const small = await setup(t, { env: { RDS_MCP_DEFAULT_LIMIT: '1' } });
  const one = await small.call('list_nodes', {});
  assert.equal(one.request.query.limit, '1');
  assert.deepEqual(one.json.nodes.map(n => n.nodeId), [ROOT]);
});

test('a result with nextCursor ends with the paging line; the last page has none', async t => {
  const { call } = await setup(t, { upserts: manyNodes(4), env: { RDS_MCP_DEFAULT_LIMIT: '2' } });
  const first = await call('list_nodes', {});
  assert.equal(first.isError, false, first.text);
  assert.ok(first.json.nextCursor);
  assert.ok(first.text.endsWith(`\n\n${moreResults(first.json.nextCursor)}`), first.text);
  assert.equal(first.cursor, first.json.nextCursor);

  const seen = [...first.json.nodes.map(n => n.nodeId)];
  let page = first;
  while (page.cursor) {
    page = await call('list_nodes', { cursor: page.cursor });
    assert.equal(page.isError, false, page.text);
    seen.push(...page.json.nodes.map(n => n.nodeId));
  }
  assert.equal(page.json.nextCursor, null);
  assert.doesNotMatch(page.text, /More results/);
  assert.deepEqual(seen, [ROOT, '3:1', '3:2', '3:3', '3:4']);

  const summary = await call('summarize', {});
  assert.doesNotMatch(summary.text, /More results/);
});

test('the size guard halves limit until the result fits, with a correct cursor', async t => {
  const max = 3000;
  const { call, requests, get } = await setup(t, { upserts: manyNodes(8, 400), env: { RDS_MCP_MAX_RESULT_CHARS: String(max) } });
  const all = (await get(`/v3/files/${FILE_KEY}/nodes`)).nodes.map(n => n.nodeId);
  assert.equal(all.length, 9);

  const first = await call('list_nodes', {});
  assert.equal(first.isError, false, first.text);
  const limits = requests.map(r => Number(r.query.limit));
  assert.equal(limits[0], 25);
  for (let i = 1; i < limits.length; i++) assert.equal(limits[i], Math.max(1, Math.floor(limits[i - 1] / 2)), `halved: ${limits}`);
  assert.ok(limits.length > 1, 'at least one retry');
  assert.ok(first.text.length <= max, `${first.text.length} chars`);
  assert.doesNotMatch(first.text, new RegExp(TRUNCATED));
  assert.equal(first.json.nodes.length, limits[limits.length - 1]);
  assert.ok(first.json.nodes.length < all.length);
  assert.equal(first.cursor, first.json.nextCursor);

  const seen = first.json.nodes.map(n => n.nodeId);
  let page = first;
  while (page.cursor) {
    page = await call('list_nodes', { cursor: page.cursor });
    assert.equal(page.isError, false, page.text);
    assert.ok(page.text.length <= max);
    seen.push(...page.json.nodes.map(n => n.nodeId));
  }
  assert.deepEqual(seen, all, 'every retry is a real request, so paging neither skips nor repeats');

  await call('list_nodes', { limit: 2 });
  assert.deepEqual(requests.map(r => r.query.limit), ['2'], 'a page that fits is not re-requested');
});

test('a single item over the budget comes back cut, with the truncation note', async t => {
  const max = 2000;
  const { call, requests } = await setup(t, { upserts: manyNodes(3, 5000), env: { RDS_MCP_MAX_RESULT_CHARS: String(max) } });
  const listed = await call('list_nodes', { under: '3:1' });
  assert.equal(listed.isError, false, listed.text);
  assert.deepEqual(requests.map(r => r.query.limit), ['25', '12', '6', '3', '1']);
  assert.ok(listed.text.length <= max, `${listed.text.length} chars`);
  assert.match(listed.text, /\n\nresult truncated — use fields= or get_node$/);

  const root = await call('list_nodes', {});
  assert.deepEqual(root.json.nodes.map(n => n.nodeId), [ROOT], 'the small root fits alone');
  const cut = await call('list_nodes', { cursor: root.cursor });
  assert.ok(cut.text.length <= max, `${cut.text.length} chars`);
  const paging = cut.text.match(PAGING_LINE);
  assert.ok(paging, 'the paging line survives the cut');
  assert.ok(cut.text.slice(0, paging.index).endsWith(`\n\n${TRUNCATED}`));
  assert.match(cut.text, /"name": "3:1 x/);
  const next = await call('list_nodes', { cursor: paging[1] });
  assert.equal(next.isError, false, next.text);
  assert.match(next.text, /"name": "3:2 x/, 'the cursor from the cut page leads to the next node');

  const node = await call('get_node', { nodeId: '3:2' });
  assert.equal(requests.length, 1, 'a tool without limit is not retried');
  assert.ok(node.text.length <= max);
  assert.ok(node.text.endsWith(`\n\n${TRUNCATED}`));
});

test('text formats pass through unchanged, whatever their size', async t => {
  const { call, baseUrl } = await setup(t, { upserts: manyNodes(6, 400), env: { RDS_MCP_MAX_RESULT_CHARS: '500' } });
  const raw = async query => {
    const url = new URL(`${baseUrl}/v3/files/${FILE_KEY}/nodes`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
    assert.equal(res.status, 200);
    return res.text();
  };
  const md = await call('list_nodes', { format: 'md' });
  assert.equal(md.isError, false, md.text);
  assert.equal(md.text, await raw({ format: 'md', limit: '25' }));
  assert.ok(md.text.length > 500);
  const line = await call('list_nodes', { format: 'ndjson', fields: 'nodeId', limit: 1 });
  assert.equal(line.text, await raw({ format: 'ndjson', fields: 'nodeId', limit: '1' }), 'a one-line ndjson body is not parsed and re-printed');
});

test('format=outline: no default limit, More results from X-RDS-Next-Cursor, the size guard keeps whole lines', async t => {
  const max = 2000;
  const { call, requests, baseUrl, openapi } = await setup(t, { upserts: manyNodes(12, 300), env: { RDS_MCP_MAX_RESULT_CHARS: String(max) } });
  const formats = openapi.paths['/v3/files/{fileKey}/nodes'].get.parameters.find(p => p.name === 'format').schema.enum;
  if (!formats.includes('outline')) return t.skip('this API has no format=outline');
  const raw = async query => {
    const url = new URL(`${baseUrl}/v3/files/${FILE_KEY}/nodes`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { authorization: `Bearer ${AGENT_TOKEN}` } });
    assert.equal(res.status, 200);
    return { body: await res.text(), next: res.headers.get('x-rds-next-cursor') };
  };
  const whole = (await raw({ format: 'outline' })).body;
  assert.equal(whole.split('\n').length - 1, 13);
  assert.ok(whole.length > max);

  const pages = [];
  let page = await call('list_nodes', { format: 'outline' });
  assert.equal(requests[0].query.limit, undefined, 'the first request has no limit');
  const kept = Number(requests.at(-1).query.limit);
  assert.ok(requests.length > 1 && kept > 1 && kept < 13, `re-requested with limit=${kept}`);
  for (;;) {
    assert.equal(page.isError, false, page.text);
    assert.ok(page.text.length <= max, `${page.text.length} chars`);
    assert.doesNotMatch(page.text, new RegExp(TRUNCATED));
    const body = page.cursor ? `${page.text.slice(0, page.text.match(PAGING_LINE).index)}\n` : page.text;
    const api = await raw({ format: 'outline', ...requests.at(-1).query });
    assert.equal(body, api.body, 'the page is the last request\'s body: whole lines');
    assert.equal(page.cursor, api.next, 'its cursor is that request\'s X-RDS-Next-Cursor');
    pages.push(body);
    if (!page.cursor) break;
    page = await call('list_nodes', { format: 'outline', cursor: page.cursor });
  }
  assert.ok(pages.length > 1);
  assert.equal(pages.join(''), whole, 'the pages join to the whole outline, nothing skipped or repeated');

  const two = await call('list_nodes', { format: 'outline', limit: 2 });
  assert.deepEqual(requests.map(r => r.query.limit), ['2'], 'a page that fits is not re-requested');
  assert.equal(two.text.split('\n').slice(0, 2).join('\n\n'), whole.split('\n').slice(0, 2).join('\n\n'));
  assert.equal(two.cursor, (await raw({ format: 'outline', limit: '2' })).next);
});

test('file- and node-taking tools accept a Figma url instead of fileKey / nodeId', async t => {
  const { call } = await setup(t, { fileKeyDefault: false });
  const rootUrl = core.link(FILE_KEY, ROOT);
  const childUrl = core.link(FILE_KEY, CHILD);

  const listed = await call('list_nodes', { url: childUrl });
  assert.equal(listed.isError, false, listed.text);
  assert.equal(listed.request.path, '/v3/files/-/nodes');
  assert.deepEqual(listed.request.query, { url: childUrl, limit: '25' });
  assert.deepEqual(listed.json.nodes.map(n => n.nodeId), [CHILD]);
  const fileOnly = await call('list_nodes', { url: `https://www.figma.com/design/${FILE_KEY}/Design` });
  assert.deepEqual(fileOnly.json.nodes.map(n => n.nodeId), [ROOT, CHILD]);
  const underLink = await call('list_nodes', { fileKey: FILE_KEY, under: childUrl });
  assert.deepEqual(underLink.request.query, { under: CHILD, limit: '25' });

  const node = await call('get_node', { url: childUrl });
  assert.equal(node.isError, false, node.text);
  assert.equal(node.request.path, '/v3/files/-/nodes/-');
  assert.equal(node.json.nodeId, CHILD);
  const byLinkId = await call('get_node', { nodeId: childUrl });
  assert.equal(byLinkId.request.path, `/v3/files/${FILE_KEY}/nodes/${encodeURIComponent(CHILD)}`, 'fileKey comes from the node link');
  assert.equal(byLinkId.json.nodeId, CHILD);

  const claim = await call('claim_nodes', { url: rootUrl, worker: 'agent-a', nodeIds: [childUrl] });
  assert.equal(claim.isError, false, claim.text);
  assert.deepEqual(claim.request.body, { worker: 'agent-a', nodeIds: [CHILD] });
  assert.deepEqual(claim.json.nodes.map(n => n.nodeId), [CHILD]);
  const released = await call('release_claim', { url: rootUrl, claimId: claim.json.claimId });
  assert.equal(released.isError, false, released.text);
  assert.deepEqual(released.json.released, [CHILD]);

  const cleared = await call('clear_nodes', { commitRef: 'abc', items: [{ nodeId: childUrl, contentHash: node.json.contentHash }] });
  assert.equal(cleared.isError, false, cleared.text);
  assert.equal(cleared.request.path, `/v3/files/${FILE_KEY}/clear`);
  assert.deepEqual(cleared.json.results, [{ nodeId: CHILD, status: 'cleared', contentHash: node.json.contentHash }]);

  const otherFile = await call('clear_nodes', { fileKey: 'OtherKey123', items: [{ nodeId: childUrl, contentHash: 'x' }] });
  assert.equal(otherFile.isError, true);
  assert.match(otherFile.text, /names file 'AbCdEf123456', but the call is for file 'OtherKey123'/);
  const notNode = await call('claim_nodes', { fileKey: FILE_KEY, worker: 'a', nodeIds: [`https://www.figma.com/design/${FILE_KEY}/Design`] });
  assert.equal(notNode.isError, true);
  assert.match(notNode.text, /nodeIds\[0\]: .* is not a Figma link with a node-id/);
  const mismatch = await call('list_nodes', { fileKey: 'OtherKey123', url: childUrl });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.text, /url_mismatch/);
  const noNode = await call('get_node', { url: `https://www.figma.com/design/${FILE_KEY}/Design` });
  assert.equal(noNode.isError, true);
  assert.match(noNode.text, /invalid_parameter[\s\S]*Hint: Pass a link that selects a node/);
});

test('problems reach the model with title, detail and hint', async t => {
  const { call } = await setup(t, { fileKeyDefault: false });
  const missing = await call('get_node', { fileKey: FILE_KEY, nodeId: '9-9' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /^HTTP 404 GET \/v3\/files\/AbCdEf123456\/nodes\/9-9 — Node not found \(node_not_found\): /);
  assert.match(missing.text, /\nHint: Neither '9:9' nor '9-9' exists/);
  const typo = await call('list_nodes', { fileKey: FILE_KEY, state: 'dirt' });
  assert.match(typo.text, /Invalid parameter \(invalid_parameter\): state: unknown value 'dirt'[\s\S]*\nHint: Use one or more of: dirty/);
  const urlAsKey = await call('list_nodes', { fileKey: `https://www.figma.com/design/${FILE_KEY}/Design` });
  assert.match(urlAsKey.text, new RegExp(`file_not_found[\\s\\S]*\\nHint: That looks like a Figma URL\\. Use the file key '${FILE_KEY}'`));
  const bad = await call('resolve_url', { url: 'https://example.com/nope' });
  assert.match(bad.text, /^HTTP 400 GET \/v3\/resolve — Not a Figma link \(invalid_url\): [\s\S]*\nHint: Pass a link like/);
  const both = await call('claim_nodes', { fileKey: FILE_KEY, worker: 'c', nodeIds: [CHILD], filter: { under: ROOT } });
  assert.match(both.text, /invalid_body\): Pass nodeIds or filter, not both\.\nHint: /);
  const unknownClaim = await call('release_claim', { fileKey: FILE_KEY, claimId: '00000000-0000-0000-0000-000000000000' });
  assert.match(unknownClaim.text, /^HTTP 404 DELETE .* — Claim not found \(claim_not_found\): [\s\S]*\nHint: /);

  const noKey = await call('list_nodes', {});
  assert.equal(noKey.isError, true);
  assert.match(noKey.text, /fileKey is required.*RDS_FILE_KEY/);
  const noId = await call('get_node', { fileKey: FILE_KEY });
  assert.match(noId.text, /nodeId is required: pass it, or a Figma link with a node-id as url/);
  const extra = await call('list_nodes', { fileKey: FILE_KEY, nope: 1 });
  assert.equal(extra.isError, true);
  assert.match(extra.text, /list_nodes: unknown input\(s\) nope\. Valid inputs: .*under/);
});

test('a bad agent token is reported as a problem, not thrown', async t => {
  const api = await startApi(t);
  const client = await connect(t, { RDS_API_BASE_URL: api.baseUrl, RDS_AGENT_TOKEN: 'wrong', RDS_FILE_KEY: FILE_KEY });
  const res = await client.callTool({ name: 'list_nodes', arguments: {} });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^HTTP 401 GET .* — Invalid bearer token \(invalid_token\)/);
});

test('a server without some operation yields no tool for it', async t => {
  const drop = ['/v3/files/{fileKey}/claims/{claimId}/renew', '/v3/files/{fileKey}/summary'];
  const { client, call, openapi } = await setup(t, {
    transform: doc => {
      for (const p of drop) delete doc.paths[p];
      delete doc.paths['/v3/files/{fileKey}/nodes/{nodeId}/block'].post['x-rds-mcp'];
      return doc;
    },
  });
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name).sort();
  const expected = annotated(openapi).map(([name]) => name).filter(n => !['renew_claim', 'summarize', 'block_node'].includes(n)).sort();
  assert.deepEqual(names, expected);
  await assert.rejects(client.callTool({ name: 'renew_claim', arguments: { claimId: 'x' } }), /Tool renew_claim not found/);
  const listed = await call('list_nodes', {});
  assert.equal(listed.isError, false, listed.text);
});

test('toolsFromOpenApi takes path-level parameters and nests a colliding or non-object body', () => {
  const tools = toolsFromOpenApi({
    paths: {
      '/v3/things/{id}': {
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        put: {
          summary: 'Put a thing',
          'x-rds-mcp': { tool: 'put_thing' },
          parameters: [{ in: 'query', name: 'id2', schema: { type: 'string' } }, { in: 'header', name: 'x-skip', schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id2: { type: 'string' } } } } } },
        },
        get: { summary: 'Get a thing' },
      },
    },
  });
  assert.deepEqual(tools.map(tool => tool.name), ['put_thing']);
  const [tool] = tools;
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['id', 'id2', 'body']);
  assert.deepEqual(tool.inputSchema.required, ['id', 'body']);
  assert.equal(tool.bodyKey, 'body');
  assert.equal(tool.annotations.readOnlyHint, false);
});

async function startupError(env, options) {
  const err = await createServer(readConfig(env), options).then(() => null, e => e);
  assert.ok(err instanceof StartupError, `expected a StartupError, got ${err}`);
  return err.message;
}

test('startup fails clearly when the API is unreachable or not a v3 API', async t => {
  const closed = `http://127.0.0.1:${await freePort()}`;
  const unreachable = await startupError({ RDS_API_BASE_URL: closed, RDS_AGENT_TOKEN: AGENT_TOKEN });
  assert.match(unreachable, new RegExp(`could not reach the rolling-design-sync API at RDS_API_BASE_URL=${closed.replace(/\./g, '\\.')} to load its tools from .*/v3/openapi\\.json`));

  const other = http.createServer((req, res) => res.writeHead(404).end('nope'));
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(() => other.close());
  const otherUrl = `http://127.0.0.1:${other.address().port}`;
  const notV3 = await startupError({ RDS_API_BASE_URL: otherUrl, RDS_AGENT_TOKEN: AGENT_TOKEN });
  assert.match(notV3, /returned HTTP 404; RDS_API_BASE_URL=.* does not look like a rolling-design-sync API with v3/);

  const api = await startApi(t);
  const noTools = await startupError({ RDS_API_BASE_URL: api.baseUrl, RDS_AGENT_TOKEN: AGENT_TOKEN }, {
    fetchImpl: async () => new Response(JSON.stringify({ openapi: '3.1.0', paths: {} }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.match(noTools, /lists no agent operations \(x-rds-mcp\).*RDS_API_BASE_URL/);

  const res = spawnSync(process.execPath, [BIN], {
    env: { ...process.env, RDS_API_BASE_URL: closed, RDS_AGENT_TOKEN: AGENT_TOKEN }, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stderr, /could not reach the rolling-design-sync API at RDS_API_BASE_URL=/);
});

test('rds-mcp serves the generated tools over stdio', async t => {
  const api = await startApi(t);
  const client = new Client({ name: 'rds-mcp-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [BIN], stderr: 'pipe',
    env: { PATH: process.env.PATH, RDS_API_BASE_URL: api.baseUrl, RDS_AGENT_TOKEN: AGENT_TOKEN, RDS_FILE_KEY: FILE_KEY },
  });
  await client.connect(transport);
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), annotated(api.openapi).map(([name]) => name).sort());
  const res = await client.callTool({ name: 'list_files', arguments: {} });
  assert.equal(res.isError, undefined, res.content[0].text);
  assert.ok(Array.isArray(JSON.parse(res.content[0].text).files));
});

test('a 429 names the retry time (Retry-After), the limit and the hint', async t => {
  const port = await freePort();
  const config = loadConfig({ RDS_STORE: 'memory', RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_RATE_LIMIT_TOKEN: '2' });
  const app = buildApp({ store: new MemoryStore(), config });
  await app.listen({ port, host: '127.0.0.1' });
  t.after(() => app.close());
  // Startup's GET /v3/openapi.json spends one request of the token's budget.
  const client = await connect(t, { RDS_API_BASE_URL: `http://127.0.0.1:${port}`, RDS_AGENT_TOKEN: AGENT_TOKEN });
  const ok = await client.callTool({ name: 'list_files', arguments: {} });
  assert.equal(ok.isError, undefined, ok.content[0].text);
  const limited = await client.callTool({ name: 'list_files', arguments: {} });
  assert.equal(limited.isError, true);
  assert.match(limited.content[0].text, /^HTTP 429 GET \/v3\/files — rate limited \(rate_limited\): retry in \d+ s\. This token made more than 2 requests in a minute\.\nHint: Retry in \d+ s/);
});

test('a 429 without a problem body or Retry-After still says it was rate limited', async () => {
  const { httpError, retrySeconds } = require('../src/server');
  const res = httpError({ status: 429, data: 'Too Many Requests', method: 'GET', path: '/v3/files', retryAfter: null });
  assert.deepEqual(res, { content: [{ type: 'text', text: 'HTTP 429 GET /v3/files — rate limited (rate_limited): retry later. Too Many Requests' }], isError: true });
  const fromBody = httpError({ status: 429, data: { title: 'Too many requests', detail: 'Slow down.', retryAfter: 7 }, method: 'GET', path: '/v3/files' });
  assert.match(fromBody.content[0].text, /retry in 7 s\. Slow down\.$/);
  assert.equal(retrySeconds('12'), 12);
  assert.equal(retrySeconds(new Date(Date.UTC(2030, 0, 1, 0, 0, 30)).toUTCString(), Date.UTC(2030, 0, 1)), 30);
  assert.equal(retrySeconds('soon'), null);
});

test('readConfig requires RDS_API_BASE_URL and RDS_AGENT_TOKEN', () => {
  assert.throws(() => readConfig({}), err => err instanceof ConfigError && /RDS_API_BASE_URL, RDS_AGENT_TOKEN/.test(err.message));
  assert.throws(() => readConfig({ RDS_API_BASE_URL: 'http://127.0.0.1:8787' }), /missing .*RDS_AGENT_TOKEN/);
  assert.throws(() => readConfig({ RDS_API_BASE_URL: 'ftp://x', RDS_AGENT_TOKEN: 't' }), /must be an http\(s\) URL/);
  assert.deepEqual(readConfig({ RDS_API_BASE_URL: 'http://127.0.0.1:8787/', RDS_AGENT_TOKEN: ' t ', RDS_FILE_KEY: 'k' }), {
    baseUrl: 'http://127.0.0.1:8787', token: 't', defaultFileKey: 'k', defaultLimit: 25, maxResultChars: 50000,
  });
  const tuned = readConfig({ RDS_API_BASE_URL: 'http://x', RDS_AGENT_TOKEN: 't', RDS_MCP_DEFAULT_LIMIT: '10', RDS_MCP_MAX_RESULT_CHARS: ' 2000 ' });
  assert.equal(tuned.defaultLimit, 10);
  assert.equal(tuned.maxResultChars, 2000);
  for (const bad of ['0', '-1', '2.5', 'ten']) {
    assert.throws(() => readConfig({ RDS_API_BASE_URL: 'http://x', RDS_AGENT_TOKEN: 't', RDS_MCP_DEFAULT_LIMIT: bad }), /RDS_MCP_DEFAULT_LIMIT must be a positive integer/);
    assert.throws(() => readConfig({ RDS_API_BASE_URL: 'http://x', RDS_AGENT_TOKEN: 't', RDS_MCP_MAX_RESULT_CHARS: bad }), /RDS_MCP_MAX_RESULT_CHARS must be a positive integer/);
  }
});

test('rds-mcp exits 1 with a clear message when required env is missing', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^[RF]DS_(API_BASE_URL|AGENT_TOKEN)$/.test(k)));
  const res = spawnSync(process.execPath, [BIN], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /missing required environment variable\(s\): RDS_API_BASE_URL, RDS_AGENT_TOKEN/);
});

test('screens and render checks; get_attachment returns MCP image content', async t => {
  const { call, client } = await setup(t, {
    upserts: [
      upsert(ROOT, { width: 800 }, { nodeType: 'SECTION' }),
      upsert(CHILD, { width: 320, height: 240 }, { parentId: ROOT, path: [ROOT], nodeType: 'FRAME' }),
    ],
  });
  const file = `/v3/files/${FILE_KEY}`;
  const set = await call('set_screen', { nodeId: CHILD, route: '/home' });
  assert.equal(set.isError, false, set.text);
  assert.deepEqual([set.request.method, set.request.path, set.request.body], ['PUT', `${file}/screens/${encodeURIComponent(CHILD)}`, { route: '/home' }]);
  assert.deepEqual(set.json.screen.viewport, { width: 320, height: 240 });
  assert.deepEqual((await call('list_screens', {})).json.screens.map(s => s.nodeId), [CHILD]);
  const requested = await call('request_render_check', { nodeId: CHILD });
  assert.equal(requested.json.check.status, 'requested');
  const { checkId } = requested.json.check;
  assert.deepEqual((await call('list_render_checks', { status: 'requested' })).json.checks.map(c => c.checkId), [checkId]);
  assert.equal((await call('get_render_check', { checkId })).json.check.route, '/home');
  const failed = await call('submit_render_check', { checkId, error: 'dev server down' });
  assert.equal(failed.json.check.status, 'error');
  const removed = await call('delete_screen', { nodeId: CHILD });
  assert.equal(removed.json.deleted, true);
  assert.deepEqual((await call('list_screens', {})).json.screens, []);

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const note = await call('add_note', { nodeId: CHILD, body: 'off by one', images: [{ data: PNG }] });
  assert.equal(note.isError, false, note.text);
  const [shot] = note.json.note.attachments;
  const res = await client.callTool({ name: 'get_attachment', arguments: { attachmentId: shot.attachmentId } });
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].type, 'image');
  assert.equal(res.content[0].mimeType, shot.contentType);
  assert.ok(Buffer.from(res.content[0].data, 'base64').length > 8);
  const missing = await client.callTool({ name: 'get_attachment', arguments: { attachmentId: '00000000-0000-4000-8000-000000000000' } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /attachment_not_found/);
});
