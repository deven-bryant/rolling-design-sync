#!/usr/bin/env node
'use strict';

/**
 * rds-agent — thin CLI over the rolling-design-sync v3 agent API.
 *
 * Commands, flags and requests come from commands.generated.json, generated from
 * the API's OpenAPI document (`npm run gen`; docs/api-v3-phase2.md, "8. Generated
 * MCP tools and CLI commands"). Hand-written here: Figma `--url` addressing,
 * `1-2` node ids, `--all` paging, `--format`, bulk-clear input, output and error
 * formatting, exit codes.
 *
 * Env: RDS_API_BASE_URL, RDS_AGENT_TOKEN, RDS_WORKER. Zero deps (Node >= 20 built-in fetch).
 * Exits 0 on 2xx (and for --help), 1 on API/usage errors.
 */

const SPEC = require('./commands.generated.json');
const { version: VERSION } = require('./package.json');

const CLIENT = `cli/${VERSION}`;
/** @type {Map<string, any>} */
const COMMANDS = new Map(SPEC.commands.map(c => [c.command, c]));
const LOCAL_FORMATS = ['json', 'table'];
/** Parameters that hold node ids, normalized from Figma's `1-2` form. */
const NODE_ID_PARAMS = new Set(['nodeId', 'under', 'component', 'nodeIds']);

class CliError extends Error {
  /**
   * @param {string} message
   * @param {{ exitCode?: number, body?: unknown }} [options]
   */
  constructor(message, { exitCode = 1, body } = {}) {
    super(message);
    this.exitCode = exitCode;
    this.body = body;
  }
}

// --- env -----------------------------------------------------------------------
const warnedVars = new Set();
const LEGACY_VAR = /^FDS_([A-Z0-9_]+)$/;

/**
 * Warns once per variable (per `warned` set) for each non-empty pre-0.10
 * `FDS_<name>` in `env`, naming its `RDS_<name>` replacement. Their values are
 * never read.
 */
function warnLegacyEnv(env, { warn = message => process.stderr.write(`${message}\n`), warned = warnedVars } = {}) {
  for (const key of Object.keys(env).sort()) {
    const m = LEGACY_VAR.exec(key);
    if (!m || !env[key] || warned.has(key)) continue;
    warned.add(key);
    warn(`rds-agent: ${key} is no longer read; set RDS_${m[1]} instead`);
  }
}

/** `RDS_<name>` from `env`; empty counts as unset. */
const envVar = (env, name) => env[`RDS_${name}`] || undefined;

// --- help ------------------------------------------------------------------------
const pad = (rows, gap = 2) => {
  const width = Math.max(...rows.map(r => r[0].length));
  return rows.map(([a, b]) => (b ? `${a.padEnd(width + gap)}${b}` : a));
};

function usage() {
  return [
    'Usage: rds-agent <command> [arguments] [flags]',
    '',
    'Commands:',
    ...pad([...COMMANDS.values()].map(c => [`  ${c.command}${argsOf(c)}`, c.summary || ''])),
    '',
    "Run 'rds-agent <command> --help' for a command's flags.",
    '',
    'File-scoped commands take --file-key <key> or --url <figma link> (the link supplies the file key and node id).',
    'Node ids take 1:2 or 1-2. Global: --format json|table (ndjson|md where the API streams them), --all on paged listings.',
    '',
    'Env: RDS_API_BASE_URL (required), RDS_AGENT_TOKEN (required), RDS_WORKER (default for --worker)',
  ].join('\n');
}

function argsOf(cmd) {
  const parts = (cmd.positionals || []).map(p => ` <${p.name}>`);
  if (cmd.items) parts.push(` <${cmd.items.keys[0]}>=<${cmd.items.keys[1]}>… | -`);
  if (!parts.length && linkArgument(cmd)) parts.push(' [<figma link>]');
  return parts.join('');
}

const serverFormats = cmd => (cmd.flags.find(f => f.name === 'format' && f.in === 'query') || {}).enum || [];
const formatsOf = cmd => [...new Set([...LOCAL_FORMATS, ...serverFormats(cmd)])];

function flagLine(cmd, f) {
  const value = f.type === 'boolean' ? '' : ` <${f.enum ? f.enum.join('|') : f.type === 'array' ? `${f.items},…` : f.type}>`;
  const notes = [];
  if (f.name === 'fileKey' && hasUrl(cmd)) notes.push('required unless --url');
  else if (f.required) notes.push(f.name === 'worker' && f.in === 'body' ? 'required; default $RDS_WORKER' : 'required');
  if (f.default !== undefined) notes.push(`default ${JSON.stringify(f.default)}`);
  return [`  --${f.flag}${value}`, `${notes.length ? `(${notes.join('; ')}) ` : ''}${f.description || ''}`];
}

function commandHelp(cmd) {
  const flags = cmd.flags.filter(f => f.name !== 'format').map(f => flagLine(cmd, f));
  const outline = serverFormats(cmd).includes('outline');
  flags.push([`  --format <${formatsOf(cmd).join('|')}>`, `(default "json") table: aligned columns${serverFormats(cmd).length ? '; ndjson, md: streamed by the API' : ''}${outline ? '; outline: every line unless --limit' : ''}`]);
  if (cmd.paging) flags.push(['  --all', `Follow ${cmd.paging.next}${outline ? ' (outline: X-RDS-Next-Cursor)' : ''} and print every page as one response`]);
  const lines = [`Usage: rds-agent ${cmd.command}${argsOf(cmd)} [flags]`, '', `${cmd.method} ${cmd.path}`];
  if (cmd.summary) lines.push('', cmd.summary);
  if (cmd.description) lines.push('', cmd.description);
  for (const p of cmd.positionals || []) lines.push('', `<${p.name}>: ${p.description || ''}${p.name === 'nodeId' && hasUrl(cmd) ? ' Optional with --url when the link has a node-id.' : ''}`);
  if (cmd.items) lines.push('', `<${cmd.items.keys[0]}>=<${cmd.items.keys[1]}>: ${cmd.items.description || cmd.items.name}; '-' reads them from stdin (whitespace-separated, # comments).`);
  if (!(cmd.positionals || []).length && !cmd.items && linkArgument(cmd)) lines.push('', '[<figma link>]: stands in for --url.');
  lines.push('', 'Flags:', ...pad(flags));
  return lines.join('\n');
}

// --- parsing ---------------------------------------------------------------------
const hasUrl = cmd => cmd.flags.some(f => f.name === 'url' && f.in === 'query');
/** A command without positional arguments takes the Figma link as its argument. */
const linkArgument = cmd => hasUrl(cmd) && !(cmd.positionals || []).length && !cmd.items;
const booleanFlags = cmd => new Set(['help', ...(cmd && cmd.paging ? ['all'] : []), ...(cmd ? cmd.flags.filter(f => f.type === 'boolean').map(f => f.flag) : [])]);

/** The command named by the leading words of argv (`nodes ls`, `claim`, …), or a CliError. */
function commandOf(words) {
  const [first, second] = words;
  if (first === undefined) throw new CliError(usage(), { exitCode: 1 });
  if (COMMANDS.has(first)) return { cmd: COMMANDS.get(first), used: 1 };
  const subs = [...COMMANDS.keys()].filter(k => k.startsWith(`${first} `)).map(k => k.slice(first.length + 1));
  if (!subs.length) throw new CliError(`Unknown command: ${first}\n\n${usage()}`);
  if (second === undefined || second.startsWith('-')) {
    if (second === '--help' || second === '-h') throw new CliError(`'${first}' subcommands: ${subs.join(', ')}\n\n${usage()}`, { exitCode: 0 });
    throw new CliError(`'${first}' needs a subcommand: ${subs.join(' or ')}\n\n${usage()}`);
  }
  if (!subs.includes(second)) throw new CliError(`Unknown subcommand: ${first} ${second} (valid: ${subs.join(', ')})\n\n${usage()}`);
  return { cmd: COMMANDS.get(`${first} ${second}`), used: 2 };
}

/** Parse argv (after node + script) into { command, options, args }. */
function parseArgs(argv) {
  const [head, ...tail] = argv;
  if (head === 'help' || head === '--help' || head === '-h') {
    if (!tail.length) throw new CliError(usage(), { exitCode: 0 });
    throw new CliError(commandHelp(commandOf(tail).cmd), { exitCode: 0 });
  }
  const { cmd, used } = commandOf(argv);
  const rest = argv.slice(used);
  const booleans = booleanFlags(cmd);
  const options = {};
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '-h') { options.help = true; continue; }
    if (!arg.startsWith('--')) { args.push(arg); continue; }
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf('=');
    if (eq !== -1) { value = key.slice(eq + 1); key = key.slice(0, eq); }
    if (booleans.has(key)) {
      options[key] = value === undefined ? true : value !== 'false';
      continue;
    }
    if (value === undefined) {
      if (i + 1 >= rest.length) throw new CliError(`Missing value for --${key}\n\n${commandHelp(cmd)}`);
      value = rest[++i];
    }
    if (options[key] !== undefined) throw new CliError(`Pass --${key} once`);
    options[key] = value;
  }
  return { command: cmd.command, options, args };
}

// --- request building ------------------------------------------------------------
function splitList(value) {
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/** Figma links write node ids as `1-2`; the API stores `1:2`. Other ids pass through. */
const normalizeNodeId = id => (/^\d+-\d+$/.test(id) ? id.replace('-', ':') : id);

function integerOf(f, value) {
  const s = String(value).trim();
  const n = Number(s);
  const min = f.minimum ?? -Infinity;
  const max = f.maximum ?? Infinity;
  if (!/^-?\d+$/.test(s) || n < min || n > max) {
    const range = [Number.isFinite(min) ? `>= ${min}` : '', Number.isFinite(max) ? `<= ${max}` : ''].filter(Boolean).join(' and ');
    throw new CliError(`--${f.flag} must be an integer${range ? ` ${range}` : ''}`);
  }
  return n;
}

/** A flag's value as the API expects it (query values stay strings). */
function valueOf(f, raw) {
  if (f.type === 'boolean') return f.in === 'query' ? String(!!raw) : !!raw;
  if (typeof raw !== 'string' || !raw.trim()) throw new CliError(`--${f.flag} needs a value`);
  const text = raw.trim();
  if (f.type === 'integer' || f.type === 'number') {
    const n = f.type === 'integer' ? integerOf(f, text) : Number(text);
    if (Number.isNaN(n)) throw new CliError(`--${f.flag} must be a number`);
    return f.in === 'query' ? String(n) : n;
  }
  if (f.type === 'array') {
    const list = splitList(text).map(v => (NODE_ID_PARAMS.has(f.name) ? normalizeNodeId(v) : v));
    if (!list.length) throw new CliError(`--${f.flag} needs at least one value`);
    return f.in === 'query' ? list.join(',') : list.map(v => (f.items === 'integer' ? integerOf(f, v) : v));
  }
  if (f.enum && !f.enum.includes(text)) throw new CliError(`--${f.flag} must be one of: ${f.enum.join(', ')}`);
  if (NODE_ID_PARAMS.has(f.name)) return splitList(text).map(normalizeNodeId).join(',');
  return text;
}

/** `a=b` tokens (arguments or stdin lines; `#` starts a comment) → body items with the command's two keys. */
function parseItems(cmd, tokens) {
  const [a, b] = cmd.items.keys;
  return tokens.map(token => {
    const eq = token.indexOf('=');
    if (eq <= 0 || eq === token.length - 1) throw new CliError(`Expected <${a}>=<${b}>, got '${token}'`);
    const first = token.slice(0, eq).trim();
    return { [a]: NODE_ID_PARAMS.has(a) ? normalizeNodeId(first) : first, [b]: token.slice(eq + 1).trim() };
  });
}

const stdinTokens = text => String(text || '').split(/\r?\n/)
  .map(line => line.replace(/#.*/, '').trim())
  .filter(Boolean)
  .flatMap(line => line.split(/\s+/));

/** Unknown flags are an error: a typo would otherwise silently widen a filter or a claim. */
function checkFlags(cmd, options) {
  const allowed = [...cmd.flags.map(f => f.flag), ...(cmd.flags.some(f => f.flag === 'format') ? [] : ['format']), ...(cmd.paging ? ['all'] : []), 'help'];
  const unknown = Object.keys(options).filter(k => !allowed.includes(k));
  if (unknown.length) {
    throw new CliError(`Unknown option${unknown.length > 1 ? 's' : ''} for '${cmd.command}': ${unknown.map(k => `--${k}`).join(', ')}. Valid: ${allowed.map(k => `--${k}`).join(' ')}`);
  }
}

/**
 * Build a request description for a parsed command:
 * { command, method, path, query, body?, format, all, paging?, chunk? }.
 */
/**
 * @param {any} parsed
 * @param {{ env?: Record<string, string | undefined>, stdinText?: string }} [options]
 */
function buildRequest(parsed, { env = {}, stdinText } = {}) {
  const cmd = COMMANDS.get(parsed.command);
  if (!cmd) throw new CliError(`Unknown command: ${parsed.command}\n\n${usage()}`);
  const options = { ...parsed.options };
  const args = [...(parsed.args || [])];
  if (options.help) throw new CliError(commandHelp(cmd), { exitCode: 0 });
  checkFlags(cmd, options);

  const format = options.format === undefined ? 'json' : String(options.format).trim();
  if (!formatsOf(cmd).includes(format)) throw new CliError(`--format must be one of: ${formatsOf(cmd).join(', ')}`);
  delete options.format;

  if (linkArgument(cmd) && args.length) {
    if (options.url !== undefined) throw new CliError(`Pass the Figma link as an argument or --url, not both`);
    options.url = args.shift();
  }
  const byUrl = options.url !== undefined && String(options.url).trim() !== '';

  const pathValues = {};
  for (const p of cmd.positionals || []) {
    const raw = args.length ? String(args.shift()).trim() : '';
    if (raw) pathValues[p.name] = NODE_ID_PARAMS.has(p.name) ? normalizeNodeId(raw) : raw;
    else if (p.name === 'nodeId' && byUrl) pathValues[p.name] = '-';
    else throw new CliError(`'${cmd.command}' needs a <${p.name}>${p.name === 'nodeId' && hasUrl(cmd) ? ' (or --url with a node-id)' : ''}\n\n${commandHelp(cmd)}`);
  }

  let items;
  if (cmd.items) {
    const tokens = args.splice(0).flatMap(a => (a === '-' ? stdinTokens(stdinText) : [a]));
    if (!tokens.length && cmd.items.required) {
      throw new CliError(`'${cmd.command}' needs <${cmd.items.keys[0]}>=<${cmd.items.keys[1]}> items (arguments, or '-' to read lines from stdin)\n\n${commandHelp(cmd)}`);
    }
    if (tokens.length) items = parseItems(cmd, tokens);
  }
  if (args.length) throw new CliError(`Unexpected argument for '${cmd.command}': ${args.join(' ')}\n\n${commandHelp(cmd)}`);

  const query = {};
  const body = cmd.body ? {} : undefined;
  /** Body flags and items only exist on commands that take a body. */
  const bodyFields = /** @type {Record<string, any>} */ (body);
  for (const f of cmd.flags) {
    let raw = options[f.flag];
    if (raw === undefined && f.name === 'worker' && f.in === 'body') raw = envVar(env, 'WORKER');
    if (raw === undefined && f.in === 'path' && f.name === 'fileKey' && byUrl) raw = '-';
    if (raw === undefined) {
      if (!f.required) continue;
      if (f.name === 'fileKey' && hasUrl(cmd)) throw new CliError(`--file-key or --url is required\n\n${commandHelp(cmd)}`);
      if (f.name === 'worker' && f.in === 'body') throw new CliError(`--worker is required (or set RDS_WORKER)\n\n${commandHelp(cmd)}`);
      throw new CliError(`--${f.flag} is required\n\n${commandHelp(cmd)}`);
    }
    const value = valueOf(f, raw);
    if (f.in === 'path') pathValues[f.name] = value;
    else if (f.in === 'query') query[f.name] = value;
    else if (f.object) (bodyFields[f.object] = bodyFields[f.object] || {})[f.name] = value;
    else bodyFields[f.name] = value;
  }
  if (items) bodyFields[cmd.items.name] = items;
  if (serverFormats(cmd).includes(format) && format !== 'json') query.format = format;

  const path = cmd.path.replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(pathValues[name]));
  const request = { command: cmd.command, method: cmd.method, path, query, format, all: !!options.all };
  if (body !== undefined) request.body = body;
  if (cmd.paging) request.paging = cmd.paging;
  if (cmd.items && cmd.items.maxItems) request.chunk = { name: cmd.items.name, size: cmd.items.maxItems };
  return request;
}

// --- execution -------------------------------------------------------------------
function readEnv(env) {
  const baseUrl = (envVar(env, 'API_BASE_URL') || '').trim().replace(/\/+$/, '');
  const token = (envVar(env, 'AGENT_TOKEN') || '').trim();
  if (!baseUrl) throw new CliError('RDS_API_BASE_URL is not set');
  if (!token) throw new CliError('RDS_AGENT_TOKEN is not set');
  return { baseUrl, token };
}

function buildUrl(baseUrl, { path, query }) {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  return url.toString();
}

/** An RFC 9457 problem body (every v3 error). */
const isProblem = data => !!data && typeof data === 'object' && typeof data.title === 'string' && typeof data.detail === 'string';

/** Seconds until a `Retry-After` value (delta-seconds or an HTTP date); null when absent or unreadable. */
function retrySeconds(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** A 429: `error: rate limited (HTTP 429) — retry in N s. <detail>` and the API's hint. */
function rateLimitMessage(res, data) {
  const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  const problem = data && typeof data === 'object' ? data : {};
  const seconds = retrySeconds(header) ?? retrySeconds(problem.retryAfter);
  const when = seconds === null ? 'retry later' : `retry in ${seconds} s`;
  const detail = problem.detail || (typeof data === 'string' ? data.trim() : '');
  return `error: rate limited (HTTP 429) — ${when}.${detail ? ` ${detail}` : ''}${problem.hint ? `\nhint: ${problem.hint}` : ''}`;
}

/** `error: <title> — <detail>` and, when the API gives one, `hint: …`. */
function problemMessage(problem) {
  return `error: ${problem.title} — ${problem.detail}${problem.hint ? `\nhint: ${problem.hint}` : ''}`;
}

const ACCEPT = { ndjson: 'application/x-ndjson', md: 'text/markdown', outline: 'text/plain' };
const streamed = request => request.query && request.query.format !== undefined && request.query.format !== 'json';

/**
 * Execute a built request; streamed formats return the response text (with
 * `withCursor`, `{ text, next }`: next is its X-RDS-Next-Cursor, else null).
 * `fetchImpl` is injectable for tests.
 */
async function execute(request, { env = process.env, fetchImpl = globalThis.fetch, withCursor = false } = {}) {
  const { baseUrl, token } = readEnv(env);
  const init = {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, accept: ACCEPT[request.query && request.query.format] || 'application/json', 'x-rds-client': CLIENT },
  };
  if (request.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(request.body);
  }
  const res = await fetchImpl(buildUrl(baseUrl, request), init);
  const type = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '';
  if (res.ok && /^\s*image\//i.test(type)) {
    const bytes = Buffer.from(await res.arrayBuffer());
    return { contentType: type.split(';')[0].trim(), bytes: bytes.length, data: bytes.toString('base64') };
  }
  const text = await res.text();
  if (res.ok && streamed(request)) {
    if (!withCursor) return text;
    return { text, next: (res.headers && typeof res.headers.get === 'function' && res.headers.get('x-rds-next-cursor')) || null };
  }
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 429) throw new CliError(rateLimitMessage(res, data));
    if (isProblem(data)) throw new CliError(problemMessage(data));
    const detail = data && typeof data === 'object' ? `${data.error || 'error'}: ${data.message || ''}`.trim() : String(data || '');
    throw new CliError(`HTTP ${res.status} ${request.method} ${request.path}${detail ? ` — ${detail}` : ''}`, { body: data });
  }
  return data;
}

/** `--all`: follow the page token until it runs out (or stops moving), as one response. */
async function allPages(request, options) {
  const { param, next, items } = request.paging;
  const first = await execute(request, options);
  const rows = [...first[items]];
  let token = first[next];
  let previous = request.query[param];
  let last = first;
  while (token !== null && token !== undefined && String(token) !== String(previous) && last[items].length) {
    last = await execute({ ...request, query: { ...request.query, [param]: String(token) } }, options);
    rows.push(...last[items]);
    previous = token;
    token = last[next];
  }
  return { ...first, [items]: rows, [next]: token };
}

/** `--all` with format=outline: follow X-RDS-Next-Cursor, joining the pages' text. */
async function outlinePages(request, options) {
  let text = '';
  let cursor = request.query.cursor;
  for (;;) {
    const page = await execute({ ...request, query: { ...request.query, ...(cursor === undefined ? {} : { cursor }) } }, { ...options, withCursor: true });
    text += page.text;
    if (!page.next || page.next === cursor) return text;
    cursor = page.next;
  }
}

/** Bulk writes larger than the API's batch limit go in batches; results concatenate and totals add up. */
async function inBatches(request, options) {
  const { name, size } = request.chunk;
  const all = request.body[name];
  let merged;
  for (let i = 0; i < all.length; i += size) {
    const part = await execute({ ...request, body: { ...request.body, [name]: all.slice(i, i + size) } }, options);
    if (!merged) { merged = part; continue; }
    for (const [k, v] of Object.entries(part)) {
      if (Array.isArray(v)) merged[k] = [...merged[k], ...v];
      else if (v && typeof v === 'object') for (const [t, n] of Object.entries(v)) merged[k][t] = (merged[k][t] || 0) + n;
      else merged[k] = v;
    }
  }
  return merged;
}

/** Execute a request, following pages for `--all` and splitting bulk items into API-sized batches. */
async function perform(request, options) {
  if (request.all && request.paging && request.query.format === 'outline') return outlinePages(request, options);
  if (request.all && request.paging && !streamed(request)) return allPages(request, options);
  if (request.chunk && request.body[request.chunk.name] && request.body[request.chunk.name].length > request.chunk.size) return inBatches(request, options);
  return execute(request, options);
}

// --- table output ----------------------------------------------------------------
const cell = v => {
  if (v === undefined || v === null || v === '') return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Left-aligned columns separated by two spaces; the header is upper-cased. */
function table(headers, rows) {
  const all = [headers.map(h => h.toUpperCase()), ...rows.map(r => r.map(cell))];
  const widths = headers.map((_, i) => Math.max(...all.map(r => r[i].length)));
  return all.map(r => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd()).join('\n') + '\n';
}

function categoriesOf(node) {
  if (node.changes === undefined) return undefined;
  if (node.changes === null) return '?';
  const categories = [...new Set(Object.values(node.changes).map(c => c && c.category).filter(Boolean))].sort();
  return categories.join(',');
}

function claimedOf(node) {
  if (node.claim === undefined) return undefined;
  if (!node.claim) return '';
  return node.claim.label ? `${node.claim.worker} (${node.claim.label})` : node.claim.worker;
}

const NODE_COLUMNS = ['node', 'name', 'type', 'change', 'categories', 'claimed'];
const nodeRow = n => [n.nodeId, n.name, n.type, n.changeType || (n.state === 'dirty' ? undefined : n.state), categoriesOf(n), claimedOf(n)];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const claimTable = data => `claim ${data.claimId}  worker ${data.worker}${data.label ? ` (${data.label})` : ''}  expires ${data.expiresAt}\n`
  + (data.nodes.length ? table(NODE_COLUMNS, data.nodes.map(nodeRow)) : '') + `${plural(data.nodes.length, 'node')} claimed\n`;

/** An array of objects as a table of the first row's keys. */
function rowsTable(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return table(keys, rows.map(r => keys.map(k => r[k])));
}

/** Any other response: its one array of objects as a table, or its fields as KEY / VALUE. */
function genericTable(data) {
  if (!data || typeof data !== 'object') return `${cell(data)}\n`;
  const arrays = Object.keys(data).filter(k => Array.isArray(data[k]) && data[k].every(r => r && typeof r === 'object' && !Array.isArray(r)));
  if (arrays.length === 1) {
    const [key] = arrays;
    const rest = Object.keys(data).filter(k => k !== key && data[k] !== null && data[k] !== undefined);
    return rowsTable(data[key]) + [plural(data[key].length, key.replace(/s$/, '')), ...rest.map(k => `${k} ${cell(data[k])}`)].join('  ') + '\n';
  }
  return table(['key', 'value'], Object.entries(data).map(([k, v]) => [k, v]));
}

const RENDERERS = {
  'nodes ls': data => {
    const shown = `${data.nodes.length}${typeof data.total === 'number' ? ` of ${data.total}` : ''} node${data.total === 1 ? '' : 's'}`;
    const next = data.nextCursor ? `  (more: --cursor ${data.nextCursor}, or --all)` : '';
    return (data.nodes.length ? table(NODE_COLUMNS, data.nodes.map(nodeRow)) : '') + `${shown}${next}\n`;
  },
  'nodes show': data => table(NODE_COLUMNS, [nodeRow(data)]),
  claim: claimTable,
  renew: claimTable,
  clear: data => table(['node', 'status', 'contentHash'], data.results.map(r => [r.nodeId, r.status, r.contentHash]))
    + `cleared ${data.totals.cleared}, stale ${data.totals.stale}, not found ${data.totals.notFound}\n`,
  release: data => `released claim ${data.claimId}  worker ${data.worker}${data.label ? ` (${data.label})` : ''}: ${plural(data.released.length, 'node')}\n`
    + (data.released.length ? table(['node'], data.released.map(id => [id])) : ''),
  resolve: data => table(['fileKey', 'nodeId'], [[data.fileKey, data.nodeId]]),
  block: data => table(NODE_COLUMNS, [nodeRow(data.node)]) + `blocked ${data.node.nodeId}${data.node.blocked && data.node.blocked.reason ? `: ${data.node.blocked.reason}` : ''}\n`,
  unblock: data => table(NODE_COLUMNS, [nodeRow(data.node)]) + `${data.unblocked ? 'unblocked' : 'was not blocked:'} ${data.node.nodeId}\n`,
};

/**
 * stderr notes for bulk-clear items that were not cleared (the request itself succeeded).
 * @param {import('../apps/api/src/v3/types').ClearReply} data
 */
function clearNotes(data) {
  return (data.results ?? []).filter(r => r.status !== 'cleared').map(r => (r.status === 'stale'
    ? `stale: ${r.nodeId} changed since it was read; current hash ${r.contentHash}. Re-read it (nodes show ${r.nodeId}) and clear against the new hash.\n`
    : `not found: ${r.nodeId} is not in this file.\n`)).join('');
}

function render(request, data) {
  if (typeof data === 'string' && streamed(request)) return data.endsWith('\n') || !data ? data : `${data}\n`;
  if (request.format === 'table') return (RENDERERS[request.command] || genericTable)(data);
  return JSON.stringify(data, null, 2) + '\n';
}

async function readAll(stream) {
  if (typeof stream === 'string') return stream;
  let text = '';
  for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  return text;
}

async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin } = {}) {
  try {
    warnLegacyEnv(env, { warn: message => stderr.write(`${message}\n`) });
    const parsed = parseArgs(argv);
    const cmd = COMMANDS.get(parsed.command);
    const stdinText = cmd.items && parsed.args.includes('-') ? await readAll(stdin) : undefined;
    const request = buildRequest(parsed, { env, stdinText });
    const data = await perform(request, { env, fetchImpl });
    stdout.write(render(request, data));
    if (request.command === 'clear' && data && Array.isArray(data.results)) stderr.write(clearNotes(data));
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      (err.exitCode === 0 ? stdout : stderr).write(err.message + '\n');
      if (err.body !== undefined && err.body !== null) stderr.write(JSON.stringify(err.body, null, 2) + '\n');
      return err.exitCode;
    }
    stderr.write(`${err && err.message ? err.message : err}\n`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { envVar, warnLegacyEnv, retrySeconds, parseArgs, buildRequest, buildUrl, execute, perform, run, normalizeNodeId, usage, commandHelp, CliError, CLIENT, COMMANDS };
