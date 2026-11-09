'use strict';

/* Zero-setup local use: the HTTP transport, the token file, startup retry, and the stdio snapshot fallback. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { buildApp } = require('@rolling-design-sync/api');
const { loadConfig } = require('@rolling-design-sync/api/src/config');
const { MemoryStore } = require('@rolling-design-sync/api/src/store/memory');
const { startHttpServer, loadSnapshot, foreignRequest } = require('../src/server');
const { readConfig, agentToken, ConfigError } = require('../src/config');
const { fetchWithHost } = require('../src/client');
const { toolsFromOpenApi } = require('../src/tools');
const { liveDoc, snapshotOf } = require('../scripts/gen-snapshot');

const AGENT_TOKEN = 'a'.repeat(64);
const BIN = path.join(__dirname, '..', 'bin', 'rds-mcp.js');
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

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

/** The API (memory store, embedded-mode Host/Origin checks) on `port`. */
async function startApi(t, port) {
  const config = loadConfig({ RDS_STORE: 'memory', HOST: '127.0.0.1', PORT: String(port), RDS_AGENT_TOKENS: AGENT_TOKEN, RDS_PLUGIN_TOKENS: 'p'.repeat(64) });
  const app = buildApp({ store: new MemoryStore(), config });
  await app.listen({ port, host: '127.0.0.1' });
  t.after(() => app.close());
  return `http://127.0.0.1:${port}`;
}

/** A tokens.json like the API's local mode writes, in a temp dir. */
function tokenFile(t, tokens = { plugin: 'p'.repeat(64), agent: AGENT_TOKEN, viewer: 'v'.repeat(64), session: 's'.repeat(64) }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-mcp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tokens.json');
  fs.writeFileSync(file, JSON.stringify(tokens));
  return file;
}

async function startMcp(t, env, options = {}) {
  const logs = [];
  const mcp = await startHttpServer(readConfig({ RDS_MCP_PORT: '0', ...env }, {}, ['--http']), { log: line => logs.push(line), ...options });
  t.after(() => mcp.close());
  return { ...mcp, logs, endpoint: `http://127.0.0.1:${mcp.port}/mcp` };
}

/** A raw request to the MCP server, with the given Host / Origin. */
function raw(port, { method = 'POST', path: p = '/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('HTTP transport: initialize, tools/list and a tool call, with the agent token read from RDS_AGENT_TOKEN_FILE', async t => {
  const baseUrl = await startApi(t, await freePort());
  const mcp = await startMcp(t, { RDS_API_BASE_URL: baseUrl, RDS_AGENT_TOKEN_FILE: tokenFile(t) });
  assert.equal(await mcp.ready, true);
  assert.equal(mcp.url, `http://127.0.0.1:${mcp.port}/mcp`);
  assert.ok(!mcp.logs.join('\n').includes(AGENT_TOKEN), 'the token is never logged');

  const client = new Client({ name: 'rds-mcp-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp.endpoint)));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), toolsFromOpenApi(loadSnapshot()).map(tool => tool.name).sort());
  const res = await client.callTool({ name: 'list_files', arguments: {} });
  assert.equal(res.isError, undefined, res.content[0].text);
  assert.ok(Array.isArray(JSON.parse(res.content[0].text).files));

  const health = await raw(mcp.port, { method: 'GET', path: '/health' });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'ok', tools: tools.length });
});

test('HTTP transport: a foreign Host or Origin is refused (DNS rebinding); loopback and RDS_MCP_ALLOWED_HOSTS are not', async t => {
  const baseUrl = await startApi(t, await freePort());
  const mcp = await startMcp(t, { RDS_API_BASE_URL: baseUrl, RDS_AGENT_TOKEN: AGENT_TOKEN, RDS_MCP_ALLOWED_HOSTS: 'mcp.internal' });
  await mcp.ready;
  for (const headers of [
    { host: 'evil.example:8788' },
    { host: `localhost:${mcp.port}`, origin: 'http://evil.example' },
    { host: `localhost:${mcp.port}`, origin: 'null' },
  ]) {
    const res = await raw(mcp.port, { headers, body: INIT });
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.match(JSON.parse(res.body).error.message, /^Forbidden: (Host header|Origin) /);
    assert.equal((await raw(mcp.port, { method: 'GET', path: '/health', headers })).status, 403);
  }
  for (const headers of [
    { host: `localhost:${mcp.port}` },
    { host: `127.0.0.1:${mcp.port}`, origin: 'http://localhost:3000' },
    { host: `[::1]:${mcp.port}` },
    { host: 'mcp.internal:8788', origin: 'http://mcp.internal' },
  ]) {
    const res = await raw(mcp.port, { headers, body: INIT });
    assert.equal(res.status, 200, `${JSON.stringify(headers)}: ${res.body}`);
    assert.equal(JSON.parse(res.body).result.serverInfo.name, 'rds-mcp');
  }
  assert.equal(foreignRequest({ headers: {} }, ['localhost']), "Host header '' is not allowed");
  assert.equal((await raw(mcp.port, { method: 'GET', headers: { host: 'localhost' } })).status, 405);
  assert.equal((await raw(mcp.port, { path: '/other', headers: { host: 'localhost' }, body: INIT })).status, 404);
});

test('HTTP transport: not ready until the API answers, then serves without a restart', async t => {
  const port = await freePort();
  const mcp = await startMcp(t, { RDS_API_BASE_URL: `http://127.0.0.1:${port}`, RDS_AGENT_TOKEN: AGENT_TOKEN }, { retry: { initialMs: 20, maxMs: 100 } });
  await new Promise(resolve => setTimeout(resolve, 100));
  const starting = await raw(mcp.port, { method: 'GET', path: '/health', headers: { host: 'localhost' } });
  assert.equal(starting.status, 503);
  assert.equal(JSON.parse(starting.body).status, 'starting');
  assert.match(JSON.parse(starting.body).detail, /could not reach the rolling-design-sync API/);
  const early = await raw(mcp.port, { headers: { host: 'localhost' }, body: INIT });
  assert.equal(early.status, 503);
  assert.match(JSON.parse(early.body).error.message, /^rds-mcp is not ready: /);
  assert.match(mcp.logs.join('\n'), /retrying until the API is up/);

  await startApi(t, port);
  assert.equal(await mcp.ready, true);
  assert.equal((await raw(mcp.port, { method: 'GET', path: '/health', headers: { host: 'localhost' } })).status, 200);
  assert.equal((await raw(mcp.port, { headers: { host: 'localhost' }, body: INIT })).status, 200);
});

test('agentToken: RDS_AGENT_TOKEN, else the file\'s agent entry, else an error naming what to set', t => {
  assert.equal(agentToken({ token: 'direct' }), 'direct');
  assert.equal(agentToken({ token: null, tokenFile: tokenFile(t) }), AGENT_TOKEN);
  assert.throws(() => agentToken({ token: null, tokenFile: null }), err => err instanceof ConfigError && /set RDS_AGENT_TOKEN .*RDS_AGENT_TOKEN_FILE/.test(err.message));
  assert.throws(() => agentToken({ token: null, tokenFile: '/nope/tokens.json' }), /RDS_AGENT_TOKEN_FILE=\/nope\/tokens\.json: it does not exist/);
  assert.throws(() => agentToken({ token: null, tokenFile: tokenFile(t, { plugin: 'x' }) }), /has no "agent" token/);
  const broken = tokenFile(t);
  fs.writeFileSync(broken, '{');
  assert.throws(() => agentToken({ token: null, tokenFile: broken }), /it is not JSON/);
});

test('RDS_API_HOST is sent as the Host header (a local-mode API only answers loopback names)', async t => {
  const seen = [];
  const srv = http.createServer((req, res) => { seen.push(req.headers.host); res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  const res = await fetchWithHost('localhost:8787')(`http://127.0.0.1:${srv.address().port}/x`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(seen, ['localhost:8787']);
});

function stdioClient(t, env) {
  const client = new Client({ name: 'rds-mcp-test', version: '0.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], stderr: 'pipe', env: { PATH: process.env.PATH, ...env } });
  t.after(() => client.close());
  return { client, transport };
}

test('stdio: with the API down it starts from the bundled snapshot, and calls say how to fix it', async t => {
  const { client, transport } = stdioClient(t, { RDS_API_BASE_URL: `http://127.0.0.1:${await freePort()}`, RDS_AGENT_TOKEN: AGENT_TOKEN });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), toolsFromOpenApi(loadSnapshot()).map(tool => tool.name).sort());
  const res = await client.callTool({ name: 'list_files', arguments: {} });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^Could not reach the rolling-design-sync API at http:\/\/127\.0\.0\.1:\d+ \(RDS_API_BASE_URL\): .*Start it \(`docker compose up -d`/);
  assert.match(stderr, /serving the bundled tool list/);
});

test('stdio: without a token it still starts, and calls name the variable to set', async t => {
  const baseUrl = await startApi(t, await freePort());
  const { client, transport } = stdioClient(t, { RDS_API_BASE_URL: baseUrl });
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.length > 0);
  const res = await client.callTool({ name: 'list_files', arguments: {} });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^No agent token: set RDS_AGENT_TOKEN .*http:\/\/localhost:8788\/mcp/);
});

test('the bundled OpenAPI snapshot matches the API (regenerate: npm run gen:snapshot -w apps/mcp)', async () => {
  assert.deepEqual(loadSnapshot(), JSON.parse(JSON.stringify(snapshotOf(await liveDoc()))));
});
