'use strict';

// Document order (docs/api-v3-agent-ergonomics.md, "9. Document order").
// A node's `orderKey` is its parent's key + '.' + its rank among its stored
// siblings, zero-padded to RANK_DIGITS; nodes whose parent isn't stored get
// ROOT_KEY. Sorting by (root path, orderKey) walks the design's layers in the
// order a reader sees them, not in node-id order.

const RANK_DIGITS = 5;
const ROOT_KEY = '0'.repeat(RANK_DIGITS);
const AUTO_LAYOUT = new Set(['HORIZONTAL', 'VERTICAL', 'GRID']);

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function translation(attrs) {
  const t = attrs && attrs.relativeTransform;
  if (!Array.isArray(t) || !Array.isArray(t[0]) || !Array.isArray(t[1])) return null;
  const x = t[0][2];
  const y = t[1][2];
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// Pure: `parentAttrs` of the parent, `children` = [{ nodeId, attrs }] (its
// stored children). Returns the children's node ids in document order.
function rankChildren(parentAttrs, children) {
  const attrs = parentAttrs || {};
  const index = new Map();
  if (Array.isArray(attrs.childOrder)) attrs.childOrder.forEach((id, i) => { if (!index.has(id)) index.set(id, i); });
  const listed = [];
  const missing = [];
  for (const c of children) (index.has(c.nodeId) ? listed : missing).push(c);
  const byIndex = (a, b) => index.get(a.nodeId) - index.get(b.nodeId);

  let ranked;
  if (AUTO_LAYOUT.has(attrs.layoutMode)) {
    const absolute = c => (c.attrs || {}).layoutPositioning === 'ABSOLUTE';
    ranked = [...listed.filter(c => !absolute(c)).sort(byIndex), ...listed.filter(absolute).sort(byIndex)];
  } else {
    const placed = listed.map(c => ({ c, t: translation(c.attrs) }));
    ranked = [
      ...placed.filter(/** @returns {p is { c: any, t: { x: number, y: number } }} */ p => !!p.t).sort((a, b) => a.t.y - b.t.y || a.t.x - b.t.x || byIndex(a.c, b.c)).map(p => p.c),
      ...placed.filter(p => !p.t).map(p => p.c).sort(byIndex),
    ];
  }
  missing.sort((a, b) => cmp(a.nodeId, b.nodeId));
  return [...ranked, ...missing].map(c => c.nodeId);
}

const childKey = (parentKey, rank) => `${parentKey}.${String(rank).padStart(RANK_DIGITS, '0')}`;

// Sort key for sort=document: the root's path (so separate roots keep a stable
// order), then the order key. Nodes without a key sort by path. Mirrored in SQL
// by `documentSortSql` (store/postgres.js); both must compare under "C".
function documentSortKey(n) {
  const path = n.path || '';
  if (n.orderKey == null) return path ? `${path} ` : '';
  const labels = path ? path.split('.') : [];
  const levels = n.orderKey.split('.').length;
  return `${labels.slice(0, Math.max(1, labels.length - levels + 1)).join('.')} ${n.orderKey}`;
}

const depth = n => (n.path ? n.path.split('.').length : 0);

// Re-rank the children of `parentIds` (and key `rootIds` as roots), rewriting
// changed keys and, for each moved child, every descendant's key prefix. Works
// top-down so a child keyed for the first time has its own children keyed too.
// Store methods: getNodes, listChildren, rekeySubtrees. Returns rows rekeyed.
/**
 * @param {any} store
 * @param {string} fileKey
 * @param {{ parentIds?: string[], rootIds?: string[] }} [options]
 */
async function reorderDocument(store, fileKey, { parentIds = [], rootIds = [] } = {}) {
  let changed = 0;
  if (rootIds.length) {
    const roots = await store.getNodes(fileKey, [...new Set(rootIds)]);
    const moves = roots.filter(r => r.orderKey !== ROOT_KEY).map(r => ({ nodeId: r.nodeId, path: r.path, from: r.orderKey, to: ROOT_KEY }));
    if (moves.length) changed += await store.rekeySubtrees(fileKey, moves);
    for (const m of moves) if (m.from == null) parentIds = [...parentIds, m.nodeId];
  }

  const seen = new Set();
  let pending = new Set(parentIds);
  while (pending.size) {
    const ids = [...pending].filter(id => !seen.has(id));
    pending = new Set();
    if (!ids.length) break;
    const parents = (await store.getNodes(fileKey, ids)).filter(p => p.orderKey != null);
    if (!parents.length) break;
    const level = Math.min(...parents.map(depth));
    const now = parents.filter(p => depth(p) === level);
    for (const p of parents) if (depth(p) !== level) pending.add(p.nodeId);
    for (const p of now) seen.add(p.nodeId);

    const children = await store.listChildren(fileKey, now.map(p => p.nodeId));
    const byParent = new Map();
    for (const c of children) {
      if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
      byParent.get(c.parentId).push(c);
    }
    const moves = [];
    for (const p of now) {
      const kids = byParent.get(p.nodeId) || [];
      const byId = new Map(kids.map(c => [c.nodeId, c]));
      rankChildren(p.attrs, kids).forEach((id, i) => {
        const c = byId.get(id);
        const to = childKey(p.orderKey, i);
        if (c.orderKey !== to) moves.push({ nodeId: c.nodeId, path: c.path, from: c.orderKey, to });
      });
    }
    if (moves.length) changed += await store.rekeySubtrees(fileKey, moves);
    for (const m of moves) if (m.from == null) pending.add(m.nodeId);
  }
  return changed;
}

module.exports = { RANK_DIGITS, ROOT_KEY, rankChildren, childKey, documentSortKey, reorderDocument };
