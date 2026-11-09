'use strict';

const http = require('node:http');
const https = require('node:https');

/**
 * Minimal HTTP client for the v3 API. `request` resolves to
 * `{ ok, status, contentType, data, nextCursor, retryAfter, method, path }` for any HTTP response
 * (`application/json` and `+json` bodies parsed, `image/*` as a Buffer, others — ndjson included — as text;
 * `nextCursor` from the X-RDS-Next-Cursor header and `retryAfter` from Retry-After, else null);
 * network failures reject. Every request carries `X-RDS-Client: <clientName>` and,
 * when `token` (a string, or a function returning one) gives a value, the agent token.
 */
/**
 * @typedef {{ ok: boolean, status: number, contentType: string, data: any, nextCursor: string | null,
 *   retryAfter: string | null, method: string, path: string }} ApiResponse
 */

const JSON_TYPE = /^\s*application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i;
const IMAGE_TYPE = /^\s*image\//i;

/**
 * A `fetch` look-alike that sends `host` as the `Host` header (which `fetch`
 * itself won't set): a local-mode API only answers loopback Host names, so a
 * client reaching it by another name (e.g. a compose service name) sends
 * `localhost:<port>`.
 * @param {string} host
 * @returns {typeof fetch}
 */
function fetchWithHost(host) {
  return /** @type {any} */ ((url, init = {}) => new Promise((resolve, reject) => {
    const target = new URL(String(url));
    const lib = target.protocol === 'https:' ? https : http;
    const headers = { ...(/** @type {Record<string, string>} */ (init.headers || {})), host };
    const req = lib.request(target, { method: init.method || 'GET', headers, signal: init.signal || undefined }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = res.statusCode || 500;
        const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);
        resolve(new Response(body, { status, headers: out }));
      });
    });
    req.on('error', reject);
    if (init.body !== undefined && init.body !== null) req.write(init.body);
    req.end();
  }));
}

/**
 * @param {{ baseUrl: string, token?: string | null | (() => string | null), clientName: string,
 *   fetchImpl?: typeof fetch, hostHeader?: string | null }} options
 */
function createApiClient({ baseUrl, token, clientName, fetchImpl, hostHeader = null }) {
  const doFetch = fetchImpl || (hostHeader ? fetchWithHost(hostHeader) : globalThis.fetch);
  /**
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, any>, body?: unknown, signal?: AbortSignal, auth?: boolean }} [options]
   * @returns {Promise<ApiResponse>}
   */
  async function request(method, path, { query, body, signal, auth = true } = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json', 'x-rds-client': clientName };
    const bearer = auth ? (typeof token === 'function' ? token() : token) : null;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    /** @type {RequestInit} */
    const init = { method, headers };
    if (signal) init.signal = signal;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await doFetch(url.toString(), init);
    const contentType = res.headers.get('content-type') || '';
    const nextCursor = res.headers.get('x-rds-next-cursor') || null;
    const retryAfter = res.headers.get('retry-after') || null;
    if (res.ok && IMAGE_TYPE.test(contentType)) {
      return { ok: res.ok, status: res.status, contentType, data: Buffer.from(await res.arrayBuffer()), nextCursor, retryAfter, method, path };
    }
    const text = await res.text();
    /** @type {any} */
    let data = text;
    if (JSON_TYPE.test(contentType) && text) {
      try { data = JSON.parse(text); } catch (_) { data = text; }
    }
    return { ok: res.ok, status: res.status, contentType, data, nextCursor, retryAfter, method, path };
  }

  return { request };
}

module.exports = { createApiClient, fetchWithHost };
