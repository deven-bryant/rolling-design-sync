'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const http = require('node:http');
const { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { readConfig, agentToken, ConfigError, DEFAULT_LIMIT, MAX_RESULT_CHARS } = require('./config');
const { createApiClient } = require('./client');
const { toolsFromOpenApi, toRequest, ToolError } = require('./tools');
const pkg = require('../package.json');

const CLIENT = `mcp/${pkg.version}`;
const OPENAPI_PATH = '/v3/openapi.json';
const STARTUP_TIMEOUT_MS = 15000;
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Bundled copy of the API's x-rds-mcp operations, served over stdio while the API is down. */
const SNAPSHOT_FILE = require.resolve('./openapi.snapshot.json');

const INSTRUCTIONS = [
  'rolling-design-sync tracks what changed in Figma since it was last built, node by node. The tools are generated from the connected API\'s OpenAPI document.',
  'Loop: (1) list_nodes for the screen or component you are working on (or claim_nodes to lease nodes when several agents share a file; summarize / list_work_items for an overview);',
  '(2) implement each node\'s `changes` — per property { built, now, category }, with token names where a value is bound — mapping it to code via Code Connect / figma.ts mappings where present, and pulling live details for that node only from the Figma MCP via its figmaUrl;',
  '(3) clear_nodes with the nodeId + contentHash pairs you read and the commit SHA.',
  'An item that comes back `stale` changed again after you read it: re-read that node with get_node, implement the newer change, and clear it with its new contentHash — never retry the old hash.',
  'Use block_node for a node you cannot implement instead of clearing it.',
  'Any tool that takes fileKey / nodeId also takes a Figma link as `url`; fileKey defaults to RDS_FILE_KEY when that is set in the server env.',
  `Listing tools return ${DEFAULT_LIMIT} results per call unless you pass limit (text formats: up to that many lines; format=outline: the whole outline unless you pass limit, in lines); a result that ends with \`More results: call again with cursor="…"\` has more — repeat the call with that cursor and every other input unchanged. Results too large for one reply come back as a smaller page.`,
  'Where the connected API offers them (they then appear in the tool inputs): expand=instances follows instances into their main components, so one list_nodes / summarize / list_work_items call covers everything a screen uses;',
  'format=outline returns a screen as an indented text tree — the quickest answer to "what\'s in this screen" (with expand=instances for the components inside);',
  'changes=names lists only the changed property names (changedProps) and changes=diff every built → now value — use list_work_items with expand=instances and changes=names for "what do I build", then get_node for the values of one node.',
].join(' ');

const TRUNCATED = 'result truncated — use fields= or get_node';
const moreResults = cursor => `More results: call again with cursor="${cursor}"`;
/** Characters an outline page keeps free for its X-RDS-Next-Cursor, beyond the one it came with. */
const CURSOR_ROOM = 64;

class StartupError extends Error {
  /** @param {string} message @param {{ unreachable?: boolean }} [options] */
  constructor(message, { unreachable = false } = {}) {
    super(message);
    this.unreachable = unreachable;
  }
}

const text = (value, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

/** A non-2xx response for the model: the problem's title, detail and hint, else the body as-is. */
/** Seconds until a `Retry-After` value (delta-seconds or an HTTP date); null when absent or unreadable. */
function retrySeconds(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** A 429: the retry time (Retry-After, else the problem's `retryAfter`) first, then the API's detail. */
function rateLimited({ data, retryAfter, method, path }) {
  const problem = data && typeof data === 'object' ? data : {};
  const seconds = retrySeconds(retryAfter) ?? retrySeconds(problem.retryAfter);
  const when = seconds === null ? 'retry later' : `retry in ${seconds} s`;
  const detail = problem.detail || (typeof data === 'string' ? data.trim() : '');
  const lines = [`HTTP 429 ${method} ${path} — rate limited (rate_limited): ${when}.${detail ? ` ${detail}` : ''}`];
  if (problem.hint) lines.push(`Hint: ${problem.hint}`);
  return text(lines.join('\n'), true);
}

function httpError({ status, data, method, path, retryAfter }) {
  if (status === 429) return rateLimited({ data, retryAfter, method, path });
  const head = `HTTP ${status} ${method} ${path}`;
  if (data && typeof data === 'object' && (data.title || data.detail)) {
    const lines = [`${head} — ${data.title || 'Error'}${data.code ? ` (${data.code})` : ''}: ${data.detail || ''}`.trim()];
    if (data.hint) lines.push(`Hint: ${data.hint}`);
    if (Array.isArray(data.validParameters) && data.validParameters.length) lines.push(`Valid parameters: ${data.validParameters.join(', ')}`);
    return text(lines.join('\n'), true);
  }
  const body = data && typeof data === 'object' ? JSON.stringify(data) : String(data || '').trim();
  return text(body ? `${head} — ${body}` : head, true);
}

const reason = err => (err && err.cause && err.cause.message) || (err && err.message) || String(err);

/** The OpenAPI document at `${baseUrl}/v3/openapi.json`; a StartupError naming RDS_API_BASE_URL when it can't be had. */
async function fetchOpenApi(api, baseUrl) {
  const where = `${baseUrl}${OPENAPI_PATH}`;
  const fix = 'Start the API, or set RDS_API_BASE_URL to the origin of a running rolling-design-sync API (v3), e.g. http://127.0.0.1:8787.';
  let res;
  try {
    res = await api.request('GET', OPENAPI_PATH, { signal: AbortSignal.timeout(STARTUP_TIMEOUT_MS), auth: false });
  } catch (err) {
    throw new StartupError(`rds-mcp: could not reach the rolling-design-sync API at RDS_API_BASE_URL=${baseUrl} to load its tools from ${where}: ${reason(err)}. ${fix}`, { unreachable: true });
  }
  if (!res.ok) throw new StartupError(`rds-mcp: GET ${where} returned HTTP ${res.status}; RDS_API_BASE_URL=${baseUrl} does not look like a rolling-design-sync API with v3. ${fix}`);
  if (!res.data || typeof res.data !== 'object' || !res.data.paths) {
    throw new StartupError(`rds-mcp: ${where} is not an OpenAPI document; RDS_API_BASE_URL=${baseUrl} does not look like a rolling-design-sync API with v3. ${fix}`);
  }
  return res.data;
}

/** The bundled OpenAPI snapshot (the API's x-rds-mcp operations at release time). */
function loadSnapshot() {
  return JSON.parse(require('node:fs').readFileSync(SNAPSHOT_FILE, 'utf8'));
}

/** `doc`'s tools; a StartupError when it has none. */
function toolsOf(doc, config) {
  const tools = toolsFromOpenApi(doc);
  if (!tools.length) {
    throw new StartupError(`rds-mcp: ${config.baseUrl}${OPENAPI_PATH} lists no agent operations (x-rds-mcp), so there are no tools to serve. Check that RDS_API_BASE_URL points at a rolling-design-sync API with v3.`);
  }
  return tools;
}

/** The API client for `config`: the agent token is resolved per request (RDS_AGENT_TOKEN, else RDS_AGENT_TOKEN_FILE). */
function apiClient(config, fetchImpl) {
  return createApiClient({ baseUrl: config.baseUrl, token: () => agentToken(config), clientName: CLIENT, fetchImpl, hostHeader: config.apiHost || null });
}

/**
 * The MCP server for `config`, with one tool per `x-rds-mcp` operation of the
 * API's OpenAPI document (fetched now unless `doc` is given). When the API
 * can't be reached and `fallback` is set, the bundled snapshot's tools are
 * served instead (calls then report the API as down until it is up). Rejects
 * with a StartupError when the document can't be loaded or has no agent operations.
 *
 * Listing tools get `limit` = `config.defaultLimit` when the call omits it. A
 * JSON result is sent pretty-printed, ending with a "More results" line when it
 * has `nextCursor`; one longer than `config.maxResultChars` is re-requested
 * with `limit` halved (down to 1), then cut with a note. Text formats (ndjson,
 * md, …) are sent as the API returned them. format=outline gets no default
 * `limit`; it ends with a "More results" line when the response has an
 * X-RDS-Next-Cursor header, and one too long is re-requested with `limit` = the
 * whole lines that fit, so its cursor is the API's for exactly those lines.
 */
/**
 * @param {any} config
 * @param {{ fetchImpl?: typeof fetch, doc?: any, fallback?: boolean, log?: (line: string) => void }} [options]
 */
async function createServer(config, { fetchImpl, doc, fallback = false, log = line => process.stderr.write(`${line}\n`) } = {}) {
  const api = apiClient(config, fetchImpl);
  let openapi = doc;
  if (!openapi) {
    try {
      openapi = await fetchOpenApi(api, config.baseUrl);
    } catch (err) {
      if (!(fallback && err instanceof StartupError && err.unreachable)) throw err;
      log(`${err.message}\nrds-mcp: serving the bundled tool list (v${pkg.version}); tool calls will fail until the API is up.`);
      openapi = loadSnapshot();
    }
  }
  return serverForTools(config, toolsOf(openapi, config), api);
}

/** An MCP server for `tools`, calling the API through `api`. */
function serverForTools(config, tools, api) {
  const defaultLimit = config.defaultLimit || DEFAULT_LIMIT;
  const maxResultChars = config.maxResultChars || MAX_RESULT_CHARS;
  const byName = new Map(tools.map(t => [t.name, t]));

  const server = new Server({ name: 'rds-mcp', version: pkg.version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = byName.get(request.params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    let req;
    try {
      req = toRequest(tool, request.params.arguments, { defaultFileKey: config.defaultFileKey });
    } catch (err) {
      if (err instanceof ToolError) return text(err.message, true);
      throw err;
    }
    const outline = req.query.format === 'outline';
    let limit = null;
    if (tool.paged) {
      if (req.query.limit === undefined) {
        if (!outline) {
          limit = tool.paged.maxLimit ? Math.min(defaultLimit, tool.paged.maxLimit) : defaultLimit;
          req.query.limit = String(limit);
        }
      } else {
        limit = Number(req.query.limit);
      }
    }
    for (;;) {
      let res;
      try {
        res = await api.request(req.method, req.path, { query: req.query, body: req.body });
      } catch (err) {
        if (err instanceof ConfigError) return text(err.message, true);
        return text(`Could not reach the rolling-design-sync API at ${config.baseUrl} (RDS_API_BASE_URL): ${reason(err)}. ` +
          'Start it (`docker compose up -d` in the rolling-design-sync checkout, or `npm start`), or set RDS_API_BASE_URL to a running API, then call the tool again.', true);
      }
      if (!res.ok) return httpError(res);
      if (res.data === '' || res.data === null) return text(`HTTP ${res.status} ${req.method} ${req.path}: no content.`);
      if (typeof res.data === 'string' && outline) {
        const paging = res.nextCursor ? `${res.data.endsWith('\n') ? '\n' : '\n\n'}${moreResults(res.nextCursor)}` : '';
        if (res.data.length + paging.length <= maxResultChars) return text(res.data + paging);
        const lines = res.data.replace(/\n$/, '').split('\n');
        const room = maxResultChars - `\n${moreResults(res.nextCursor || '')}`.length - CURSOR_ROOM;
        let kept = 0;
        for (let size = 0; kept < lines.length && size + lines[kept].length + 1 <= room; kept++) size += lines[kept].length + 1;
        const fewer = Math.max(1, Math.min(kept, lines.length - 1));
        if (lines.length > 1 && limit !== 1) {
          limit = fewer;
          req.query.limit = String(limit);
          continue;
        }
        const note = `\n\n${TRUNCATED}`;
        const tail = res.nextCursor ? `\n\n${moreResults(res.nextCursor)}` : '';
        return text(res.data.slice(0, Math.max(0, maxResultChars - note.length - tail.length)) + note + tail);
      }
      if (typeof res.data === 'string') return text(res.data);
      const body = JSON.stringify(res.data, null, 2);
      const cursor = res.data && typeof res.data.nextCursor === 'string' && res.data.nextCursor ? res.data.nextCursor : null;
      const paging = cursor ? `\n\n${moreResults(cursor)}` : '';
      if (body.length + paging.length <= maxResultChars) return text(body + paging);
      if (Number.isInteger(limit) && limit > 1) {
        limit = Math.max(1, Math.floor(limit / 2));
        req.query.limit = String(limit);
        continue;
      }
      const note = `\n\n${TRUNCATED}`;
      return text(body.slice(0, Math.max(0, maxResultChars - note.length - paging.length)) + note + paging);
    }
  });

  return server;
}

/** The host name of a `Host` header (`name[:port]` / `[v6][:port]`), lower-cased; null when malformed. */
function hostName(header) {
  const m = /^(\[[^\]]*\]|[^:[\]]*)(?::\d*)?$/.exec(String(header || '').trim().toLowerCase());
  return m && m[1] ? m[1] : null;
}

/** DNS-rebinding defense: `Host`, and `Origin` when sent, must name an allowed host (any port). Returns the problem, or null. */
function foreignRequest(req, allowedHosts) {
  const host = hostName(req.headers.host);
  if (!host || !allowedHosts.includes(host)) return `Host header '${req.headers.host || ''}' is not allowed`;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let name = null;
    try { name = new URL(String(origin)).hostname.toLowerCase(); } catch (_) { name = null; }
    if (!name || !allowedHosts.includes(name)) return `Origin '${origin}' is not allowed`;
  }
  return null;
}

const rpcError = (res, status, code, message) => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
};

/** The request body as JSON; undefined when empty. Rejects with a status-tagged error. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body.trim()) return resolve(undefined);
      try { resolve(JSON.parse(body)); } catch (_) { reject(Object.assign(new Error('Parse error: the body is not JSON'), { status: 400, code: -32700 })); }
    });
  });
}

const sleep = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true });
});

/**
 * Serves MCP over Streamable HTTP (stateless JSON responses) at
 * `http://<config.httpHost>:<config.httpPort>/mcp`, plus `GET /health`. Listens
 * at once and loads the tools from the API in the background, retrying with
 * backoff until it answers; until then `/health` is 503 and `/mcp` answers 503.
 * Requests whose `Host` / `Origin` name a host outside `config.allowedHosts`
 * are refused (403).
 * @param {any} config
 * @param {{ fetchImpl?: typeof fetch, log?: (line: string) => void, retry?: { initialMs?: number, maxMs?: number } }} [options]
 */
async function startHttpServer(config, { fetchImpl, log = line => process.stderr.write(`${line}\n`), retry = {} } = {}) {
  const api = apiClient(config, fetchImpl);
  const state = { tools: /** @type {any[] | null} */ (null), problem: /** @type {string | null} */ ('loading the tools from the API') };
  const stop = new AbortController();

  const ready = (async () => {
    let delay = retry.initialMs || 500;
    let reported = null;
    while (!stop.signal.aborted) {
      try {
        state.tools = toolsOf(await fetchOpenApi(api, config.baseUrl), config);
        state.problem = null;
        log(`rds-mcp: serving ${state.tools.length} tools from ${config.baseUrl}`);
        return true;
      } catch (err) {
        state.problem = err && err.message ? err.message : String(err);
        if (state.problem !== reported) { log(`${state.problem}\nrds-mcp: retrying until the API is up.`); reported = state.problem; }
      }
      await sleep(delay, stop.signal);
      delay = Math.min(delay * 2, retry.maxMs || 5000);
    }
    return false;
  })();

  const handle = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const foreign = foreignRequest(req, config.allowedHosts);
    if (foreign) return rpcError(res, 403, -32000, `Forbidden: ${foreign}. Connect via http://localhost:${config.httpPort}${MCP_PATH}, or add the host name to RDS_MCP_ALLOWED_HOSTS.`);
    if (url.pathname === '/health') {
      const body = state.tools ? { status: 'ok', tools: state.tools.length } : { status: 'starting', detail: state.problem };
      return res.writeHead(state.tools ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    }
    if (url.pathname !== MCP_PATH) return rpcError(res, 404, -32000, `Not found: the MCP endpoint is ${MCP_PATH}`);
    if (req.method !== 'POST') return rpcError(res, 405, -32000, 'Method not allowed: this server is stateless; send JSON-RPC requests with POST.');
    if (!state.tools) return rpcError(res, 503, -32000, `rds-mcp is not ready: ${state.problem}`);
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return rpcError(res, err.status || 400, err.code || -32000, err.message);
    }
    const server = serverForTools(config, state.tools, api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      log(`rds-mcp: ${err && err.message ? err.message : err}`);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error');
      else res.end();
    });
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.httpPort, config.httpHost, () => { httpServer.off('error', reject); resolve(undefined); });
  });
  const address = /** @type {import('node:net').AddressInfo} */ (httpServer.address());
  const shown = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const url = `http://${shown}:${address.port}${MCP_PATH}`;
  log(`rds-mcp: MCP over HTTP at ${url} (API: ${config.baseUrl})`);
  const close = async () => {
    stop.abort();
    await ready;
    await new Promise(resolve => { httpServer.close(() => resolve(undefined)); httpServer.closeAllConnections(); });
  };
  return { httpServer, url, port: address.port, ready, close };
}

/**
 * Starts the transport `readConfig` picks: stdio (default; falls back to the
 * bundled tool list while the API is down) or HTTP (`--http` / RDS_MCP_TRANSPORT=http).
 * @param {{ env?: NodeJS.ProcessEnv, argv?: string[] }} [options]
 */
async function main({ env = process.env, argv = [] } = {}) {
  const config = readConfig(env, {}, argv);
  if (config.transport === 'http') return startHttpServer(config);
  const server = await createServer(config, { fallback: true });
  await server.connect(new StdioServerTransport());
  return server;
}

module.exports = {
  createServer, startHttpServer, loadSnapshot, httpError, retrySeconds, main, fetchOpenApi, foreignRequest,
  StartupError, INSTRUCTIONS, CLIENT, TRUNCATED, moreResults, SNAPSHOT_FILE, MCP_PATH,
};
