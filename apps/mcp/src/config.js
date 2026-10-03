'use strict';

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

/**
 * Reads the server config from env. `RDS_API_BASE_URL` and `RDS_AGENT_TOKEN`
 * are required; `RDS_FILE_KEY` is an optional default for tools' `fileKey`;
 * `RDS_MCP_DEFAULT_LIMIT` (25) is the page size when a listing call omits
 * `limit`, and `RDS_MCP_MAX_RESULT_CHARS` (50,000) the tool-result size budget.
 */
function readConfig(env = process.env, envOptions = {}) {
  warnLegacyEnv(env, envOptions);
  const rds = name => envVar(env, name);
  const baseUrl = String(rds('API_BASE_URL') || '').trim().replace(/\/+$/, '');
  const token = String(rds('AGENT_TOKEN') || '').trim();
  const defaultFileKey = String(rds('FILE_KEY') || '').trim() || null;
  const defaultLimit = positiveInt(rds('MCP_DEFAULT_LIMIT'), 'MCP_DEFAULT_LIMIT', DEFAULT_LIMIT);
  const maxResultChars = positiveInt(rds('MCP_MAX_RESULT_CHARS'), 'MCP_MAX_RESULT_CHARS', MAX_RESULT_CHARS);
  const missing = [];
  if (!baseUrl) missing.push('RDS_API_BASE_URL');
  if (!token) missing.push('RDS_AGENT_TOKEN');
  if (missing.length) {
    throw new ConfigError(
      `rds-mcp: missing required environment variable(s): ${missing.join(', ')}.\n` +
      'Set RDS_API_BASE_URL to the rolling-design-sync API origin (e.g. http://127.0.0.1:8787) ' +
      'and RDS_AGENT_TOKEN to an agent token, in the "env" block of your MCP client config.',
    );
  }
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  } catch (_) {
    throw new ConfigError(`rds-mcp: RDS_API_BASE_URL must be an http(s) URL, got "${baseUrl}".`);
  }
  return { baseUrl, token, defaultFileKey, defaultLimit, maxResultChars };
}

module.exports = { readConfig, envVar, warnLegacyEnv, ConfigError, DEFAULT_LIMIT, MAX_RESULT_CHARS };
