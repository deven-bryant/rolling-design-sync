'use strict';

/*
 * Library links (docs/api-v3-design.md, "Library components"): with
 * RDS_FIGMA_TOKEN set, a library component key resolves through Figma's REST
 * API (`GET /v1/components/{key}`, `/v1/component_sets/{key}`: `meta.file_key`,
 * `meta.node_id`) into the library file and node id, cached in the store's
 * `library_component` table. Resolution runs in the background — after a sync
 * commits and on read for keys not cached yet — never blocks or fails a
 * request, times out quickly and retries a failed key at most hourly. The token
 * is never logged or returned.
 */

const FIGMA_API = 'https://api.figma.com/v1';
const TIMEOUT_MS = 5000;
const RETRY_MS = 60 * 60 * 1000;
const CONCURRENCY = 4;

const SET_TYPE = 'COMPONENT_SET';

class LibraryLinks {
  /**
   * @param {{ store: import('./store/types').Store, token?: string, fetch?: typeof fetch, now?: () => Date,
   *   timeoutMs?: number, retryMs?: number, log?: { warn: (...args: any[]) => void } | null }} options
   */
  constructor({ store, token = '', fetch: fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = TIMEOUT_MS, retryMs = RETRY_MS, log = null }) {
    this.store = store;
    this.token = token || '';
    this.fetch = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.retryMs = retryMs;
    this.log = log;
    /** component key → type, waiting to be resolved */
    this.queue = new Map();
    /** keys being resolved now */
    this.running = new Set();
    this.active = 0;
    this.closed = false;
    this.waiters = [];
  }

  /** True when a token is configured: library nodes can link to their library file. */
  get enabled() { return !!this.token && !this.closed; }

  /** A cached row needs (re)resolving: never resolved, or failed at least `retryMs` ago. */
  due(row) {
    if (!row) return true;
    if (!row.error) return false;
    return !row.resolvedAt || this.now().getTime() - Date.parse(row.resolvedAt) >= this.retryMs;
  }

  /**
   * The cached resolutions of `refs` (`[{ key, type }]`) by key — empty
   * without a token — and, for keys not resolved yet, a background resolve.
   */
  async lookup(refs) {
    if (!this.enabled) return new Map();
    const keys = [...new Set(refs.map(r => r.key).filter(Boolean))];
    if (!keys.length) return new Map();
    const rows = new Map((await this.store.getLibraryComponents(keys)).map(r => [r.componentKey, r]));
    this.schedule(refs.filter(r => r.key && this.due(rows.get(r.key))));
    return rows;
  }

  /** After a sync committed: resolves the keys of `refs` that are not cached (or due a retry), in the background. */
  async enqueue(refs) {
    if (!this.enabled || !refs.length) return;
    const keys = [...new Set(refs.map(r => r.key).filter(Boolean))];
    const rows = new Map((await this.store.getLibraryComponents(keys)).map(r => [r.componentKey, r]));
    this.schedule(refs.filter(r => r.key && this.due(rows.get(r.key))));
  }

  schedule(refs) {
    for (const { key, type } of refs) {
      if (!this.queue.has(key) && !this.running.has(key)) this.queue.set(key, type ?? null);
    }
    this.pump();
  }

  pump() {
    while (!this.closed && this.active < CONCURRENCY && this.queue.size) {
      const [key, type] = this.queue.entries().next().value;
      this.queue.delete(key);
      this.running.add(key);
      this.active += 1;
      this.resolve(key, type)
        .catch(err => { if (this.log) this.log.warn({ componentKey: key, err: err && err.message }, 'library link not stored'); })
        .finally(() => {
          this.running.delete(key);
          this.active -= 1;
          this.pump();
          if (!this.active && !this.queue.size) for (const done of this.waiters.splice(0)) done();
        });
    }
  }

  /** Resolves when no resolution is queued or running (tests). */
  idle() {
    if (!this.active && !this.queue.size) return Promise.resolve();
    return new Promise(resolve => this.waiters.push(resolve));
  }

  /** One key through Figma's REST API; the outcome (resolved or the error) is cached. */
  async resolve(key, type) {
    const kind = type === SET_TYPE ? 'component_sets' : 'components';
    let row;
    try {
      const res = await this.fetch(`${FIGMA_API}/${kind}/${encodeURIComponent(key)}`, {
        headers: { 'X-Figma-Token': this.token },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      /** @type {any} */
      const body = res.ok ? await res.json().catch(() => null) : null;
      const meta = body && body.meta;
      if (meta && typeof meta.file_key === 'string' && typeof meta.node_id === 'string') {
        row = { fileKey: meta.file_key, nodeId: meta.node_id, name: typeof meta.name === 'string' ? meta.name : null, error: null };
      } else {
        row = { error: res.ok ? 'unexpected_response' : `http_${res.status}` };
      }
    } catch (err) {
      row = { error: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'network_error' };
    }
    if (this.closed) return;
    await this.store.upsertLibraryComponent({ componentKey: key, ...row, resolvedAt: this.now().toISOString() });
  }

  /** Stops scheduling; resolutions in flight finish without writing. */
  close() {
    this.closed = true;
    this.queue.clear();
    for (const done of this.waiters.splice(0)) done();
  }
}

module.exports = { LibraryLinks, FIGMA_API, TIMEOUT_MS, RETRY_MS };
