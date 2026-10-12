'use strict';

/*
 * Per-node change tracking (docs/node-sync-design.md) behind the v3 plugin
 * routes (v3/plugin.js) over the store interface (store/memory.js,
 * store/postgres.js).
 */
const core = require('@rolling-design-sync/core');
const { HttpError } = require('./errors');
const { buildPath, pathNodeIds } = require('./ltree');
const { withEvents } = require('./events/outbox');
const { reorderDocument } = require('./documentOrder');

const badRequest = (msg, code = 'bad_request') => new HttpError(400, code, msg);

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = v => typeof v === 'string' && v.trim().length > 0;

/** Instances are stored as placement rows (docs/node-sync-design.md, "Instance placements"). */
const isInstanceNode = u => u.isInstance === true || u.nodeType === 'INSTANCE';

const COMPONENT_TYPES = ['COMPONENT', 'COMPONENT_SET'];
const remoteRef = attrs => !!attrs && !!attrs.componentReference && attrs.componentReference.remote === true;

/** Per-file settings and their defaults (docs/api-v3-design.md, "Library components"). */
const DEFAULT_SETTINGS = Object.freeze({ trackLibraryComponents: true });

/** A file's effective settings: the stored known ones over the defaults. */
function fileSettings(file) {
  const stored = (file && file.settings) || {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof stored[k] === typeof DEFAULT_SETTINGS[k]) out[k] = stored[k];
  return out;
}

/**
 * Stamped on every upsert; rows with a lower stored `capture_version` are
 * reported as `stale` by `POST /v3/files/{fileKey}/exists` so the plugin re-scans them
 * (docs/node-sync-design.md, "Stale-main refresh"). 2 = instance-aware.
 */
const CAPTURE_VERSION = 2;

const CLEAN_CHANGES = Object.freeze({ changeType: null, changedProps: [], changeCategories: [] });

/**
 * The v3 change columns for a node row (docs/api-v3-design.md, "The change
 * model"): clean -> `null`/`[]`/`[]`; tombstoned -> `deleted`, diffed against
 * `null`; never implemented -> `added`; implemented -> `modified`, diffed
 * against `implementedAttrs` (empty when those are unknown, i.e. migrated).
 *
 * @param {{ dirty?: boolean, deletedAt?: string | null, implementedHash?: string | null, implementedAttrs?: object | null, attrs?: object | null }} row
 */
function changeColumns({ dirty, deletedAt, implementedHash, implementedAttrs, attrs }) {
  if (!dirty) return { ...CLEAN_CHANGES };
  const built = implementedAttrs ?? null;
  let changeType, diff;
  if (deletedAt) { changeType = 'deleted'; diff = core.diffAttrs(built, null); }
  else if (implementedHash === null || implementedHash === undefined) { changeType = 'added'; diff = core.diffAttrs(null, attrs ?? {}); }
  else { changeType = 'modified'; diff = built ? core.diffAttrs(built, attrs ?? {}) : null; }
  return { changeType, changedProps: diff ? diff.changedProps : [], changeCategories: diff ? diff.categories : [] };
}

const sameChanges = (a, b) => (a.changeType ?? null) === (b.changeType ?? null)
  && core.stable(a.changedProps ?? []) === core.stable(b.changedProps ?? [])
  && core.stable(a.changeCategories ?? []) === core.stable(b.changeCategories ?? []);

/** Optional batch metadata: absent / `null` / blank -> `null`; any other non-string is a 400. */
const optionalString = (v, name) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${name} must be a string.`);
  return v.trim() ? v : null;
};

/** Whether a node's own attrs changed how its children rank (docs/api-v3-agent-ergonomics.md, "9. Document order"). */
const orderInputsChanged = (a = {}, b = {}) => (a || {}).layoutMode !== (b || {}).layoutMode
  || core.stable((a || {}).childOrder ?? null) !== core.stable((b || {}).childOrder ?? null);

/** `path` may be a list of ancestor node ids (root first) or a dot-joined one. */
function pathInput(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (!value.every(nonEmptyString)) throw badRequest('path entries must be non-empty strings.');
    return value;
  }
  if (typeof value === 'string') return value.split('.').filter(Boolean);
  throw badRequest('path must be an array of node ids or a dot-joined string.');
}

/** Upper bound on `nodeIds` per `POST /v3/files/{fileKey}/exists` call (one batched query). */
const EXISTS_MAX_IDS = 5000;

class NodeSyncService {
  /**
   * @param {import('./store/types').Store} store
   * @param {{ now?: () => Date, existsMaxIds?: number, bus?: import('./events/bus').MemoryBus | import('./events/postgres').PostgresBus | null, libraryLinks?: import('./library').LibraryLinks | null }} [options]
   */
  constructor(store, { now = () => new Date(), existsMaxIds = EXISTS_MAX_IDS, bus = null, libraryLinks = null } = {}) {
    this.store = store;
    this.bus = bus;
    /** @type {import('./library').LibraryLinks | null} */
    this.libraryLinks = libraryLinks;
    this.now = now;
    this.existsMaxIds = existsMaxIds;
  }

  // --- plugin -------------------------------------------------------------

  /** The file's effective settings (defaults when the file was never synced). */
  async fileSettings(fileKey) {
    const [file] = await this.store.listFiles({ fileKey });
    return fileSettings(file);
  }

  /** `{ [nodeId]: contentHash }` for the node's subtree; `{}` when never scanned. */
  async subtreeHashes(fileKey, nodeId) {
    if (!nonEmptyString(fileKey)) throw badRequest('fileKey is required.');
    if (!nonEmptyString(nodeId)) throw badRequest('nodeId is required.');
    const rows = await this.store.listNodeSubtree(fileKey, nodeId, { includeDeleted: false });
    const out = {};
    for (const row of rows) out[row.nodeId] = row.contentHash ?? null;
    return out;
  }

  /**
   * `{ present: [nodeId, …], stale: [nodeId, …] }` — `present` is the subset of
   * `nodeIds` stored and not tombstoned; `stale ⊆ present` are those captured
   * with `capture_version < CAPTURE_VERSION`.
   */
  async exists(body) {
    if (!isObject(body)) throw badRequest('Body must be an object.');
    const { fileKey, nodeIds } = body;
    if (!nonEmptyString(fileKey)) throw badRequest('fileKey is required.');
    if (!Array.isArray(nodeIds)) throw badRequest('nodeIds must be an array.');
    if (!nodeIds.every(nonEmptyString)) throw badRequest('nodeIds must be node id strings.');
    if (nodeIds.length > this.existsMaxIds) throw badRequest(`nodeIds must contain at most ${this.existsMaxIds} ids.`, 'batch_too_large');
    const unique = [...new Set(nodeIds)];
    if (!unique.length) return { present: [], stale: [] };
    const versions = await this.store.nodeCaptureVersions(fileKey, unique);
    const present = [], stale = [];
    for (const { nodeId, captureVersion } of versions) {
      present.push(nodeId);
      if (captureVersion < CAPTURE_VERSION) stale.push(nodeId);
    }
    return { present, stale };
  }

  /**
   * Upsert the scanned deltas and tombstone what vanished from Figma.
   * `dirty` becomes `contentHash !== implementedHash`, so a node that is
   * edited back to its implemented state goes clean on its own.
   *
   * `markImplemented: true` (first-scan baseline) inserts never-seen nodes as
   * already implemented (`implementedCommit: 'baseline'`); existing rows,
   * tombstoned ones included, are upserted exactly as without the flag.
   *
   * Every write keeps the v3 change columns current (`changeColumns`), and a
   * content-hash change unblocks a blocked node. The file's `last_sync_at` is
   * bumped on every batch; optional `fileName` / `rootNodeId` also name the
   * file and record a `sync_event` with this batch's counts.
   *
   * A tombstoned node that was never implemented (`implementedHash` null)
   * resolves itself: it becomes a clean tombstone, counted as `autoResolved`.
   *
   * Events: one `sync.completed` per batch (its `counts.dirty`: nodes the
   * batch made dirty — new, or clean before; `counts.autoResolved`: the
   * never-built nodes it tombstoned clean), and a `node.unblocked` (`auto`)
   * for each blocked node whose content hash changed.
   */
  async batchUpsert(body) {
    if (!isObject(body)) throw badRequest('Body must be an object.');
    const { fileKey, upserts = [], deletedNodeIds = [], markImplemented = false } = body;
    const fileName = optionalString(body.fileName, 'fileName');
    const rootNodeId = optionalString(body.rootNodeId, 'rootNodeId');
    if (!nonEmptyString(fileKey)) throw badRequest('fileKey is required.');
    if (typeof markImplemented !== 'boolean') throw badRequest('markImplemented must be a boolean.');
    if (!Array.isArray(upserts)) throw badRequest('upserts must be an array.');
    if (!Array.isArray(deletedNodeIds)) throw badRequest('deletedNodeIds must be an array.');
    if (!deletedNodeIds.every(nonEmptyString)) throw badRequest('deletedNodeIds must be node id strings.');

    const rows = [];
    for (const u of upserts) {
      if (!isObject(u)) throw badRequest('Each upsert must be an object.');
      if (!nonEmptyString(u.nodeId)) throw badRequest('upsert.nodeId is required.');
      if (!nonEmptyString(u.contentHash)) throw badRequest(`upsert.contentHash is required (node ${u.nodeId}).`);
      if (u.nodeType !== undefined && u.nodeType !== null && typeof u.nodeType !== 'string') throw badRequest('upsert.nodeType must be a string.');
      if (u.name !== undefined && u.name !== null && typeof u.name !== 'string') throw badRequest('upsert.name must be a string.');
      if (u.parentId !== undefined && u.parentId !== null && !nonEmptyString(u.parentId)) throw badRequest('upsert.parentId must be a node id string or null.');
      if (u.attrs !== undefined && !isObject(u.attrs)) throw badRequest(`upsert.attrs must be an object (node ${u.nodeId}).`);
      if (u.isInstance !== undefined && u.isInstance !== null && typeof u.isInstance !== 'boolean') throw badRequest('upsert.isInstance must be a boolean.');
      if (u.mainComponentId !== undefined && u.mainComponentId !== null && !nonEmptyString(u.mainComponentId)) throw badRequest('upsert.mainComponentId must be a node id string or null.');
      if (u.library !== undefined && u.library !== null && typeof u.library !== 'boolean') throw badRequest('upsert.library must be a boolean.');
      const isInstance = isInstanceNode(u);
      // A library node: flagged by the plugin, or a main component / set whose own reference is remote.
      const library = u.library === true || (!isInstance && COMPONENT_TYPES.includes(u.nodeType) && remoteRef(u.attrs));
      rows.push({ ...u, isInstance, library, ancestors: pathInput(u.path) });
    }

    const nowIso = this.now().toISOString();
    return withEvents(this.store, this.bus, async (tx, emit) => {
      const paths = new Map();
      const ancestorsOf = async row => {
        if (row.ancestors) return row.ancestors;
        if (!row.parentId) return [];
        const known = paths.get(row.parentId);
        if (known) return known; // parent's own chain (ancestors + parent itself)
        const parent = await tx.getNode(fileKey, row.parentId);
        return parent && parent.path ? pathNodeIds(parent.path) : [row.parentId];
      };

      const prior = new Map((await tx.getNodes(fileKey, [...new Set(rows.map(r => r.nodeId))])).map(n => [n.nodeId, n]));
      const counts = { uploaded: rows.length, changed: 0, added: 0, deleted: 0, baselined: 0, autoResolved: 0 };
      const upserted = [];
      const unblocked = [];
      const dirtiedIds = new Set();
      const reorderParents = new Set();
      for (const row of rows) {
        const ancestors = await ancestorsOf(row);
        const ancestorIds = ancestors[ancestors.length - 1] === row.nodeId ? ancestors.slice(0, -1) : ancestors;
        paths.set(row.nodeId, [...ancestorIds, row.nodeId]);
        const existing = prior.get(row.nodeId) || null;
        const baselining = !existing && markImplemented;
        const implementedHash = existing ? existing.implementedHash : baselining ? row.contentHash : null;
        const expected = changeColumns({
          dirty: row.contentHash !== implementedHash,
          deletedAt: null,
          implementedHash,
          implementedAttrs: existing ? existing.implementedAttrs : baselining ? row.attrs ?? {} : null,
          attrs: row.attrs ?? {},
        });
        let node = await tx.upsertNode(fileKey, {
          nodeId: row.nodeId,
          nodeType: row.nodeType ?? null,
          name: row.name ?? null,
          parentId: row.parentId ?? null,
          path: buildPath(row.nodeId, ancestorIds),
          attrs: row.attrs ?? {},
          isInstance: row.isInstance,
          mainComponentId: row.mainComponentId ?? null,
          contentHash: row.contentHash,
          captureVersion: CAPTURE_VERSION,
          library: row.library,
          ...expected,
        }, markImplemented ? { implementedAt: nowIso } : null);
        // The upsert result is authoritative (a concurrent writer may have inserted the row meanwhile).
        const actual = changeColumns(node);
        if (!sameChanges(actual, node)) node = { ...(await tx.updateNode(fileKey, row.nodeId, actual)), baselined: node.baselined };
        prior.set(row.nodeId, node);
        upserted.push(node);
        if (node.parentId) reorderParents.add(node.parentId);
        if (existing && existing.parentId && existing.parentId !== node.parentId) reorderParents.add(existing.parentId);
        if (!existing || existing.deletedAt || orderInputsChanged(existing.attrs, node.attrs)) reorderParents.add(node.nodeId);
        if (existing && existing.blockedAt && !node.blockedAt) unblocked.push(existing);
        if (node.dirty && !(existing && existing.dirty)) dirtiedIds.add(node.nodeId);

        if (!existing) counts[node.baselined ? 'baselined' : 'added'] += 1;
        else if (existing.deletedAt || existing.contentHash !== row.contentHash) counts.changed += 1;
      }
      const wasDirty = new Set((deletedNodeIds.length ? await tx.getNodes(fileKey, [...new Set(deletedNodeIds)]) : []).filter(n => n.dirty).map(n => n.nodeId));
      const tombstoned = await tx.tombstoneNodes(fileKey, deletedNodeIds, nowIso);
      for (const n of tombstoned) if (n.dirty && !wasDirty.has(n.nodeId)) dirtiedIds.add(n.nodeId);
      for (const node of tombstoned) await tx.updateNode(fileKey, node.nodeId, changeColumns(node));
      counts.deleted = tombstoned.length;
      counts.autoResolved = tombstoned.filter(n => !n.dirty).length;
      for (const node of tombstoned) if (node.parentId) reorderParents.add(node.parentId);

      // Library roots: the library rows of this batch, and the mains (and sets) its instances with a remote reference point at.
      const libraryRoots = new Set(upserted.filter(n => n.library).map(n => n.nodeId));
      for (const n of upserted) {
        if (!n.isInstance || !remoteRef(n.attrs)) continue;
        if (n.mainComponentId) libraryRoots.add(n.mainComponentId);
        const set = n.attrs.componentReference.set;
        if (set && nonEmptyString(set.id)) libraryRoots.add(set.id);
      }
      const marked = new Set(await tx.markLibrarySubtrees(fileKey, [...libraryRoots]));
      const libraryIds = new Set([...upserted, ...tombstoned].filter(n => n.library).map(n => n.nodeId));
      for (const id of marked) libraryIds.add(id);
      const libraryDirty = [...dirtiedIds].filter(id => libraryIds.has(id)).length;
      if (libraryDirty) counts.libraryDirty = libraryDirty;
      const libraryRefs = [];
      if (this.libraryLinks && this.libraryLinks.enabled && libraryIds.size) {
        for (const n of await tx.getNodes(fileKey, [...libraryIds])) {
          const key = n.attrs && n.attrs.componentReference && n.attrs.componentReference.key;
          if (COMPONENT_TYPES.includes(n.nodeType) && nonEmptyString(key)) libraryRefs.push({ key, type: n.nodeType });
        }
      }

      const storedParents = new Set((await tx.getNodes(fileKey, [...new Set(upserted.map(n => n.parentId).filter(Boolean))])).map(n => n.nodeId));
      const rootIds = upserted.filter(n => !n.parentId || !storedParents.has(n.parentId)).map(n => n.nodeId);
      await reorderDocument(tx, fileKey, { parentIds: [...reorderParents], rootIds });

      await tx.upsertFile({ fileKey, name: fileName, lastSyncAt: nowIso });
      if (fileName !== null || rootNodeId !== null) await tx.recordSync({ fileKey, rootNodeId, counts, createdAt: nowIso });

      const summary = {
        fileKey,
        upserted: upserted.length,
        dirty: upserted.filter(n => n.dirty).length,
        tombstoned: tombstoned.length,
        autoResolved: counts.autoResolved,
        skippedInstances: 0, // kept for plugin/CLI compatibility; instances are stored now
      };
      if (markImplemented) summary.baselined = upserted.filter(n => n.baselined).length;

      await emit(fileKey, 'sync.completed', { actor: 'plugin', data: { rootNodeId, counts: { ...counts, dirty: dirtiedIds.size } } });
      for (const n of unblocked) {
        await emit(fileKey, 'node.unblocked', { actor: 'plugin', data: { nodeId: n.nodeId, reason: n.blockedReason ?? null, by: null, auto: true } });
      }
      return { summary, libraryRefs };
    }).then(({ summary, libraryRefs }) => {
      if (libraryRefs.length && this.libraryLinks) this.libraryLinks.enqueue(libraryRefs).catch(() => {});
      return summary;
    });
  }
}

module.exports = { NodeSyncService, changeColumns, sameChanges, fileSettings, DEFAULT_SETTINGS, EXISTS_MAX_IDS, CAPTURE_VERSION };
