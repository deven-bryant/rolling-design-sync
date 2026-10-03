#!/usr/bin/env node
'use strict';

/**
 * Generates `commands.generated.json` — the CLI's command table — from the API's
 * OpenAPI document (docs/api-v3-phase2.md, "8. Generated MCP tools and CLI
 * commands"), plus the command reference in README.md. One command per
 * operation annotated `x-rds-cli`. The document is built in-process with
 * `buildApp` (memory store), so no server or network is needed.
 *
 *   node gen-commands.js [--check] [--json <path>] [--readme <path>]
 *
 * `--check` writes nothing and exits 1 when either file is out of date.
 *
 * Mapping: the `fileKey` path parameter becomes `--file-key`; other path
 * parameters become positional arguments; query and JSON-body properties become
 * flags (camelCase → kebab-case), and the properties of an object-valued body
 * property (e.g. a claim's `filter`) become flags of their own; a body array of
 * two-key objects (e.g. clear's `items`) becomes variadic `<a>=<b>` arguments.
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildApp } = require('../apps/api/src/app');
const { loadConfig } = require('../apps/api/src/config');
const { MemoryStore } = require('../apps/api/src/store/memory');

const JSON_PATH = path.join(__dirname, 'commands.generated.json');
const README_PATH = path.join(__dirname, 'README.md');
const BEGIN = '<!-- BEGIN GENERATED COMMANDS (npm run gen) -->';
const END = '<!-- END GENERATED COMMANDS -->';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const kebab = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const typeOf = schema => {
  const types = [].concat(schema.type || []).filter(t => t !== 'null');
  if (types.length !== 1) throw new Error(`Unsupported schema type ${JSON.stringify(schema.type)}`);
  return types[0];
};

async function openapiDocument() {
  const app = buildApp({ store: new MemoryStore(), config: loadConfig({ RDS_AGENT_TOKENS: 'gen-commands', RDS_PLUGIN_TOKENS: 'gen-commands-plugin' }) });
  try {
    const res = await app.inject({ method: 'GET', url: '/v3/openapi.json' });
    if (res.statusCode !== 200) throw new Error(`GET /v3/openapi.json answered ${res.statusCode}`);
    return res.json();
  } finally {
    await app.close();
  }
}

/**
 * A flag from a parameter / property schema; only keys that are set.
 * @param {string} where
 * @param {string} name
 * @param {any} schema
 * @param {{ required?: boolean, object?: string }} [options]
 */
function flag(where, name, schema, { required = false, object } = {}) {
  /** @type {Record<string, any>} */
  const out = { flag: kebab(name), in: where, name };
  if (object) out.object = object;
  out.type = typeOf(schema);
  if (out.type === 'array') out.items = typeOf(schema.items || {});
  for (const key of ['enum', 'minimum', 'maximum', 'default']) if (schema[key] !== undefined) out[key] = schema[key];
  if (required) out.required = true;
  if (schema.description) out.description = schema.description;
  return out;
}

/** A body array of objects with exactly two required string keys: `<a>=<b>` arguments. */
function itemsInput(name, schema, required) {
  const item = schema.items || {};
  const keys = item.required || [];
  if (typeOf(item) !== 'object' || keys.length !== 2 || !keys.every(k => item.properties && typeOf(item.properties[k]) === 'string')) {
    throw new Error(`Unsupported body array '${name}'`);
  }
  const out = { name, keys };
  for (const key of ['minItems', 'maxItems']) if (schema[key] !== undefined) out[key] = schema[key];
  if (required) out.required = true;
  if (schema.description) out.description = schema.description;
  return out;
}

function jsonResponse(op) {
  const ok = op.responses['200'] || op.responses['201'] || {};
  return ((ok.content || {})['application/json'] || {}).schema || {};
}

/** `--all` paging: a `cursor`/`nextCursor` or `after`/`nextAfter` pair and the page's one array property. */
function pagingOf(op, queryNames) {
  const props = jsonResponse(op).properties || {};
  const pair = [['cursor', 'nextCursor'], ['after', 'nextAfter']].find(([param, next]) => queryNames.includes(param) && props[next]);
  if (!pair) return undefined;
  const arrays = Object.keys(props).filter(k => typeOf(props[k]) === 'array');
  if (arrays.length !== 1) throw new Error(`Paged response needs exactly one array property, got ${arrays.join(', ') || 'none'}`);
  return { param: pair[0], next: pair[1], items: arrays[0] };
}

function commandOf(method, route, op) {
  const where = `${method.toUpperCase()} ${route}`;
  try {
    const cmd = { command: op['x-rds-cli'].command, summary: op.summary, description: op.description, method: method.toUpperCase(), path: route };
    const positionals = [];
    const flags = [];
    for (const p of op.parameters || []) {
      if (p.in === 'path' && p.name !== 'fileKey') {
        positionals.push({ name: p.name, ...(p.description || p.schema.description ? { description: p.description || p.schema.description } : {}) });
      } else if (p.in === 'path' || p.in === 'query') {
        flags.push(flag(p.in, p.name, { ...p.schema, description: p.description || p.schema.description }, { required: !!p.required }));
      } else {
        throw new Error(`Unsupported parameter location '${p.in}'`);
      }
    }
    let items;
    if (op.requestBody) {
      const body = op.requestBody.content['application/json'].schema;
      const required = body.required || [];
      for (const [name, schema] of Object.entries(body.properties || {})) {
        const type = typeOf(schema);
        if (type === 'object' && schema.properties) {
          for (const [sub, subSchema] of Object.entries(schema.properties)) flags.push(flag('body', sub, subSchema, { object: name }));
        } else if (type === 'array' && typeOf(schema.items || {}) === 'object') {
          if (items) throw new Error('More than one item array in the body');
          items = itemsInput(name, schema, required.includes(name));
        } else {
          flags.push(flag('body', name, schema, { required: required.includes(name) }));
        }
      }
    }
    const order = ['path', 'query', 'body'];
    flags.sort((a, b) => order.indexOf(a.in) - order.indexOf(b.in));
    const seen = new Set();
    for (const f of flags) {
      if (seen.has(f.flag)) throw new Error(`Duplicate flag --${f.flag}`);
      seen.add(f.flag);
    }
    if (positionals.length) cmd.positionals = positionals;
    if (items) cmd.items = items;
    cmd.flags = flags;
    if (op.requestBody) cmd.body = true;
    const paging = pagingOf(op, flags.filter(f => f.in === 'query').map(f => f.name));
    if (paging) cmd.paging = paging;
    return cmd;
  } catch (err) {
    throw new Error(`${where}: ${err.message}`);
  }
}

function commandsFrom(doc) {
  const commands = [];
  for (const [route, ops] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = ops[method];
      if (op && op['x-rds-cli']) commands.push(commandOf(method, route, op));
    }
  }
  const names = commands.map(c => c.command);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`Two operations annotate x-rds-cli command '${dup}'`);
  return {
    $comment: 'Generated by scripts/gen-commands.js from the API\'s OpenAPI document (x-rds-cli operations). Do not edit; run `npm run gen` in scripts/.',
    api: doc.info.version,
    commands,
  };
}

// --- README command reference --------------------------------------------------
const cellText = s => String(s).replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '\\|');

function flagType(f) {
  if (f.enum) return f.enum.join('\\|');
  if (f.type === 'array') return `${f.items},…`;
  return f.type;
}

function referenceOf(spec) {
  const lines = [
    BEGIN,
    '',
    '## Command reference',
    '',
    `Generated from the API's OpenAPI document (API ${spec.api}) — one command per \`x-rds-cli\` operation.`,
    '',
    '| Command | Request | Summary |',
    '|---------|---------|---------|',
    ...spec.commands.map(c => `| [\`${c.command}\`](#rds-agent-${c.command.replace(/ /g, '-')}) | \`${c.method} ${c.path}\` | ${cellText(c.summary || '')} |`),
  ];
  for (const c of spec.commands) {
    const args = [...(c.positionals || []).map(p => `<${p.name}>`), ...(c.items ? [`<${c.items.keys[0]}>=<${c.items.keys[1]}> … | -`] : [])];
    lines.push('', `### rds-agent ${c.command}`, '', `\`${c.method} ${c.path}\`${args.length ? ` — arguments: \`${args.join(' ')}\`` : ''}`, '');
    if (c.description) lines.push(cellText(c.description), '');
    if (c.items) lines.push(`Arguments: ${cellText(c.items.description || c.items.name)} (body \`${c.items.name}\`)`, '');
    const flags = c.flags.filter(f => f.name !== 'format');
    if (flags.length) {
      lines.push('| Flag | Type | Sent as | Description |', '|------|------|---------|-------------|');
      for (const f of flags) {
        const sent = f.in === 'body' ? `body \`${f.object ? `${f.object}.` : ''}${f.name}\`` : `${f.in} \`${f.name}\``;
        const notes = [f.required ? '**Required.**' : '', f.default !== undefined ? `Default \`${JSON.stringify(f.default)}\`.` : ''].filter(Boolean).join(' ');
        lines.push(`| \`--${f.flag}\` | ${flagType(f)} | ${sent} | ${cellText([notes, f.description || ''].filter(Boolean).join(' '))} |`);
      }
      lines.push('');
    }
    const extra = [c.flags.some(f => f.name === 'format') ? `\`--format\`: also ${(c.flags.find(f => f.name === 'format').enum || ['ndjson', 'md']).filter(v => v !== 'json').map(v => `\`${v}\``).join(', ')} (from the server)` : '', c.paging ? `\`--all\`: follows \`${c.paging.next}\`` : ''].filter(Boolean);
    if (extra.length) lines.push(`${extra.join('; ')}.`, '');
  }
  lines.push(END);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function withReference(readme, reference) {
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start === -1 || end < start) throw new Error(`README.md needs the ${BEGIN} … ${END} markers`);
  return readme.slice(0, start) + reference + readme.slice(end + END.length);
}

/** `{ json, readme }`: the generated file's content and README.md with its reference section replaced. */
async function generate({ readme }) {
  const spec = commandsFrom(await openapiDocument());
  return { json: `${JSON.stringify(spec, null, 2)}\n`, readme: withReference(readme, referenceOf(spec)) };
}

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

async function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const check = argv.includes('--check');
  const jsonPath = argValue(argv, '--json', JSON_PATH);
  const readmePath = argValue(argv, '--readme', README_PATH);
  const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  const current = { json: read(jsonPath), readme: read(readmePath) };
  if (current.readme === null) throw new Error(`${readmePath} not found`);
  const next = await generate({ readme: current.readme });
  const stale = [[jsonPath, 'json'], [readmePath, 'readme']].filter(([, k]) => current[k] !== next[k]);
  if (check) {
    if (stale.length) {
      stderr.write(`Out of date: ${stale.map(([p]) => path.relative(process.cwd(), p)).join(', ')}. Run \`npm run gen\` in scripts/ and commit the result.\n`);
      return 1;
    }
    stdout.write('Generated CLI commands are up to date.\n');
    return 0;
  }
  for (const [p, k] of stale) fs.writeFileSync(p, next[k]);
  stdout.write(stale.length ? `Wrote ${stale.map(([p]) => path.relative(process.cwd(), p)).join(', ')}\n` : 'Generated CLI commands are up to date.\n');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => { process.stderr.write(`${err.stack || err}\n`); process.exitCode = 1; });
}

module.exports = { generate, commandsFrom, openapiDocument, main, BEGIN, END };
