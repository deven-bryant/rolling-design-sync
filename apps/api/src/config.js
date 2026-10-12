'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const warnedVars = new Set();
const LEGACY_VAR = /^FDS_([A-Z0-9_]+)$/;

/**
 * Warns once per variable (per `warned` set) for each non-empty pre-0.10
 * `FDS_<name>` in `env`, naming its `RDS_<name>` replacement. Their values are
 * never read.
 */
function warnLegacyEnv(env, { warn = message => console.warn(message), warned = warnedVars } = {}) {
  for (const key of Object.keys(env).sort()) {
    const m = LEGACY_VAR.exec(key);
    if (!m || !env[key] || warned.has(key)) continue;
    warned.add(key);
    warn(`${key} is no longer read; set RDS_${m[1]} instead`);
  }
}

/** `RDS_<name>` from `env`; empty counts as unset. */
const envVar = (env, name) => env[`RDS_${name}`] || undefined;

const splitTokens = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

const intOr = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** `RDS_STORE` values that run without a database server. */
const EMBEDDED_STORES = ['memory', 'local'];
const MIN_TOKEN_LENGTH = 32;
const TOKENS_FILE = 'tokens.json';
const TOKEN_NAME = /^[a-z0-9._-]{1,40}$/;

/**
 * One `RDS_*_TOKENS` list (docs/ui-portal.md, "Token labels"): each entry is a
 * token, or `name:token` where the name becomes the token's label in events
 * and the portal. Names match `[a-z0-9._-]{1,40}` and are unique per class —
 * anything else is a startup error. Returns the raw tokens plus token → name.
 */
function parseNamedTokens(value, envName) {
  const tokens = [];
  const names = new Map();
  const seen = new Set();
  for (const entry of splitTokens(value)) {
    const at = entry.indexOf(':');
    if (at === -1) { tokens.push(entry); continue; }
    const name = entry.slice(0, at);
    const token = entry.slice(at + 1);
    if (!TOKEN_NAME.test(name)) throw new Error(`${envName}: '${name}' is not a valid token name. Names match [a-z0-9._-]{1,40}.`);
    if (!token) throw new Error(`${envName}: '${entry}' has no token after 'name:'.`);
    if (seen.has(name)) throw new Error(`${envName}: token name '${name}' is used more than once.`);
    seen.add(name);
    tokens.push(token);
    names.set(token, name);
  }
  return { tokens, names };
}

function isLoopback(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

const UI_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})\/?$/i;

/**
 * `RDS_UI_ORIGINS`: comma-separated loopback origins (`http://localhost:<port>`,
 * `http://127.0.0.1:<port>`), returned normalized; any other entry throws.
 */
function parseUiOrigins(value) {
  return splitTokens(value).map(entry => {
    const m = UI_ORIGIN.exec(entry);
    const port = m ? Number(m[2]) : 0;
    if (!m || port < 1 || port > 65535) {
      throw new Error(`RDS_UI_ORIGINS: '${entry}' is not a loopback origin. Use http://localhost:<port> or http://127.0.0.1:<port>.`);
    }
    return `http://${m[1].toLowerCase()}:${port}`;
  });
}

/**
 * Rate-limit defaults (requests per minute per instance) for deployments with
 * a database; embedded modes default to off. `sync` is the plugin sync routes'
 * per-token budget, on whenever the token limit is: a 2,000-node scope uploads
 * in a handful of requests (apps/api/tests/rate-limit.test.js measures it), so
 * this leaves room for many full uploads a minute.
 */
const RATE_LIMIT_DEFAULTS = Object.freeze({ token: 600, ip: 120, auth: 10, sync: 120 });

/** A `RDS_RATE_LIMIT_*` value: a non-negative integer (`0` disables the limit), else a startup error. */
function rateLimitVar(value, name, fallback) {
  if (value === undefined || !String(value).trim()) return fallback;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error(`RDS_${name} must be a non-negative integer (requests per minute; 0 disables), got '${value}'.`);
  return Number(text);
}

/**
 * `RDS_TRUST_PROXY` as Fastify's `trustProxy`: unset, `false` or `0` trust no
 * proxy (the client IP is the socket's); `true` trusts every hop; a positive
 * integer trusts that many hops; anything else is a comma-separated list of
 * proxy addresses or CIDR ranges.
 */
function parseTrustProxy(value) {
  const text = String(value || '').trim();
  if (!text || /^(false|0)$/i.test(text)) return false;
  if (/^true$/i.test(text)) return true;
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

function rateLimits(rds, embedded) {
  const limit = name => rateLimitVar(rds(`RATE_LIMIT_${name.toUpperCase()}`), `RATE_LIMIT_${name.toUpperCase()}`, embedded ? 0 : RATE_LIMIT_DEFAULTS[name]);
  const token = limit('token');
  return { token, ip: limit('ip'), auth: limit('auth'), sync: token ? RATE_LIMIT_DEFAULTS.sync : 0 };
}

function loadConfig(env = process.env, envOptions = {}) {
  warnLegacyEnv(env, envOptions);
  const rds = name => envVar(env, name);
  const store = rds('STORE') || '';
  const embedded = EMBEDDED_STORES.includes(store);
  const host = env.HOST || (embedded ? '127.0.0.1' : '0.0.0.0');
  const loopback = isLoopback(host);
  const pluginTokens = parseNamedTokens(rds('PLUGIN_TOKENS'), 'RDS_PLUGIN_TOKENS');
  const agentTokens = parseNamedTokens(rds('AGENT_TOKENS'), 'RDS_AGENT_TOKENS');
  const viewerTokens = parseNamedTokens(rds('VIEWER_TOKENS'), 'RDS_VIEWER_TOKENS');
  const tokenLabels = new Map();
  for (const names of [pluginTokens.names, agentTokens.names, viewerTokens.names]) {
    for (const [token, name] of names) tokenLabels.set(token, name);
  }
  return {
    port: intOr(env.PORT, 8787),
    host,
    logLevel: env.LOG_LEVEL || 'info',
    databaseUrl: env.DATABASE_URL || '',
    store,
    embedded,
    loopback,
    dataDir: path.resolve(rds('DATA_DIR') || 'data'),
    pluginTokens: pluginTokens.tokens,
    agentTokens: agentTokens.tokens,
    viewerTokens: viewerTokens.tokens,
    tokenLabels,
    sessionSecret: rds('SESSION_SECRET') || '',
    portalDir: path.resolve(rds('PORTAL_DIR') || path.join(__dirname, '..', '..', 'portal', 'dist')),
    bodyLimit: intOr(rds('BODY_LIMIT_BYTES'), 64 * 1024 * 1024),
    claimTtlSeconds: intOr(rds('CLAIM_TTL_SECONDS'), 15 * 60),
    listenUrl: rds('LISTEN_URL') || env.DATABASE_URL || '',
    eventReplayHours: intOr(rds('EVENT_REPLAY_HOURS'), 24),
    eventRetentionDays: intOr(rds('EVENT_RETENTION_DAYS'), 30),
    // DNS-rebinding defense: embedded modes serve this machine only.
    checkHost: embedded,
    // Embedded modes accept only non-browser callers, the plugin's `Origin: null`
    // and the loopback UI origins listed in RDS_UI_ORIGINS.
    checkOrigin: embedded,
    uiOrigins: parseUiOrigins(rds('UI_ORIGINS')),
    trustProxy: parseTrustProxy(rds('TRUST_PROXY')),
    rateLimit: rateLimits(rds, embedded),
    // Optional Figma REST token for library links (library.js); never logged or returned.
    figmaToken: rds('FIGMA_TOKEN') || '',
  };
}

function chmodBestEffort(file, mode) {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(file, mode); } catch (_) { /* best-effort */ }
}

/** Creates `dir` (and parents) private to the current user; an existing directory is left as is. */
function ensureDataDir(dir) {
  const created = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (created) chmodBestEffort(dir, 0o700);
  return dir;
}

const newToken = () => randomBytes(32).toString('hex');

/** Token classes: `tokens.json` key → config field. */
const TOKEN_CLASSES = { plugin: 'pluginTokens', agent: 'agentTokens', viewer: 'viewerTokens' };

/** Non-token secrets `tokens.json` also holds: file key → config field. */
const LOCAL_SECRETS = { session: 'sessionSecret' };

/**
 * Local mode: fills in each token class and server secret that isn't
 * configured from `<dataDir>/tokens.json`, generating and persisting (mode
 * 0600) any that aren't stored yet. Returns the effective config and which
 * token classes were generated on this call (server secrets like `session`
 * generate silently — nothing needs to copy them out).
 */
function ensureLocalTokens(config) {
  const needed = Object.keys(TOKEN_CLASSES).filter(cls => !(config[TOKEN_CLASSES[cls]] || []).length);
  const secrets = Object.keys(LOCAL_SECRETS).filter(key => !config[LOCAL_SECRETS[key]]);
  const file = path.join(config.dataDir, TOKENS_FILE);
  if (!needed.length && !secrets.length) return { config, file, generated: [] };

  ensureDataDir(config.dataDir);
  let stored = {};
  if (fs.existsSync(file)) stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  const generated = [];
  let wrote = false;
  for (const cls of needed) {
    if (typeof stored[cls] !== 'string') { stored[cls] = newToken(); generated.push(cls); wrote = true; }
  }
  for (const key of secrets) {
    if (typeof stored[key] !== 'string') { stored[key] = newToken(); wrote = true; }
  }
  if (wrote) {
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
    chmodBestEffort(file, 0o600);
  }
  const filled = Object.fromEntries(needed.map(cls => [TOKEN_CLASSES[cls], [stored[cls]]]));
  for (const key of secrets) filled[LOCAL_SECRETS[key]] = stored[key];
  return { config: { ...config, ...filled }, file, generated };
}

/**
 * Embedded modes: throws if any token is shorter than MIN_TOKEN_LENGTH while
 * listening on a non-loopback address; on loopback returns warnings instead.
 */
function checkTokenStrength(config) {
  if (!config.embedded) return [];
  const tokens = [...config.pluginTokens, ...config.agentTokens, ...(config.viewerTokens || [])];
  if (config.sessionSecret) tokens.push(config.sessionSecret);
  const short = tokens.filter(t => t.length < MIN_TOKEN_LENGTH).length;
  if (!short) return [];
  const msg = `${short} configured token(s) shorter than ${MIN_TOKEN_LENGTH} characters`;
  if (!config.loopback) {
    throw new Error(`Refusing to listen on ${config.host} with ${msg}. Generate strong tokens with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
  }
  return [`Warning: ${msg}; acceptable only because the API listens on loopback (${config.host}).`];
}

module.exports = { loadConfig, envVar, warnLegacyEnv, parseTrustProxy, RATE_LIMIT_DEFAULTS, splitTokens, parseNamedTokens, parseUiOrigins, isLoopback, ensureDataDir, ensureLocalTokens, checkTokenStrength, EMBEDDED_STORES, MIN_TOKEN_LENGTH, TOKENS_FILE, TOKEN_CLASSES, TOKEN_NAME, LOCAL_SECRETS };
