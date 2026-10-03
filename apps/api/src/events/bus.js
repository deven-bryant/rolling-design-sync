'use strict';

/*
 * Event bus (docs/api-v3-phase2.md, "Event bus"). A bus carries only
 * `{ fileKey, id }` wake-ups; subscribers read the rows from the `event` table.
 *
 *   publish(fileKey, id)   after the transaction that wrote event `id` commits
 *   subscribe(fileKey, fn) fn(id) on every event of the file (null = all files)
 *   close()
 *
 * Delivery is at-least-once and may repeat or reorder ids, so subscribers read
 * "events after the last id I sent" rather than trusting the id they are given.
 */

/** Per-file subscriber sets; shared by the in-memory and Postgres buses. */
class Subscribers {
  /**
   * `onError(err)` sees what a subscriber throws.
   * @param {{ onError?: (err: unknown) => void }} [options]
   */
  constructor({ onError = () => {} } = {}) {
    this.byFile = new Map();
    this.onError = onError;
  }

  add(fileKey, fn) {
    let set = this.byFile.get(fileKey);
    if (!set) this.byFile.set(fileKey, (set = new Set()));
    const entry = { fn };
    set.add(entry);
    return () => {
      set.delete(entry);
      if (!set.size && this.byFile.get(fileKey) === set) this.byFile.delete(fileKey);
    };
  }

  dispatch(fileKey, id) {
    const entries = [...(this.byFile.get(fileKey) || []), ...(this.byFile.get(null) || [])];
    for (const { fn } of entries) {
      try { fn(id); } catch (err) { this.onError(err); }
    }
  }

  fileKeys() { return [...this.byFile.keys()]; }

  count(fileKey) {
    if (fileKey === undefined) return [...this.byFile.values()].reduce((n, s) => n + s.size, 0);
    const set = this.byFile.get(fileKey);
    return set ? set.size : 0;
  }

  clear() { this.byFile.clear(); }
}

/** Single-process fan-out, for the embedded stores (RDS_STORE=local|memory). */
class MemoryBus {
  constructor({ log = null } = {}) {
    this.log = log;
    this.subscribers = new Subscribers({ onError: err => { if (this.log) this.log.error({ err }, 'event subscriber failed'); } });
  }

  async start() {}

  publish(fileKey, id) { this.subscribers.dispatch(fileKey, id); }

  subscribe(fileKey, fn) { return this.subscribers.add(fileKey, fn); }

  /** Live subscriptions, for one file or all of them. */
  subscriberCount(fileKey) { return this.subscribers.count(fileKey); }

  async close() { this.subscribers.clear(); }
}

module.exports = { MemoryBus, Subscribers };
