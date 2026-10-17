'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { readConfig, DEFAULT_LIMIT, MAX_RESULT_CHARS } = require('./config');
const { createApiClient } = require('./client');
const { toolsFromOpenApi, toRequest, ToolError } = require('./tools');
const pkg = require('../package.json');

const CLIENT = `mcp/${pkg.version}`;
const OPENAPI_PATH = '/v3/openapi.json';
const STARTUP_TIMEOUT_MS = 15000;

const INSTRUCTIONS = [
  'rolling-design-sync tracks what changed in Figma since it was last built, node by node. The tools are generated from the connected API\'s OpenAPI document.',
  'Loop: (1) list_nodes for the screen or component you are working on (or claim_nodes to lease nodes when several agents share a file; summarize / list_work_items for an overview);',
  '(2) implement each node\'s `changes` — per property { built, now, category }, with token names where a value is bound — mapping it to code via Code Connect / figma.ts mappings where present, and pulling live details for that node only from the Figma MCP via its figmaUrl;',
  '(3) clear_nodes with the nodeId + contentHash pairs you read and the commit SHA.',
  'An item that comes back `stale` changed again after you read it: re-read that node with get_node, implement the newer change, and clear it with its new contentHash — never retry the old hash.',
  'Use block_node for a node you cannot implement instead of clearing it.',
  'Notes and render checks can carry screenshots: get_attachment returns one as an image (thumb=true for a small one). A `render_check` note means a screen\'s built page does not match its design — open its heatmap, fix the screen, then request_render_check again.',
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

class StartupError extends Error {}

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
    res = await api.request('GET', OPENAPI_PATH, { signal: AbortSignal.timeout(STARTUP_TIMEOUT_MS) });
  } catch (err) {
    throw new StartupError(`rds-mcp: could not reach the rolling-design-sync API at RDS_API_BASE_URL=${baseUrl} to load its tools from ${where}: ${reason(err)}. ${fix}`);
  }
  if (!res.ok) throw new StartupError(`rds-mcp: GET ${where} returned HTTP ${res.status}; RDS_API_BASE_URL=${baseUrl} does not look like a rolling-design-sync API with v3. ${fix}`);
  if (!res.data || typeof res.data !== 'object' || !res.data.paths) {
    throw new StartupError(`rds-mcp: ${where} is not an OpenAPI document; RDS_API_BASE_URL=${baseUrl} does not look like a rolling-design-sync API with v3. ${fix}`);
  }
  return res.data;
}

/**
 * The MCP server for `config`, with one tool per `x-rds-mcp` operation of the
 * API's OpenAPI document (fetched now unless `doc` is given). Rejects with a
 * StartupError when the document can't be loaded or has no agent operations.
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
 * @param {{ fetchImpl?: typeof fetch, doc?: any }} [options]
 */
async function createServer(config, { fetchImpl, doc } = {}) {
  const defaultLimit = config.defaultLimit || DEFAULT_LIMIT;
  const maxResultChars = config.maxResultChars || MAX_RESULT_CHARS;
  const api = createApiClient({ baseUrl: config.baseUrl, token: config.token, clientName: CLIENT, fetchImpl });
  const openapi = doc || await fetchOpenApi(api, config.baseUrl);
  const tools = toolsFromOpenApi(openapi);
  if (!tools.length) {
    throw new StartupError(`rds-mcp: ${config.baseUrl}${OPENAPI_PATH} lists no agent operations (x-rds-mcp), so there are no tools to serve. Check that RDS_API_BASE_URL points at a rolling-design-sync API with v3.`);
  }
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
        return text(`Could not reach the rolling-design-sync API at ${config.baseUrl} (RDS_API_BASE_URL): ${reason(err)}`, true);
      }
      if (!res.ok) return httpError(res);
      if (Buffer.isBuffer(res.data)) {
        const mimeType = res.contentType.split(';')[0].trim();
        return { content: [{ type: 'image', data: res.data.toString('base64'), mimeType }] };
      }
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

async function main({ env = process.env } = {}) {
  const server = await createServer(readConfig(env));
  await server.connect(new StdioServerTransport());
  return server;
}

module.exports = { createServer, httpError, retrySeconds, main, fetchOpenApi, StartupError, INSTRUCTIONS, CLIENT, TRUNCATED, moreResults };
