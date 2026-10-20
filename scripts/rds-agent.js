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
 * Hand-written command: `check` (render checks; loads the optional Playwright peer
 * dependency, nothing else does).
 *
 * Env: RDS_API_BASE_URL, RDS_AGENT_TOKEN, RDS_WORKER. Zero deps (Node >= 20 built-in fetch).
 * Exits 0 on 2xx (and for --help), 1 on API/usage errors; `check`: 0 passed, 1 mismatch, 2 errors.
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
    ...pad([...[...COMMANDS.values()].map(c => [`  ${c.command}${argsOf(c)}`, c.summary || '']), ['  check', 'Screenshot check targets of the built app and submit render checks (Playwright)']]),
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
    if (tail[0] === 'check') throw new CliError(checkHelp(), { exitCode: 0 });
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

// --- check (render checks with Playwright) -------------------------------------------
const CHECK_BROWSERS = ['chromium', 'firefox', 'webkit'];
const CHECK_DEFAULT_TIMEOUT = 30000;
/** The page's clock is frozen at this instant, so dates and relative times render the same on every run. */
const CHECK_FROZEN_TIME = '2025-01-01T12:00:00.000Z';
const CHECK_SOURCE = 'rds-agent check';
const CHECK_MODES = ['screen', 'requested', 'ready', 'all', 'list-unmapped'];
const CHECK_BOOLEANS = ['requested', 'ready', 'all', 'list-unmapped'];
const CHECK_FLAGS = ['file-key', 'base-url', ...CHECK_MODES, 'url', 'storybook', 'storage-state', 'browser', 'timeout', 'commit-ref', 'source', 'help'];
/** The element a gallery page or story marks as the thing to screenshot. */
const RDS_TARGET = '[data-rds-target]';
const STORYBOOK_ROOT = '#storybook-root';

function checkHelp() {
  return [
    'Usage: rds-agent check --file-key <key> --base-url <url> (--ready | --all | --requested | --screen <nodeId>) [flags]',
    '       rds-agent check --file-key <key> --list-unmapped [--base-url <url>] [--storybook <url>]',
    '',
    'Screenshots check targets of the built app with Playwright and submits them as render check results;',
    'the API compares them with their Figma references. Every target renders from the gallery first (the file\'s',
    'gallery.urlTemplate, or Storybook stories tagged figma:<component key>), else at base-url + its route, else it is Not mapped.',
    'Playwright is an optional peer dependency: npm i -D playwright && npx playwright install chromium',
    '',
    'Flags:',
    ...pad([
      ['  --file-key <string>', '(required) The Figma file key.'],
      ['  --base-url <url>', '(required, except with --list-unmapped) Where the built app runs (e.g. http://localhost:3000); targets without a gallery entry open at base-url + route (+ query).'],
      ['  --ready', 'Check every target the API lists as ready, in its order (contained targets first). End each pass with this.'],
      ['  --all', 'Check every target not excluded (e.g. nightly CI, for regressions in clean nodes).'],
      ['  --requested', 'Run every requested check of the file.'],
      ['  --screen <nodeId>', 'Request a check of this target, then run it.'],
      ['  --list-unmapped', 'Print the targets with no gallery entry or story and no route; renders nothing.'],
      ['  --url <url>', 'The full app URL of a target with no gallery entry and no route; saved as its (family\'s) route.'],
      ['  --storybook <url>', '(default: the file\'s gallery.storybookUrl) Storybook to resolve component stories in.'],
      ['  --storage-state <file>', 'Playwright storage state (cookies, local storage) for a signed-in app.'],
      ['  --browser <chromium|firefox|webkit>', '(default "chromium")'],
      ['  --timeout <ms>', `(default ${CHECK_DEFAULT_TIMEOUT}) Per page: navigation, network idle and fonts.`],
      ['  --commit-ref <string>', '(default: git rev-parse HEAD in a git repo) The commit the app was built from.'],
      ['  --source <string>', `(default $RDS_WORKER, else "${CHECK_SOURCE}") What rendered the screenshots.`],
    ]),
    '',
    'With --ready / --all, a target containing a target that just mismatched is skipped (Waiting on <target>);',
    'targets with no gallery entry and no route are Not mapped and never block; excluded targets are skipped.',
    '',
    'Exit codes: 0 every check passed (or there was nothing to check), 1 a render mismatch, 2 an error.',
  ].join('\n');
}

const absoluteUrl = value => {
  try { return new URL(value).toString(); } catch { return null; }
};

/** Parse `check` flags (argv after `check`); usage errors are CliErrors with exit code 2. */
function parseCheckArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { options.help = true; continue; }
    if (!arg.startsWith('--')) throw new CliError(`Unexpected argument for 'check': ${arg}\n\n${checkHelp()}`, { exitCode: 2 });
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf('=');
    if (eq !== -1) { value = key.slice(eq + 1); key = key.slice(0, eq); }
    if (!CHECK_FLAGS.includes(key)) {
      throw new CliError(`Unknown option for 'check': --${key}. Valid: ${CHECK_FLAGS.map(k => `--${k}`).join(' ')}`, { exitCode: 2 });
    }
    if (CHECK_BOOLEANS.includes(key)) { options[key] = value === undefined ? true : value !== 'false'; continue; }
    if (value === undefined) {
      if (i + 1 >= argv.length) throw new CliError(`Missing value for --${key}\n\n${checkHelp()}`, { exitCode: 2 });
      value = argv[++i];
    }
    if (options[key] !== undefined) throw new CliError(`Pass --${key} once`, { exitCode: 2 });
    options[key] = String(value).trim();
  }
  if (options.help) throw new CliError(checkHelp(), { exitCode: 0 });
  const usageError = message => new CliError(`${message}\n\n${checkHelp()}`, { exitCode: 2 });
  const modes = CHECK_MODES.filter(m => options[m]);
  if (modes.length !== 1) throw usageError('Pass one of --ready, --all, --requested, --screen <nodeId> or --list-unmapped');
  const mode = modes[0];
  const required = mode === 'list-unmapped' ? ['file-key'] : ['file-key', 'base-url'];
  for (const key of required) if (!options[key]) throw usageError(`--${key} is required`);
  const browser = options.browser || 'chromium';
  if (!CHECK_BROWSERS.includes(browser)) throw usageError(`--browser must be one of: ${CHECK_BROWSERS.join(', ')}`);
  let timeout = CHECK_DEFAULT_TIMEOUT;
  if (options.timeout !== undefined) {
    if (!/^\d+$/.test(options.timeout) || Number(options.timeout) < 1) throw usageError('--timeout must be a positive integer (ms)');
    timeout = Number(options.timeout);
  }
  let baseUrl = null;
  if (options['base-url']) {
    baseUrl = absoluteUrl(options['base-url']);
    if (!baseUrl) throw usageError('--base-url must be an absolute URL (e.g. http://localhost:3000)');
  }
  let url = null;
  if (options.url) {
    if (mode === 'list-unmapped') throw usageError('--url renders a screen; it does not combine with --list-unmapped');
    url = absoluteUrl(options.url);
    if (!url) throw usageError('--url must be a full URL (e.g. http://localhost:3000/files?tab=recent)');
  }
  return {
    mode,
    fileKey: options['file-key'],
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, '') : null,
    screen: options.screen ? normalizeNodeId(options.screen) : null,
    requested: mode === 'requested',
    url,
    storybook: options.storybook || null,
    storageState: options['storage-state'] || null,
    browser,
    timeout,
    commitRef: options['commit-ref'] || null,
    source: options.source || null,
  };
}

/** `git rev-parse HEAD` in `cwd`, or null outside a git repo (or without git). */
function gitHead(cwd) {
  try {
    const out = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Load Playwright from the project in `cwd` (where `npm i -D playwright` puts it),
 * else from the CLI's own location. Throws a CliError naming the install command when missing.
 */
async function loadPlaywright({ cwd = process.cwd(), name = 'playwright', browser = 'chromium' } = {}) {
  const { pathToFileURL } = require('node:url');
  let specifier = name;
  try { specifier = pathToFileURL(require.resolve(name, { paths: [cwd, __dirname] })).href; } catch { /* fall through to a bare import */ }
  try {
    const mod = await import(specifier);
    return mod.default && mod.default[browser] ? mod.default : mod;
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) {
      throw new CliError(`rds-agent check needs Playwright — install it: npm i -D playwright && npx playwright install ${browser}`, { exitCode: 2 });
    }
    throw err;
  }
}

/** `query` (with or without a leading `?`) appended to `url`'s query string as given. */
function withQuery(url, query) {
  const u = new URL(url);
  const q = String(query || '').replace(/^\?/, '');
  if (q) u.search = u.search ? `${u.search}&${q}` : `?${q}`;
  return u.toString();
}

/** The page a check renders: base URL + route, with the screen's query string. */
function checkUrl(baseUrl, check) {
  return withQuery(baseUrl + (check.route || '/'), check.query);
}

/** `path` (absolute, or relative to the app) as a full URL. */
function appUrl(baseUrl, path) {
  if (absoluteUrl(path)) return new URL(path).toString();
  if (!baseUrl) throw new CliError(`${path} is relative: pass --base-url to resolve it`, { exitCode: 2 });
  return baseUrl + (path.startsWith('/') ? path : `/${path}`);
}

/**
 * Fill a gallery URL template: `{key}`, `{nodeId}`, `{set}`, `{variant}`, `{prop.<Name>}`,
 * each URL-encoded. Returns null when a placeholder has no value for this variant.
 * @param {string} template
 * @param {{ key?: string | null, nodeId?: string, set?: string | null, variant?: string | null, props?: Record<string, string> }} render
 */
function fillTemplate(template, render) {
  let missing = false;
  const filled = template.replace(/\{([^{}]+)\}/g, (whole, name) => {
    const value = name.startsWith('prop.') ? (render.props || {})[name.slice(5)]
      : ['key', 'nodeId', 'set', 'variant'].includes(name) ? render[name] : undefined;
    if (value === undefined || value === null || (value === '' && name !== 'variant')) { missing = true; return whole; }
    return encodeURIComponent(String(value));
  });
  return missing ? null : filled;
}

/** Storybook index entries (`index.json` v4+, or `stories.json` v3 shape). */
function storybookEntries(index) {
  const entries = (index && (index.entries || index.stories)) || {};
  return Object.values(entries).filter(e => e && typeof e.id === 'string' && (!e.type || e.type === 'story'));
}

/** The story tagged `figma:<key>` (else `figma-node:<nodeId>`) in a Storybook index, or null. */
function findStory(index, { key, nodeId }) {
  const entries = storybookEntries(index);
  const tagged = tag => entries.find(e => Array.isArray(e.tags) && e.tags.includes(tag));
  return (key && tagged(`figma:${key}`)) || (nodeId && (tagged(`figma-node:${nodeId}`) || tagged(`figma-node:${nodeId.replace(':', '-')}`))) || null;
}

/**
 * How a target renders through the gallery: `{ mapped: true, url, storyId?, selectors }` or
 * `{ mapped: false, reason }`. Storybook (when configured) first, then the URL template.
 */
async function resolveComponent(render, { baseUrl, storybook, storybookIndex }) {
  const gallery = render.gallery || {};
  const sbUrl = storybook || gallery.storybookUrl || null;
  if (sbUrl) {
    const root = appUrl(baseUrl, sbUrl).replace(/\/+$/, '');
    const story = findStory(await storybookIndex(root), render);
    if (story) {
      return {
        mapped: true, storyId: story.id, url: `${root}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`,
        selectors: [`${STORYBOOK_ROOT} ${RDS_TARGET}`, STORYBOOK_ROOT],
      };
    }
  }
  if (gallery.urlTemplate) {
    const path = fillTemplate(gallery.urlTemplate, render);
    if (path !== null) return { mapped: true, storyId: null, url: baseUrl || absoluteUrl(path) ? appUrl(baseUrl, path) : path, selectors: [RDS_TARGET] };
    if (!sbUrl) return { mapped: false, reason: `gallery.urlTemplate needs a value this variant lacks (${gallery.urlTemplate})` };
  }
  if (sbUrl) return { mapped: false, reason: `no story tagged figma:${render.key || '?'}${render.nodeId ? ` or figma-node:${render.nodeId}` : ''}` };
  return { mapped: false, reason: 'no gallery: set gallery.urlTemplate or gallery.storybookUrl (files settings)' };
}

/** The theme of a render: the URL to open, context options and an init script. */
function themed(url, render) {
  const theme = render.theme || null;
  const mode = render.themeMode || 'color-scheme';
  const key = render.themeKey || 'theme';
  let out = withQuery(url, render.query);
  /** @type {Record<string, any>} */
  const contextOptions = {};
  let initScript = null;
  if (theme && mode === 'query') {
    out = withQuery(out, `${encodeURIComponent(key)}=${encodeURIComponent(theme)}`);
  } else if (theme && mode === 'storage') {
    initScript = `(() => { const k = ${JSON.stringify(key)}, v = ${JSON.stringify(theme)};`
      + ' try { localStorage.setItem(k, v); } catch (_) {}'
      + ' const add = () => document.documentElement && document.documentElement.classList.add(v);'
      + ' if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add); })();';
  } else if (theme === 'dark' || theme === 'light') {
    contextOptions.colorScheme = theme;
  }
  return { url: out, contextOptions, initScript };
}

/**
 * A PNG of one page (reduced motion, frozen clock, after network idle and fonts): the first of
 * `job.selectors` present on the page, else the viewport.
 * @param {any} browser
 * @param {{ url: string, viewport: { width: number, height: number }, contextOptions?: object, initScript?: string | null, selectors?: string[] }} job
 */
async function screenshot(browser, job, options) {
  const context = await browser.newContext({
    viewport: { width: job.viewport.width, height: job.viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    ...(job.contextOptions || {}),
    ...(options.storageState ? { storageState: options.storageState } : {}),
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeout);
    if (job.initScript) await page.addInitScript(job.initScript);
    await page.clock.setFixedTime(new Date(CHECK_FROZEN_TIME));
    await page.goto(job.url, { waitUntil: 'networkidle', timeout: options.timeout });
    await page.evaluate('document.fonts.ready.then(() => true)');
    const shot = { type: 'png', animations: 'disabled', caret: 'hide', timeout: options.timeout };
    for (const selector of job.selectors || []) {
      const found = page.locator(selector);
      if (await found.count()) return await found.first().screenshot(shot);
    }
    return await page.screenshot({ ...shot, fullPage: false });
  } finally {
    await context.close();
  }
}

const percent = n => (typeof n === 'number' ? `${Number(n.toFixed(3))}%` : '?');

function checkLine(check) {
  const head = `${check.nodeId}  ${check.status}`;
  if (check.status === 'error') return `${head}  ${check.error || ''}`.trimEnd();
  const cmp = check.status === 'passed' ? '<=' : '>';
  const lines = [`${head}  score ${percent(check.score)} ${cmp} limit ${percent(check.threshold)}  ${check.checkId}`];
  for (const r of check.regions || []) lines.push(`  region ${r.x},${r.y} ${r.width}x${r.height}${typeof r.pixels === 'number' ? ` (${r.pixels} px)` : ''}`);
  return lines.join('\n');
}

const asCheckError = err => (err instanceof CliError ? err.message : `error: ${err && err.message ? err.message : err}`);
const errorText = err => (err && err.message ? err.message : String(err));
const targetLabel = t => (t && t.name ? `${t.name} (${t.nodeId})` : t ? t.nodeId : '?');
const sameGallery = (a, b) => !!a && !!b && a.mapped === b.mapped && (a.storyId ?? null) === (b.storyId ?? null) && (a.url ?? null) === (b.url ?? null);

/** The route `url` gives relative to the app at `baseUrl` (its path, query and hash otherwise). */
function routeOf(url, baseUrl) {
  if (baseUrl && url.startsWith(`${baseUrl}/`)) return url.slice(baseUrl.length);
  const u = new URL(url);
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * `rds-agent check`: list (or request) the checks / targets, screenshot each, submit it.
 * Returns the exit code: 0 all passed (or nothing to check), 1 any mismatch, 2 any error.
 */
async function runCheck(argv, { env, fetchImpl, stdout, stderr, cwd = process.cwd(), playwright }) {
  const opts = parseCheckArgs(argv);
  readEnv(env);
  const call = (method, path, extra = {}) => execute({ method, path, query: {}, ...extra }, { env, fetchImpl });
  const fk = encodeURIComponent(opts.fileKey);
  const targetPath = nodeId => `/v3/files/${fk}/targets/${encodeURIComponent(nodeId)}`;
  const listTargets = async (query = {}) => (await call('GET', `/v3/files/${fk}/targets`, { query })).targets || [];

  const indexes = new Map();
  const storybookIndex = root => {
    if (!indexes.has(root)) {
      indexes.set(root, (async () => {
        const res = await fetchImpl(`${root}/index.json`, { method: 'GET', headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`could not read the Storybook index ${root}/index.json: HTTP ${res.status}`);
        return JSON.parse(await res.text());
      })());
    }
    return indexes.get(root);
  };
  /** Resolve a target's gallery entry and store it with the target when it changed (`listOnly`: only not-mapped ones). */
  async function galleryOf(target, { listOnly = false } = {}) {
    const render = { nodeId: target.nodeId, ...(target.render || {}) };
    const resolved = await resolveComponent(render, { baseUrl: opts.baseUrl, storybook: opts.storybook, storybookIndex });
    const stored = { mapped: resolved.mapped, storyId: resolved.mapped ? resolved.storyId : null, url: resolved.mapped ? resolved.url : null };
    if ((!listOnly || !resolved.mapped) && !sameGallery(render.cache || target.gallery, stored)) {
      try { await call('PATCH', targetPath(target.nodeId), { body: { gallery: stored } }); } catch (err) {
        stderr.write(`${target.nodeId}  warning  could not store its gallery resolution: ${asCheckError(err)}\n`);
      }
    }
    return resolved;
  }

  if (opts.mode === 'list-unmapped') {
    const rows = [];
    let errors = 0;
    for (const t of (await listTargets()).filter(x => !x.excluded)) {
      try {
        const g = await galleryOf(t, { listOnly: true });
        if (!g.mapped && !(t.render && t.render.route) && !t.route) rows.push([t.nodeId, t.render && t.render.set, t.render && t.render.variant, t.render && t.render.key, `${g.reason}; no route`]);
      } catch (err) {
        errors++;
        stderr.write(`${t.nodeId}  error  ${asCheckError(err)}\n`);
      }
    }
    stdout.write(rows.length ? table(['target', 'set', 'variant', 'key', 'reason'], rows) : 'every target is mapped\n');
    return errors ? 2 : 0;
  }

  /** @type {{ target: any, check?: any }[]} */
  let items;
  let runsAll = false;
  if (opts.mode === 'ready' || opts.mode === 'all') {
    runsAll = true;
    items = (await listTargets(opts.mode === 'ready' ? { status: 'ready' } : {})).filter(target => !target.excluded).map(target => ({ target }));
  } else {
    let checks;
    if (opts.screen) checks = [(await call('POST', `/v3/files/${fk}/screens/${encodeURIComponent(opts.screen)}/checks`)).check];
    else checks = (await call('GET', `/v3/files/${fk}/checks`, { query: { status: 'requested', limit: '500' } })).checks || [];
    const byNode = checks.length ? new Map((await listTargets()).map(t => [t.nodeId, t])) : new Map();
    items = checks.map(check => ({ check, target: byNode.get(check.nodeId) || null }));
  }
  if (!items.length) {
    stdout.write(opts.mode === 'ready' ? 'no ready targets\n' : opts.mode === 'all' ? 'no check targets\n' : 'no requested checks\n');
    return 0;
  }

  const pw = playwright || await loadPlaywright({ cwd, browser: opts.browser });
  const commitRef = opts.commitRef || gitHead(cwd);
  const source = opts.source || envVar(env, 'WORKER') || CHECK_SOURCE;
  const meta = { ...(commitRef ? { commitRef } : {}), source };
  const counts = { passed: 0, mismatch: 0, error: 0, waiting: 0, 'not mapped': 0 };
  const summary = [];
  /** Targets that mismatched (or wait on one) in this run → the target to name. */
  const failed = new Map();
  const passed = new Set();
  /** --url: the family whose route it captured. */
  let captured = null;
  const note = (target, nodeId, status, detail) => {
    counts[status]++;
    summary.push([nodeId, target && target.name, status, detail]);
  };

  /**
   * What to open for one item, or a skip `{ skip, detail }`.
   * @param {{ target: any, check?: any }} item
   * @returns {Promise<any>}
   */
  async function plan({ target, check }) {
    const render = (target && target.render) || {};
    const viewport = (check && check.viewport && check.viewport.width ? check.viewport : null) || render.viewport || (target && target.viewport);
    if (!viewport || !viewport.width || !viewport.height) throw new Error(`target ${(target || check).nodeId} has no viewport`);
    const look = { theme: render.theme ?? (check && check.theme), query: render.query ?? (check && check.query), themeMode: render.themeMode, themeKey: render.themeKey };
    // Gallery first, then the route, else Not mapped.
    let gallery = null;
    const configured = !!(opts.storybook || (render.gallery && (render.gallery.urlTemplate || render.gallery.storybookUrl)));
    const known = render.route || (target && target.route) || (check && check.route);
    if (target && (configured || !known)) {
      gallery = await galleryOf(target);
      if (gallery.mapped) return { viewport, selectors: gallery.selectors, ...themed(gallery.url, render) };
    }
    let route = render.route || (target && target.route) || (check && check.route) || null;
    const family = (target && (target.familyKey || target.nodeId)) || (check && check.nodeId);
    if (!route && opts.url && (!captured || captured.family === family)) {
      if (!captured) {
        const nodeId = (target || check).nodeId;
        const saved = (await call('PATCH', targetPath(nodeId), { body: { route: routeOf(opts.url, opts.baseUrl) } })).target;
        captured = { family, route: (saved && saved.route) || routeOf(opts.url, opts.baseUrl) };
        stdout.write(`${nodeId}  route  saved ${captured.route}\n`);
      }
      route = captured.route;
    }
    if (!route) return { skip: 'not mapped', detail: `${gallery ? `${gallery.reason}; ` : ''}no route (pass --url <full url> to set it)` };
    return { viewport, selectors: [], ...themed(opts.baseUrl + (route.startsWith('/') ? route : `/${route}`), look) };
  }

  let browser = null;
  try {
    for (const item of items) {
      const { target } = item;
      const nodeId = (target || item.check).nodeId;
      if (runsAll && target) {
        const blocker = (target.contains || []).find(id => failed.has(id));
        const listed = target.status === 'waiting' && target.waitingOn && !passed.has(target.waitingOn.nodeId) ? target.waitingOn : null;
        const on = blocker ? failed.get(blocker) : listed;
        if (on) {
          failed.set(target.nodeId, on);
          note(target, nodeId, 'waiting', `Waiting on ${targetLabel(on)}`);
          stdout.write(`${nodeId}  waiting  Waiting on ${targetLabel(on)}\n`);
          continue;
        }
      }
      let job;
      try {
        job = await plan(item);
      } catch (err) {
        note(target, nodeId, 'error', errorText(err));
        stderr.write(`${nodeId}  error  ${asCheckError(err)}\n`);
        continue;
      }
      if (job.skip) {
        note(target, nodeId, job.skip, job.detail);
        stdout.write(`${nodeId}  ${job.skip}  ${job.detail}\n`);
        continue;
      }
      try {
        const check = item.check || (await call('POST', `/v3/files/${fk}/screens/${encodeURIComponent(nodeId)}/checks`)).check;
        let body;
        try {
          if (!browser) browser = await pw[opts.browser].launch();
          body = { image: Buffer.from(await screenshot(browser, job, opts)).toString('base64'), ...meta };
        } catch (err) {
          body = { error: `could not render ${job.url}: ${errorText(err)}`.slice(0, 2000), ...meta };
        }
        const done = (await call('POST', `/v3/files/${fk}/checks/${encodeURIComponent(check.checkId)}/result`, { body })).check;
        const status = done.status === 'passed' || done.status === 'mismatch' ? done.status : 'error';
        if (target) {
          if (status === 'mismatch') failed.set(target.nodeId, target);
          if (status === 'passed') passed.add(target.nodeId);
        }
        note(target, nodeId, status, status === 'error' ? done.error : `score ${percent(done.score)} / limit ${percent(done.threshold)}`);
        stdout.write(`${checkLine(done)}\n`);
      } catch (err) {
        note(target, nodeId, 'error', asCheckError(err));
        stderr.write(`${nodeId}  error  ${asCheckError(err)}\n`);
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  if (summary.length > 1 || runsAll) stdout.write(`\n${table(['target', 'name', 'result', 'detail'], summary)}`);
  const extra = ['waiting', 'not mapped'].filter(k => counts[k]).map(k => `, ${counts[k]} ${k}`).join('');
  stdout.write(`${plural(items.length, 'check')}: ${counts.passed} passed, ${counts.mismatch} mismatch, ${plural(counts.error, 'error')}${extra}\n`);
  if (counts.error) return 2;
  return counts.mismatch ? 1 : 0;
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: any, stdout?: any, stderr?: any, stdin?: any, cwd?: string, playwright?: any }} [options]
 */
async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, cwd = process.cwd(), playwright } = {}) {
  const isCheck = argv[0] === 'check';
  try {
    warnLegacyEnv(env, { warn: message => stderr.write(`${message}\n`) });
    if (isCheck) return await runCheck(argv.slice(1), { env, fetchImpl, stdout, stderr, cwd, playwright });
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
      return isCheck && err.exitCode !== 0 ? 2 : err.exitCode;
    }
    stderr.write(`${err && err.message ? err.message : err}\n`);
    return isCheck ? 2 : 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { parseCheckArgs, loadPlaywright, checkUrl, fillTemplate, findStory, resolveComponent, themed, gitHead, envVar, warnLegacyEnv, retrySeconds, parseArgs, buildRequest, buildUrl, execute, perform, run, normalizeNodeId, usage, commandHelp, CliError, CLIENT, COMMANDS };
