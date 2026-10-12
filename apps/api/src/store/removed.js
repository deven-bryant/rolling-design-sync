'use strict';

/*
 * Removed work items (docs/api-v3-design.md, "Removed design"): the `uses` and
 * `warnings` of an item for a removed root, shaped the same for both stores.
 */

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `uses` from one row per main component referenced by the removed subtree's
 * instance rows: components with no live placements first, then by name and id.
 *
 * @param {{ componentId: string, name?: string | null, ref?: any, placementsRemoved: number, livePlacements: number }[]} rows
 */
function removedUses(rows) {
  return rows
    .map(({ componentId, name, ref, placementsRemoved, livePlacements }) => ({
      componentId,
      name: name ?? null,
      ...(ref && ref.set ? { set: ref.set } : {}),
      ...(ref && typeof ref.remote === 'boolean' ? { remote: ref.remote } : {}),
      placementsRemoved,
      livePlacements,
    }))
    .sort((a, b) => Number(a.livePlacements > 0) - Number(b.livePlacements > 0)
      || cmp(a.name ?? '', b.name ?? '') || cmp(a.componentId, b.componentId));
}

/**
 * `warnings` from the removed COMPONENT / COMPONENT_SET rows of the subtree
 * (root included) with their live placements, in document order.
 *
 * @param {{ componentId: string, docKey: string, livePlacements: number }[]} rows
 */
function removedWarnings(rows) {
  return rows
    .filter(r => r.livePlacements > 0)
    .sort((a, b) => cmp(a.docKey, b.docKey) || cmp(a.componentId, b.componentId))
    .map(({ componentId, livePlacements }) => ({ code: 'main_removed_with_live_placements', componentId, livePlacements }));
}

/** Work-item sort key prefix of removed items: after every component key, before the keyless item ('~'). */
const REMOVED_K = '}';

module.exports = { removedUses, removedWarnings, REMOVED_K };
