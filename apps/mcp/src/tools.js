'use strict';

/*
 * MCP tools from the API's OpenAPI document (docs/api-v3-phase2.md, "8.
 * Generated MCP tools"): one tool per operation annotated `x-rds-mcp`, whose
 * input schema is the operation's path, query and body parameters, with the
 * JSON Schemas passed through as-is.
 */

const { parseFigmaUrl } = require('@rolling-design-sync/core');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
/** Path parameters a `url` (Figma link) query parameter can supply, as `-`. */
const URL_PARAMS = ['fileKey', 'nodeId'];
const PLACEHOLDER = '-';
/** Input keys holding node ids; a Figma link with a node-id is accepted there too. */
const NODE_KEYS = new Set(['nodeId', 'under', 'nodeIds']);

class ToolError extends Error {}

const describe = (schema, description) => (description && !schema.description ? { ...schema, description } : schema);

/**
 * Every `x-rds-mcp` operation of `doc` as a tool:
 * `{ name, title, description, inputSchema, annotations, method, path, params, bodyProps, bodyKey, bodyRequired, paged }`.
 * `params` maps an input name to `path` or `query`; body inputs are the body
 * schema's properties (`bodyProps`), or the whole body under `bodyKey` when
 * they are not an object's properties or collide with a parameter name.
 * `paged` is `{ maxLimit }` for a read-only operation with a `limit` query
 * parameter (a listing the server may page), else null.
 */
function toolsFromOpenApi(doc) {
  const tools = [];
  const seen = new Set();
  for (const [path, item] of Object.entries((doc && doc.paths) || {})) {
    for (const method of METHODS) {
      const op = item && item[method];
      const name = op && op['x-rds-mcp'] && op['x-rds-mcp'].tool;
      if (typeof name !== 'string' || !name || seen.has(name)) continue;
      seen.add(name);
      tools.push(toolFromOperation(name, method.toUpperCase(), path, op, item.parameters || []));
    }
  }
  return tools;
}

function toolFromOperation(name, method, path, op, shared) {
  const byKey = new Map();
  for (const p of [...shared, ...(op.parameters || [])]) {
    if (p && (p.in === 'path' || p.in === 'query')) byKey.set(`${p.in}:${p.name}`, p);
  }
  const parameters = [...byKey.values()];
  const properties = {};
  const required = [];
  const params = {};
  const takesUrl = parameters.some(p => p.in === 'query' && p.name === 'url');
  for (const p of parameters) {
    properties[p.name] = describe(p.schema || {}, p.description);
    params[p.name] = p.in;
    const suppliedByUrl = p.in === 'path' && takesUrl && URL_PARAMS.includes(p.name);
    if ((p.required || p.in === 'path') && !suppliedByUrl) required.push(p.name);
  }

  let bodyProps = null;
  let bodyKey = null;
  let bodyRequired = false;
  const content = op.requestBody && op.requestBody.content;
  const schema = content && content['application/json'] && content['application/json'].schema;
  if (schema) {
    bodyRequired = !!op.requestBody.required;
    const props = schema.properties;
    const types = [].concat(schema.type || []);
    if (props && types.includes('object') && !Object.keys(props).some(k => k in properties)) {
      bodyProps = Object.keys(props);
      Object.assign(properties, props);
      required.push(...(schema.required || []));
    } else {
      bodyKey = 'body';
      properties.body = describe(schema, op.requestBody.description || 'The request body.');
      if (bodyRequired) required.push('body');
    }
  }

  const readOnly = method === 'GET';
  const limitParam = readOnly && parameters.find(p => p.in === 'query' && p.name === 'limit');
  const paged = limitParam ? { maxLimit: Number.isInteger((limitParam.schema || {}).maximum) ? limitParam.schema.maximum : null } : null;
  return {
    name,
    title: op.summary || name,
    description: [op.summary, op.description].filter(Boolean).join('\n\n') || name,
    inputSchema: { type: 'object', properties, ...(required.length ? { required: [...new Set(required)] } : {}), additionalProperties: false },
    annotations: {
      ...(op.summary ? { title: op.summary } : {}),
      readOnlyHint: readOnly,
      ...(readOnly ? {} : { destructiveHint: false }),
      openWorldHint: false,
    },
    method,
    path,
    params,
    bodyProps,
    bodyKey,
    bodyRequired,
    paged,
  };
}

const looksLikeUrl = v => typeof v === 'string' && (/^[a-z][a-z0-9+.-]*:\/\//i.test(v.trim()) || /figma\.com\//i.test(v));
const present = v => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim());

/** `value` with every Figma link under a node-id key replaced by its node id; the links' file keys go to `fileKeys`. */
function unlinkNodes(value, key, where, fileKeys) {
  if (Array.isArray(value)) return value.map((v, i) => unlinkNodes(v, key, `${where}[${i}]`, fileKeys));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unlinkNodes(v, k, `${where}.${k}`, fileKeys)]));
  }
  if (!NODE_KEYS.has(key) || !looksLikeUrl(value)) return value;
  const parsed = parseFigmaUrl(value.trim());
  if (!parsed || !parsed.nodeId) throw new ToolError(`${where}: '${value}' is not a Figma link with a node-id (…?node-id=1-2).`);
  fileKeys.add(parsed.fileKey);
  return parsed.nodeId;
}

const queryValue = v => (Array.isArray(v) ? v.join(',') : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * The HTTP request `{ method, path, query, body }` for a call of `tool` with
 * `args`. A `url` supplies `fileKey` / `nodeId` (as `-`); without either,
 * `fileKey` comes from node links in the inputs, then `defaultFileKey`.
 */
function toRequest(tool, args, { defaultFileKey = null } = {}) {
  const input = args && typeof args === 'object' ? args : {};
  const unknown = Object.keys(input).filter(k => !(k in tool.inputSchema.properties));
  if (unknown.length) {
    throw new ToolError(`${tool.name}: unknown input(s) ${unknown.join(', ')}. Valid inputs: ${Object.keys(tool.inputSchema.properties).join(', ')}.`);
  }
  const fileKeys = new Set();
  const values = {};
  for (const [k, v] of Object.entries(input)) if (present(v)) values[k] = unlinkNodes(typeof v === 'string' ? v.trim() : v, k, k, fileKeys);

  const url = tool.params.url === 'query' ? values.url : undefined;
  const pathValues = {};
  for (const name of Object.keys(tool.params).filter(n => tool.params[n] === 'path')) {
    let v = values[name];
    if (v === undefined && url !== undefined && URL_PARAMS.includes(name)) v = PLACEHOLDER;
    if (v === undefined && name === 'fileKey') v = fileKeys.size === 1 ? [...fileKeys][0] : defaultFileKey || undefined;
    if (v === undefined) {
      if (name === 'fileKey') {
        throw new ToolError('fileKey is required: pass it (or a Figma link as url), or set RDS_FILE_KEY in the MCP server env. It is the <fileKey> segment of figma.com/design/<fileKey>/….');
      }
      throw new ToolError(`${name} is required${URL_PARAMS.includes(name) && tool.params.url ? ': pass it, or a Figma link with a node-id as url' : ''}.`);
    }
    pathValues[name] = String(v);
  }
  if (pathValues.fileKey !== undefined) {
    const target = pathValues.fileKey === PLACEHOLDER ? (parseFigmaUrl(url) || {}).fileKey : pathValues.fileKey;
    const other = target && [...fileKeys].find(k => k !== target);
    if (other) throw new ToolError(`A link names file '${other}', but the call is for file '${target}'. Address each file in its own call.`);
  }

  const path = tool.path.replace(/\{([^}]+)\}/g, (_, k) => encodeURIComponent(pathValues[k]));
  const query = {};
  for (const [k, where] of Object.entries(tool.params)) if (where === 'query' && values[k] !== undefined) query[k] = queryValue(values[k]);

  let body;
  if (tool.bodyProps) {
    const picked = Object.fromEntries(tool.bodyProps.filter(k => values[k] !== undefined).map(k => [k, values[k]]));
    if (Object.keys(picked).length || tool.bodyRequired) body = picked;
  } else if (tool.bodyKey) {
    body = values[tool.bodyKey];
    if (body === undefined && tool.bodyRequired) body = {};
  }
  return { method: tool.method, path, query, body };
}

module.exports = { toolsFromOpenApi, toRequest, ToolError, URL_PARAMS };
