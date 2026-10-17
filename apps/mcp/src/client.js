'use strict';

/**
 * Minimal HTTP client for the v3 API. `request` resolves to
 * `{ ok, status, contentType, data, nextCursor, retryAfter, method, path }` for any HTTP response
 * (`application/json` and `+json` bodies parsed, `image/*` as a Buffer, others — ndjson included — as text;
 * `nextCursor` from the X-RDS-Next-Cursor header and `retryAfter` from Retry-After, else null);
 * network failures reject. Every request
 * carries the agent token and `X-RDS-Client: <clientName>`.
 */
/**
 * @typedef {{ ok: boolean, status: number, contentType: string, data: any, nextCursor: string | null,
 *   retryAfter: string | null, method: string, path: string }} ApiResponse
 */

const JSON_TYPE = /^\s*application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i;
const IMAGE_TYPE = /^\s*image\//i;

function createApiClient({ baseUrl, token, clientName, fetchImpl = globalThis.fetch }) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, any>, body?: unknown, signal?: AbortSignal }} [options]
   * @returns {Promise<ApiResponse>}
   */
  async function request(method, path, { query, body, signal } = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    /** @type {Record<string, string>} */
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json', 'x-rds-client': clientName };
    /** @type {RequestInit} */
    const init = { method, headers };
    if (signal) init.signal = signal;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(url.toString(), init);
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

module.exports = { createApiClient };
