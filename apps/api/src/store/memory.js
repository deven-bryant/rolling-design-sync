'use strict';

/*
 * In-memory data layer. Same interface as store/postgres.js; used by unit tests
 * and for running the service without a database (RDS_STORE=memory).
 */
const { randomUUID } = require('node:crypto');
const { isDescendant, pathNodeIds } = require('../ltree');
const { documentSortKey } = require('../documentOrder');

const now = () => new Date().toISOString();
const clone = v => (v === undefined ? undefined : structuredClone(v));

// --- v3 read helpers (mirror store/postgres.js v3Where) ----------------------
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const v3State = n => (n.blockedAt ? 'blocked' : n.dirty ? 'dirty' : n.deletedAt ? null : 'clean');
const V3_SORT_KEY = { document: documentSortKey, path: n => n.path || '', name: n => n.name || '', updatedAt: n => new Date(n.updatedAt).toISOString() };
const globRegex = g => new RegExp(`^${String(g).split('').map(c => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 'is');

const COMPONENT_TYPES = ['COMPONENT', 'COMPONENT_SET'];
/** Mirrors CLAIM_PREVIEW_NODES in store/postgres.js. */
const CLAIM_PREVIEW_NODES = 3;
/** Mirrors V3_CHANGE_TYPE_SQL in store/postgres.js. */
const v3ChangeType = n => {
  if (!n.dirty) return null;
  if (n.changeType) return n.changeType;
  if (n.deletedAt) return 'deleted';
  return n.implementedHash === null || n.implementedHash === undefined ? 'added' : 'modified';
};
/** The path of `n`'s ancestor at `level + 1` labels (one below a root at `level`), or null. */
const framePath = (n, level) => {
  const parts = n.path ? n.path.split('.') : [];
  return parts.length > level ? parts.slice(0, level + 1).join('.') : null;
};

/** Index in `regions` (0 = the scope, then each expanded component) of the first one containing `n`, or -1; mirrors v3RegionOrdSql. */
const regionOf = (n, regions) => regions.findIndex(r => r === null || (!!n.path && isDescendant(n.path, r)));
const inRoot = (n, root) => !root || (!!n.path && isDescendant(n.path, root.path));
/** `n` is in `root`'s subtree, at most `depth` levels below it (any depth when null). */
const inSubtree = (n, root, depth) => !!n.path && isDescendant(n.path, root.path)
  && (depth === null || depth === undefined || n.path.split('.').length <= root.path.split('.').length + depth);

function v3Counts(nodes) {
  const counts = { total: 0, dirty: 0, blocked: 0 };
  for (const n of nodes) {
    const state = v3State(n);
    if (!state) continue;
    counts.total += 1;
    if (state === 'dirty') counts.dirty += 1;
    if (state === 'blocked') counts.blocked += 1;
  }
  return counts;
}

/** `roots`: the `under` nodes (none: the whole file). */
function v3Matches(n, f, roots) {
  if (!f.states.includes(v3State(n))) return false;
  if (f.regions) {
    if (regionOf(n, f.regions) < 0) return false;
  } else if (roots.length) {
    if (!roots.some(root => inSubtree(n, root, f.depth))) return false;
  }
  if (f.types.length && !f.types.includes(n.nodeType)) return false;
  if (f.changeTypes.length && !f.changeTypes.includes(n.changeType)) return false;
  if (f.categories.length && !(n.changeCategories || []).some(c => f.categories.includes(c))) return false;
  if (f.changedExact.length || f.changedPrefixes.length) {
    const props = n.changedProps || [];
    if (!props.some(p => f.changedExact.includes(p) || f.changedPrefixes.some(x => p.startsWith(x)))) return false;
  }
  if (f.components.length && !(f.components.includes(n.mainComponentId) || f.components.includes(n.nodeId))) return false;
  if (typeof f.instance === 'boolean' && !!n.isInstance !== f.instance) return false;
  if (f.names.length && !(n.name !== null && n.name !== undefined && f.names.some(g => globRegex(g).test(n.name)))) return false;
  if (f.since && !(Date.parse(n.updatedAt) >= Date.parse(f.since))) return false;
  if (f.claimed.length) {
    const active = !!n.claimedBy && !!n.claimExpiresAt && Date.parse(n.claimExpiresAt) > Date.parse(f.now);
    const ok = f.claimed.some(c => (c === 'true' ? active : c === 'false' ? !active : active && n.claimedBy === f.worker));
    if (!ok) return false;
  }
  return true;
}

/** @typedef {import('./types').Store} Store */

/** @implements {Store} */
class MemoryStore {
  constructor() {
    this.nodes = new Map(); // node-sync: `${fileKey}\u0000${nodeId}` -> row
    this.files = new Map(); // fileKey -> file row
    this.syncEvents = new Map(); // id -> sync_event row
    this.claims = new Map(); // claimId -> v3 claim row
    this.events = new Map(); // id -> event row
    this._eventSeq = 0; // like bigserial: never rolled back
    this._lock = Promise.resolve();
  }

  /** Serialized, all-or-nothing: state is restored if `fn` throws. */
  transaction(fn) {
    const run = async () => {
      const backup = this._dump();
      try { return await fn(this); }
      catch (err) { this._restore(backup); throw err; }
    };
    const result = this._lock.then(run, run);
    this._lock = result.catch(() => {});
    return result;
  }

  _dump() {
    return ['nodes', 'files', 'syncEvents', 'claims', 'events'].map(k => [k, new Map(structuredClone(Array.from(this[k].entries())))]);
  }

  _restore(backup) { for (const [k, m] of backup) this[k] = m; }

  async close() {}

  // --- node-sync ----------------------------------------------------------
  _nodeKey(fileKey, nodeId) { return `${fileKey}\u0000${nodeId}`; }

  async getNode(fileKey, nodeId) { return clone(this.nodes.get(this._nodeKey(fileKey, nodeId))) || null; }

  /** Stored rows (tombstoned included) for `nodeIds`; unknown ids are skipped. */
  async getNodes(fileKey, nodeIds) {
    const out = [];
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
      if (node) out.push(clone(node));
    }
    return out;
  }

  /**
   * `baseline` (`{ implementedAt }`) inserts a never-seen node as already
   * implemented; it is ignored for existing rows. The result carries
   * `baselined: true` when that happened. `changeType` / `changedProps` /
   * `changeCategories` are stored as given; a content-hash change clears the
   * block columns.
   *
   * @param {Parameters<Store['upsertNode']>[2]} [baseline]
   */
  async upsertNode(fileKey, row, baseline = null) {
    const key = this._nodeKey(fileKey, row.nodeId);
    const existing = this.nodes.get(key);
    const baselined = !existing && !!baseline;
    const implementedHash = existing ? existing.implementedHash : baselined ? row.contentHash : null;
    const node = {
      ...(existing || {
        implementedHash,
        implementedCommit: baselined ? 'baseline' : null,
        implementedAt: baselined ? baseline.implementedAt : null,
        implementedAttrs: baselined ? clone(row.attrs) || {} : null,
        claimedBy: null,
        claimExpiresAt: null,
        claimId: null,
        blockedAt: null,
        blockedBy: null,
        blockedReason: null,
        orderKey: null,
        createdAt: now(),
      }),
      ...(existing && existing.contentHash !== row.contentHash ? { blockedAt: null, blockedBy: null, blockedReason: null } : {}),
      fileKey,
      nodeId: row.nodeId,
      nodeType: row.nodeType ?? null,
      name: row.name ?? null,
      parentId: row.parentId ?? null,
      path: row.path,
      attrs: clone(row.attrs) || {},
      isInstance: !!row.isInstance,
      mainComponentId: row.mainComponentId ?? null,
      contentHash: row.contentHash,
      captureVersion: row.captureVersion ?? 1,
      dirty: row.contentHash !== implementedHash,
      changeType: row.changeType ?? null,
      changedProps: clone(row.changedProps) || [],
      changeCategories: clone(row.changeCategories) || [],
      deletedAt: null,
      updatedAt: now(),
    };
    this.nodes.set(key, node);
    return { ...clone(node), baselined };
  }

  /** Ids in `nodeIds` that are stored and not tombstoned, in input order. */
  async nodesPresent(fileKey, nodeIds) {
    return nodeIds.filter(nodeId => {
      const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
      return !!node && !node.deletedAt;
    });
  }

  /** `[{ nodeId, captureVersion }]` for the present (non-tombstoned) ids, in input order. */
  async nodeCaptureVersions(fileKey, nodeIds) {
    const out = [];
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
      if (node && !node.deletedAt) out.push({ nodeId, captureVersion: node.captureVersion ?? 1 });
    }
    return out;
  }

  /** Tombstones existing rows (last-known attrs kept); unknown ids are ignored. */
  async tombstoneNodes(fileKey, nodeIds, deletedAt) {
    const out = [];
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
      if (!node || node.deletedAt) continue;
      Object.assign(node, { deletedAt, dirty: true, updatedAt: now() });
      out.push(clone(node));
    }
    return out;
  }

  /**
   * @param {string} fileKey
   * @param {string} nodeId
   * @param {{ dirty?: boolean, includeDeleted?: boolean }} [options]
   */
  async listNodeSubtree(fileKey, nodeId, { dirty, includeDeleted = true } = {}) {
    const root = this.nodes.get(this._nodeKey(fileKey, nodeId));
    if (!root || !root.path) return [];
    return Array.from(this.nodes.values())
      .filter(n => n.fileKey === fileKey && n.path && isDescendant(n.path, root.path))
      .filter(n => (includeDeleted || !n.deletedAt) && (dirty === undefined || !!n.dirty === dirty))
      .sort((a, b) => a.path.localeCompare(b.path) || a.nodeId.localeCompare(b.nodeId))
      .map(clone);
  }

  /** Live (non-tombstoned) rows whose `parentId` is in `parentIds`. */
  async listChildren(fileKey, parentIds) {
    const parents = new Set(parentIds);
    return this._fileNodes(fileKey)
      .filter(n => !n.deletedAt && n.parentId !== null && parents.has(n.parentId))
      .sort((a, b) => cmp(a.nodeId, b.nodeId))
      .map(clone);
  }

  /**
   * Document order: sets each `{ nodeId, path, from, to }`'s `orderKey` to `to`
   * and rewrites the `from.` prefix of its descendants' keys (tombstoned
   * included). Moves must be disjoint subtrees. Not a content update:
   * `updatedAt` is kept. Returns how many rows changed.
   */
  async rekeySubtrees(fileKey, moves) {
    let n = 0;
    const all = this._fileNodes(fileKey);
    for (const m of moves) {
      const prefix = m.from == null ? null : `${m.from}.`;
      for (const node of all) {
        if (node.nodeId === m.nodeId) {
          if (node.orderKey !== m.to) { node.orderKey = m.to; n += 1; }
        } else if (prefix && m.path && node.path && node.orderKey && node.orderKey.startsWith(prefix) && isDescendant(node.path, m.path)) {
          node.orderKey = m.to + node.orderKey.slice(m.from.length);
          n += 1;
        }
      }
    }
    return n;
  }

  async updateNode(fileKey, nodeId, patch) {
    const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
    if (!node) return null;
    Object.assign(node, clone(patch), { updatedAt: now() });
    return clone(node);
  }

  // --- startup maintenance (same contract as PostgresStore) --------------------
  /**
   * Up to `limit` rows (tombstoned included) with a `changeType` but no
   * `changedProps`, in `(fileKey, nodeId)` order after `after`
   * (`{ fileKey, nodeId }`, exclusive).
   *
   * @param {Parameters<Store['listChangeRepairCandidates']>[0]} options
   */
  async listChangeRepairCandidates({ after = null, limit }) {
    const past = n => !after || cmp(n.fileKey, after.fileKey) > 0 || (n.fileKey === after.fileKey && cmp(n.nodeId, after.nodeId) > 0);
    return Array.from(this.nodes.values())
      .filter(n => n.changeType !== null && n.changeType !== undefined && !(n.changedProps || []).length && past(n))
      .sort((a, b) => cmp(a.fileKey, b.fileKey) || cmp(a.nodeId, b.nodeId))
      .slice(0, limit)
      .map(clone);
  }

  /**
   * Writes the change columns of each `{ fileKey, nodeId, contentHash, from,
   * changeType, changedProps, changeCategories }` whose row still has
   * `contentHash`, `changeType === from` and no `changedProps`. Returns how
   * many rows were written.
   */
  async repairChangeColumns(items) {
    let n = 0;
    for (const i of items) {
      const node = this.nodes.get(this._nodeKey(i.fileKey, i.nodeId));
      if (!node || node.contentHash !== i.contentHash || node.changeType !== i.from || (node.changedProps || []).length) continue;
      Object.assign(node, {
        changeType: i.changeType, changedProps: clone(i.changedProps), changeCategories: clone(i.changeCategories), updatedAt: now(),
      });
      n += 1;
    }
    return n;
  }

  /**
   * Up to `limit` rows (tombstoned included) without an `orderKey`, parents
   * before children: in `(fileKey, depth, nodeId)` order after `after`
   * (`{ fileKey, depth, nodeId }`, exclusive). Rows carry `depth`.
   *
   * @param {Parameters<Store['listOrderKeyCandidates']>[0]} options
   */
  async listOrderKeyCandidates({ after = null, limit }) {
    const depth = n => (n.path ? n.path.split('.').length : 0);
    const order = (a, b) => cmp(a.fileKey, b.fileKey) || a.depth - b.depth || cmp(a.nodeId, b.nodeId);
    return Array.from(this.nodes.values())
      .filter(n => n.orderKey === null || n.orderKey === undefined)
      .map(n => ({ ...clone(n), depth: depth(n) }))
      .filter(n => !after || order(n, after) > 0)
      .sort(order)
      .slice(0, limit);
  }

  /** Sets `orderKey` of each `{ fileKey, nodeId, orderKey }` whose row has none. Returns how many rows were written. */
  async setOrderKeys(items) {
    let n = 0;
    for (const i of items) {
      const node = this.nodes.get(this._nodeKey(i.fileKey, i.nodeId));
      if (!node || (node.orderKey !== null && node.orderKey !== undefined)) continue;
      node.orderKey = i.orderKey;
      n += 1;
    }
    return n;
  }

  /** Upserts the file row; a `null` name keeps the stored one. */
  async upsertFile({ fileKey, name = null, lastSyncAt = null }) {
    const existing = this.files.get(fileKey);
    const file = {
      fileKey,
      name: name ?? (existing ? existing.name : null),
      lastSyncAt: lastSyncAt ?? now(),
      createdAt: existing ? existing.createdAt : now(),
    };
    this.files.set(fileKey, file);
    return clone(file);
  }

  async recordSync({ fileKey, rootNodeId = null, counts = {}, createdAt = null }) {
    const event = { id: randomUUID(), fileKey, rootNodeId, counts: clone(counts), createdAt: createdAt ?? now() };
    this.syncEvents.set(event.id, event);
    return clone(event);
  }

  // --- v3 reads (same contract as PostgresStore) ------------------------------
  _fileNodes(fileKey) { return Array.from(this.nodes.values()).filter(n => n.fileKey === fileKey); }
  _fileName(fileKey) { const file = this.files.get(fileKey); return file ? file.name ?? null : null; }

  _nodeV3(node, all, counts) {
    const out = { ...clone(node), claimLabel: (node.claimId && this.claims?.get(node.claimId)?.label) || null };
    if (counts) out.descendants = v3Counts(all.filter(d => d.path && node.path && d.nodeId !== node.nodeId && isDescendant(d.path, node.path)));
    return out;
  }

  /** The stored `under` nodes that have a path, in order; [] without `under`. */
  _roots(fileKey, filter) {
    return (filter.under || []).map(id => this.nodes.get(this._nodeKey(fileKey, id))).filter(n => n && n.path);
  }

  async listNodes(fileKey, filter, page) {
    const all = this._fileNodes(fileKey);
    const roots = this._roots(fileKey, filter);
    if (filter.under && !roots.length) return { nodes: [], total: 0, next: null };
    const ord = filter.regions ? n => (filter.regions[0] === null ? 0 : regionOf(n, filter.regions))
      : roots.length > 1 ? n => roots.findIndex(root => inSubtree(n, root, filter.depth)) : null;
    const tree = page.sort === 'path' || page.sort === 'document' ? V3_SORT_KEY[page.sort] : null;
    const key = ord && tree ? n => `${String(ord(n)).padStart(4, '0')} ${tree(n)}` : V3_SORT_KEY[page.sort];
    const dir = page.desc ? -1 : 1;
    const matched = all.filter(n => v3Matches(n, filter, roots))
      .map(n => ({ n, k: key(n) }))
      .sort((a, b) => dir * (cmp(a.k, b.k) || cmp(a.n.nodeId, b.n.nodeId)));
    const after = page.after;
    const rest = after ? matched.filter(({ n, k }) => dir * (cmp(k, after.k) || cmp(n.nodeId, after.id)) > 0) : matched;
    const pageRows = rest.slice(0, page.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      nodes: pageRows.map(({ n }) => (filter.regions && ord ? { ...this._nodeV3(n, all, page.counts), expandOrd: ord(n) } : this._nodeV3(n, all, page.counts))),
      total: matched.length,
      next: rest.length > page.limit ? { k: last.k, id: last.n.nodeId } : null,
    };
  }

  async getNodeV3(fileKey, nodeId, { counts = false } = {}) {
    const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
    return node ? this._nodeV3(node, counts ? this._fileNodes(fileKey) : [], counts) : null;
  }

  async listFiles({ fileKey = null } = {}) {
    return Array.from(this.files.values())
      .filter(f => fileKey === null || f.fileKey === fileKey)
      .sort((a, b) => cmp(b.lastSyncAt || '', a.lastSyncAt || '') || cmp(a.fileKey, b.fileKey))
      .map(f => ({ ...clone(f), counts: v3Counts(this._fileNodes(f.fileKey)) }));
  }

  async listScopes(fileKey) {
    const latest = new Map();
    for (const e of this.syncEvents.values()) {
      if (e.fileKey !== fileKey || e.rootNodeId === null || e.rootNodeId === undefined) continue;
      const seen = latest.get(e.rootNodeId);
      if (!seen || cmp(e.createdAt, seen.createdAt) > 0 || (e.createdAt === seen.createdAt && cmp(e.id, seen.id) > 0)) latest.set(e.rootNodeId, e);
    }
    const all = this._fileNodes(fileKey);
    return Array.from(latest.values())
      .sort((a, b) => cmp(b.createdAt, a.createdAt) || cmp(a.rootNodeId, b.rootNodeId))
      .map(e => {
        const root = this.nodes.get(this._nodeKey(fileKey, e.rootNodeId));
        return {
          nodeId: e.rootNodeId,
          name: root ? root.name ?? null : null,
          nodeType: root ? root.nodeType ?? null : null,
          deleted: !!(root && root.deletedAt),
          lastSyncAt: e.createdAt,
          lastSyncCounts: clone(e.counts) || {},
          counts: root && root.path ? v3Counts(all.filter(n => n.path && isDescendant(n.path, root.path))) : { total: 0, dirty: 0, blocked: 0 },
        };
      });
  }

  // --- v3 actions (same contract as PostgresStore) ----------------------------
  /**
   * Hash-guarded compare-and-clear of many nodes: each `{ nodeId, contentHash }`
   * whose stored `content_hash` still equals `contentHash` gets
   * `implemented_hash` / `implemented_attrs` from its current row plus `patch`.
   * Returns `[{ nodeId, contentHash }]` for the rows cleared.
   */
  async clearNodes(fileKey, items, patch) {
    const out = [];
    for (const { nodeId, contentHash } of items) {
      const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
      if (!node || node.contentHash !== contentHash) continue;
      Object.assign(node, { implementedHash: node.contentHash, implementedAttrs: clone(node.attrs) ?? {} }, clone(patch), { updatedAt: now() });
      if (!out.some(c => c.nodeId === nodeId)) out.push({ nodeId, contentHash });
    }
    return out;
  }

  async getClaim(fileKey, claimId) {
    const claim = this.claims.get(claimId);
    return claim && claim.fileKey === fileKey ? clone(claim) : null;
  }

  /** @param {Parameters<Store['listClaims']>[0]} options */
  async listClaims({ fileKey = null, nowIso }) {
    return [...this.claims.values()]
      .filter(c => (fileKey === null || c.fileKey === fileKey) && Date.parse(c.expiresAt) > Date.parse(nowIso))
      .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || cmp(a.claimId, b.claimId))
      .map(c => {
        const nodes = this._claimNodes(c.fileKey, c, nowIso, true).sort((a, b) => cmp(a.nodeId, b.nodeId));
        const preview = nodes.slice().sort((a, b) => cmp(documentSortKey(a), documentSortKey(b)) || cmp(a.nodeId, b.nodeId)).slice(0, CLAIM_PREVIEW_NODES);
        return {
          ...clone(c), fileName: this._fileName(c.fileKey), nodeCount: nodes.length, nodeIds: nodes.slice(0, 500).map(n => n.nodeId),
          nodes: preview.map(n => ({ nodeId: n.nodeId, name: n.name ?? null, type: n.nodeType ?? null })),
        };
      });
  }

  /**
   * Records a claim and leases it the nodes in `nodeIds` that are unclaimed,
   * expired at `nowIso`, or already `worker`'s. Returns `{ claim, nodes }`
   * (the nodes taken, v3 rows).
   */
  async createClaim({ fileKey, worker, label = null, expiresAt, nowIso, nodeIds }) {
    const claim = { claimId: randomUUID(), fileKey, worker, label, createdAt: nowIso, expiresAt };
    this.claims.set(claim.claimId, claim);
    const nodes = [];
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
      if (!node) continue;
      const free = !node.claimedBy || !node.claimExpiresAt || Date.parse(node.claimExpiresAt) <= Date.parse(nowIso) || node.claimedBy === worker;
      if (!free || nodes.some(n => n.nodeId === nodeId)) continue;
      Object.assign(node, { claimedBy: worker, claimExpiresAt: expiresAt, claimId: claim.claimId, updatedAt: now() });
      nodes.push(this._nodeV3(node, [], false));
    }
    return { claim: clone(claim), nodes };
  }

  /** Nodes still leased under `claim` (same claim id and worker); `active` also requires an unexpired lease. */
  _claimNodes(fileKey, claim, nowIso, active) {
    return this._fileNodes(fileKey).filter(n => n.claimId === claim.claimId && n.claimedBy === claim.worker
      && (!active || (n.claimExpiresAt && Date.parse(n.claimExpiresAt) > Date.parse(nowIso))));
  }

  /** Extends the claim and its still-active node leases to `expiresAt`; `null` for an unknown claim. */
  async renewClaim(fileKey, claimId, { expiresAt, nowIso }) {
    const claim = this.claims.get(claimId);
    if (!claim || claim.fileKey !== fileKey) return null;
    claim.expiresAt = expiresAt;
    const nodes = this._claimNodes(fileKey, claim, nowIso, true).map(node => {
      Object.assign(node, { claimExpiresAt: expiresAt, updatedAt: now() });
      return this._nodeV3(node, [], false);
    });
    return { claim: clone(claim), nodes };
  }

  /** Ends the claim at `nowIso` and unleases the nodes still pointing at it; `null` for an unknown claim. */
  async releaseClaim(fileKey, claimId, { nowIso }) {
    const claim = this.claims.get(claimId);
    if (!claim || claim.fileKey !== fileKey) return null;
    if (Date.parse(claim.expiresAt) > Date.parse(nowIso)) claim.expiresAt = nowIso;
    const nodes = this._claimNodes(fileKey, claim, nowIso, false).map(node => {
      Object.assign(node, { claimedBy: null, claimExpiresAt: null, claimId: null, updatedAt: now() });
      return this._nodeV3(node, [], false);
    });
    return { claim: clone(claim), nodes };
  }

  /**
   * Blocks a node at `at` (reason / by) and drops its lease. Returns
   * `{ node, released }` — `released` is the lease that was active at `at`
   * (`{ claimId, worker }`), else null — or null for an unknown node.
   */
  async blockNode(fileKey, nodeId, { reason, by, at }) {
    const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
    if (!node) return null;
    const active = !!node.claimedBy && !!node.claimExpiresAt && Date.parse(node.claimExpiresAt) > Date.parse(at);
    const released = active ? { claimId: node.claimId ?? null, worker: node.claimedBy } : null;
    Object.assign(node, { blockedAt: at, blockedBy: by, blockedReason: reason, claimedBy: null, claimExpiresAt: null, claimId: null, updatedAt: now() });
    return { node: this._nodeV3(node, [], false), released };
  }

  /** Clears a node's block. Returns `{ node, prior: { at, by, reason } }`, or null when the node is unknown or not blocked. */
  async unblockNode(fileKey, nodeId) {
    const node = this.nodes.get(this._nodeKey(fileKey, nodeId));
    if (!node || !node.blockedAt) return null;
    const prior = { at: node.blockedAt, by: node.blockedBy ?? null, reason: node.blockedReason ?? null };
    Object.assign(node, { blockedAt: null, blockedBy: null, blockedReason: null, updatedAt: now() });
    return { node: this._nodeV3(node, [], false), prior };
  }

  // --- v3 events (same contract as PostgresStore) -----------------------------
  /** Appends an event; ids are monotonic per store. Returns the stored row. */
  // --- v3 insights (same contract as PostgresStore) ---------------------------
  /** `{ all, byPath, root, matched }` for a v3 filter; `root` is the `under` node when there is exactly one (else null). */
  _v3Match(fileKey, filter) {
    const all = this._fileNodes(fileKey);
    const byPath = new Map();
    for (const n of all) if (n.path && !byPath.has(n.path)) byPath.set(n.path, n);
    const roots = this._roots(fileKey, filter);
    const root = filter.under && filter.under.length === 1 ? roots[0] || null : null;
    if (filter.under && !roots.length) return { all, byPath, root, matched: [] };
    return { all, byPath, root, matched: all.filter(n => v3Matches(n, filter, roots)) };
  }

  async summarizeNodes(fileKey, filter) {
    const { byPath, root, matched } = this._v3Match(fileKey, filter);
    const byState = { dirty: 0, clean: 0, blocked: 0 };
    const byChangeType = { added: 0, modified: 0, deleted: 0 };
    /** @type {Record<string, number>} */
    const byCategory = {};
    /** @type {Record<string, number>} */
    const byType = {};
    const frames = new Map();
    const level = root && root.path ? root.path.split('.').length : null;
    for (const n of matched) {
      byState[v3State(n)] += 1;
      const ct = v3ChangeType(n);
      if (ct) byChangeType[ct] += 1;
      for (const c of n.changeCategories || []) byCategory[c] = (byCategory[c] || 0) + 1;
      if (n.nodeType) byType[n.nodeType] = (byType[n.nodeType] || 0) + 1;
      const frame = level === null || !inRoot(n, root) ? null : framePath(n, level);
      if (frame) frames.set(frame, (frames.get(frame) || 0) + 1);
    }
    const byFrame = root
      ? [...frames.entries()]
        .map(([p, count]) => [p, count, byPath.has(p) ? documentSortKey(byPath.get(p)) : null])
        .sort((a, b) => Number(a[2] === null) - Number(b[2] === null) || cmp(a[2] ?? '', b[2] ?? '') || cmp(a[0], b[0]))
        .map(([p, count]) => ({ nodeId: /** @type {string} */ (pathNodeIds(p).pop()), name: byPath.get(p)?.name ?? null, count })) // a frame path is never empty
      : null;
    return { total: matched.length, byState, byChangeType, byCategory, byType, byFrame };
  }

  async listWorkItems(fileKey, filter, page) {
    const { byPath, root, matched } = this._v3Match(fileKey, filter);
    const level = root && root.path ? root.path.split('.').length : null;
    const keyOf = page.group === 'frame'
      ? n => (level === null || !inRoot(n, root) ? null : framePath(n, level))
      : n => {
        const parts = n.path ? n.path.split('.') : [];
        for (let i = parts.length; i > 0; i -= 1) {
          const p = parts.slice(0, i).join('.');
          const a = byPath.get(p);
          if (a && COMPONENT_TYPES.includes(a.nodeType)) return p;
        }
        return null;
      };
    const groups = new Map();
    const knownSets = new Map();
    for (const n of byPath.values()) {
      const set = n.attrs?.componentReference?.set;
      if (set) knownSets.set(set.id, set);
    }
    const setOf = keyNode => {
      if (!keyNode) return null;
      const ref = keyNode.attrs?.componentReference;
      if (ref?.set) return ref.set;
      const parent = byPath.get(keyNode.path?.split('.').slice(0, -1).join('.'));
      const owner = keyNode.nodeType === 'COMPONENT_SET' ? keyNode : parent?.nodeType === 'COMPONENT_SET' ? parent : null;
      if (!owner) return null;
      if (knownSets.has(owner.nodeId)) return knownSets.get(owner.nodeId);
      const ownRef = owner.attrs?.componentReference;
      return { id: owner.nodeId, key: ownRef?.key ?? owner.nodeId, name: owner.name };
    };
    const groupOf = n => {
      const keyPath = keyOf(n);
      const keyNode = keyPath === null ? null : byPath.get(keyPath);
      const set = setOf(keyNode);
      const identity = page.group === 'set' && set ? `set:${set.key ?? set.id}` : keyPath;
      const owner = page.group === 'set' && set ? this.nodes.get(this._nodeKey(fileKey, set.id)) || keyNode : keyNode;
      const k = keyPath === null ? '~' : owner ? `${documentSortKey(owner)} ${identity}` : keyPath;
      return { identity, k, keyPath, keyNode, set };
    };
    for (const n of matched) {
      const g = groupOf(n);
      if (!groups.has(g.identity)) groups.set(g.identity, { ...g, nodes: [] });
      const item = groups.get(g.identity);
      if (g.k < item.k) item.k = g.k;
      item.nodes.push(n);
    }
    const all = [...groups.values()].sort((a, b) => cmp(a.k, b.k));
    const progress = new Map();
    if (page.progress) {
      for (const n of this._v3Match(fileKey, { ...filter, states: ['dirty', 'clean', 'blocked'] }).matched) {
        const { identity } = groupOf(n);
        if (!progress.has(identity)) progress.set(identity, { total: 0, clean: 0 });
        const count = progress.get(identity);
        count.total += 1;
        if (v3State(n) === 'clean') count.clean += 1;
      }
    }
    const rest = page.after ? all.filter(g => g.k > page.after.k) : all;
    const pageRows = rest.slice(0, page.limit);
    const items = pageRows.map(({ k, keyPath, nodes, identity, set }) => {
      const keyNode = keyPath === null ? null : byPath.get(keyPath) || null;
      const keyId = keyPath === null ? null : pathNodeIds(keyPath).pop();
      const sorted = nodes.slice().sort((a, b) => cmp(documentSortKey(a), documentSortKey(b)) || cmp(a.nodeId, b.nodeId));
      /** @type {Record<string, any>} */
      const item = {
        k, keyId: page.group === 'set' && set ? set.key ?? set.id : keyId,
        name: page.group === 'set' && set ? set.name : keyNode ? keyNode.name ?? null : null,
        type: page.group === 'set' && set ? 'COMPONENT_SET' : keyNode ? keyNode.nodeType ?? null : null,
        ...(set ? { set } : {}),
        nodeCount: nodes.length,
        categories: [...new Set(nodes.flatMap(n => n.changeCategories || []))].sort(),
        changedProps: [...new Set(nodes.flatMap(n => n.changedProps || []))].sort(),
        nodeIds: sorted.slice(0, page.maxIds).map(n => n.nodeId),
        ...(page.progress ? { progress: progress.get(identity) } : {}),
      };
      if (page.group === 'set' && set) {
        const variants = new Map();
        for (const n of sorted) {
          const variant = groupOf(n).keyNode;
          if (!variant || variant.nodeType !== 'COMPONENT') continue;
          if (!variants.has(variant.nodeId)) variants.set(variant.nodeId, { key: variant.attrs?.componentReference?.key ?? variant.nodeId, name: variant.name, nodeCount: 0 });
          variants.get(variant.nodeId).nodeCount++;
        }
        item.variants = [...variants.values()];
      }
      if (page.group === 'component') {
        item.placements = keyNode
          ? this._fileNodes(fileKey).filter(x => x.mainComponentId === keyNode.nodeId && !x.deletedAt).length
          : null;
        if (filter.regions) {
          item.placementsInScope = keyNode
            ? this._fileNodes(fileKey).filter(x => x.mainComponentId === keyNode.nodeId && !x.deletedAt && regionOf(x, filter.regions) >= 0).length
            : null;
        }
      }
      return item;
    });
    const last = items[items.length - 1];
    return { items, total: all.length, next: rest.length > page.limit ? { k: last.k, id: last.keyId ?? '' } : null };
  }

  /** `expand=instances`, step 1 (mirrors PostgresStore.expansionReach): reachable mains, breadth-first, with hop count and path. */
  async expansionReach(fileKey, { scope, maxDepth }) {
    const instances = this._fileNodes(fileKey).filter(n => n.mainComponentId && !n.deletedAt && n.path);
    const mainsIn = path => new Set(instances.filter(i => path === null || isDescendant(i.path, path)).map(i => i.mainComponentId));
    const found = new Map();
    let frontier = mainsIn(scope);
    for (let depth = 1; depth <= maxDepth && frontier.size; depth += 1) {
      const next = new Set();
      for (const id of frontier) {
        if (found.has(id)) continue;
        const main = this.nodes.get(this._nodeKey(fileKey, id));
        const path = main && main.path ? main.path : null;
        found.set(id, { mainComponentId: id, depth, path });
        if (path) for (const m of mainsIn(path)) if (!found.has(m)) next.add(m);
      }
      frontier = next;
    }
    return [...found.values()];
  }

  /** `expand=instances`, step 2 (mirrors PostgresStore.expansionEdges): each region's first instance of each main one hop deeper. */
  async expansionEdges(fileKey, { regions, mains }) {
    const depthOf = new Map(mains.map(m => [m.mainComponentId, m.depth]));
    const instances = this._fileNodes(fileKey).filter(n => n.mainComponentId && !n.deletedAt && n.path);
    const out = [];
    for (const r of regions) {
      const best = new Map();
      for (const i of instances) {
        if (depthOf.get(i.mainComponentId) !== r.depth + 1 || (r.path !== null && !isDescendant(i.path, r.path))) continue;
        const b = best.get(i.mainComponentId);
        if (!b || (cmp(documentSortKey(i), documentSortKey(b)) || cmp(i.nodeId, b.nodeId)) < 0) best.set(i.mainComponentId, i);
      }
      for (const i of best.values()) {
        out.push({ region: r.key, instanceId: i.nodeId, instancePath: i.path, instanceKey: documentSortKey(i), mainComponentId: i.mainComponentId });
      }
    }
    return out;
  }

  async insertEvent({ fileKey, type, actor = null, data = {}, createdAt = null }) {
    this._eventSeq += 1;
    const event = { id: this._eventSeq, fileKey, type, actor: actor ?? null, data: clone(data) || {}, createdAt: createdAt ?? now() };
    this.events.set(event.id, event);
    return clone(event);
  }

  async latestEvent(type) {
    const events = [...this.events.values()].filter(e => e.type === type);
    events.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
    return clone(events[0]) ?? null;
  }

  /**
   * Events with `after < id < before`, oldest first (`order: 'desc'`: newest first), each with its file's `fileName`;
   * `fileKey` (or all files when null), `types`, `nodeId` and `since` narrow them.
   *
   * @param {Parameters<Store['listEvents']>[0]} [options]
   */
  async listEvents({ fileKey = null, after = 0, before = null, order = 'asc', types = [], nodeId = null, since = null, limit = 100 } = {}) {
    const out = [];
    for (const e of this.events.values()) {
      if (e.id <= after || (before !== null && e.id >= before)) continue;
      if ((fileKey !== null && e.fileKey !== fileKey) || (types.length && !types.includes(e.type))) continue;
      if (nodeId !== null && e.data.nodeId !== nodeId && !(Array.isArray(e.data.nodeIds) && e.data.nodeIds.includes(nodeId))) continue;
      if (since !== null && Date.parse(e.createdAt) < Date.parse(since)) continue;
      out.push(e);
    }
    const dir = order === 'desc' ? -1 : 1;
    return out.sort((a, b) => dir * (a.id - b.id)).slice(0, limit).map(e => ({ ...clone(e), fileName: this._fileName(e.fileKey) }));
  }

  async getEvent(fileKey, id) {
    const e = this.events.get(id);
    return e && (fileKey === null || e.fileKey === fileKey) ? clone(e) : null;
  }

  /** The newest event id of the file, 0 when it has none. */
  async lastEventId(fileKey) {
    let last = 0;
    for (const e of this.events.values()) if ((fileKey === null || e.fileKey === fileKey) && e.id > last) last = e.id;
    return last;
  }

  /** `[{ fileKey, id }]`: the newest event id of each of `fileKeys` that has events. */
  async latestEventIds(fileKeys) {
    const wanted = fileKeys === null ? null : new Set(fileKeys);
    const latest = new Map();
    for (const e of this.events.values()) {
      if ((!wanted || wanted.has(e.fileKey)) && e.id > (latest.get(e.fileKey) || 0)) latest.set(e.fileKey, e.id);
    }
    return Array.from(latest, ([fileKey, id]) => ({ fileKey, id }));
  }

  /** Deletes events created before `before`; returns how many. */
  async pruneEvents(before) {
    let n = 0;
    for (const [id, e] of this.events) {
      if (Date.parse(e.createdAt) < Date.parse(before)) { this.events.delete(id); n += 1; }
    }
    return n;
  }
}

module.exports = { MemoryStore };
