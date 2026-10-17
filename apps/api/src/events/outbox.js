'use strict';

/*
 * Transactional outbox (docs/api-v3-phase2.md, "Transactional outbox"): event
 * rows are inserted inside the transaction that makes the change and published
 * on the bus only after it commits. A failed transaction publishes nothing and,
 * rolling back, leaves no row.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

/** `data.nodeIds` holds at most this many ids. */
const MAX_EVENT_NODE_IDS = 500;

const EVENT_TYPES = Object.freeze([
  'sync.completed', 'nodes.cleared', 'claim.created', 'claim.renewed', 'claim.released', 'node.blocked', 'node.unblocked',
  'file.settings_changed', 'note.added', 'note.resolved', 'note.dismissed', 'render_check.requested', 'render_check.passed', 'render_check.mismatch',
]);

const capIds = ids => ids.slice(0, MAX_EVENT_NODE_IDS);

/** The calling client (`X-RDS-Client`) of the request being served; events emitted under it get `data.client`. */
const requestClient = new AsyncLocalStorage();

/** Runs `fn` with `client` (a string or null) as the client of the events it emits. */
const withClient = (client, fn) => requestClient.run(client ?? null, fn);

/**
 * `store.transaction(tx => fn(tx, emit))`, where `emit(fileKey, type, { actor, data })`
 * inserts an event through `tx`. Emitted events are published once the
 * transaction has committed. Emit last in the transaction: the Postgres store
 * holds a per-file lock from the first insert until commit.
 */
async function withEvents(store, bus, fn) {
  const emitted = [];
  const client = requestClient.getStore() ?? null;
  const emit = async (tx, fileKey, type, { actor = null, data = {} } = {}) => {
    const event = await tx.insertEvent({ fileKey, type, actor, data: client ? { ...data, client } : data });
    emitted.push(event);
    return event;
  };
  const result = await store.transaction(tx => fn(tx, (...args) => emit(tx, ...args)));
  if (bus) for (const e of emitted) bus.publish(e.fileKey, e.id);
  return result;
}

module.exports = { withEvents, withClient, capIds, MAX_EVENT_NODE_IDS, EVENT_TYPES };
