'use strict';

/*
 * Check targets (docs/api-v3-design.md, "Check targets"): which nodes are
 * render-checked and how. Every synced scope has one switch, `checks`
 * (default true; `scope_setting`). A checked scope makes its top-level FRAME /
 * COMPONENT / INSTANCE nodes, the variants of its top-level COMPONENT_SETs and
 * every main COMPONENT inside it check targets (the union, each node once).
 * Auto targets are `screen` rows with `source: auto`, kept in step by
 * `reconcileTargets` after syncs, scope switches and settings changes.
 * Variants that differ only in mapped variant properties form a family that
 * shares one route.
 */
const { fileSettings } = require('./nodeService');
const core = require('@rolling-design-sync/core');
const { pathNodeIds } = require('./ltree');

/** Legacy scope kinds (rev9b drafts): `screens` / `components` = checked, `none` = not. */
const SCOPE_KINDS = Object.freeze(['screens', 'components', 'none']);
const checksOfKind = kind => kind !== 'none';
const TOP_LEVEL_TYPES = ['FRAME', 'COMPONENT', 'INSTANCE'];
const MAX_SIDE = 8192;
const AUTO_ACTOR = 'auto-targets';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A variant's properties: `attrs.variantProperties`, else parsed from a `Prop=Value, …` name.
 * @returns {Record<string, string>}
 */
function variantProps(node) {
  const vp = node && node.attrs && node.attrs.variantProperties;
  if (isObject(vp) && !vp.$unreadable) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(vp)) if (typeof v === 'string') out[k] = v;
    return out;
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of String((node && node.name) || '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Theme and query from the variant's mapped properties (`settings.variantMappings`). */
function mappedRendering(props, mappings) {
  let theme = null;
  const query = [];
  for (const name of Object.keys(props).sort(cmp)) {
    const m = mappings[name];
    if (!isObject(m)) continue;
    const value = isObject(m.values) && typeof m.values[props[name]] === 'string' ? m.values[props[name]] : props[name];
    if (m.as === 'theme') theme = value;
    else if (m.as === 'query') query.push(`${encodeURIComponent(m.key || name)}=${encodeURIComponent(value)}`);
  }
  return { theme, query: query.length ? query.join('&') : null };
}

/**
 * Variants of one set differing only in mapped properties share a family key.
 * @param {any} node
 * @param {string | null} setId
 * @param {Record<string, string>} props
 * @param {Record<string, any>} mappings
 */
function familyKeyOf(node, setId, props, mappings) {
  if (!setId) return node.nodeId;
  const rest = Object.keys(props).filter(k => !isObject(mappings[k])).sort(cmp).map(k => `${k}=${props[k]}`);
  return `${setId}|${rest.join(', ')}`;
}

const viewportOf = node => {
  const attrs = node.attrs || {};
  const side = v => Math.min(MAX_SIDE, Math.max(1, Math.round(Number(v) || 0)));
  return { width: side(attrs.width), height: side(attrs.height) };
};

/**
 * The scopes whose targets are detected: every synced scope (not the tokens
 * scope) unless its switch is off.
 * @param {import('./store/types').Store} store
 * @returns {Promise<string[]>}
 */
async function checkedScopes(store, fileKey) {
  const off = new Set((await store.listScopeChecks(fileKey)).filter(c => !c.checks).map(c => c.nodeId));
  return (await store.listScopes(fileKey)).map(s => s.nodeId).filter(id => !core.isTokenNodeId(id) && !off.has(id)).sort(cmp);
}

/**
 * The auto targets of the file's checked scopes, by node id (first scope wins).
 * `level` is deprecated: `component` for a main component found only below
 * the top level, else `screen`.
 * @param {import('./store/types').Store} store
 * @param {string[]} scopeIds
 * @returns {Promise<Map<string, { nodeId: string, level: 'screen' | 'component', scopeId: string, familyKey: string, theme: string | null, query: string | null, viewport: { width: number, height: number } }>>}
 */
async function detectTargets(store, fileKey, settings, scopeIds) {
  const out = new Map();
  const mappings = settings.variantMappings || {};
  for (const scopeId of scopeIds) {
    const root = await store.getNode(fileKey, scopeId);
    if (!root || root.deletedAt) continue;
    const subtree = (await store.listNodeSubtree(fileKey, root.nodeId, { includeDeleted: false })).filter(n => !n.library);
    const byId = new Map(subtree.map(n => [n.nodeId, n]));
    /** @param {any} node @param {'screen' | 'component'} level */
    const add = (node, level) => {
      if (out.has(node.nodeId)) return;
      const parent = node.parentId ? byId.get(node.parentId) : null;
      const setId = node.nodeType === 'COMPONENT' && parent && parent.nodeType === 'COMPONENT_SET' ? parent.nodeId : null;
      const props = node.nodeType === 'COMPONENT' ? variantProps(node) : {};
      const { theme, query } = mappedRendering(props, mappings);
      out.set(node.nodeId, {
        nodeId: node.nodeId, level, scopeId: root.nodeId, theme, query, viewport: viewportOf(node), familyKey: familyKeyOf(node, setId, props, mappings),
      });
    };
    for (const child of subtree.filter(n => n.parentId === root.nodeId)) {
      if (TOP_LEVEL_TYPES.includes(child.nodeType || '')) add(child, 'screen');
      else if (child.nodeType === 'COMPONENT_SET') {
        for (const v of subtree.filter(n => n.parentId === child.nodeId && n.nodeType === 'COMPONENT')) add(v, 'screen');
      }
    }
    for (const n of subtree.filter(x => x.nodeType === 'COMPONENT' && !x.isInstance)) add(n, 'component');
  }
  return out;
}

const sameAuto = (s, d) => s.level === d.level && s.familyKey === d.familyKey && s.theme === d.theme && s.query === d.query
  && s.viewport.width === d.viewport.width && s.viewport.height === d.viewport.height;

/**
 * Brings the file's auto targets in line with its scope switches and
 * settings: creates and updates detected ones, removes the rest (with their
 * checks and images). Manual screens are never touched; `excluded` survives.
 * Returns the removed attachment rows, whose blobs the caller deletes after
 * the transaction.
 * @param {import('./store/types').Store} store
 * @param {string} fileKey
 * @param {{ at: string }} options
 */
async function reconcileTargets(store, fileKey, { at }) {
  let removed = [];
  await store.transaction(async tx => {
    const [file] = await tx.listFiles({ fileKey });
    if (!file) return;
    const settings = fileSettings(file);
    const wanted = settings.autoTargets ? await detectTargets(tx, fileKey, settings, await checkedScopes(tx, fileKey)) : new Map();
    const existing = new Map((await tx.listScreens(fileKey)).map(s => [s.nodeId, s]));
    for (const d of wanted.values()) {
      const s = existing.get(d.nodeId);
      if (s && (s.source === 'manual' || sameAuto(s, d))) continue;
      await tx.upsertScreen({
        fileKey, nodeId: d.nodeId, route: null, viewport: d.viewport, theme: d.theme, query: d.query, masks: s ? s.masks : [],
        threshold: s ? s.threshold : 1, level: d.level, source: 'auto', familyKey: d.familyKey, gallery: s ? s.gallery : null,
        maskNodeIds: s ? s.maskNodeIds : [], by: AUTO_ACTOR, at,
      });
    }
    for (const s of existing.values()) {
      if (s.source !== 'auto' || wanted.has(s.nodeId)) continue;
      removed = removed.concat(await removeTarget(tx, fileKey, s));
    }
  });
  return removed;
}

/** Deletes a target row with its checks and their attachments (in `tx`); returns the removed attachment rows. */
async function removeTarget(tx, fileKey, s) {
  const checks = await tx.deleteChecks(fileKey, s.nodeId);
  const ids = [...(s.referenceId ? [s.referenceId] : []), ...(await tx.listAttachments(fileKey, 'screen', [s.nodeId])).map(a => a.attachmentId)];
  for (const c of checks) ids.push(...(await tx.listAttachments(fileKey, 'check', [c.checkId])).map(a => a.attachmentId));
  const removed = await tx.deleteAttachments(fileKey, [...new Set(ids)]);
  await tx.deleteScreen(fileKey, s.nodeId);
  return removed;
}

// --- node maps and attribution ----------------------------------------------
const NODE_MAP_MAX_ENTRIES = 20000;
const NODE_MAP_MAX_BYTES = 2 * 1024 * 1024;
/** A region touching more than this many nodes is attributed to their nearest common parent. */
const MAX_ATTRIBUTED_PER_REGION = 2;

const area = r => Math.max(0, r.width) * Math.max(0, r.height);
function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width), btm = Math.min(a.y + a.height, b.y + b.height);
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : null;
}
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** Mask rectangles for `maskNodeIds` from the node map, clipped to the viewport. */
function nodeMasks(nodeMap, maskNodeIds, viewport) {
  if (!nodeMap || !maskNodeIds || !maskNodeIds.length) return [];
  const ids = new Set(maskNodeIds);
  const bounds = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const out = [];
  for (const e of nodeMap) {
    if (!ids.has(e.nodeId) && !(e.mainNodeId && ids.has(e.mainNodeId))) continue;
    const r = intersect({ x: Math.floor(e.x), y: Math.floor(e.y), width: Math.ceil(e.width), height: Math.ceil(e.height) }, bounds);
    if (r) out.push(r);
  }
  return out;
}

/** The nearest common ancestor (by stored path) of `nodes`; null when they share none. */
function commonParent(nodes) {
  const paths = nodes.map(n => pathNodeIds(n.path));
  if (!paths.length) return null;
  let prefix = paths[0];
  for (const p of paths.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < p.length && prefix[i] === p[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  return prefix.length ? prefix[prefix.length - 1] : null;
}

/**
 * Attributes each differing region to nodes: the deepest node-map entries
 * with their own record that it touches (an instance sublayer counts as its
 * `mainNodeId`); an entry is skipped when a deeper touched entry covers its
 * whole overlap with the region. More than MAX_ATTRIBUTED_PER_REGION nodes →
 * their nearest common parent, or the target when that is outside it.
 * @param {{ x: number, y: number, width: number, height: number }[]} regions
 * @param {{ nodeId: string, mainNodeId?: string, x: number, y: number, width: number, height: number, depth: number }[]} nodeMap
 * @param {Map<string, any>} records live stored nodes by id
 * @param {{ nodeId: string, subtree: Set<string> }} target
 * @returns {{ nodeId: string, regions: number[] }[]} by node, in first-region order
 */
function attribute(regions, nodeMap, records, target) {
  const entries = nodeMap.map(e => ({ ...e, recordId: records.has(e.nodeId) ? e.nodeId : (e.mainNodeId && records.has(e.mainNodeId) ? e.mainNodeId : null) }))
    .filter(e => e.recordId && e.width > 0 && e.height > 0);
  const out = new Map();
  regions.forEach((region, index) => {
    const hits = [];
    for (const e of entries) {
      const overlap = intersect(e, region);
      if (overlap) hits.push({ e, overlap });
    }
    const leaves = hits.filter(h => !hits.some(o => o !== h && o.e.depth > h.e.depth && contains(o.e, h.overlap)));
    /** @type {string[]} */
    let ids = [...new Set(leaves.map(h => String(h.e.recordId)))];
    if (ids.length > MAX_ATTRIBUTED_PER_REGION) {
      const parent = commonParent(ids.map(id => records.get(id)));
      ids = [parent && target.subtree.has(parent) ? parent : target.nodeId];
    }
    if (!ids.length) ids = [target.nodeId];
    for (const id of ids) {
      if (!out.has(id)) out.set(id, { nodeId: id, regions: [] });
      out.get(id).regions.push(index);
    }
  });
  return Array.from(out.values());
}

/** Validates an uploaded node map; returns the normalised entries or an error message. */
function normaliseNodeMap(raw) {
  if (!Array.isArray(raw)) return { error: 'must be an array' };
  if (raw.length > NODE_MAP_MAX_ENTRIES) return { error: `has ${raw.length} entries; at most ${NODE_MAP_MAX_ENTRIES}` };
  const out = raw.map(e => {
    const row = {
      nodeId: String(e.nodeId), x: Math.round(Number(e.x)), y: Math.round(Number(e.y)),
      width: Math.round(Number(e.width)), height: Math.round(Number(e.height)), depth: Math.round(Number(e.depth) || 0),
    };
    if (typeof e.mainNodeId === 'string' && e.mainNodeId) row.mainNodeId = e.mainNodeId;
    return row;
  });
  const bytes = Buffer.byteLength(JSON.stringify(out));
  if (bytes > NODE_MAP_MAX_BYTES) return { error: `is ${bytes} bytes as JSON; at most ${NODE_MAP_MAX_BYTES}` };
  return { entries: out, bytes };
}

module.exports = {
  SCOPE_KINDS, checksOfKind, checkedScopes, AUTO_ACTOR, NODE_MAP_MAX_ENTRIES, NODE_MAP_MAX_BYTES, MAX_ATTRIBUTED_PER_REGION,
  variantProps, mappedRendering, detectTargets, reconcileTargets, removeTarget, nodeMasks, attribute, commonParent, normaliseNodeMap, area,
};
