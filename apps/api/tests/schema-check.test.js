'use strict';

/*
 * Postgres-mode schema check (src/schemaCheck.js) against PGlite, which runs
 * the same migration SQL: probes per migration prefix, the startup refusal,
 * RDS_AUTO_MIGRATE, the advisory lock and the RDS_SCHEMA_CHECK=off escape hatch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { ltree } = require('@electric-sql/pglite/contrib/ltree');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { PGliteAdapter, DEFAULT_MIGRATIONS_DIR } = require('../src/store/pglite');
const { loadConfig } = require('../src/config');
const { checkSchema, missingMigrations, migrationFiles, PROBES, MIGRATIONS_DIR } = require('../src/schemaCheck');

const FILES = migrationFiles();
const PROBE_SQL = new Set(Object.values(PROBES));
const sqlOf = file => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
const NODE_TABLE = FILES.findIndex(f => f.endsWith('_node_sync_v2_node_table.sql'));
const ON = { schemaCheck: true, autoMigrate: false };
const AUTO = { schemaCheck: true, autoMigrate: true };

async function openDb(t) {
  const db = await PGlite.create({ extensions: { ltree, pgcrypto } });
  t.after(() => db.close());
  return db;
}

/**
 * pg Pool look-alike over one PGlite instance (a checked-out client holds it
 * until release, like PGliteAdapter); parameterless queries run as simple
 * queries so a whole migration file goes through. `statements` records every
 * query, per pool.
 */
function poolOf(db) {
  const adapter = new PGliteAdapter(db);
  const statements = [];
  const run = async text => {
    statements.push(text);
    const results = await db.exec(text);
    return { rows: results.length ? results[results.length - 1].rows : [] };
  };
  return {
    statements,
    query: async text => {
      const release = await adapter.lock.acquire();
      try { return await run(text); } finally { release(); }
    },
    connect: async () => ({ query: run, release: await adapter.lock.acquire() }),
  };
}

/** A dirty tombstone that was never built: the state the auto-resolve migration repairs. */
const seedNeverBuiltTombstone = db => db.query(
  "insert into public.node (file_key, node_id, node_type, content_hash, dirty, deleted_at) values ('AbCdEf123456', '9:9', 'FRAME', 'h1', true, now())",
);

/** Applies FILES[0..count) directly, seeding a never-built tombstone once `node` exists. */
async function applyPrefix(db, count) {
  for (let i = 0; i < count; i++) {
    await db.exec(sqlOf(FILES[i]));
    if (i === NODE_TABLE) await seedNeverBuiltTombstone(db);
  }
}

const recorder = () => {
  const lines = [];
  return { lines, info: msg => lines.push(['info', msg]), warn: msg => lines.push(['warn', msg]) };
};

test('every migration file has a probe, and every probe names a migration file', () => {
  assert.equal(MIGRATIONS_DIR, DEFAULT_MIGRATIONS_DIR);
  assert.ok(FILES.length >= 10);
  for (const file of FILES) assert.ok(PROBES[file], `${file} has no probe in src/schemaCheck.js`);
  assert.deepEqual(Object.keys(PROBES).sort(), FILES);
  for (const probe of PROBE_SQL) assert.match(probe, /^select .* as ok$/s);
});

test('probes report exactly the migrations not yet applied, one prefix at a time', async t => {
  const db = await openDb(t);
  const pool = poolOf(db);
  for (let i = 0; i <= FILES.length; i++) {
    assert.deepEqual(await missingMigrations(pool), FILES.slice(i), `after applying ${i} file(s)`);
    if (i < FILES.length) await db.exec(sqlOf(FILES[i]));
    if (i === NODE_TABLE) await seedNeverBuiltTombstone(db);
  }
  assert.ok(pool.statements.every(s => PROBE_SQL.has(s)));
});

test('a database migrated with psql-style application of every file passes all probes', async t => {
  const db = await openDb(t);
  await applyPrefix(db, FILES.length);
  assert.deepEqual(await missingMigrations(poolOf(db)), []);
});

test('startup refuses with the missing files in order, the psql loop and the docs pointer', async t => {
  const db = await openDb(t);
  await applyPrefix(db, FILES.length - 3);
  const pool = poolOf(db);
  const missing = FILES.slice(-3);
  await assert.rejects(checkSchema(pool, ON, { log: recorder() }), err => {
    const at = missing.map(f => err.message.indexOf(`  ${f}\n`));
    assert.ok(at.every(i => i > 0), err.message);
    assert.deepEqual(at, [...at].sort((a, b) => a - b));
    assert.ok(err.message.includes(`for f in ${missing.map(f => `supabase/migrations/${f}`).join(' ')}; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done`), err.message);
    assert.match(err.message, /RDS_AUTO_MIGRATE=true/);
    assert.match(err.message, /docs\/setup\.md/);
    assert.ok(!FILES.slice(0, -3).some(f => err.message.includes(f)));
    return true;
  });
  assert.ok(pool.statements.every(s => PROBE_SQL.has(s)), 'only probes ran');
  assert.deepEqual(await missingMigrations(pool), missing, 'nothing was applied');
});

test('RDS_AUTO_MIGRATE applies only the missing migrations, in order, and logs each file', async t => {
  const db = await openDb(t);
  await applyPrefix(db, FILES.length - 3);
  const pool = poolOf(db);
  const log = recorder();
  const missing = FILES.slice(-3);
  assert.deepEqual(await checkSchema(pool, AUTO, { log }), missing);
  const migrationsRun = pool.statements.filter(s => FILES.some(f => s === sqlOf(f)));
  assert.deepEqual(migrationsRun, missing.map(sqlOf));
  assert.deepEqual(log.lines, [...missing.map(f => ['info', `Applying migration ${f}`]), ['info', 'Schema check: applied 3 migration(s).']]);
  assert.ok(pool.statements.some(s => /pg_advisory_lock/.test(s)));
  assert.ok(pool.statements.some(s => /pg_advisory_unlock/.test(s)));
  assert.deepEqual(await missingMigrations(pool), []);
  assert.equal((await db.query("select count(*)::int as n from public.node where deleted_at is not null and implemented_hash is null and dirty")).rows[0].n, 0);
});

test('an up-to-date database is left untouched: only the probes run', async t => {
  const db = await openDb(t);
  await applyPrefix(db, FILES.length);
  for (const config of [ON, AUTO]) {
    const pool = poolOf(db);
    const log = recorder();
    assert.deepEqual(await checkSchema(pool, config, { log }), []);
    assert.equal(pool.statements.length, FILES.length);
    assert.ok(pool.statements.every(s => PROBE_SQL.has(s)), 'no statement other than the probes');
    assert.deepEqual(log.lines, []);
  }
});

test('a fresh empty database is bootstrapped by applying every file', async t => {
  const db = await openDb(t);
  const pool = poolOf(db);
  assert.deepEqual(await missingMigrations(pool), FILES);
  assert.deepEqual(await checkSchema(pool, AUTO, { log: recorder() }), FILES);
  assert.deepEqual(await missingMigrations(pool), []);
  assert.equal((await db.query('select count(*)::int as n from public.node_note')).rows[0].n, 0);
});

test('the advisory lock lets one of two concurrent runners apply; the other finds nothing to do', async t => {
  const db = await openDb(t);
  const pool = poolOf(db);
  const results = await Promise.all([checkSchema(pool, AUTO, { log: recorder() }), checkSchema(pool, AUTO, { log: recorder() })]);
  assert.deepEqual(results.map(r => r.length).sort((a, b) => a - b), [0, FILES.length]);
  for (const file of FILES) assert.equal(pool.statements.filter(s => s === sqlOf(file)).length, 1, `${file} applied once`);
  assert.equal(pool.statements.filter(s => /pg_advisory_lock/.test(s)).length, 2);
  assert.deepEqual(await missingMigrations(pool), []);
});

test('a failing migration rolls back, names the file and keeps the database as it was', async t => {
  const db = await openDb(t);
  const at = FILES.indexOf('20261020000000_api_v3_check_targets.sql');
  await applyPrefix(db, at);
  const pool = poolOf(db);
  const last = FILES[at];
  // The probe still fails (no new columns or tables) and re-adding the attachment kind check fails on the bogus row.
  await db.exec(`alter table public.attachment drop constraint attachment_kind_check;
    insert into public.attachment (file_key, owner_kind, owner_id, kind, content_type, size, width, height, sha256, blob_key, created_by)
    values ('f', 'note', 'n', 'bogus', 'image/png', 1, 1, 1, 'x', 'k', 't')`);
  await assert.rejects(checkSchema(pool, AUTO, { log: recorder() }), new RegExp(`Migration ${last} failed`));
  assert.ok(pool.statements.includes('rollback'));
  assert.deepEqual(await missingMigrations(pool), FILES.slice(at));
});

test('RDS_SCHEMA_CHECK=off warns and starts without running a statement', async t => {
  const db = await openDb(t);
  const pool = poolOf(db);
  const log = recorder();
  assert.deepEqual(await checkSchema(pool, { schemaCheck: false, autoMigrate: false }, { log }), []);
  assert.equal(pool.statements.length, 0);
  assert.equal(log.lines.length, 1);
  assert.equal(log.lines[0][0], 'warn');
  assert.match(log.lines[0][1], /RDS_SCHEMA_CHECK=off/);
  assert.match(log.lines[0][1], /[Nn]ot recommended/);
});

test('config: RDS_AUTO_MIGRATE and RDS_SCHEMA_CHECK', () => {
  const base = { DATABASE_URL: 'postgres://u@db.example.com/rds' };
  assert.deepEqual((({ schemaCheck, autoMigrate }) => ({ schemaCheck, autoMigrate }))(loadConfig(base)), { schemaCheck: true, autoMigrate: false });
  assert.equal(loadConfig({ ...base, RDS_AUTO_MIGRATE: 'true' }).autoMigrate, true);
  assert.equal(loadConfig({ ...base, RDS_AUTO_MIGRATE: 'false' }).autoMigrate, false);
  assert.equal(loadConfig({ ...base, RDS_AUTO_MIGRATE: 'yes' }).autoMigrate, false);
  assert.equal(loadConfig({ ...base, RDS_SCHEMA_CHECK: 'off' }).schemaCheck, false);
  assert.equal(loadConfig({ ...base, RDS_SCHEMA_CHECK: 'on' }).schemaCheck, true);
});
