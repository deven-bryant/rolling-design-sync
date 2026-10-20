'use strict';

/*
 * Postgres-mode schema check (docs/setup.md, "Apply the migrations"). Each file
 * in supabase/migrations/ has a read-only probe that is true when the file's
 * effect is present. Startup runs every probe; with RDS_AUTO_MIGRATE=true it
 * applies only the files whose probe fails, under an advisory lock. The local
 * (PGlite) store keeps its own schema_migrations tracking (store/pglite.js).
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');
const SETUP_DOC = 'docs/setup.md, "Apply the migrations"';
/** Session advisory lock key held while migrations are applied. */
const LOCK_KEY = '7228519940127351014';
/** A probe that reads a table which isn't there yet: the migration is missing. */
const MISSING_OBJECT = new Set(['42P01', '42703']);

const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const table = name => `to_regclass(${lit(`public.${name}`)}) is not null`;
const column = (tbl, col) => `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = ${lit(tbl)} and column_name = ${lit(col)})`;
const constraint = (tbl, name, like) => `exists (select 1 from pg_constraint where conrelid = to_regclass(${lit(`public.${tbl}`)}) and conname = ${lit(name)}${like ? ` and pg_get_constraintdef(oid) like ${lit(like)}` : ''})`;
const all = (...parts) => `select (${parts.join(' and ')}) as ok`;

/**
 * Migration filename → read-only probe (`select … as ok`, true once its effect
 * is present). Every new migration file needs one (tests/schema-check.test.js).
 * @type {Readonly<Record<string, string>>}
 */
const PROBES = Object.freeze({
  '20260911050000_init_change_sync_schema.sql': all(
    `to_regprocedure('public.set_updated_at()') is not null`,
    table('tracked_scope'), table('snapshot'), table('changeset'), table('checklist_item'), table('verification'),
    constraint('tracked_scope', 'tracked_scope_latest_snapshot_id_fkey'),
  ),
  '20260911220000_node_sync_v2_node_table.sql': all(table('node'), `exists (select 1 from pg_extension where extname = 'ltree')`),
  '20260912160000_node_sync_v2_instance_placements.sql': all(column('node', 'is_instance'), column('node', 'main_component_id')),
  '20260912180000_node_sync_v2_capture_version.sql': all(column('node', 'capture_version')),
  '20260929180000_api_v3_change_model.sql': all(
    column('node', 'implemented_attrs'), column('node', 'blocked_reason'),
    table('claim'), table('sync_event'), table('file'),
    constraint('node', 'node_claim_id_fkey'),
  ),
  '20260930000000_api_v3_events.sql': all(table('event')),
  '20260930120000_api_v3_document_order.sql': all(
    column('node', 'order_key'), table('node_file_key_parent_id_idx'),
    `exists (select 1 from pg_trigger where tgrelid = to_regclass('public.node') and tgname = 'node_set_updated_at' and pg_get_triggerdef(oid) like '%order_key%')`,
  ),
  '20261012000000_api_v3_auto_resolve_never_built.sql': 'select not exists (select 1 from public.node where deleted_at is not null and implemented_hash is null and dirty) as ok',
  '20261013000000_api_v3_library_components.sql': all(column('node', 'library'), column('file', 'settings'), table('library_component')),
  '20261014000000_api_v3_node_notes.sql': all(table('node_note'), constraint('node', 'node_change_type_check', '%requested%')),
  '20261017000000_api_v3_render_checks.sql': all(
    table('blob'), table('attachment'), table('screen'), table('render_check'), column('node_note', 'source'),
  ),
  '20261020000000_api_v3_check_targets.sql': all(
    column('screen', 'level'), column('screen', 'source'), column('screen', 'family_key'), column('screen', 'gallery'),
    column('screen', 'mask_node_ids'), column('screen', 'node_map_id'), column('render_check', 'attribution'),
    table('scope_setting'), table('target_family'), constraint('attachment', 'attachment_kind_check', '%node_map%'),
  ),
});

/** The `*.sql` filenames in `dir`, in apply order. */
const migrationFiles = (dir = MIGRATIONS_DIR) => fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

/**
 * Runs every probe through `db` (a pg Pool or client); returns the files whose
 * probe fails, in filename order. A file without a probe throws.
 *
 * @param {{ query: Function }} db
 * @param {{ dir?: string, probes?: Readonly<Record<string, string>> }} [options]
 */
async function missingMigrations(db, { dir = MIGRATIONS_DIR, probes = PROBES } = {}) {
  const missing = [];
  for (const file of migrationFiles(dir)) {
    const probe = probes[file];
    if (!probe) throw new Error(`Migration ${file} has no schema probe (apps/api/src/schemaCheck.js).`);
    let ok;
    try {
      ok = (await db.query(probe)).rows[0]?.ok === true;
    } catch (err) {
      if (!MISSING_OBJECT.has(err && err.code)) throw err;
      ok = false;
    }
    if (!ok) missing.push(file);
  }
  return missing;
}

/** The startup refusal for `missing` (filenames in apply order). */
function missingMessage(missing) {
  const list = missing.map(f => `  ${f}`).join('\n');
  const files = missing.map(f => `supabase/migrations/${f}`).join(' ');
  return [
    `Database schema is missing ${missing.length} migration(s); refusing to start. Apply, in this order:`,
    list,
    'From the repository root:',
    `  for f in ${files}; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done`,
    `Or set RDS_AUTO_MIGRATE=true to apply them at startup. See ${SETUP_DOC}.`,
  ].join('\n');
}

/**
 * Applies the files whose probe fails, in filename order, each in its own
 * transaction, while holding a session advisory lock (other instances wait,
 * then find nothing to apply). Returns the applied filenames.
 *
 * @param {{ connect: Function }} pool
 * @param {{ dir?: string, probes?: Readonly<Record<string, string>>, log: { info: Function } }} options
 */
async function applyMissing(pool, { dir = MIGRATIONS_DIR, probes = PROBES, log }) {
  const client = await pool.connect();
  try {
    await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
    try {
      const missing = await missingMigrations(client, { dir, probes });
      for (const file of missing) {
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        log.info(`Applying migration ${file}`);
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('commit');
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw new Error(`Migration ${file} failed: ${err.message}`);
        }
      }
      const still = await missingMigrations(client, { dir, probes });
      if (still.length) throw new Error(`Applied ${missing.length} migration(s), but the schema check still fails.\n${missingMessage(still)}`);
      return missing;
    } finally {
      await client.query(`select pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
    }
  } finally {
    client.release();
  }
}

/**
 * Postgres-mode startup check. `config.schemaCheck` false: warn and skip.
 * All probes pass: nothing else runs. Otherwise throws the refusal, or with
 * `config.autoMigrate` applies the missing files. Returns the applied files.
 *
 * @param {{ query: Function, connect: Function }} pool
 * @param {{ schemaCheck: boolean, autoMigrate: boolean }} config
 * @param {{ dir?: string, probes?: Readonly<Record<string, string>>, log?: { info: Function, warn: Function } }} [options]
 */
async function checkSchema(pool, config, { dir = MIGRATIONS_DIR, probes = PROBES, log = console } = {}) {
  if (!config.schemaCheck) {
    log.warn('WARNING: RDS_SCHEMA_CHECK=off — the database schema is not checked. Missing migrations will surface as 500 errors. Not recommended.');
    return [];
  }
  const missing = await missingMigrations(pool, { dir, probes });
  if (!missing.length) return [];
  if (!config.autoMigrate) throw new Error(missingMessage(missing));
  const applied = await applyMissing(pool, { dir, probes, log });
  log.info(`Schema check: applied ${applied.length} migration(s).`);
  return applied;
}

module.exports = { checkSchema, missingMigrations, applyMissing, missingMessage, migrationFiles, PROBES, MIGRATIONS_DIR, LOCK_KEY };
