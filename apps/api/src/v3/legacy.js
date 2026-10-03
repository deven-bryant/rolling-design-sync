'use strict';

/*
 * The removed v1 (per-scope snapshots and queue) and v2 (per-node sync)
 * routes, each with its v3 equivalent for the `route_not_found` hint
 * (docs/api-v3-phase2.md, "9. Removals").
 */

const FILE = '{fileKey}';

/**
 * `[method, pattern, (params, fileKey) => v3 equivalent]`; `fileKey` is `?fileKey=` or `{fileKey}`.
 * @type {[string, RegExp, (params: string[], fileKey: string) => string][]}
 */
const LEGACY_ROUTES = [
  ['POST', /^\/scopes$/, () => `POST /v3/files/${FILE}/sync`],
  ['POST', /^\/scopes\/[^/]+\/snapshots$/, () => `POST /v3/files/${FILE}/sync`],
  ['POST', /^\/snapshots\/[^/]+\/parts$/, () => `POST /v3/files/${FILE}/sync`],
  ['POST', /^\/snapshots\/[^/]+\/publish$/, () => `POST /v3/files/${FILE}/sync`],
  ['GET', /^\/scopes\/[^/]+\/pending$/, () => `GET /v3/files/${FILE}/nodes (dirty nodes; GET /v3/files/${FILE}/scopes lists the scopes)`],
  ['GET', /^\/items\/[^/]+$/, () => `GET /v3/files/${FILE}/nodes/{nodeId}`],
  ['POST', /^\/items\/[^/]+\/verification$/, () => `POST /v3/files/${FILE}/clear`],
  ['GET', /^\/v2\/scopes\/([^/]+)\/hashes$/, ([nodeId], fk) => `GET /v3/files/${fk}/hashes?under=${nodeId}`],
  ['POST', /^\/v2\/nodes\/batch$/, (_, fk) => `POST /v3/files/${fk}/sync`],
  ['POST', /^\/v2\/nodes\/exists$/, (_, fk) => `POST /v3/files/${fk}/exists`],
  ['GET', /^\/v2\/nodes\/([^/]+)\/delta$/, ([nodeId], fk) => `GET /v3/files/${fk}/nodes?under=${nodeId} (POST /v3/files/${fk}/claims to lease them)`],
  ['POST', /^\/v2\/nodes\/clear$/, (_, fk) => `POST /v3/files/${fk}/clear`],
];

/** The hint for a request to a removed v1/v2 path, or `null` when `path` is not one. */
function legacyRouteHint(method, path, query = {}) {
  const fileKey = typeof query.fileKey === 'string' && query.fileKey.trim() ? query.fileKey.trim() : FILE;
  for (const [m, pattern, v3] of LEGACY_ROUTES) {
    const match = pattern.exec(path);
    if (match && m === method) return `The v1/v2 API was removed; use ${v3(match.slice(1), fileKey)}. GET /v3/openapi.json lists every v3 route.`;
  }
  if (/^\/v[12](\/|$)/.test(path)) return 'The v1/v2 API was removed. GET /v3/openapi.json lists every v3 route.';
  return null;
}

module.exports = { LEGACY_ROUTES, legacyRouteHint };
