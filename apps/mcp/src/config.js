'use strict';

const fs = require('node:fs');

class ConfigError extends Error {}

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
    warn(`rds-mcp: ${key} is no longer read; set RDS_${m[1]} instead`);
  }
}

/** `RDS_<name>` from `env`; empty counts as unset. */
const envVar = (env, name) => env[`RDS_${name}`] || undefined;

const DEFAULT_LIMIT = 25;
const MAX_RESULT_CHARS = 50000;

/** A positive integer from env var `name` (`RDS_` + `name`), else `fallback`. */
function positiveInt(value, name, fallback) {
  if (value === undefined || !String(value).trim()) return fallback;
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1) throw new ConfigError(`rds-mcp: RDS_${name} must be a positive integer, got "${value}".`);
  return n;
}

const DEFAULT_BASE_URL = 'http://localhost:8787';
const DEFAULT_MCP_PORT = 8788;
const DEFAULT_MCP_HOST = '127.0.0.1';
const TRANSPORTS = ['stdio', 'http'];
/** Host names the HTTP transport always accepts in `Host` / `Origin` (DNS-rebinding defense). */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** A TCP port from `value`, else `fallback`. */
function portVar(value, name, fallback) {
  if (value === undefined || !String(value).trim()) return fallback;
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new ConfigError(`rds-mcp: RDS_${name} must be a port number (0-65535), got "${value}".`);
  return n;
}

/** `RDS_MCP_ALLOWED_HOSTS`: extra host names (no port), lower-cased, after the loopback ones. */
function allowedHosts(value) {
  const extra = String(value || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  for (const h of extra) {
    if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/.test(h)) throw new ConfigError(`rds-mcp: RDS_MCP_ALLOWED_HOSTS: '${h}' is not a host name (no scheme or port).`);
  }
  return [...new Set([...LOOPBACK_HOSTS, ...extra])];
}

/**
 * Reads the server config from env (and `argv` for `--http`).
 *
 * - `RDS_API_BASE_URL` (default `http://localhost:8787`) must be an http(s) URL.
 * - The agent token is `RDS_AGENT_TOKEN`, else the `agent` entry of the
 *   `tokens.json` named by `RDS_AGENT_TOKEN_FILE`, read on every request; with
 *   neither, the server still starts and tool calls say what to set.
 * - `RDS_API_HOST` overrides the `Host` header sent to the API.
 * - `RDS_FILE_KEY` is an optional default for tools' `fileKey`;
 *   `RDS_MCP_DEFAULT_LIMIT` (25) is the page size when a listing call omits
 *   `limit`, and `RDS_MCP_MAX_RESULT_CHARS` (50,000) the tool-result size budget.
 * - `transport` is `stdio` unless `--http` or `RDS_MCP_TRANSPORT=http`; the HTTP
 *   transport listens on `RDS_MCP_HOST` (127.0.0.1) : `RDS_MCP_PORT` (8788) and
 *   accepts the loopback hosts plus `RDS_MCP_ALLOWED_HOSTS`.
 */
function readConfig(env = process.env, envOptions = {}, argv = []) {
  warnLegacyEnv(env, envOptions);
  const rds = name => envVar(env, name);
  const baseUrl = String(rds('API_BASE_URL') || '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const token = String(rds('AGENT_TOKEN') || '').trim() || null;
  const tokenFile = token ? null : String(rds('AGENT_TOKEN_FILE') || '').trim() || null;
  const apiHost = String(rds('API_HOST') || '').trim() || null;
  const defaultFileKey = String(rds('FILE_KEY') || '').trim() || null;
  const defaultLimit = positiveInt(rds('MCP_DEFAULT_LIMIT'), 'MCP_DEFAULT_LIMIT', DEFAULT_LIMIT);
  const maxResultChars = positiveInt(rds('MCP_MAX_RESULT_CHARS'), 'MCP_MAX_RESULT_CHARS', MAX_RESULT_CHARS);
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  } catch (_) {
    throw new ConfigError(`rds-mcp: RDS_API_BASE_URL must be an http(s) URL, got "${baseUrl}".`);
  }
  const transportVar = String(rds('MCP_TRANSPORT') || '').trim().toLowerCase();
  if (transportVar && !TRANSPORTS.includes(transportVar)) {
    throw new ConfigError(`rds-mcp: RDS_MCP_TRANSPORT must be one of ${TRANSPORTS.join(', ')}, got "${transportVar}".`);
  }
  const transport = argv.includes('--http') ? 'http' : transportVar || 'stdio';
  return {
    baseUrl, token, tokenFile, apiHost, defaultFileKey, defaultLimit, maxResultChars, transport,
    httpPort: portVar(rds('MCP_PORT'), 'MCP_PORT', DEFAULT_MCP_PORT),
    httpHost: String(rds('MCP_HOST') || '').trim() || DEFAULT_MCP_HOST,
    allowedHosts: allowedHosts(rds('MCP_ALLOWED_HOSTS')),
  };
}

const NO_TOKEN = 'No agent token: set RDS_AGENT_TOKEN to an agent token (or RDS_AGENT_TOKEN_FILE to the API\'s tokens.json) in the MCP server\'s env. ' +
  'With the Docker setup, use the HTTP server instead (`docker compose up -d`, then connect to http://localhost:8788/mcp), which needs no token.';

/**
 * The agent token for a request: `config.token`, else the `agent` entry of
 * `config.tokenFile`. Throws a ConfigError saying what to set.
 */
function agentToken(config, { readFile = fs.readFileSync } = {}) {
  if (config.token) return config.token;
  if (!config.tokenFile) throw new ConfigError(NO_TOKEN);
  let stored;
  try {
    stored = JSON.parse(String(readFile(config.tokenFile, 'utf8')));
  } catch (err) {
    const why = err && err.code === 'ENOENT' ? 'it does not exist (has the API started once?)' : err && err.code ? err.code : 'it is not JSON';
    throw new ConfigError(`Could not read the agent token from RDS_AGENT_TOKEN_FILE=${config.tokenFile}: ${why}.`);
  }
  const token = stored && typeof stored.agent === 'string' ? stored.agent.trim() : '';
  if (!token) throw new ConfigError(`RDS_AGENT_TOKEN_FILE=${config.tokenFile} has no "agent" token.`);
  return token;
}

module.exports = { readConfig, agentToken, envVar, warnLegacyEnv, ConfigError, DEFAULT_LIMIT, MAX_RESULT_CHARS, DEFAULT_BASE_URL, DEFAULT_MCP_PORT, LOOPBACK_HOSTS };
