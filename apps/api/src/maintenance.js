'use strict';

/*
 * Startup maintenance (docs/api-v3-agent-ergonomics.md, "8. Repairing missing
 * change data"): an ordered list of repair steps that server.js runs after the
 * store opens and before the server listens. Each step is idempotent, works in
 * batches, and resolves to the number of rows it repaired; a failing step is
 * logged as a warning and the next one still runs.
 */
const { changeColumns, sameChanges } = require('./nodeService');
const { ROOT_KEY, rankChildren, childKey } = require('./documentOrder');

const BATCH_SIZE = 500;

/**
 * Step `change-data`: rows with a `changeType` but no `changedProps` (synced
 * before v0.8.0, backfilled by its migration) get their change columns
 * recomputed by the write path's `changeColumns`; only rows whose result
 * differs are written.
 */
async function repairChangeData(store, { batchSize = BATCH_SIZE } = {}) {
  let repaired = 0;
  let after = null;
  for (;;) {
    const rows = await store.listChangeRepairCandidates({ after, limit: batchSize });
    if (!rows.length) break;
    const items = [];
    for (const row of rows) {
      const next = changeColumns(row);
      if (sameChanges(next, row)) continue;
      items.push({ fileKey: row.fileKey, nodeId: row.nodeId, contentHash: row.contentHash, from: row.changeType, ...next });
    }
    if (items.length) repaired += await store.repairChangeColumns(items);
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1];
    after = { fileKey: last.fileKey, nodeId: last.nodeId };
  }
  return repaired;
}

/**
 * Step `document-order` ("9. Document order"): rows without an `orderKey`
 * (synced before it existed) get one, parents before children — the key of a
 * node under an unstored parent is the root key, else its parent's key plus
 * its rank among the parent's live children (a tombstoned row ranks as if it
 * were still there). A row whose parent has no key yet is left for the write
 * path.
 */
async function backfillDocumentOrder(store, { batchSize = BATCH_SIZE } = {}) {
  let written = 0;
  let after = null;
  for (;;) {
    const rows = await store.listOrderKeyCandidates({ after, limit: batchSize });
    if (!rows.length) break;
    const keys = new Map(); // `${fileKey}\0${nodeId}` -> key assigned in this batch
    const ranks = new Map(); // `${fileKey}\0${parentId}` -> { parent, ranked } over live children
    const items = [];
    for (const row of rows) {
      const k = id => `${row.fileKey}\u0000${id}`;
      let key = null;
      if (!row.parentId) key = ROOT_KEY;
      else {
        if (!ranks.has(k(row.parentId))) {
          const [parent] = await store.getNodes(row.fileKey, [row.parentId]);
          const kids = parent ? await store.listChildren(row.fileKey, [parent.nodeId]) : [];
          ranks.set(k(row.parentId), { parent: parent || null, kids });
        }
        const { parent, kids } = ranks.get(k(row.parentId));
        const parentKey = parent ? keys.get(k(parent.nodeId)) ?? parent.orderKey : null;
        if (!parent) key = ROOT_KEY;
        else if (parentKey != null) {
          const siblings = kids.some(c => c.nodeId === row.nodeId) ? kids : [...kids, row];
          key = childKey(parentKey, rankChildren(parent.attrs, siblings).indexOf(row.nodeId));
        }
      }
      if (key === null) continue;
      keys.set(k(row.nodeId), key);
      items.push({ fileKey: row.fileKey, nodeId: row.nodeId, orderKey: key });
    }
    if (items.length) written += await store.setOrderKeys(items);
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1];
    after = { fileKey: last.fileKey, depth: last.depth, nodeId: last.nodeId };
  }
  return written;
}

const STEPS = Object.freeze([
  { name: 'change-data', run: repairChangeData },
  { name: 'document-order', run: backfillDocumentOrder },
]);

/**
 * Runs `steps` in order against `store`, logging one line per step. Resolves
 * to `[{ name, count }]` (`count: null` and `error` for a step that failed).
 *
 * @param {import('./store/types').Store} store
 * @param {{ steps?: readonly { name: string, run: Function }[], log?: { info: Function, warn: Function }, batchSize?: number }} [options]
 */
async function runMaintenance(store, { steps = STEPS, log = console, batchSize = BATCH_SIZE } = {}) {
  const results = [];
  for (const step of steps) {
    try {
      const count = await step.run(store, { batchSize });
      log.info(`Maintenance ${step.name}: ${count} row(s) repaired.`);
      results.push({ name: step.name, count });
    } catch (err) {
      log.warn({ err }, `Maintenance ${step.name} failed, continuing startup: ${err.message}`);
      results.push({ name: step.name, count: null, error: err });
    }
  }
  return results;
}

module.exports = { runMaintenance, repairChangeData, backfillDocumentOrder, STEPS, BATCH_SIZE };
