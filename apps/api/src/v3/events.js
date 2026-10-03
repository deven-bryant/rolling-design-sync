'use strict';

/*
 * v3 events (docs/api-v3-phase2.md, "1. Events"): `GET /v3/files/{fileKey}/events`
 * is a server-sent-event stream with replay (`Accept: text/event-stream`) or,
 * otherwise, a JSON page of the event log.
 */
const { problem } = require('./problem');
const address = require('./address');
const schemas = require('./schemas');
const format = require('./format');
const { EVENT_TYPES } = require('../events/outbox');

const HEARTBEAT_MS = 20 * 1000;
const REPLAY_PAGE = 500;
const RETRY_MS = 3000;
const HOUR_MS = 60 * 60 * 1000;

// --- schemas -------------------------------------------------------------------
const { security, tags } = schemas.listNodes;
const { agentOp } = schemas;
const problemResponse = schemas.getFile.response[404];

const event = {
  type: 'object',
  properties: {
    id: { type: 'integer', description: 'Monotonic; the SSE `id` and the replay cursor.' },
    fileKey: { type: 'string' },
    type: { type: 'string', enum: EVENT_TYPES },
    actor: { type: ['string', 'null'], description: '`plugin`, or the worker / token label that caused it.' },
    data: { type: 'object', additionalProperties: true, description: 'IDs, counts, labels and commit refs; never design content.' },
    createdAt: { type: 'string' },
  },
};

const namedEvent = {
  ...event,
  properties: { ...event.properties, fileName: { type: ['string', 'null'], description: 'The Figma file\'s name (null before a sync sent one). JSON pages only.' } },
};
const page = items => ({
  type: 'object',
  description: 'The JSON page (the SSE stream is `text/event-stream`).',
  properties: {
    fileKey: { type: 'string' },
    events: { type: 'array', items },
    nextAfter: { type: 'integer', description: 'order=asc: the last id returned (or `after` when there were none).' },
    nextBefore: { type: 'integer', description: 'order=desc: the last (oldest) id returned (or `before`, or 0, when there were none).' },
  },
});

const fileEvents = {
  summary: 'List file events',
  description: [
    'The file\'s activity log, oldest first: syncs, clears, claims, blocks (IDs, counts and labels, never design content). Use it to see what changed since you last looked, or who holds what.',
    'JSON page `{ events, nextAfter }`: poll with `after` = the previous `nextAfter`; `after=0` starts from the oldest retained event. After a `sync.completed`, re-read the affected nodes.',
    'To read the newest events first, pass `order=desc`: the page `{ events, nextBefore }` is newest first; pass `before` = the previous `nextBefore` for the next older page (omit `before` to start at the newest event). A page shorter than `limit` is the last one. Filters apply the same in both orders.',
    `Types: ${EVENT_TYPES.join(', ')}.`,
    'With `Accept: text/event-stream`: a server-sent-event stream. Each message has `id` (the event id), `event` (the type) and `data` (the event as JSON).',
    'It replays the events after `Last-Event-ID` (header, sent by EventSource on reconnect) or `?after=`, then streams live; without either it streams live only.',
    'A `: heartbeat` comment is sent every 20 s. When the requested id is older than the replay window (RDS_EVENT_REPLAY_HOURS), one `event: reset` is sent instead of the replay — re-fetch state — and the stream continues live.',
    '`format` applies to the JSON page only (`ndjson` / `md` stream every event after `after` — with order=desc, before `before`, newest first — up to `limit` when given).',
    '`nodeId` matches data.nodeId or a member of data.nodeIds in JSON and SSE. `since` is an inclusive ISO timestamp lower bound on JSON pages (ignored for SSE). Filters combine with types, after and before. `order` and `before` apply to JSON pages only (SSE is always oldest first).',
  ].join(' '),
  tags, security,
  ...agentOp('list_events', 'events'),
  params: schemas.getFile.params,
  querystring: {
    type: 'object',
    properties: {
      after: { type: 'integer', minimum: 0, description: 'Only events with a greater id: the previous page\'s `nextAfter` (default 0 = from the start of the log).' },
      before: { type: 'integer', minimum: 0, description: 'Only events with a smaller id: with order=desc, the previous page\'s `nextBefore` (default: from the newest event). JSON pages only.' },
      order: { type: 'string', enum: ['asc', 'desc'], default: 'asc', description: '`asc` (default): oldest first, page with `after` / `nextAfter`. `desc`: newest first, page with `before` / `nextBefore`. JSON pages only; SSE is unchanged.' },
      types: { type: 'string', description: `Comma-separated event types: ${EVENT_TYPES.join(', ')}.` },
      limit: { type: 'integer', minimum: 1, maximum: schemas.MAX_LIMIT, description: `JSON page size (default ${schemas.DEFAULT_LIMIT}, max ${schemas.MAX_LIMIT}).` },
      url: schemas.getFile.querystring.properties.url,
      nodeId: { type: 'string', minLength: 1, description: 'Only events mentioning this node in data.nodeId or data.nodeIds (1:2 or 1-2); JSON and SSE.' },
      since: { type: 'string', format: 'date-time', description: 'Inclusive ISO timestamp lower bound on createdAt for JSON pages; ignored for SSE.' },
    },
  },
  response: {
    200: page(event),
    ...Object.fromEntries([400, 401, 403, 404].map(s => [s, { ...problemResponse }])),
  },
};
const listEvents = format.withFormat(fileEvents);

const allEvents = format.withFormat({
  ...fileEvents,
  summary: 'List events across files',
  description: `Activity across all files in global event-id order. Every event includes fileKey and, on JSON pages, fileName; fileKey optionally narrows to a tracked file. ${fileEvents.description}`,
  params: { type: 'object', properties: {} },
  'x-rds-mcp': undefined,
  'x-rds-cli': undefined,
  querystring: {
    ...fileEvents.querystring,
    properties: { ...fileEvents.querystring.properties, fileKey: { type: 'string', minLength: 1, description: 'Narrow the JSON page or SSE stream to this tracked file key.' } },
  },
  response: { ...fileEvents.response, 200: page(namedEvent) },
});

// --- helpers -------------------------------------------------------------------
const wantsStream = request => /\btext\/event-stream\b/i.test(String(request.headers.accept || ''));

function parseTypes(value) {
  if (value === undefined) return [];
  const types = [...new Set(String(value).split(',').map(s => s.trim()).filter(Boolean))];
  const bad = types.filter(t => !EVENT_TYPES.includes(t));
  if (bad.length) {
    throw problem('invalid_parameter', `types: unknown value${bad.length > 1 ? 's' : ''} ${bad.map(t => `'${t}'`).join(', ')}.`, {
      hint: `Use one or more of: ${EVENT_TYPES.join(', ')} (comma-separated).`,
    });
  }
  return types;
}

/** The replay cursor: `Last-Event-ID` wins over `?after=` (EventSource resends the original URL on reconnect). */
function parseAfter(request) {
  const header = request.headers['last-event-id'];
  if (header !== undefined && String(header).trim() !== '') {
    const text = String(header).trim();
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
      throw problem('invalid_parameter', `Last-Event-ID: '${text}' is not an event id.`, { hint: 'Send the `id` of the last event received, or drop the header.' });
    }
    return Number(text);
  }
  return request.query.after ?? null;
}

const eventOut = e => ({ id: e.id, fileKey: e.fileKey, type: e.type, actor: e.actor, data: e.data, createdAt: e.createdAt });
const namedEventOut = e => ({ ...eventOut(e), fileName: e.fileName ?? null });
const sseMessage = (id, type, data) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerEventRoutes(app, { store, now, config, bus }) {
  const heartbeatMs = config.eventHeartbeatMs ?? HEARTBEAT_MS;
  const replayMs = (config.eventReplayHours ?? 24) * HOUR_MS;
  const streams = new Set();

  app.addHook('preClose', async () => { for (const end of [...streams]) end(); });

  async function trackedFile(fileKey) {
    const [file] = await store.listFiles({ fileKey });
    if (!file) throw address.fileNotFound(fileKey);
  }

  /** True when replaying after `after` would reach past the replay window (or into pruned events). */
  async function outsideWindow(fileKey, after, lastId) {
    const cutoff = now().getTime() - replayMs;
    if (after > 0) {
      const seen = await store.getEvent(fileKey, after);
      if (!seen) return after < lastId; // pruned (or not this file's); an id past the end just waits
      if (Date.parse(seen.createdAt) < cutoff) return true;
    }
    const [next] = await store.listEvents({ fileKey, after, limit: 1 });
    return !!next && Date.parse(next.createdAt) < cutoff;
  }

  async function stream(request, reply, { fileKey, cursorFileKey, after, types, nodeId }) {
    const raw = reply.raw;
    let closed = false, ready = false, again = false, running = null, cursor = 0;
    const write = chunk => { if (!closed) raw.write(chunk); };

    const pump = () => {
      if (closed) return;
      if (!ready || running) { again = true; return; }
      running = (async () => {
        do {
          again = false;
          for (;;) {
            const page = await store.listEvents({ fileKey, after: cursor, types, nodeId, limit: REPLAY_PAGE });
            for (const e of page) { write(sseMessage(e.id, e.type, eventOut(e))); cursor = e.id; }
            if (page.length < REPLAY_PAGE || closed) break;
          }
        } while (again && !closed);
      })()
        .catch(err => { request.log.error({ err }, 'event stream read failed'); end(); })
        .finally(() => { running = null; if (again && !closed) pump(); });
    };

    const unsubscribe = bus.subscribe(fileKey, pump);
    const heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatMs);
    function end() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(end);
      raw.end();
    }
    streams.add(end);
    raw.on('close', end);

    reply.hijack();
    raw.writeHead(200, {
      ...reply.getHeaders(),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    try {
      const lastId = await store.lastEventId(cursorFileKey);
      if (after === null) cursor = lastId;
      else if (await outsideWindow(cursorFileKey, after, lastId)) {
        cursor = lastId;
        write(sseMessage(lastId, 'reset', { fileKey, lastEventId: lastId, reason: 'The requested event is older than the replay window; re-fetch state.' }));
      } else cursor = after;
    } catch (err) {
      request.log.error({ err }, 'event stream setup failed');
      end();
      return;
    }
    ready = true;
    write(`retry: ${RETRY_MS}\n: connected\n\n`);
    pump();
  }

  async function handle(request, reply) {
    const file = request.params.fileKey ?? request.query.fileKey ?? (request.query.url ? '-' : null);
    const fileKey = file === null ? null : address.resolveFile(file, request.query.url).fileKey;
    const types = parseTypes(request.query.types);
    const nodeId = request.query.nodeId === undefined ? null : address.normalizeNodeId(request.query.nodeId);
    const sse = wantsStream(request);
    const after = sse ? parseAfter(request) : request.query.after ?? 0;
    if (fileKey !== null) await trackedFile(fileKey);
    if (sse) return stream(request, reply, { fileKey, cursorFileKey: request.params.fileKey === undefined ? null : fileKey, after, types, nodeId });
    const since = request.query.since ?? null;
    const before = request.query.before ?? null;
    const desc = request.query.order === 'desc';
    const out = request.params.fileKey === undefined ? namedEventOut : eventOut;
    const list = (from, limit) => store.listEvents({
      fileKey, types, nodeId, since, limit, order: desc ? 'desc' : 'asc',
      ...(desc ? { after, before: from } : { after: from, before }),
    });

    const fmt = request.query.format ?? 'json';
    if (fmt !== 'json') {
      const limit = format.pageSize(fmt, request.query.limit, schemas.DEFAULT_LIMIT);
      const read = async from => {
        const page = await list(from, limit);
        return { rows: page, next: page.length === limit ? page[page.length - 1].id : null };
      };
      return format.stream(reply, fmt, {
        first: await read(desc ? before : after), fetch: read, cap: request.query.limit ?? null, toObject: out, toLine: e => format.eventLine(eventOut(e)),
      });
    }
    const events = await list(desc ? before : after, request.query.limit ?? schemas.DEFAULT_LIMIT);
    const last = events.length ? events[events.length - 1].id : null;
    const cursor = desc ? { nextBefore: last ?? before ?? 0 } : { nextAfter: last ?? after };
    return { ...(fileKey !== null ? { fileKey } : {}), events: events.map(out), ...cursor };
  }
  app.get('/files/:fileKey/events', { schema: listEvents }, handle);
  app.get('/events', { schema: allEvents }, handle);
}

module.exports = { registerEventRoutes, HEARTBEAT_MS };
