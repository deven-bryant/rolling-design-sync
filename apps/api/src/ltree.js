'use strict';

/*
 * Figma node ids ("1:2", "I3:4;5:6") are not valid ltree labels, which allow
 * only [A-Za-z0-9_]. Every other byte is escaped as `_<hex>` (and `_` itself as
 * `_5f`), so the mapping node id -> label is injective and reversible. The
 * server owns this encoding: clients send plain Figma node ids and never
 * ltree syntax.
 */

const label = nodeId => String(nodeId).replace(/[^A-Za-z0-9]/g, c => '_' + c.charCodeAt(0).toString(16).padStart(2, '0'));

const unlabel = lbl => String(lbl).replace(/_([0-9a-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

/**
 * Materialized ltree path for a node: its ancestors' labels followed by its
 * own. `ancestors` is a list of node ids (root first); a trailing `nodeId` in
 * that list is tolerated.
 */
function buildPath(nodeId, ancestors = []) {
  const ids = ancestors.filter(id => typeof id === 'string' && id.length > 0);
  if (ids[ids.length - 1] === nodeId) ids.pop();
  return [...ids, nodeId].map(label).join('.');
}

/** True when `path` is `ancestorPath` or one of its descendants (ltree `<@`). */
const isDescendant = (path, ancestorPath) => path === ancestorPath || path.startsWith(ancestorPath + '.');

/** Node ids of a path, root first (inverse of buildPath). */
const pathNodeIds = path => (path ? String(path).split('.').map(unlabel) : []);

module.exports = { label, unlabel, buildPath, isDescendant, pathNodeIds };
