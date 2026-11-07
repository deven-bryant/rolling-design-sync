'use strict';

/*
 * RDS_STORE=local: embedded Postgres (PGlite, in-process WebAssembly)
 * persisted to a directory. Applies supabase/migrations once each and serves
 * the unmodified PostgresStore through a pool-compatible adapter.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { ltree } = require('@electric-sql/pglite/contrib/ltree');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { PostgresStore } = require('./postgres');
const { ensureDataDir } = require('../config');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const PGDATA = 'pgdata';

/** FIFO mutex: `acquire()` resolves to a one-shot `release` function. */
class Lock {
  constructor() { this.tail = Promise.resolve(); }

  acquire() {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const ready = this.tail.then(() => {
      let done = false;
      return () => { if (!done) { done = true; release(); } };
    });
    this.tail = ready.then(() => held);
    return ready;
  }
}

const param = v => (v === undefined ? null : v instanceof Date ? v.toISOString() : v);

/**
 * node-postgres Pool look-alike over one PGlite instance. PGlite is a single
 * connection, so a checked-out client holds the lock until `release()`; every
 * other `query()` / `connect()` waits, keeping requests out of each other's
 * transactions.
 */
class PGliteAdapter {
  constructor(db) {
    this.db = db;
    this.lock = new Lock();
  }

  async run(text, params) {
    const res = await this.db.query(text, (params || []).map(param));
    return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length, fields: res.fields };
  }

  async query(text, params) {
    const release = await this.lock.acquire();
    try { return await this.run(text, params); } finally { release(); }
  }

  async connect() {
    const release = await this.lock.acquire();
    return { query: (text, params) => this.run(text, params), release };
  }

  async end() {
    const release = await this.lock.acquire();
    try { if (!this.db.closed) await this.db.close(); } finally { release(); }
  }
}

/** Applies each `*.sql` in filename order, once, each in its own transaction. Returns the newly applied filenames. */
async function migrate(db, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  await db.exec(`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz default now()
  )`);
  const done = new Set((await db.query('select filename from schema_migrations')).rows.map(r => r.filename));
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.transaction(async tx => {
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (filename) values ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

/**
 * Opens (creating if needed) the local store under `dataDir`. Returns the
 * PostgresStore, the migrations applied by this open, and whether the
 * directory already held a database (`existing`).
 *
 * @param {{ dataDir?: string, migrationsDir?: string }} [options]
 */
async function openLocalStore({ dataDir, migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!dataDir) throw new Error('openLocalStore requires a dataDir.');
  ensureDataDir(dataDir);
  const existing = fs.existsSync(path.join(dataDir, PGDATA));
  const db = await PGlite.create({ dataDir: path.join(dataDir, PGDATA), extensions: { ltree, pgcrypto } });
  let applied;
  try {
    applied = await migrate(db, migrationsDir);
  } catch (err) {
    await db.close();
    throw err;
  }
  const adapter = new PGliteAdapter(db);
  return { store: new PostgresStore(adapter, { pool: adapter }), applied, existing };
}

/** Totals only (no names or keys): `{ files, nodes, firstCreated }`, nodes not counting deleted ones. */
async function summarizeLocalData(pool) {
  const { rows } = await pool.query(`select
    (select count(*) from public.file)::int as files,
    (select count(*) from public.node where deleted_at is null)::int as nodes,
    (select min(created_at) from public.file) as first_created`);
  const row = rows[0] || {};
  return { files: row.files || 0, nodes: row.nodes || 0, firstCreated: row.first_created ? new Date(row.first_created) : null };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The startup line for a local store that already held data. */
function existingDataNotice(dataDir, { files, nodes, firstCreated }) {
  const created = firstCreated ? `, first created ${firstCreated.toISOString().slice(0, 10)}` : '';
  return `Using existing data in ${dataDir}: ${plural(files, 'file')}, ${plural(nodes, 'node')}${created}. ` +
    `To start fresh: docker compose down -v (Docker), or stop the API and remove ${dataDir}.`;
}

module.exports = { openLocalStore, summarizeLocalData, existingDataNotice, migrate, PGliteAdapter, DEFAULT_MIGRATIONS_DIR };
