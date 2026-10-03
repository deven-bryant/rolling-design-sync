'use strict';

/*
 * Event retention (docs/api-v3-phase2.md, "Retention"): events older than
 * RDS_EVENT_RETENTION_DAYS are deleted on startup and hourly.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Deletes the events older than `retentionDays`; returns how many. */
async function pruneEvents(store, { retentionDays, now = () => new Date() }) {
  return store.pruneEvents(new Date(now().getTime() - retentionDays * DAY_MS).toISOString());
}

/**
 * Prunes now and every `intervalMs`; returns `stop()`.
 * @param {import('../store/types').Store} store
 * @param {{ retentionDays: number, intervalMs?: number, now?: () => Date, log?: { info: Function, error: Function } | null }} options
 */
function startRetention(store, { retentionDays, intervalMs = HOUR_MS, now, log = null }) {
  const run = () => pruneEvents(store, { retentionDays, now })
    .then(n => { if (n && log) log.info(`Pruned ${n} event(s) older than ${retentionDays} day(s).`); })
    .catch(err => { if (log) log.error({ err }, 'event pruning failed'); });
  const ready = run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  const stop = () => clearInterval(timer);
  stop.ready = ready;
  return stop;
}

module.exports = { pruneEvents, startRetention, HOUR_MS, DAY_MS };
