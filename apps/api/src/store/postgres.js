'use strict';

/*
 * node-postgres data layer over the schema in supabase/migrations. Same
 * interface as store/memory.js. `transaction(fn)` hands `fn` a store bound to a
 * single client inside BEGIN/COMMIT.
 */
const { Pool } = require('pg');
const { pathNodeIds } = require('../ltree');
const { removedUses, removedWarnings, REMOVED_K } = require('./removed');

const iso = v => (v instanceof Date ? v.toISOString() : v ?? null);

const mapNode = r => r && ({
  fileKey: r.file_key, nodeId: r.node_id, nodeType: r.node_type, name: r.name, parentId: r.parent_id,
  path: r.path, attrs: r.attrs, isInstance: !!r.is_instance, mainComponentId: r.main_component_id ?? null,
  contentHash: r.content_hash, captureVersion: r.capture_version ?? 1, implementedHash: r.implemented_hash, dirty: r.dirty,
  implementedCommit: r.implemented_commit, implementedAt: iso(r.implemented_at), claimedBy: r.claimed_by,
  claimExpiresAt: iso(r.claim_expires_at), deletedAt: iso(r.deleted_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  implementedAttrs: r.implemented_attrs ?? null, changeType: r.change_type ?? null, changedProps: r.changed_props ?? [],
  changeCategories: r.change_categories ?? [], claimId: r.claim_id ?? null, blockedAt: iso(r.blocked_at),
  blockedBy: r.blocked_by ?? null, blockedReason: r.blocked_reason ?? null, orderKey: r.order_key ?? null, library: !!r.library,
});
const mapFile = r => r && ({ fileKey: r.file_key, name: r.name, lastSyncAt: iso(r.last_sync_at), createdAt: iso(r.created_at), settings: r.settings ?? {} });
const mapLibraryComponent = r => r && ({
  componentKey: r.component_key, fileKey: r.file_key ?? null, nodeId: r.node_id ?? null, name: r.name ?? null, resolvedAt: iso(r.resolved_at), error: r.error ?? null,
});
const mapEvent = r => r && ({
  id: Number(r.id), fileKey: r.file_key, type: r.type, actor: r.actor ?? null, data: r.data ?? {}, createdAt: iso(r.created_at),
});
/** Mirrors CLAIM_PREVIEW_NODES in store/memory.js. */
const CLAIM_PREVIEW_NODES = 3;
const mapSyncEvent = r => r && ({ id: r.id, fileKey: r.file_key, rootNodeId: r.root_node_id, counts: r.counts, createdAt: iso(r.created_at) });

const JSON_COLUMNS = new Set(['implemented_attrs']);
const NULLABLE_JSON_COLUMNS = new Set(['implemented_attrs']);
const TEXT_ARRAY_COLUMNS = new Set(['changed_props', 'change_categories']);
const NODE_COLUMNS = {
  nodeType: 'node_type', name: 'name', parentId: 'parent_id', path: 'path', attrs: 'attrs', isInstance: 'is_instance',
  mainComponentId: 'main_component_id', contentHash: 'content_hash', captureVersion: 'capture_version',
  implementedHash: 'implemented_hash', dirty: 'dirty', implementedCommit: 'implemented_commit', implementedAt: 'implemented_at',
  claimedBy: 'claimed_by', claimExpiresAt: 'claim_expires_at', deletedAt: 'deleted_at',
  implementedAttrs: 'implemented_attrs', changeType: 'change_type', changedProps: 'changed_props', changeCategories: 'change_categories',
  claimId: 'claim_id', blockedAt: 'blocked_at', blockedBy: 'blocked_by', blockedReason: 'blocked_reason', library: 'library',
};
const LTREE_COLUMNS = new Set(['path']);

const json = v => JSON.stringify(v ?? null);

const cast = col => (JSON_COLUMNS.has(col) ? '::jsonb' : LTREE_COLUMNS.has(col) ? '::ltree' : TEXT_ARRAY_COLUMNS.has(col) ? '::text[]' : '');

const columnValue = (col, v) => {
  if (!JSON_COLUMNS.has(col)) return v;
  return NULLABLE_JSON_COLUMNS.has(col) && (v === null || v === undefined) ? null : json(v);
};

function setClause(patch, columns, startAt = 1) {
  const sets = [], values = [];
  for (const [k, col] of Object.entries(columns)) {
    if (!(k in patch)) continue;
    values.push(columnValue(col, patch[k]));
    sets.push(`${col} = $${startAt + values.length - 1}${cast(col)}`);
  }
  return { sets, values };
}

// --- v3 read helpers (docs/api-v3-design.md) --------------------------------
/** Node states as SQL over alias `a`: blocked wins, then dirty, else clean; a cleared tombstone is in none. */
const v3StateSql = a => ({
  dirty: `(${a}.dirty and ${a}.blocked_at is null)`,
  clean: `(not ${a}.dirty and ${a}.blocked_at is null and ${a}.deleted_at is null)`,
  blocked: `(${a}.blocked_at is not null)`,
});
const v3VisibleSql = a => `(${a}.dirty or ${a}.blocked_at is not null or ${a}.deleted_at is null)`;
const v3CountsSql = a => {
  const s = v3StateSql(a);
  return `json_build_object('total', count(*) filter (where ${v3VisibleSql(a)}), 'dirty', count(*) filter (where ${s.dirty}), 'blocked', count(*) filter (where ${s.blocked}))`;
};
/** The file's trackLibraryComponents setting (alias `f` of `file`) as SQL; true when absent. */
const trackingSql = f => `coalesce((${f}.settings ->> 'trackLibraryComponents')::boolean, true)`;
/** Mirrors documentSortKey (src/documentOrder.js) over alias `a`: root path, ' ', order key (no key: path, ' '). */
const documentSortSql = a => `coalesce(case when ${a}.order_key is null then ${a}.path::text || ' '
  else coalesce(subpath(${a}.path, 0, greatest(1, nlevel(${a}.path) - nlevel(${a}.order_key::ltree) + 1))::text, '') || ' ' || ${a}.order_key end, '')`;
const V3_SORT_SQL = {
  document: `${documentSortSql('n')} collate "C"`,
  path: 'n.path::text collate "C"',
  name: `coalesce(n.name, '') collate "C"`,
  updatedAt: `to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') collate "C"`,
};
const likeEscape = s => String(s).replace(/[\\%_]/g, '\\$&');
const globToLike = g => String(g).split('').map(c => (c === '*' ? '%' : c === '?' ? '_' : likeEscape(c))).join('');

/** WHERE clause (alias `n`) for a v3 listing filter; pushes its parameters onto `params`. */
function v3Where(fileKey, f, params) {
  const p = v => { params.push(v); return `$${params.length}`; };
  const fk = p(fileKey);
  const where = [`n.file_key = ${fk}`];
  const states = v3StateSql('n');
  where.push(`(${f.states.map(s => states[s]).join(' or ')})`);
  if (f.regions) {
    if (f.regions[0] !== null) where.push(`n.path <@ any(${p(f.regions)}::text[]::ltree[])`);
  } else if (f.under && f.under.length === 1) {
    const under = p(f.under[0]);
    where.push(`n.path <@ (select u.path from node u where u.file_key = ${fk} and u.node_id = ${under})`);
    if (f.depth !== null && f.depth !== undefined) {
      where.push(`nlevel(n.path) <= (select nlevel(u.path) from node u where u.file_key = ${fk} and u.node_id = ${under}) + ${p(f.depth)}::int`);
    }
  } else if (f.under && f.under.length) {
    const ids = p(f.under);
    where.push(`n.path <@ any(array(select u.path from node u where u.file_key = ${fk} and u.node_id = any(${ids}::text[])))`);
    if (f.depth !== null && f.depth !== undefined) {
      where.push(`exists (select 1 from node u where u.file_key = ${fk} and u.node_id = any(${ids}::text[]) and n.path <@ u.path and nlevel(n.path) <= nlevel(u.path) + ${p(f.depth)}::int)`);
    }
  }
  if (f.library === 'exclude') where.push('not n.library');
  else if (f.library === 'only') where.push('n.library');
  if (f.types.length) where.push(`n.node_type = any(${p(f.types)}::text[])`);
  if (f.changeTypes.length) where.push(`n.change_type = any(${p(f.changeTypes)}::text[])`);
  if (f.categories.length) where.push(`n.change_categories && ${p(f.categories)}::text[]`);
  if (f.changedExact.length || f.changedPrefixes.length) {
    const any = [];
    if (f.changedExact.length) any.push(`n.changed_props && ${p(f.changedExact)}::text[]`);
    if (f.changedPrefixes.length) {
      any.push(`exists (select 1 from unnest(n.changed_props) cp where cp like any(${p(f.changedPrefixes.map(x => likeEscape(x) + '%'))}::text[]))`);
    }
    where.push(`(${any.join(' or ')})`);
  }
  if (f.components.length) {
    const ids = p(f.components);
    where.push(`(n.main_component_id = any(${ids}::text[]) or n.node_id = any(${ids}::text[]))`);
  }
  if (typeof f.instance === 'boolean') where.push(`n.is_instance = ${p(f.instance)}::boolean`);
  if (f.names.length) where.push(`n.name ilike any(${p(f.names.map(globToLike))}::text[])`);
  if (f.since) where.push(`n.updated_at >= ${p(f.since)}::timestamptz`);
  if (f.claimed.length) {
    const active = `(n.claimed_by is not null and n.claim_expires_at > ${p(f.now)}::timestamptz)`;
    const any = f.claimed.map(c => (c === 'true' ? active : c === 'false' ? `not ${active}` : `(${active} and n.claimed_by = ${p(f.worker)})`));
    where.push(`(${any.join(' or ')})`);
  }
  return where.join(' and ');
}

/** A node's change type as SQL (alias `n`), derived like the v3 representation; null unless dirty. */
const V3_CHANGE_TYPE_SQL = `(case when not n.dirty then null when n.change_type is not null then n.change_type
  when n.deleted_at is not null then 'deleted' when n.implemented_hash is null then 'added' else 'modified' end)`;
/** `nlevel` of the `under` node's path as a scalar subquery; pushes its parameter (`$1` is the file key). */
const v3UnderLevelSql = (under, params) => { params.push(under); return `(select nlevel(u.path) from node u where u.file_key = $1 and u.node_id = $${params.length})`; };
const lastNodeId = path => pathNodeIds(path).pop() ?? null;
/**
 * The index in `f.regions` (0 = the scope, then each expanded component) of the
 * first region containing node `n`, as SQL; pushes its parameter.
 */
const v3RegionOrdSql = (f, params) => {
  if (f.regions[0] === null) return '0';
  params.push(f.regions);
  return `(select u.o::int - 1 from unnest($${params.length}::text[]::ltree[]) with ordinality u(root, o) where n.path <@ u.root order by u.o limit 1)`;
};
/**
 * The index in `f.under` (several roots) of the first root whose subtree (to
 * `f.depth`) contains node `n`, as SQL; pushes its parameters (`$1` is the file key).
 */
const v3RootOrdSql = (f, params) => {
  params.push(f.under);
  const ids = `$${params.length}`;
  let depth = '';
  if (f.depth !== null && f.depth !== undefined) { params.push(f.depth); depth = ` and nlevel(n.path) <= nlevel(r.path) + $${params.length}::int`; }
  return `(select u.o::int - 1 from unnest(${ids}::text[]) with ordinality u(id, o) join node r on r.file_key = $1 and r.node_id = u.id
    where n.path <@ r.path${depth} order by u.o limit 1)`;
};
/**
 * The removed root of a tombstone (alias `a`) as SQL: the topmost tombstone on
 * its path (its parent live or not stored), or null when `a` is live or that
 * root sits inside a live COMPONENT / COMPONENT_SET. Mirrors MemoryStore's removedRootOf.
 */
const removedRootSql = a => `(case when ${a}.deleted_at is null then null else (select r.root from (
    select subpath(${a}.path, 0, coalesce(max(l), 0) + 1) as root from generate_series(1, nlevel(${a}.path) - 1) l
    where not exists (select 1 from node t where t.file_key = ${a}.file_key and t.path = subpath(${a}.path, 0, l) and t.deleted_at is not null)) r
  where not exists (select 1 from node c where c.file_key = ${a}.file_key and c.path @> r.root and c.path <> r.root
    and c.deleted_at is null and c.node_type in ('COMPONENT', 'COMPONENT_SET'))) end)`;
/** Nodes inside the `under` subtree (alias `n`), as SQL; pushes its parameter. */
const v3InUnderSql = (under, params) => { params.push(under); return `n.path <@ (select u.path from node u where u.file_key = $1 and u.node_id = $${params.length})`; };

const mapNodeV3 = r => r && ({
  ...mapNode(r),
  claimLabel: r.claim_label ?? null,
  ...(r.expand_ord !== undefined ? { expandOrd: r.expand_ord } : {}),
  ...(r.descendants !== undefined && r.descendants !== null ? { descendants: r.descendants } : {}),
});
const V3_DESCENDANTS_SQL = `(select ${v3CountsSql('d')} from node d where d.file_key = n.file_key and d.path <@ n.path and d.node_id <> n.node_id) as descendants`;
const mapFileV3 = r => r && ({ ...mapFile(r), counts: r.counts });
const mapClaim = r => r && ({
  claimId: r.claim_id, fileKey: r.file_key, worker: r.worker, label: r.label ?? null,
  createdAt: iso(r.created_at), expiresAt: iso(r.expires_at),
});
const mapScopeV3 = r => r && ({
  nodeId: r.root_node_id, name: r.name ?? null, nodeType: r.node_type ?? null, deleted: !!r.deleted_at,
  lastSyncAt: iso(r.created_at), lastSyncCounts: r.last_counts || {}, counts: r.counts,
});

/** @typedef {import('./types').Store} Store */

/** @implements {Store} */
class PostgresStore {
  /**
   * @param {any} clientOrPool
   * @param {{ pool?: any }} [options]
   */
  constructor(clientOrPool, { pool } = {}) {
    this.db = clientOrPool;
    this.pool = pool || null;
  }

  static fromUrl(databaseUrl, options = {}) {
    const pool = new Pool({ connectionString: databaseUrl, max: options.max || 5, ssl: options.ssl });
    return new PostgresStore(pool, { pool });
  }

  async close() { if (this.pool) await this.pool.end(); }

  async query(text, params) { return this.db.query(text, params); }

  async transaction(fn) {
    if (!this.pool) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PostgresStore(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // --- node-sync ----------------------------------------------------------
  async getNode(fileKey, nodeId) {
    const { rows } = await this.query('select * from node where file_key = $1 and node_id = $2', [fileKey, nodeId]);
    return mapNode(rows[0]) || null;
  }

  /** Stored rows (tombstoned included) for `nodeIds` — one batched lookup; unknown ids are skipped. */
  async getNodes(fileKey, nodeIds) {
    if (!nodeIds.length) return [];
    const { rows } = await this.query(
      'select * from node where file_key = $1 and node_id = any($2::text[]) order by node_id', [fileKey, nodeIds]);
    return rows.map(mapNode);
  }

  /**
   * `dirty` is always derived server-side from the stored (auto-baseline) implemented_hash.
   * `baseline` (`{ implementedAt }`) only affects the insert branch: a never-seen node is
   * stored as already implemented (implemented_attrs = attrs); the conflict branch never
   * touches the implemented columns. `changeType` / `changedProps` / `changeCategories` are
   * stored as given; a content-hash change clears the block columns.
   * The result carries `baselined: true` when the row was inserted that way.
   *
   * @param {Parameters<Store['upsertNode']>[2]} [baseline]
   */
  async upsertNode(fileKey, row, baseline = null) {
    const { rows } = await this.query(
      `insert into node (file_key, node_id, node_type, name, parent_id, path, attrs, is_instance, main_component_id, content_hash, capture_version,
                         dirty, implemented_hash, implemented_commit, implemented_at, implemented_attrs,
                         change_type, changed_props, change_categories, library)
       values ($1, $2, $3, $4, $5, $6::ltree, $7::jsonb, $8, $9, $10, $11,
               not $12::boolean,
               case when $12::boolean then $10 end,
               case when $12::boolean then 'baseline' end,
               case when $12::boolean then $13::timestamptz end,
               case when $12::boolean then $7::jsonb end,
               $14, $15::text[], $16::text[], $17::boolean)
       on conflict (file_key, node_id) do update set
         node_type = excluded.node_type, name = excluded.name, parent_id = excluded.parent_id, path = excluded.path,
         attrs = excluded.attrs, is_instance = excluded.is_instance, main_component_id = excluded.main_component_id,
         content_hash = excluded.content_hash, capture_version = excluded.capture_version, deleted_at = null,
         dirty = excluded.content_hash is distinct from node.implemented_hash,
         change_type = excluded.change_type, changed_props = excluded.changed_props, change_categories = excluded.change_categories,
         library = node.library or excluded.library,
         blocked_at = case when node.content_hash is distinct from excluded.content_hash then null else node.blocked_at end,
         blocked_by = case when node.content_hash is distinct from excluded.content_hash then null else node.blocked_by end,
         blocked_reason = case when node.content_hash is distinct from excluded.content_hash then null else node.blocked_reason end
       returning *, (xmax = 0 and $12::boolean) as baselined`,
      [fileKey, row.nodeId, row.nodeType ?? null, row.name ?? null, row.parentId ?? null, row.path, json(row.attrs || {}),
        !!row.isInstance, row.mainComponentId ?? null, row.contentHash, row.captureVersion ?? 1,
        !!baseline, baseline ? baseline.implementedAt : null,
        row.changeType ?? null, row.changedProps || [], row.changeCategories || [], !!row.library]);
    return { ...mapNode(rows[0]), baselined: !!rows[0].baselined };
  }

  /** `[{ nodeId, captureVersion }]` for the present (non-tombstoned) ids — one batched lookup. */
  async nodeCaptureVersions(fileKey, nodeIds) {
    if (!nodeIds.length) return [];
    const { rows } = await this.query(
      `select node_id, capture_version from node where file_key = $1 and node_id = any($2::text[]) and deleted_at is null order by node_id`,
      [fileKey, nodeIds]);
    return rows.map(r => ({ nodeId: r.node_id, captureVersion: r.capture_version ?? 1 }));
  }

  /** Ids in `nodeIds` that are stored and not tombstoned — one batched lookup. */
  async nodesPresent(fileKey, nodeIds) {
    if (!nodeIds.length) return [];
    const { rows } = await this.query(
      `select node_id from node where file_key = $1 and node_id = any($2::text[]) and deleted_at is null order by node_id`,
      [fileKey, nodeIds]);
    return rows.map(r => r.node_id);
  }

  /**
   * Tombstones existing rows (last-known attrs kept); unknown ids are ignored.
   * A row never implemented (`implemented_hash` null) becomes a clean tombstone.
   */
  async tombstoneNodes(fileKey, nodeIds, deletedAt) {
    if (!nodeIds.length) return [];
    const { rows } = await this.query(
      `update node set deleted_at = $3, dirty = implemented_hash is not null
       where file_key = $1 and node_id = any($2::text[]) and deleted_at is null returning *`,
      [fileKey, nodeIds, deletedAt]);
    return rows.map(mapNode);
  }

  /**
   * @param {string} fileKey
   * @param {string} nodeId
   * @param {{ dirty?: boolean, includeDeleted?: boolean }} [options]
   */
  async listNodeSubtree(fileKey, nodeId, { dirty, includeDeleted = true } = {}) {
    let where = 'file_key = $1 and path <@ (select path from node where file_key = $1 and node_id = $2)';
    if (dirty !== undefined) where += dirty ? ' and dirty' : ' and not dirty';
    if (!includeDeleted) where += ' and deleted_at is null';
    const { rows } = await this.query(`select * from node where ${where} order by path, node_id`, [fileKey, nodeId]);
    return rows.map(mapNode);
  }

  /** Live (non-tombstoned) rows whose `parent_id` is in `parentIds` — one batched lookup. */
  async listChildren(fileKey, parentIds) {
    if (!parentIds.length) return [];
    const { rows } = await this.query(
      `select * from node where file_key = $1 and parent_id = any($2::text[]) and deleted_at is null order by node_id`,
      [fileKey, parentIds]);
    return rows.map(mapNode);
  }

  /**
   * Document order: sets each `{ nodeId, path, from, to }`'s `order_key` to
   * `to` and rewrites the `from.` prefix of its descendants' keys (tombstoned
   * included) — one statement. Moves must be disjoint subtrees. `updated_at`
   * is kept (see the node_set_updated_at trigger). Returns how many rows changed.
   */
  async rekeySubtrees(fileKey, moves) {
    if (!moves.length) return 0;
    const { rowCount } = await this.query(
      `update node n set order_key = case when n.node_id = m.node_id then m.to_key
                                          else m.to_key || substr(n.order_key, length(m.from_key) + 1) end
       from jsonb_to_recordset($2::jsonb) as m(node_id text, path text, from_key text, to_key text)
       where n.file_key = $1
         and ((n.node_id = m.node_id and n.order_key is distinct from m.to_key)
              or (m.from_key is not null and n.node_id <> m.node_id and n.path <@ m.path::ltree
                  and left(n.order_key, length(m.from_key) + 1) = m.from_key || '.'))`,
      [fileKey, json(moves.map(m => ({ node_id: m.nodeId, path: m.path ?? null, from_key: m.from ?? null, to_key: m.to })))]);
    return rowCount ?? 0;
  }

  async updateNode(fileKey, nodeId, patch) {
    const { sets, values } = setClause(patch, NODE_COLUMNS, 3);
    if (!sets.length) return this.getNode(fileKey, nodeId);
    const { rows } = await this.query(
      `update node set ${sets.join(', ')} where file_key = $1 and node_id = $2 returning *`, [fileKey, nodeId, ...values]);
    return mapNode(rows[0]) || null;
  }

  // --- startup maintenance (src/maintenance.js) --------------------------------
  /**
   * Up to `limit` rows (tombstoned included) with a `change_type` but no
   * `changed_props`, in `(file_key, node_id)` order after `after`
   * (`{ fileKey, nodeId }`, exclusive).
   *
   * @param {Parameters<Store['listChangeRepairCandidates']>[0]} options
   */
  async listChangeRepairCandidates({ after = null, limit }) {
    const { rows } = await this.query(
      `select * from node
       where change_type is not null and cardinality(changed_props) = 0
         and ($1::text is null or (file_key, node_id) > ($1::text, $2::text))
       order by file_key, node_id limit $3`,
      [after ? after.fileKey : null, after ? after.nodeId : null, limit]);
    return rows.map(mapNode);
  }

  /**
   * Writes the change columns of each `{ fileKey, nodeId, contentHash, from,
   * changeType, changedProps, changeCategories }` whose row still has
   * `content_hash = contentHash`, `change_type = from` and no `changed_props`
   * (one batched update). Returns how many rows were written.
   */
  async repairChangeColumns(items) {
    if (!items.length) return 0;
    const { rowCount } = await this.query(
      `update node n set change_type = i.change_type,
         changed_props = array(select jsonb_array_elements_text(i.changed_props)),
         change_categories = array(select jsonb_array_elements_text(i.change_categories))
       from jsonb_to_recordset($1::jsonb) as i(file_key text, node_id text, content_hash text, from_type text,
                                               change_type text, changed_props jsonb, change_categories jsonb)
       where n.file_key = i.file_key and n.node_id = i.node_id and n.content_hash = i.content_hash
         and n.change_type = i.from_type and cardinality(n.changed_props) = 0`,
      [json(items.map(i => ({
        file_key: i.fileKey, node_id: i.nodeId, content_hash: i.contentHash, from_type: i.from,
        change_type: i.changeType, changed_props: i.changedProps, change_categories: i.changeCategories,
      })))]);
    return rowCount ?? 0;
  }

  /**
   * Up to `limit` rows (tombstoned included) without an `order_key`, parents
   * before children: in `(file_key, depth, node_id)` order after `after`
   * (`{ fileKey, depth, nodeId }`, exclusive). Rows carry `depth`.
   *
   * @param {Parameters<Store['listOrderKeyCandidates']>[0]} options
   */
  async listOrderKeyCandidates({ after = null, limit }) {
    const { rows } = await this.query(
      `select *, coalesce(nlevel(path), 0) as depth from node
       where order_key is null
         and ($1::text is null or (file_key collate "C", coalesce(nlevel(path), 0), node_id collate "C") > ($1::text collate "C", $2::int, $3::text collate "C"))
       order by file_key collate "C", coalesce(nlevel(path), 0), node_id collate "C" limit $4`,
      [after ? after.fileKey : null, after ? after.depth : null, after ? after.nodeId : null, limit]);
    return rows.map(r => ({ ...mapNode(r), depth: Number(r.depth) }));
  }

  /** Sets `order_key` of each `{ fileKey, nodeId, orderKey }` whose row has none (one batched update). Returns how many rows were written. */
  async setOrderKeys(items) {
    if (!items.length) return 0;
    const { rowCount } = await this.query(
      `update node n set order_key = i.order_key
       from jsonb_to_recordset($1::jsonb) as i(file_key text, node_id text, order_key text)
       where n.file_key = i.file_key and n.node_id = i.node_id and n.order_key is null`,
      [json(items.map(i => ({ file_key: i.fileKey, node_id: i.nodeId, order_key: i.orderKey })))]);
    return rowCount ?? 0;
  }

  /** Upserts the file row; a `null` name keeps the stored one. */
  async upsertFile({ fileKey, name = null, lastSyncAt = null }) {
    const { rows } = await this.query(
      `insert into file (file_key, name, last_sync_at) values ($1, $2, coalesce($3::timestamptz, now()))
       on conflict (file_key) do update set name = coalesce(excluded.name, file.name), last_sync_at = excluded.last_sync_at
       returning *`, [fileKey, name ?? null, lastSyncAt ?? null]);
    return mapFile(rows[0]);
  }

  async recordSync({ fileKey, rootNodeId = null, counts = {}, createdAt = null }) {
    const { rows } = await this.query(
      `insert into sync_event (file_key, root_node_id, counts, created_at) values ($1, $2, $3::jsonb, coalesce($4::timestamptz, now()))
       returning *`, [fileKey, rootNodeId ?? null, json(counts || {}), createdAt ?? null]);
    return mapSyncEvent(rows[0]);
  }

  /**
   * Library nodes: marks every row in the subtree of each stored node in
   * `rootIds` (the root included) `library = true`. Returns the ids newly marked.
   */
  async markLibrarySubtrees(fileKey, rootIds) {
    if (!rootIds.length) return [];
    const { rows } = await this.query(
      `update node n set library = true
       where n.file_key = $1 and not n.library
         and n.path <@ any(array(select r.path from node r where r.file_key = $1 and r.node_id = any($2::text[])))
       returning n.node_id`, [fileKey, rootIds]);
    return rows.map(r => r.node_id);
  }

  /** Merges `settings` into the file's settings; null for an unknown file. */
  async updateFileSettings(fileKey, settings) {
    const { rows } = await this.query(
      'update file set settings = settings || $2::jsonb where file_key = $1 returning *', [fileKey, json(settings)]);
    return mapFile(rows[0]) || null;
  }

  /** Cached library component resolutions for `keys`; unknown keys are skipped. */
  async getLibraryComponents(keys) {
    if (!keys.length) return [];
    const { rows } = await this.query('select * from library_component where component_key = any($1::text[]) order by component_key', [keys]);
    return rows.map(mapLibraryComponent);
  }

  /** Inserts or replaces the cached resolution of one library component key. */
  async upsertLibraryComponent({ componentKey, fileKey = null, nodeId = null, name = null, resolvedAt, error = null }) {
    const { rows } = await this.query(
      `insert into library_component (component_key, file_key, node_id, name, resolved_at, error) values ($1, $2, $3, $4, $5, $6)
       on conflict (component_key) do update set file_key = excluded.file_key, node_id = excluded.node_id, name = excluded.name,
         resolved_at = excluded.resolved_at, error = excluded.error
       returning *`, [componentKey, fileKey, nodeId, name, resolvedAt, error]);
    return mapLibraryComponent(rows[0]);
  }

  /**
   * Per main component id: its live instance rows file-wide (`placements`)
   * and, with `regions` (ltree paths; a null entry is the whole file), those
   * inside any region (`placementsInScope`, else null).
   */
  /**
   * @param {string} fileKey
   * @param {string[]} mainIds
   * @param {(string | null)[] | null} [regions]
   */
  async placementCounts(fileKey, mainIds, regions = null) {
    if (!mainIds.length) return [];
    const scoped = regions === null ? 'null::int' : regions.includes(null)
      ? 'count(i.node_id)::int' : 'count(i.node_id) filter (where i.path <@ any($3::text[]::ltree[]))::int';
    const { rows } = await this.query(
      `select m.id, count(i.node_id)::int as placements, ${scoped} as in_scope
       from unnest($2::text[]) m(id)
         left join node i on i.file_key = $1 and i.main_component_id = m.id and i.deleted_at is null
       group by m.id order by m.id`, regions === null || regions.includes(null) ? [fileKey, mainIds] : [fileKey, mainIds, regions]);
    return rows.map(r => ({ mainComponentId: r.id, placements: r.placements, placementsInScope: r.in_scope ?? null }));
  }

  // --- v3 reads -------------------------------------------------------------
  /**
   * One page of a file's nodes matching a v3 filter (`filter.states` already
   * expanded), filtered and ordered in SQL. `page.after` is the previous
   * page's `{ k, id }`; the result carries `next` (or `null`) and `total`.
   */
  async listNodes(fileKey, filter, page) {
    const params = [];
    const where = v3Where(fileKey, filter, params);
    const { rows: [{ total }] } = await this.query(`select count(*)::int as total from node n where ${where}`, params);
    const listParams = params.slice();
    const ord = filter.regions ? v3RegionOrdSql(filter, listParams) : filter.under && filter.under.length > 1 ? v3RootOrdSql(filter, listParams) : null;
    const tree = { path: 'n.path::text', document: documentSortSql('n') }[page.sort];
    const key = ord && tree ? `(lpad((${ord})::text, 4, '0') || ' ' || ${tree}) collate "C"` : V3_SORT_SQL[page.sort];
    const dir = page.desc ? 'desc' : 'asc';
    const cmp = page.desc ? '<' : '>';
    let after = '';
    if (page.after) {
      listParams.push(page.after.k, page.after.id);
      const k = `$${listParams.length - 1}`, id = `$${listParams.length}`;
      after = ` and (${key} ${cmp} ${k} or (${key} = ${k} and n.node_id collate "C" ${cmp} ${id}))`;
    }
    listParams.push(page.limit + 1);
    const { rows } = await this.query(
      `select n.*, c.label as claim_label, ${key} as sort_key${filter.regions ? `, ${ord} as expand_ord` : ''}${page.counts ? `, ${V3_DESCENDANTS_SQL}` : ''}
       from node n left join claim c on c.claim_id = n.claim_id
       where ${where}${after}
       order by ${key} ${dir}, n.node_id collate "C" ${dir}
       limit $${listParams.length}`, listParams);
    const more = rows.length > page.limit;
    const pageRows = more ? rows.slice(0, page.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return { nodes: pageRows.map(mapNodeV3), total, next: more ? { k: last.sort_key, id: last.node_id } : null };
  }

  /** One node (tombstoned included) with its claim label; `counts` adds `descendants`. */
  async getNodeV3(fileKey, nodeId, { counts = false } = {}) {
    const { rows } = await this.query(
      `select n.*, c.label as claim_label${counts ? `, ${V3_DESCENDANTS_SQL}` : ''}
       from node n left join claim c on c.claim_id = n.claim_id
       where n.file_key = $1 and n.node_id = $2`, [fileKey, nodeId]);
    return mapNodeV3(rows[0]) || null;
  }

  // --- v3 insights ------------------------------------------------------------
  /**
   * Counts of the nodes matching a v3 filter, aggregated in SQL. `byFrame`
   * (only with `filter.under`) groups by the ancestor one level below `under`.
   */
  async summarizeNodes(fileKey, filter) {
    const params = [];
    const where = v3Where(fileKey, filter, params);
    const s = v3StateSql('n');
    const ct = V3_CHANGE_TYPE_SQL;
    const { rows: [t] } = await this.query(
      `select count(*)::int as total,
         count(*) filter (where ${s.dirty})::int as dirty, count(*) filter (where ${s.clean})::int as clean,
         count(*) filter (where ${s.blocked})::int as blocked,
         count(*) filter (where ${ct} = 'added')::int as added, count(*) filter (where ${ct} = 'modified')::int as modified,
         count(*) filter (where ${ct} = 'deleted')::int as deleted
       from node n where ${where}`, params);
    const { rows: categories } = await this.query(
      `select c as key, count(*)::int as count from node n cross join unnest(n.change_categories) c where ${where} group by c`, params);
    const { rows: types } = await this.query(
      `select n.node_type as key, count(*)::int as count from node n where ${where} and n.node_type is not null group by n.node_type`, params);
    let byFrame = null;
    if (filter.under && filter.under.length === 1) {
      const frameParams = params.slice();
      const level = v3UnderLevelSql(filter.under[0], frameParams);
      const inUnder = filter.regions ? ` and ${v3InUnderSql(filter.under[0], frameParams)}` : '';
      const { rows } = await this.query(
        `select g.frame_path::text as frame_path, g.count, f.name
         from (select subpath(n.path, 0, ${level} + 1) as frame_path, count(*)::int as count
               from node n where ${where}${inUnder} and nlevel(n.path) > ${level} group by 1) g
         left join lateral (select f.name, ${documentSortSql('f')} as doc_key from node f where f.file_key = $1 and f.path = g.frame_path limit 1) f on true
         order by f.doc_key collate "C" nulls last, g.frame_path::text collate "C"`, frameParams);
      byFrame = rows.map(r => ({ nodeId: lastNodeId(r.frame_path), name: r.name ?? null, count: r.count }));
    }
    return {
      total: t.total,
      byState: { dirty: t.dirty, clean: t.clean, blocked: t.blocked },
      byChangeType: { added: t.added, modified: t.modified, deleted: t.deleted },
      byCategory: Object.fromEntries(categories.map(r => [r.key, r.count])),
      byType: Object.fromEntries(types.map(r => [r.key, r.count])),
      byFrame,
    };
  }

  /**
   * One page of work items: the nodes matching a v3 filter grouped (in SQL) by
   * `page.group` — `component` (nearest COMPONENT / COMPONENT_SET
   * ancestor-or-self) or `frame` (the ancestor one level below `filter.under`).
   * Items are ordered by the key node's document order (the keyless item last); `page.after`
   * is the previous page's `{ k, id }`.
   */
  async listWorkItems(fileKey, filter, page) {
    if (page.group === 'set') return this.listSetWorkItems(fileKey, filter, page);
    const params = [];
    const where = v3Where(fileKey, filter, params);
    const keySql = page.group === 'frame'
      ? (level => `(case when nlevel(n.path) > ${level}${filter.regions ? ` and ${v3InUnderSql(filter.under[0], params)}` : ''} then subpath(n.path, 0, ${level} + 1) end)`)(v3UnderLevelSql(filter.under[0], params))
      : `(select a.path from node a where a.file_key = n.file_key and a.path @> n.path
          and a.node_type in ('COMPONENT', 'COMPONENT_SET') order by nlevel(a.path) desc limit 1)`;
    const removedSql = page.group === 'frame' ? 'null::ltree' : removedRootSql('n');
    const maxIds = Number(page.maxIds);
    const progressWhere = page.progress ? v3Where(fileKey, { ...filter, states: ['dirty', 'clean', 'blocked'] }, params) : null;
    const progress = page.progress ? `,
      progress_nodes as (select coalesce(x.removed_path, x.key_path) as key_path, x.removed_path is not null as removed, x.clean
        from (select ${keySql} as key_path, ${removedSql} as removed_path, ${v3StateSql('n').clean} as clean from node n where ${progressWhere}) x),
      progress as (select key_path, removed, count(*)::int as total, count(*) filter (where clean)::int as clean from progress_nodes group by key_path, removed)` : '';
    const items = `with m0 as (
        select n.node_id, n.path, ${documentSortSql('n')} as doc_key, n.changed_props, n.change_categories, ${keySql} as key_path, ${removedSql} as removed_path
        from node n where ${where}),
      m as (select m0.node_id, m0.doc_key, m0.changed_props, m0.change_categories,
          coalesce(m0.removed_path, m0.key_path) as key_path, m0.removed_path is not null as removed from m0),
      g as (
        select key_path, removed, count(*)::int as node_count,
          (array_agg(node_id order by doc_key collate "C", node_id collate "C"))[1:${maxIds}] as node_ids
        from m group by key_path, removed),
      pr as (select key_path, removed, array_agg(distinct x) as props from m cross join unnest(m.changed_props) x group by key_path, removed),
      ca as (select key_path, removed, array_agg(distinct x) as cats from m cross join unnest(m.change_categories) x group by key_path, removed),
      items as (
        select (case when g.removed then '${REMOVED_K}' || coalesce(kn.doc_key, '') || ' ' || g.key_path::text
            else coalesce(kn.doc_key || ' ' || g.key_path::text, g.key_path::text, '~') end) collate "C" as k,
          g.key_path, g.removed, g.node_count, g.node_ids,
          coalesce(pr.props, '{}') as props, coalesce(ca.cats, '{}') as cats
        from g left join lateral (
            select ${documentSortSql('f')} as doc_key from node f where f.file_key = $1 and f.path = g.key_path limit 1) kn on true
          left join pr on pr.key_path is not distinct from g.key_path and pr.removed = g.removed
          left join ca on ca.key_path is not distinct from g.key_path and ca.removed = g.removed)${progress}`;
    const { rows: [{ total }] } = await this.query(`${items} select count(*)::int as total from items`, params);
    const pageParams = params.slice();
    const p = v => { pageParams.push(v); return `$${pageParams.length}`; };
    const after = page.after ? `where i.k > ${p(page.after.k)}` : '';
    const placements = page.group === 'component'
      ? `, case when f.node_id is null or i.removed then null else
           (select count(*)::int from node pl where pl.file_key = $1 and pl.main_component_id = f.node_id and pl.deleted_at is null) end as placements${
        filter.regions ? `, case when f.node_id is null or i.removed then null else
           (select count(*)::int from node pl where pl.file_key = $1 and pl.main_component_id = f.node_id and pl.deleted_at is null${
             filter.regions[0] === null ? '' : ` and pl.path <@ any(${p(filter.regions)}::text[]::ltree[])`}) end as placements_in_scope` : ''}`
      : '';
    const { rows } = await this.query(
      `${items}
       select i.k, i.key_path::text as key_path, i.removed, i.node_count, i.node_ids, i.props, i.cats, f.name, f.node_type,
         case when i.removed then null else coalesce(f.attrs #> '{componentReference,set}',
           (select coalesce(
              (select x.attrs #> '{componentReference,set}' from node x
               where x.file_key = s.file_key and x.attrs #>> '{componentReference,set,id}' = s.node_id limit 1),
              jsonb_build_object('id', s.node_id, 'key', coalesce(s.attrs #>> '{componentReference,key}', s.node_id), 'name', s.name))
            from node s where s.file_key = $1 and s.node_type = 'COMPONENT_SET'
              and (s.path = i.key_path or s.path = subpath(i.key_path, 0, nlevel(i.key_path) - 1)) limit 1)) end as component_set${placements}${page.progress ? ', p.total as progress_total, p.clean as progress_clean' : ''}
       from items i left join lateral (
         select f.node_id, f.name, f.node_type, f.attrs from node f where f.file_key = $1 and f.path = i.key_path limit 1) f on true
       ${page.progress ? 'left join progress p on p.key_path is not distinct from i.key_path and p.removed = i.removed' : ''}
       ${after}
       order by i.k
       limit ${p(page.limit + 1)}`, pageParams);
    const more = rows.length > page.limit;
    const pageRows = more ? rows.slice(0, page.limit) : rows;
    const details = await this.removedDetails(fileKey, pageRows.filter(r => r.removed).map(r => r.key_path));
    const out = pageRows.map(r => ({
      k: r.k,
      keyId: r.key_path === null ? null : lastNodeId(r.key_path),
      name: r.key_path === null ? null : r.name ?? null,
      type: r.key_path === null ? null : r.node_type ?? null,
      ...(r.component_set ? { set: r.component_set } : {}),
      nodeCount: r.node_count,
      categories: [...r.cats].sort(),
      changedProps: [...r.props].sort(),
      ...(page.group === 'component' && !r.removed ? { placements: r.placements ?? null } : {}),
      ...(page.group === 'component' && !r.removed && filter.regions ? { placementsInScope: r.placements_in_scope ?? null } : {}),
      nodeIds: r.node_ids || [],
      ...(page.progress ? { progress: { total: r.progress_total, clean: r.progress_clean } } : {}),
      ...(r.removed ? { kind: 'removed', ...details.get(r.key_path) } : {}),
    }));
    const last = out[out.length - 1];
    return { items: out, total, next: more ? { k: last.k, id: last.keyId ?? '' } : null };
  }

  /** Aggregate by captured set identity even when the set's own row was not synced (remote libraries). */
  async listSetWorkItems(fileKey, filter, page) {
    const params = [];
    const where = v3Where(fileKey, page.progress ? { ...filter, states: ['dirty', 'clean', 'blocked'] } : filter, params);
    const matches = page.progress ? v3Where(fileKey, filter, params) : 'true';
    const p = v => { params.push(v); return `$${params.length}`; };
    const ctes = `with source as (
        select n.*, ${documentSortSql('n')} as doc_key, ${v3StateSql('n').clean} as clean, (${matches}) as matches
        from node n where ${where}),
      assigned as (
        select n.*, case when rr.root is not null then rn.node_id else c.node_id end as component_id,
          case when rr.root is not null then rn.name else c.name end as component_name,
          case when rr.root is not null then rn.node_type else c.node_type end as component_type,
          coalesce(c.attrs #>> '{componentReference,key}', c.node_id) as variant_key,
          coalesce(rr.root, c.path)::text as key_path, case when rr.root is not null then null else cs.ref end as component_set,
          case when rr.root is not null then 'removed:' || rr.root::text
            when cs.ref is not null then 'set:' || coalesce(cs.ref->>'key', cs.ref->>'id') else c.path::text end as identity,
          case when rr.root is not null then '${REMOVED_K}' || coalesce(${documentSortSql('rn')}, '')
            else coalesce(${documentSortSql('s')}, ${documentSortSql('c')}) end as owner_key,
          rr.root is not null as removed
        from source n left join lateral (select ${removedRootSql('n')} as root) rr on true
        left join lateral (select x.* from node x where x.file_key = n.file_key and x.path = rr.root limit 1) rn on true
        left join lateral (
          select a.* from node a where a.file_key = n.file_key and a.path @> n.path
            and a.node_type in ('COMPONENT', 'COMPONENT_SET') order by nlevel(a.path) desc limit 1) c on true
        left join lateral (
          select coalesce(c.attrs #> '{componentReference,set}',
            (select coalesce(
               (select x.attrs #> '{componentReference,set}' from node x
                where x.file_key = a.file_key and x.attrs #>> '{componentReference,set,id}' = a.node_id limit 1),
               jsonb_build_object('id', a.node_id, 'key', coalesce(a.attrs #>> '{componentReference,key}', a.node_id), 'name', a.name))
             from node a where a.file_key = n.file_key and a.node_type = 'COMPONENT_SET'
               and (a.path = c.path or a.path = subpath(c.path, 0, nlevel(c.path) - 1)) limit 1)) as ref) cs on true
        left join node s on s.file_key = n.file_key and s.node_id = cs.ref->>'id'),
      m as (select * from assigned where matches),
      g as (
        select identity, bool_or(removed) as removed, min(key_path) as key_path, coalesce(min(owner_key || ' ' || identity) collate "C", '~') as k,
          (array_agg(component_set order by doc_key collate "C", node_id collate "C"))[1] as component_set,
          (array_agg(component_id order by doc_key collate "C", node_id collate "C"))[1] as component_id,
          (array_agg(component_name order by doc_key collate "C", node_id collate "C"))[1] as component_name,
          (array_agg(component_type order by doc_key collate "C", node_id collate "C"))[1] as component_type,
          count(*)::int as node_count,
          (array_agg(node_id order by doc_key collate "C", node_id collate "C"))[1:${Number(page.maxIds)}] as node_ids
        from m group by identity),
      pr as (select identity, array_agg(distinct x) as props from m cross join unnest(changed_props) x group by identity),
      ca as (select identity, array_agg(distinct x) as cats from m cross join unnest(change_categories) x group by identity),
      variants as (
        select identity, component_id, variant_key, component_name, min(doc_key collate "C") as doc_key, count(*)::int as node_count
        from m where component_type = 'COMPONENT' and component_set is not null
        group by identity, component_id, variant_key, component_name),
      va as (select identity, jsonb_agg(jsonb_build_object('key', variant_key, 'name', component_name, 'nodeCount', node_count)
        order by doc_key collate "C", component_id collate "C") as variants from variants group by identity),
      progress as (select identity, count(*)::int as total, count(*) filter (where clean)::int as clean from assigned group by identity)`;
    const { rows: [{ total }] } = await this.query(`${ctes} select count(*)::int as total from g`, params);
    const after = page.after ? `where g.k > ${p(page.after.k)} collate "C"` : '';
    const { rows } = await this.query(`${ctes}
      select g.*, coalesce(pr.props, '{}') as props, coalesce(ca.cats, '{}') as cats, coalesce(va.variants, '[]'::jsonb) as variants,
        progress.total as progress_total, progress.clean as progress_clean
      from g left join pr on pr.identity is not distinct from g.identity
        left join ca on ca.identity is not distinct from g.identity
        left join va on va.identity = g.identity
        left join progress on progress.identity is not distinct from g.identity
      ${after} order by g.k collate "C" limit ${p(page.limit + 1)}`, params);
    const more = rows.length > page.limit;
    const details = await this.removedDetails(fileKey, rows.slice(0, page.limit).filter(r => r.removed).map(r => r.key_path));
    const items = rows.slice(0, page.limit).map(r => ({
      k: r.k, keyId: r.component_set ? r.component_set.key ?? r.component_set.id : r.component_id,
      name: r.component_set ? r.component_set.name : r.component_name,
      type: r.component_set ? 'COMPONENT_SET' : r.component_type,
      ...(r.component_set ? { set: r.component_set, variants: r.variants } : {}),
      nodeCount: r.node_count, nodeIds: r.node_ids, categories: [...r.cats].sort(), changedProps: [...r.props].sort(),
      ...(page.progress ? { progress: { total: r.progress_total, clean: r.progress_clean } } : {}),
      ...(r.removed ? { kind: 'removed', ...details.get(r.key_path) } : {}),
    }));
    const last = items[items.length - 1];
    return { items, total, next: more ? { k: last.k, id: last.keyId ?? '' } : null };
  }

  /**
   * `{ uses, warnings }` per removed root path (see store/removed.js): the
   * main components its tombstoned instance rows reference, with their live
   * placements file-wide, and its removed components that still have live
   * placements.
   *
   * @param {string} fileKey
   * @param {string[]} roots ltree paths
   */
  async removedDetails(fileKey, roots) {
    const out = new Map();
    if (!roots.length) return out;
    const live = id => `(select count(*)::int from node l where l.file_key = $1 and l.main_component_id = ${id} and l.deleted_at is null)`;
    const { rows: uses } = await this.query(
      `select r.root, i.main_component_id, count(*)::int as placements_removed, min(m.name) as name,
         (array_agg(m.attrs -> 'componentReference'))[1] as ref, ${live('i.main_component_id')} as live
       from unnest($2::text[]) r(root)
         join node i on i.file_key = $1 and i.path <@ r.root::ltree and i.main_component_id is not null and i.deleted_at is not null
         left join node m on m.file_key = $1 and m.node_id = i.main_component_id
       group by r.root, i.main_component_id`, [fileKey, roots]);
    const { rows: mains } = await this.query(
      `select r.root, c.node_id, ${documentSortSql('c')} as doc_key, ${live('c.node_id')} as live
       from unnest($2::text[]) r(root)
         join node c on c.file_key = $1 and c.path <@ r.root::ltree and c.deleted_at is not null and c.node_type in ('COMPONENT', 'COMPONENT_SET')`,
      [fileKey, roots]);
    for (const root of roots) {
      out.set(root, {
        uses: removedUses(uses.filter(u => u.root === root).map(u => ({
          componentId: u.main_component_id, name: u.name, ref: u.ref, placementsRemoved: u.placements_removed, livePlacements: u.live,
        }))),
        warnings: removedWarnings(mains.filter(c => c.root === root).map(c => ({ componentId: c.node_id, docKey: c.doc_key, livePlacements: c.live }))),
      });
    }
    return out;
  }

  /**
   * `expand=instances`, step 1: every main component reachable from `scope`
   * (an ltree path, or null for the whole file) over instance → main edges, at
   * most `maxDepth` hops, with its shortest hop count and its path (null when
   * the main was never synced). A recursive CTE over (main, depth) pairs:
   * `union` deduplicates them and the depth cap ends cycles.
   */
  async expansionReach(fileKey, { scope, maxDepth }) {
    const { rows } = await this.query(
      `with recursive reach(main_id, depth) as (
         select i.main_component_id, 1 from node i
         where i.file_key = $1 and i.main_component_id is not null and i.deleted_at is null
           and ($2::ltree is null or i.path <@ $2::ltree)
         union
         select i.main_component_id, r.depth + 1 from reach r
           join node m on m.file_key = $1 and m.node_id = r.main_id
           join node i on i.file_key = $1 and i.path <@ m.path and i.main_component_id is not null and i.deleted_at is null
         where r.depth < $3::int)
       select r.main_id, min(r.depth)::int as depth, m.path::text as path
       from reach r left join node m on m.file_key = $1 and m.node_id = r.main_id
       group by r.main_id, m.path`, [fileKey, scope, maxDepth]);
    return rows.map(r => ({ mainComponentId: r.main_id, depth: r.depth, path: r.path ?? null }));
  }

  /**
   * `expand=instances`, step 2: for each region (`{ key, path, depth }`; a null
   * path is the whole file) and each main (`{ mainComponentId, depth }`) one
   * hop deeper, the region's first instance of that main in document order.
   */
  async expansionEdges(fileKey, { regions, mains }) {
    const { rows } = await this.query(
      `with r(key, root, depth) as (select * from unnest($2::text[], $3::text[], $4::int[])),
         t(main_id, depth) as (select * from unnest($5::text[], $6::int[]))
       select distinct on (r.key, i.main_component_id) r.key, i.node_id, i.path::text as path, i.main_component_id,
         ${documentSortSql('i')} collate "C" as instance_key
       from r
         join node i on i.file_key = $1 and (r.root is null or i.path <@ r.root::ltree)
           and i.main_component_id is not null and i.deleted_at is null
         join t on t.main_id = i.main_component_id and t.depth = r.depth + 1
       order by r.key, i.main_component_id, ${documentSortSql('i')} collate "C", i.node_id collate "C"`,
      [fileKey, regions.map(x => x.key), regions.map(x => x.path), regions.map(x => x.depth),
        mains.map(x => x.mainComponentId), mains.map(x => x.depth)]);
    return rows.map(r => ({ region: r.key, instanceId: r.node_id, instancePath: r.path, instanceKey: r.instance_key, mainComponentId: r.main_component_id }));
  }

  /** Tracked files with node counts, most recently synced first; `fileKey` narrows to one. */
  async listFiles({ fileKey = null } = {}) {
    const { rows } = await this.query(
      `select f.*, (select ${v3CountsSql('n')} from node n where n.file_key = f.file_key and (not n.library or ${trackingSql('f')})) as counts
       from file f
       where $1::text is null or f.file_key = $1
       order by f.last_sync_at desc nulls last, f.file_key collate "C"`, [fileKey]);
    return rows.map(mapFileV3);
  }

  /** Synced roots of a file: the latest `sync_event` per `root_node_id`, with the root's name and current counts. */
  async listScopes(fileKey) {
    const { rows } = await this.query(
      `select e.root_node_id, e.counts as last_counts, e.created_at, r.name, r.node_type, r.deleted_at,
              (select ${v3CountsSql('d')} from node d where d.file_key = e.file_key and d.path <@ r.path
                 and (not d.library or (select ${trackingSql('f')} from file f where f.file_key = e.file_key))) as counts
       from (select distinct on (root_node_id) * from sync_event
             where file_key = $1 and root_node_id is not null
             order by root_node_id, created_at desc, id desc) e
       left join node r on r.file_key = e.file_key and r.node_id = e.root_node_id
       order by e.created_at desc, e.root_node_id collate "C"`, [fileKey]);
    return rows.map(mapScopeV3);
  }

  // --- v3 actions ------------------------------------------------------------
  /**
   * Hash-guarded compare-and-clear of many nodes: each `{ nodeId, contentHash }`
   * whose stored `content_hash` still equals `contentHash` gets
   * `implemented_hash` / `implemented_attrs` from its current row plus `patch`.
   * Returns `[{ nodeId, contentHash }]` for the rows cleared.
   */
  async clearNodes(fileKey, items, patch) {
    if (!items.length) return [];
    const { sets, values } = setClause(patch, NODE_COLUMNS, 4);
    const { rows } = await this.query(
      `update node n set implemented_hash = n.content_hash, implemented_attrs = coalesce(n.attrs, '{}'::jsonb), ${sets.join(', ')}
       from unnest($2::text[], $3::text[]) as i(node_id, content_hash)
       where n.file_key = $1 and n.node_id = i.node_id and n.content_hash = i.content_hash
       returning n.node_id, n.content_hash`,
      [fileKey, items.map(i => i.nodeId), items.map(i => i.contentHash), ...values]);
    return rows.map(r => ({ nodeId: r.node_id, contentHash: r.content_hash }));
  }

  async getClaim(fileKey, claimId) {
    const { rows } = await this.query('select * from claim where file_key = $1 and claim_id = $2::uuid', [fileKey, claimId]);
    return mapClaim(rows[0]) || null;
  }

  /** @param {Parameters<Store['listClaims']>[0]} options */
  async listClaims({ fileKey = null, nowIso }) {
    const leased = a => `${a}.file_key = c.file_key and ${a}.claim_id = c.claim_id and ${a}.claimed_by = c.worker and ${a}.claim_expires_at > $2::timestamptz`;
    const { rows } = await this.query(
      `select c.*, f.name as file_name, held.node_count, held.node_ids, preview.nodes
       from claim c left join file f on f.file_key = c.file_key
       cross join lateral (select count(*)::int as node_count, (array_agg(n.node_id order by n.node_id collate "C"))[1:500] as node_ids
         from node n where ${leased('n')}) held
       cross join lateral (select coalesce(json_agg(json_build_object('nodeId', p.node_id, 'name', p.name, 'type', p.node_type) order by p.doc_key, p.node_id collate "C"), '[]'::json) as nodes
         from (select n.node_id, n.name, n.node_type, ${documentSortSql('n')} collate "C" as doc_key from node n where ${leased('n')}
           order by doc_key, n.node_id collate "C" limit ${CLAIM_PREVIEW_NODES}) p) preview
       where ($1::text is null or c.file_key = $1) and c.expires_at > $2::timestamptz
       order by c.expires_at, c.claim_id`, [fileKey, nowIso]);
    return rows.map(r => ({ ...mapClaim(r), fileName: r.file_name ?? null, nodeCount: r.node_count, nodeIds: r.node_ids || [], nodes: r.nodes }));
  }

  /**
   * Records a claim and leases it the nodes in `nodeIds` that are unclaimed,
   * expired at `nowIso`, or already `worker`'s. Returns `{ claim, nodes }`
   * (the nodes taken, v3 rows).
   */
  async createClaim({ fileKey, worker, label = null, expiresAt, nowIso, nodeIds }) {
    const { rows: [row] } = await this.query(
      `insert into claim (file_key, worker, label, created_at, expires_at) values ($1, $2, $3, $4, $5) returning *`,
      [fileKey, worker, label, nowIso, expiresAt]);
    const claim = mapClaim(row);
    if (!nodeIds.length) return { claim, nodes: [] };
    const { rows } = await this.query(
      `update node set claimed_by = $2, claim_expires_at = $3, claim_id = $4
       where file_key = $1 and node_id = any($5::text[])
         and (claimed_by is null or claim_expires_at is null or claim_expires_at <= $6 or claimed_by = $2)
       returning *, $7::text as claim_label`,
      [fileKey, worker, expiresAt, claim.claimId, nodeIds, nowIso, claim.label]);
    return { claim, nodes: rows.map(mapNodeV3) };
  }

  /** Extends the claim and its still-active node leases to `expiresAt`; `null` for an unknown claim. */
  async renewClaim(fileKey, claimId, { expiresAt, nowIso }) {
    const { rows: [row] } = await this.query(
      'update claim set expires_at = $3 where file_key = $1 and claim_id = $2::uuid returning *', [fileKey, claimId, expiresAt]);
    const claim = mapClaim(row);
    if (!claim) return null;
    const { rows } = await this.query(
      `update node set claim_expires_at = $3
       where file_key = $1 and claim_id = $2::uuid and claimed_by = $4 and claim_expires_at > $5
       returning *, $6::text as claim_label`,
      [fileKey, claimId, expiresAt, claim.worker, nowIso, claim.label]);
    return { claim, nodes: rows.map(mapNodeV3) };
  }

  /** Ends the claim at `nowIso` and unleases the nodes still pointing at it; `null` for an unknown claim. */
  async releaseClaim(fileKey, claimId, { nowIso }) {
    const { rows: [row] } = await this.query(
      `update claim set expires_at = least(expires_at, $3::timestamptz)
       where file_key = $1 and claim_id = $2::uuid returning *`, [fileKey, claimId, nowIso]);
    const claim = mapClaim(row);
    if (!claim) return null;
    const { rows } = await this.query(
      `update node set claimed_by = null, claim_expires_at = null, claim_id = null
       where file_key = $1 and claim_id = $2::uuid and claimed_by = $3
       returning *, null::text as claim_label`, [fileKey, claimId, claim.worker]);
    return { claim, nodes: rows.map(mapNodeV3) };
  }

  /**
   * Blocks a node at `at` (reason / by) and drops its lease. Returns
   * `{ node, released }` — `released` is the lease that was active at `at`
   * (`{ claimId, worker }`), else null — or null for an unknown node.
   */
  async blockNode(fileKey, nodeId, { reason, by, at }) {
    const { rows: [row] } = await this.query(
      `with prior as (select node_id, claimed_by, claim_id, claim_expires_at from node where file_key = $1 and node_id = $2 for update)
       update node n set blocked_at = $3, blocked_by = $4, blocked_reason = $5, claimed_by = null, claim_expires_at = null, claim_id = null
       from prior where n.file_key = $1 and n.node_id = prior.node_id
       returning n.*, null::text as claim_label, prior.claimed_by as prior_claimed_by, prior.claim_id as prior_claim_id,
                 prior.claim_expires_at > $3::timestamptz as prior_active`,
      [fileKey, nodeId, at, by, reason]);
    if (!row) return null;
    const released = row.prior_claimed_by && row.prior_active ? { claimId: row.prior_claim_id ?? null, worker: row.prior_claimed_by } : null;
    return { node: mapNodeV3(row), released };
  }

  /** Clears a node's block. Returns `{ node, prior: { at, by, reason } }`, or null when the node is unknown or not blocked. */
  async unblockNode(fileKey, nodeId) {
    const { rows: [row] } = await this.query(
      `with prior as (select node_id, blocked_at, blocked_by, blocked_reason from node
                      where file_key = $1 and node_id = $2 and blocked_at is not null for update)
       update node n set blocked_at = null, blocked_by = null, blocked_reason = null
       from prior where n.file_key = $1 and n.node_id = prior.node_id
       returning n.*, (select c.label from claim c where c.claim_id = n.claim_id) as claim_label,
                 prior.blocked_at as prior_blocked_at, prior.blocked_by as prior_blocked_by, prior.blocked_reason as prior_blocked_reason`,
      [fileKey, nodeId]);
    if (!row) return null;
    return { node: mapNodeV3(row), prior: { at: iso(row.prior_blocked_at), by: row.prior_blocked_by ?? null, reason: row.prior_blocked_reason ?? null } };
  }

  // --- v3 events --------------------------------------------------------------
  /**
   * Appends an event. A transaction-scoped advisory lock per file makes a
   * file's event ids commit in id order, so a reader that has seen id N never
   * misses a later-committing event of that file with a lower id.
   */
  async insertEvent({ fileKey, type, actor = null, data = {}, createdAt = null }) {
    await this.query(`select pg_advisory_xact_lock(hashtext('rds_events:' || $1))`, [fileKey]);
    const { rows } = await this.query(
      `insert into event (file_key, type, actor, data, created_at) values ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, now()))
       returning *`, [fileKey, type, actor ?? null, json(data || {}), createdAt ?? null]);
    return mapEvent(rows[0]);
  }

  /**
   * Events with `after < id < before`, oldest first (`order: 'desc'`: newest first), each with its file's `fileName`;
   * `fileKey` (or all files when null), `types`, `nodeId` and `since` narrow them.
   *
   * @param {Parameters<Store['listEvents']>[0]} [options]
   */
  async listEvents({ fileKey = null, after = 0, before = null, order = 'asc', types = [], nodeId = null, since = null, limit = 100 } = {}) {
    const { rows } = await this.query(
      `select e.*, f.name as file_name from event e left join file f on f.file_key = e.file_key
       where e.id > $1 and ($7::bigint is null or e.id < $7) and ($2::text is null or e.file_key = $2)
         and (cardinality($3::text[]) = 0 or e.type = any($3::text[]))
         and ($4::text is null or e.data @> jsonb_build_object('nodeId', $4::text) or e.data @> jsonb_build_object('nodeIds', jsonb_build_array($4::text)))
         and ($5::timestamptz is null or e.created_at >= $5)
       order by e.id ${order === 'desc' ? 'desc' : 'asc'} limit $6`, [after, fileKey, types, nodeId, since, limit, before]);
    return rows.map(r => ({ ...mapEvent(r), fileName: r.file_name ?? null }));
  }

  async latestEvent(type) {
    const { rows } = await this.query('select * from event where type = $1 order by created_at desc, id desc limit 1', [type]);
    return mapEvent(rows[0]) || null;
  }

  async getEvent(fileKey, id) {
    const { rows } = await this.query('select * from event where ($1::text is null or file_key = $1) and id = $2', [fileKey, id]);
    return mapEvent(rows[0]) || null;
  }

  /** The newest event id of the file, 0 when it has none. */
  async lastEventId(fileKey) {
    const { rows: [row] } = await this.query('select max(id) as id from event where $1::text is null or file_key = $1', [fileKey]);
    return row && row.id !== null ? Number(row.id) : 0;
  }

  /** `[{ fileKey, id }]`: the newest event id of each of `fileKeys` that has events. */
  async latestEventIds(fileKeys) {
    if (fileKeys !== null && !fileKeys.length) return [];
    const { rows } = await this.query(
      'select file_key, max(id) as id from event where $1::text[] is null or file_key = any($1::text[]) group by file_key', [fileKeys]);
    return rows.map(r => ({ fileKey: r.file_key, id: Number(r.id) }));
  }

  /** Deletes events created before `before`; returns how many. */
  async eventTrends({ fileKey = null, from, since, until }) {
    const { rows } = await this.query(
      `select f.file_key, f.name,
         coalesce(sum(e.n) filter (where e.type = 'nodes.cleared' and e.created_at >= $2), 0) as cleared,
         coalesce(sum(e.n) filter (where e.type = 'nodes.cleared' and e.created_at < $2), 0) as cleared_previous,
         coalesce(sum(e.n) filter (where e.type = 'sync.completed' and e.created_at >= $2), 0) as dirtied
       from file f
       left join lateral (
         select ev.type, ev.created_at,
           case when ev.type = 'nodes.cleared' then
             case when jsonb_typeof(ev.data->'count') = 'number' then (ev.data->>'count')::numeric
                  when jsonb_typeof(ev.data->'nodeIds') = 'array' then jsonb_array_length(ev.data->'nodeIds') else 0 end
           else
             case when jsonb_typeof(ev.data->'counts'->'dirty') = 'number' then (ev.data->'counts'->>'dirty')::numeric else 0 end
           end - case when ${trackingSql('f')} then 0
             when ev.type = 'nodes.cleared' and jsonb_typeof(ev.data->'libraryCount') = 'number' then (ev.data->>'libraryCount')::numeric
             when ev.type = 'sync.completed' and jsonb_typeof(ev.data->'counts'->'libraryDirty') = 'number' then (ev.data->'counts'->>'libraryDirty')::numeric
             else 0 end as n
         from event ev
         where ev.file_key = f.file_key and ev.type in ('nodes.cleared', 'sync.completed')
           and ev.created_at >= $1 and ev.created_at < $3
       ) e on true
       where ($4::text is null or f.file_key = $4)
       group by f.file_key, f.name
       order by f.file_key`,
      [from, since, until, fileKey]
    );
    return rows.map(r => ({
      fileKey: r.file_key, fileName: r.name ?? null,
      cleared: Number(r.cleared), clearedPrevious: Number(r.cleared_previous), dirtied: Number(r.dirtied),
    }));
  }

  async pruneEvents(before) {
    const { rowCount } = await this.query('delete from event where created_at < $1', [before]);
    return rowCount ?? 0;
  }
}

module.exports = { PostgresStore };
