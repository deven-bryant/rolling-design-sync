'use strict';

/*
 * Postgres event bus (docs/api-v3-phase2.md, "Event bus"): `NOTIFY rds_events`
 * with `{ fileKey, id }` after commit, and one dedicated `LISTEN` connection per
 * process (RDS_LISTEN_URL, else DATABASE_URL). While `LISTEN` is unavailable —
 * it failed, or the connection dropped — the bus polls the `event` table every
 * `pollMs` and keeps trying to reconnect.
 */
const { Client } = require('pg');
const { Subscribers } = require('./bus');

const CHANNEL = 'rds_events';

class PostgresBus {
  /**
   * @param {object} opts
   * @param {object} opts.store       PostgresStore (NOTIFY and polling go through its pool)
   * @param {string} [opts.connectionString]  the listening connection
   * @param {object|boolean} [opts.ssl]
   * @param {Function | null} [opts.createClient]  `config => pg.Client`-like (tests)
   * @param {number} [opts.pollMs]
   * @param {number} [opts.reconnectMs]
   * @param {number} [opts.maxReconnectMs]
   * @param {{ info: Function, warn: Function, error: Function } | null} [opts.log]
   */
  constructor({ store, connectionString = '', ssl = false, createClient = null, pollMs = 2000, reconnectMs = 5000, maxReconnectMs = 5 * 60 * 1000, log = null }) {
    this.store = store;
    this.clientConfig = { connectionString, ssl };
    this.createClient = createClient || (config => new Client(config));
    this.pollMs = pollMs;
    this.reconnectMs = reconnectMs;
    this.maxReconnectMs = Math.max(reconnectMs, maxReconnectMs);
    this.reconnectDelay = reconnectMs;
    this.lastError = null;
    this.log = log;
    this.subscribers = new Subscribers({ onError: err => { if (this.log) this.log.error({ err }, 'event subscriber failed'); } });
    this.seen = new Map(); // fileKey -> newest id dispatched
    this.client = null;
    this.mode = 'stopped'; // 'listening' | 'polling' | 'stopped'
    this.closed = false;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.polling = false;
  }

  async start() {
    if (!(await this._listen())) this._fallBack();
  }

  publish(fileKey, id) {
    this._dispatch(fileKey, id);
    Promise.resolve()
      .then(() => this.store.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify({ fileKey, id })]))
      .catch(err => this._warn(err, 'NOTIFY failed'));
  }

  subscribe(fileKey, fn) { return this.subscribers.add(fileKey, fn); }

  subscriberCount(fileKey) { return this.subscribers.count(fileKey); }

  async close() {
    this.closed = true;
    this.mode = 'stopped';
    clearInterval(this.pollTimer ?? undefined);
    clearTimeout(this.reconnectTimer);
    this.pollTimer = this.reconnectTimer = null;
    this.subscribers.clear();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }

  _dispatch(fileKey, id) {
    if (id > (this.seen.get(fileKey) || 0)) this.seen.set(fileKey, id);
    this.subscribers.dispatch(fileKey, id);
  }

  _warn(err, msg) { if (this.log && !this.closed) this.log.warn({ err }, `event bus: ${msg}`); }

  /** Opens the listening connection; true once `LISTEN` succeeded. */
  async _listen() {
    let client;
    try {
      client = this.createClient({ ...this.clientConfig });
      client.on('error', err => this._dropped(client, err));
      client.on('end', () => this._dropped(client, null));
      client.on('notification', msg => this._notified(msg));
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (err) {
      this.lastError = err;
      this._warn(err, 'LISTEN unavailable; polling the event table');
      if (client) client.end().catch(() => {});
      return false;
    }
    if (this.closed) { client.end().catch(() => {}); return false; }
    this.client = client;
    this.mode = 'listening';
    this.lastError = null;
    this.reconnectDelay = this.reconnectMs;
    clearInterval(this.pollTimer ?? undefined);
    this.pollTimer = null;
    await this.poll(); // catch up on anything committed while not listening
    return true;
  }

  _notified(msg) {
    if (msg.channel !== CHANNEL) return;
    try {
      const { fileKey, id } = JSON.parse(msg.payload);
      if (typeof fileKey === 'string' && Number.isSafeInteger(id)) this._dispatch(fileKey, id);
    } catch (err) {
      this._warn(err, 'bad notification payload');
    }
  }

  _dropped(client, err) {
    if (this.client !== client || this.closed) return;
    this.client = null;
    this._warn(err, 'LISTEN connection lost; polling the event table');
    client.end().catch(() => {});
    this._fallBack();
  }

  _fallBack() {
    if (this.closed) return;
    this.mode = 'polling';
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => { this.poll(); }, this.pollMs);
      this.pollTimer.unref();
    }
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null;
        if (this.closed) return;
        if (!(await this._listen())) this._fallBack();
      }, this._nextDelay());
      this.reconnectTimer.unref();
    }
  }

  /**
   * Delay before the next LISTEN attempt: doubles from `reconnectMs` up to
   * `maxReconnectMs`, and jumps straight to the maximum after an authentication
   * failure so bad credentials can't trip a pooler's circuit breaker.
   */
  _nextDelay() {
    if (isAuthFailure(this.lastError)) return this.maxReconnectMs;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, this.maxReconnectMs);
    return delay;
  }

  /** Dispatches each subscribed file whose newest event id moved. */
  async poll() {
    const keys = this.subscribers.fileKeys();
    if (this.polling || !keys.length || this.closed) return;
    this.polling = true;
    try {
      for (const { fileKey, id } of await this.store.latestEventIds(keys.includes(null) ? null : keys)) {
        if (id > (this.seen.get(fileKey) || 0)) this._dispatch(fileKey, id);
      }
    } catch (err) {
      this._warn(err, 'polling the event table failed');
    } finally {
      this.polling = false;
    }
  }
}

/** Bad credentials (28P01) or a pooler that has stopped accepting them (Supavisor's circuit breaker). */
function isAuthFailure(err) {
  if (!err) return false;
  return err.code === '28P01' || /password authentication failed|ECIRCUITBREAKER/i.test(String(err.message || ''));
}

module.exports = { PostgresBus, CHANNEL, isAuthFailure };
