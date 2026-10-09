# @rolling-design-sync/api

Standalone Fastify service: the per-node design-implementation ledger (see
`docs/architecture.md`). The plugin syncs changed nodes; the server keeps one
row per node with its content hash and the hash last implemented, and serves
agents the dirty nodes with their property-level changes. It serves API v3
only (`/v3/…`, plus `GET /health`).

## Run

```bash
cp .env.example .env            # DATABASE_URL, RDS_PLUGIN_TOKENS, RDS_AGENT_TOKENS, PORT
npm start -w @rolling-design-sync/api
# no database (non-persistent dev server):
RDS_STORE=memory RDS_PLUGIN_TOKENS=p RDS_AGENT_TOKENS=a npm start -w @rolling-design-sync/api
```

Env: `DATABASE_URL` (Postgres, schema from `supabase/migrations`), `PORT`
(8787), `HOST`, `LOG_LEVEL`, `RDS_PLUGIN_TOKENS` / `RDS_AGENT_TOKENS`
(comma-separated static bearer tokens; an entry may be `name:token`, name
`[a-z0-9._-]{1,40}` unique per class, to give events a human label),
`RDS_VIEWER_TOKENS` (read-only, v3
`GET` routes only), `RDS_SESSION_SECRET` (signs the `rds_session` browser
cookie; sessions are `503 sessions_disabled` without it in `DATABASE_URL`
mode, generated into `tokens.json` in `RDS_STORE` modes), `RDS_PORTAL_DIR`
(the built portal `/ui` serves; `apps/portal/dist`), `RDS_UI_ORIGINS` (embedded modes: loopback browser UI
origins, `http://localhost:<port>` / `http://127.0.0.1:<port>`), `RDS_BODY_LIMIT_BYTES` (64 MiB),
`RDS_CLAIM_TTL_SECONDS` (900), `PGSSLMODE=disable` to turn off TLS,
`RDS_LISTEN_URL` (direct Postgres URL for the event listener; defaults to
`DATABASE_URL`), `RDS_EVENT_REPLAY_HOURS` (24), `RDS_EVENT_RETENTION_DAYS` (30), `RDS_RATE_LIMIT_TOKEN` / `RDS_RATE_LIMIT_IP` /
`RDS_RATE_LIMIT_AUTH` (requests per minute: 600 / 120 / 10 with `DATABASE_URL`,
off in `RDS_STORE` modes; `0` disables) and `RDS_TRUST_PROXY` (read the client IP
from `X-Forwarded-For`) — see `docs/setup.md`, "Rate limits". Only `RDS_*` names are
read; a leftover `FDS_*` variable is ignored with a startup warning.

## Routes

`Authorization: Bearer <token>`. Plugin tokens reach only the plugin routes,
agent tokens only the agent routes (401 unknown token, 403 wrong class).

The v1 (per-scope snapshots and queue) and v2 (per-node sync) routes were
removed; their tables and columns are kept. A request to one of their paths —
or any other unknown path — is `404 route_not_found`, and for a former v1/v2
route the `hint` names the v3 route to use (`apps/api/src/v3/legacy.js`):

| Removed | Use |
|---------|-----|
| `POST /scopes`, `POST /scopes/:id/snapshots`, `POST /snapshots/:id/parts`, `POST /snapshots/:id/publish` | `POST /v3/files/{fileKey}/sync` |
| `GET /scopes/:id/pending` | `GET /v3/files/{fileKey}/nodes` |
| `GET /items/:id` | `GET /v3/files/{fileKey}/nodes/{nodeId}` |
| `POST /items/:id/verification` | `POST /v3/files/{fileKey}/clear` |
| `GET /v2/scopes/:nodeId/hashes` | `GET /v3/files/{fileKey}/hashes?under=<nodeId>` |
| `POST /v2/nodes/batch` | `POST /v3/files/{fileKey}/sync` |
| `POST /v2/nodes/exists` | `POST /v3/files/{fileKey}/exists` |
| `GET /v2/nodes/:nodeId/delta` | `GET /v3/files/{fileKey}/nodes?under=<nodeId>`, `POST /v3/files/{fileKey}/claims` |
| `POST /v2/nodes/clear` | `POST /v3/files/{fileKey}/clear` |

v3 (`docs/api-v3-design.md`) — agent token on every route except
the plugin routes (below) and `/v3/openapi.json`, which is the full reference (every parameter, body and
response schema). A viewer token (`RDS_VIEWER_TOKENS`) also reaches every v3
`GET`; a write with one is `403 wrong_token_class`. Errors are
`application/problem+json` with `code` and `hint`; the codes are in
[`docs/errors.md`](../../docs/errors.md). Every v3 response carries
`X-RDS-Server: <API version>`; a request's `X-RDS-Client: <name>/<version>`
(capped at 100 characters) is logged at debug level and recorded as
`data.client` on the events that request emits.

Addressing: `{fileKey}` is the file key; `{nodeId}` accepts `1:2` or `1-2`
(responses use `1:2`). Every file route also takes `?url=<figma link>`: pass
`-` as `{fileKey}` (and as `{nodeId}` to use the link's `node-id`). On the
listing and claims, the link's node becomes `under`. A link for another file
than the path is `400 url_mismatch`; a URL pasted as the key is
`404 file_not_found` whose `hint` gives the key.

| Route | Query / body | Returns |
|-------|--------------|---------|
| `GET /v3/status` | — | `{version, store, events, replayHours, plugin: {lastSyncAt, client}}` — newest retained sync; plugin fields null before any sync |
| `GET /v3/tokens` | — | `[{class, label, lastUsedAt}]` — no values; last use tracks bearer/session requests in memory per instance and resets on restart |
| `GET /v3/claims` | — | `{claims: [{fileKey, fileName, claimId, worker, label, expiresAt, createdAt, nodeCount, nodeIds, nodes: [{nodeId, name, type}]}]}` — active claims, soonest expiry first, at most 500 IDs each; `nodes` names the first 3 in document order |
| `GET /v3/files/{fileKey}/claims` | `url?` | `{fileKey, claims: [{claimId, worker, label, expiresAt, createdAt, nodeCount, nodeIds, nodes}]}` — nodes still leased to each unexpired claim |
| `GET /v3/files` | — | `{files: [file]}`, most recently synced first |
| `GET /v3/files/{fileKey}` | `url?` | `file` |
| `GET /v3/files/{fileKey}/scopes` | `url?` | `{fileKey, scopes: [{nodeId, name, type, deleted, figmaUrl, lastSyncAt, lastSyncCounts, counts}]}` — one per synced root, latest sync |
| `GET /v3/files/{fileKey}/nodes` | filters (below), `view`, `changes`, `fields`, `include`, `sort`, `limit`, `cursor`, `format?`, `url?` | `{fileKey, nodes: [node], nextCursor, total, truncated?}` |
| `GET /v3/files/{fileKey}/nodes/{nodeId}` | `fields?`, `changes?`, `url?` | detail node |
| `POST /v3/files/{fileKey}/clear` | `{commitRef?, worker?, items: [{nodeId, contentHash}]}` (1–500) | `{fileKey, commitRef, results: [{nodeId, status, contentHash}], totals: {cleared, stale, notFound}}` |
| `POST /v3/files/{fileKey}/claims` | `{worker, label?, ttlSeconds?, limit?, nodeIds? \| filter?}` | `claim` |
| `POST /v3/files/{fileKey}/claims/{claimId}/renew` | `{ttlSeconds?}` (body optional) | `claim` |
| `DELETE /v3/files/{fileKey}/claims/{claimId}` | — | `{claimId, worker, label, released: [nodeId]}` |
| `POST /v3/files/{fileKey}/nodes/{nodeId}/block` | `{reason, worker?}` (reason 1–500) | `{fileKey, node, released: {claimId, worker} \| null}` — releases any lease |
| `POST /v3/files/{fileKey}/nodes/{nodeId}/unblock` | `{worker?}` (body optional) | `{fileKey, node, unblocked}` (`false` if it wasn't blocked) |
| `GET /v3/files/{fileKey}/events` | `after?`, `order?` (`asc` \| `desc`), `before?`, `types?`, `nodeId?`, `since?`, `limit?`, `format?` (JSON); `Last-Event-ID` (SSE), `url?` | `{fileKey, events: [event], nextAfter}` (`order=desc`: newest first, `{fileKey, events, nextBefore}`; page older with `before`), or a `text/event-stream` with `Accept: text/event-stream` |
| `GET /v3/events` | Same event parameters plus `fileKey?` | `{events: [event], nextAfter}` (or `nextBefore` with `order=desc`) or SSE across files; every event includes `fileKey`, and on JSON pages `fileName` |
| `GET /v3/files/{fileKey}/summary` | listing filters, `url?` | `{fileKey, total, byState, byChangeType, byCategory, byType, byFrame?}` |
| `GET /v3/files/{fileKey}/work` | listing filters, `group?` (`component` \| `set` \| `frame`), `changes?`, `include=progress?`, `limit`, `cursor`, `format?`, `url?` | `{fileKey, group, items: [item], nextCursor, total, truncated?}` |
| `GET /v3/insights/trends` | `windowDays?` (1–14, default 7), `fileKey?` | `{windowDays, from, to, complete, retentionDays, total: trend, files: [{fileKey, fileName, …trend}]}`; trend is `{cleared, clearedPrevious, clearedChangePct, dirtied, netDirty}` |
| `GET /v3/resolve` | `url` | `{fileKey, nodeId}` (`nodeId` null without `node-id`) |
| `GET /v3/openapi.json` | — | OpenAPI 3.1 document (no token) |

Session routes (browser portal auth, `docs/ui-portal.md`; not agent/MCP ops):

| Route | Body | Returns |
|---|---|---|
| `POST /v3/session` | `{token}` (viewer or agent; plugin → `403 wrong_token_class`) | `{role, label, expiresAt}` + `rds_session` cookie |
| `GET /v3/session` | — | the session (`401` without a valid cookie) |
| `DELETE /v3/session` | — | `{signedOut: true}` + clears the cookie |

`rds_session` is a signed (`RDS_SESSION_SECRET`) `HttpOnly;
SameSite=Strict; Path=/; Max-Age=43200` cookie — `Secure` on HTTPS — that
authenticates every v3 route with the role of the token it was minted from;
a bearer token wins when both are sent. Cookie-authenticated writes need
`X-RDS-Client: portal/…` and an `Origin` equal to the API's own origin, else
`403 csrf_rejected`, and their events record `portal:<label>` as the actor
(and `blocked_by` for blocks).

The API also serves the built portal: `GET /` redirects to `/ui/`, and
`GET /ui`/`/ui/*` serves `RDS_PORTAL_DIR` (`apps/portal/dist`) — immutable
caching for hashed `assets/`, `no-cache` for `index.html`, SPA fallback,
path-traversal safe. Without a build, `/ui` answers a 404 page explaining
`npm ci && npm run build -w @rolling-design-sync/portal`.

Plugin routes (`docs/api-v3-phase2.md`, section 7) — **plugin token only**
(agent and viewer tokens get `403 wrong_token_class`; plugin tokens on every
other v3 route too). They call `NodeSyncService` (`src/nodeService.js`) and
add v3 addressing (`?url=`, `1:2` or `1-2` everywhere, including
upsert `parentId` / `path` / `mainComponentId`, `deletedNodeIds` and
`rootNodeId`), problem errors, and `data.client` on `sync.completed`. They carry
no `x-rds-mcp` / `x-rds-cli` annotations, so they are never agent tools.

| Route | Query / body | Returns |
|---|---|---|
| `GET /v3/files/{fileKey}/hashes` | `under` (the scope root; defaults to the `?url=` link's node), `url?` | `{[nodeId]: contentHash}` for the live subtree, `{}` if never synced |
| `POST /v3/files/{fileKey}/sync` | `{upserts: [{nodeId, parentId, path, nodeType, name, attrs, contentHash, isInstance?, mainComponentId?}], deletedNodeIds, markImplemented?, fileName?, rootNodeId?}`; `url?` | `{fileKey, upserted, dirty, tombstoned, skippedInstances, baselined?}` |
| `POST /v3/files/{fileKey}/exists` | `{nodeIds}` (max 5000); `url?` | `{present, stale}` |

`markImplemented: true` (boolean, default `false`) inserts never-seen nodes
clean (`implementedHash = contentHash`, `implementedCommit: 'baseline'`) and
adds `baselined` (the count of such inserts); existing rows, tombstoned
included, are unaffected. `exists` returns the stored, non-tombstoned subset as
`present`, and as `stale ⊆ present` the rows whose `capture_version` is below
the server's `CAPTURE_VERSION` (re-scan them).

The path names the file; a body `fileKey` is accepted only when
it equals it, else `400 invalid_body`. Unknown body members are
`400 invalid_body` (a misspelt `deletedNodeIds` would otherwise tombstone
nothing); the service's own validation errors (e.g. more than 5000 ids) are
`400 invalid_body` with its message.

Shapes:

- `file` — `{fileKey, name, lastSyncAt, createdAt, counts}`; `counts` (also on
  scopes) is `{total, dirty, clean, blocked}`.
- compact `node` (listing default) — `{nodeId, name, type, parentId,
  isInstance, mainComponentId, component, state, changeType, changedProps, changes,
  changesKnown, contentHash, figmaUrl, claim, blocked}`. `isInstance` /
  `mainComponentId` link an instance to its main component (`null` otherwise).
  `component` is the captured main/self reference (`null` on other nodes), with
  optional `set: { id, key, name }` for variants, including library components.
  It is present in compact listings and detail and selectable with `fields=component`.
  `state` is `dirty | clean | blocked`; `changeType` is `added | modified |
  deleted` or `null` when clean; `changedProps` is the sorted changed property
  names (`[]` when clean); `changes` is `{prop: {built, now, category}}`
  against the attrs as last cleared (`{}` when clean). `changesKnown: false`
  (with `changes: null`) marks a node dirtied before v3 whose built attrs were
  never stored. `claim` is `{claimId, worker, label, expiresAt}` or `null`
  (expired leases read as `null`); `blocked` is `{reason, by, at}` or `null`.
- `changes=` (listing, detail, work items): `auto` (listing / work default)
  leaves `changes` out for `added` nodes (a fresh sync lists only names, via
  `changedProps`); `diff` (detail default) has it for every node; `names`
  never has it. On the listing (except `view=full`) and work items, a change
  side (`built` / `now`) whose JSON is over 1 KB is `{truncated: true, bytes}`
  and the page has `truncated: true`; node detail is never truncated.
- `view=full` adds `attrs`, `implementedAttrs` and `path` (ancestor ids, root
  first, plus the node). `fields=a,b` returns exactly those fields.
  `include=counts` adds `descendants: {total, dirty, blocked}` (subtree,
  excluding the node).
- detail node — the full node plus `deleted`, `history: {createdAt, updatedAt,
  implementedAt, implementedCommit, implementedHash, deletedAt}` and
  `descendants`.
- `claim` — `{claimId, worker, label, expiresAt, nodes: [node]}`.

Listing filters (AND across parameters, comma-separated values OR'd within
one): `state` (`dirty` default, `clean`, `blocked`, `all`), `under` (node id;
subtree including the node; or up to 50 comma-separated ids: the union of
their subtrees, each node once, roots in the order given), `depth` (with
`under`; levels below each root), `type`, `changeType`,
`changed` (property names, trailing `*` for a prefix: `padding*`), `category`,
`component` (instances of a main component), `instance` (`true`: instances
only, `false`: none), `name` (case-insensitive, `*`
wildcards), `since` (ISO 8601, `updatedAt >=`), `claimed` (`true`, `false`,
`mine` with `worker`), `worker`. `q` packs the same filters into one string:
`q=type:TEXT changed:characters name:"Pay button"`. `sort` is `document`
(default: the design's layer order — auto-layout flow order, else top to
bottom and left to right; `docs/api-v3-agent-ergonomics.md` section 9), `path`
(node-id path order), `updatedAt` or `name`, `-` for descending; `limit` 1–1000 (default
100). `nextCursor` is opaque and bound to the query: pass it back with the same
parameters. Unknown parameters are `400 unknown_parameter`, with suggestions.

Actions:

- Bulk clear is hash-guarded per item: `cleared` when the stored
  `contentHash` still matches (stores the attrs as built, resets the change
  columns, records `commitRef`, releases the node's lease), `stale` when the
  design changed since (the current `contentHash` is returned), `not_found`
  for unknown ids. Always `200` for a valid body. `worker`, when given, is
  the `nodes.cleared` actor; otherwise the token label (or `portal:<label>`
  for a cookie-authenticated call).
- Claims lease `nodeIds` (unknown ids skipped) or the nodes a `filter` of
  listing parameters selects (`q` included; `claimed`/`worker` are implied), up
  to `limit`. Only unclaimed, expired or the same worker's nodes are taken —
  a live lease is never stolen. `ttlSeconds` defaults to
  `RDS_CLAIM_TTL_SECONDS` and is capped at 24 h. Leases are the node's
  `claimed_by`/`claim_expires_at` columns plus a `claim` row. Renew extends the claim and every node still under it (cleared or
  released nodes drop out); release ends it and frees them. An unknown claim
  id, or one from another file, is `404 claim_not_found`.

Blocking (`docs/api-v3-phase2.md`, section 3): block sets `blocked_at`/`by`/
`reason` (re-blocking replaces them) and releases the node's lease; a blocked
node is out of the default `state=dirty` listing and in `state=blocked`.
`by` (and the event `actor`) is `worker`, else the token label. Unblock clears
the block; the node reads `dirty` or `clean` again. A design change to a
blocked node still unblocks it automatically (`node.unblocked` with
`auto: true`).

Summaries and work items (`docs/api-v3-phase2.md`, section 2): both take
every listing filter (default `state=dirty`) and aggregate in the store (SQL
`count … filter` / `group by` on Postgres and PGlite).

- Summary: `byState` `{dirty, clean, blocked}`, `byChangeType` `{added,
  modified, deleted}`, `byCategory` (a node counts once per category it has),
  `byType` (node type → count). With one `under` (or a `?url=` link),
  `byFrame: [{nodeId, name, count}]` groups by the ancestor one level below
  `under`, in document order; the `under` node itself is in none. With
  several `under` ids there is no `byFrame`.
- Work items: `group=component` (default) keys each node by its nearest
  component ancestor-or-self, with `set: { id, key, name }` when known.
  `group=set` merges variants into one item named like their Figma component
  set (`key` = Figma set key, falling back to node id), even without a synced
  set row; `variants: [{ key, name, nodeCount }]` lists their Figma keys (or node
  ids), names and filtered node counts. Node ids, caps, paging and progress
  cover the merged item; a matching set root is not a variant. Standalone
  components and unknown sets keep component grouping.
  This uses the nearest `COMPONENT` / `COMPONENT_SET` ancestor-or-self;
  `group=frame` groups by the
  ancestor one level below `under` — exactly one `under` is required, else
  `400 invalid_parameter` with a hint (several: pass one, or group by component). Nodes without a key form one `key: null` item, listed last.
  `item` is `{key, name, type, nodeCount, categories, changedProps, changes?,
  placements?, nodeIds, more, progress?}`: `changes` is `{nodeId: diff}` for the listed
  `nodeIds` per `changes=` (absent with `names`); `placements` (component grouping only) counts
  the instance rows whose `mainComponentId` is the key; `nodeIds` holds the
  first 50 ids in document order and `more` the rest. Items are in document
  order of their key and page with `limit` (default 100) / `nextCursor` like the listing.
  `include=progress` adds `{total, clean}` across all states of each item,
  independent of `state=` and the node ID cap; other filters still apply.
  Cleared tombstones are excluded from these counts.

Formats (`docs/api-v3-phase2.md`, section 4): the listing, work items and the
events JSON page take `format` (`outline`: the listing and work items only):

- `json` (default) — the page as above.
- `ndjson` — `application/x-ndjson`, one object per line (a node in the
  listing's `view`/`fields` shape, an item, or an event). Streamed: every match
  from `cursor` / `after` on is read from the store 500 rows at a time and
  written as it is read; `limit`, when given, caps the lines. The listing
  and work items also send `X-Total-Count`.
- `md` — `text/markdown`, a checklist with one line per row, streamed the same
  way. Node: `- [ ] **Name** (TYPE) — paddingLeft 16 → 24; fills
  color/brand/500 → color/brand/600 · [Figma](url)` (token names when the
  change carries one, raw values otherwise, truncated at 40 characters; `added`
  / `deleted` / `clean` instead of the props; `[x]` when clean; `· blocked:
  reason` when blocked). Item: `- [ ] **Name** (TYPE) — 3 nodes: fills,
  paddingLeft · 2 placements · [Figma](url)`. Event: `- <createdAt> **type**
  #id by actor — key: value; …`.
- `outline` (listing and work items only, `docs/api-v3-agent-ergonomics.md`,
  section 5) — `text/plain`, an indented tree with one line per node:
  `Name (TYPE) · modified (3: fills, paddingLeft, …)` (`clean` / `added` /
  `deleted`, `· blocked`; an instance shows `(INSTANCE → <mainComponentId>
  <main name>)`). Two spaces per level below `under` (several `under` ids: each root's tree
  in the order given, each root at the left margin); a node whose ancestors
  the filters leave out is indented under its nearest shown ancestor (no
  placeholder lines). With `expand=instances` a component's subtree is nested
  (`↳ Name (COMPONENT)`) under the first instance that reached it, and other
  instances show `→ <id> (shown above)`; a node positioned absolutely in an
  auto-layout parent is marked `(absolute)`. Always in document order
  (`sort=path` for node-id path order; any other `sort` is a 400). Work items: `Name (TYPE) · 3 nodes · changed (4: …)
  · 2 placements`, with the item's listed nodes as a tree below it. The whole
  result (up to 2,000 rows, or 2,000 lines of whole items) is rendered once and
  then paged by rendered lines: `limit` lines per page (default all), and while
  lines remain an `X-RDS-Next-Cursor` header (CORS-exposed) to pass as
  `cursor`. Past the cap, the outline's last line is `… N more (use
  cursor/limit) — cursor=<c>`. Outline cursors are bound to the outline query
  (a JSON `nextCursor` is a 400 `invalid_cursor`).
- `Accept: text/event-stream` on events still streams SSE; `format` applies to
  the JSON page only.

Events (`docs/api-v3-phase2.md`, section 1):

- Every sync, clear, claim change, block and unblock appends one row to
  the `event` table in the same transaction as the change, and is published
  only after commit — a rolled-back change leaves no event. Types:
  `sync.completed`, `nodes.cleared`, `claim.created`, `claim.renewed`,
  `claim.released`, `node.blocked`, `node.unblocked`. `event` is `{id, fileKey,
  type, actor, data, createdAt}`; `data` carries ids and counts only (node ids
  capped at 500), never design content. `nodes.cleared` has `count` (all
  cleared nodes, beyond the id cap); `sync.completed` `counts.dirty` is the
  number of nodes the batch made dirty (new, or changed / deleted while clean).
- Trends (`GET /v3/insights/trends`) sum those counts over the half-open
  window `[from, to)` = the last `windowDays` days, and `clearedPrevious` over
  the window before. `clearedChangePct` is `round((cleared − clearedPrevious)
  / clearedPrevious × 100)`, null when `clearedPrevious` is 0; `netDirty` is
  `dirtied − cleared`. Older `nodes.cleared` events without `count` count
  their `nodeIds`. `complete` is false when `RDS_EVENT_RETENTION_DAYS` is under
  `2 × windowDays` (the previous window may be pruned). Viewer tokens may read it.
- JSON: `after` (event id, exclusive), `types` (comma-separated), `limit`
  1–1000 (default 100); pass `nextAfter` back as `after` to page.
- SSE: messages are `id: <event id>`, `event: <type>`, `data: <event>`.
  Both event routes accept `nodeId` (matches `data.nodeId` or `data.nodeIds`)
  and JSON pages accept `since` (inclusive ISO timestamp lower bound).
  `/v3/events` subscribes across files, with optional `fileKey` narrowing.
  Reconnect with `Last-Event-ID` (wins over `?after=`) to replay what was
  missed, then receive live events. Without either, the stream is live only.
  A cursor older than `RDS_EVENT_REPLAY_HOURS`, or pruned, gets one
  `event: reset` (`data: {fileKey, lastEventId, reason}`) instead of a replay — re-read state,
  then continue from it. A `: heartbeat` comment every 20 s keeps proxies
  open.
- Live delivery across processes uses Postgres `LISTEN/NOTIFY` on one
  dedicated connection (`RDS_LISTEN_URL`; transaction poolers don't support
  `LISTEN`); when that fails or drops the API polls the table every 2 s and
  reconnects. `RDS_STORE` modes deliver in-process.
- Events older than `RDS_EVENT_RETENTION_DAYS` are pruned at startup and
  hourly.

## Behaviour

- One row per node keyed by `(file_key, node_id)`; `dirty = content_hash <>
  implemented_hash`, and `implemented_hash` (the auto-baseline) advances only
  through the hash-guarded clear. Editing a node back to its implemented state
  makes it clean again.
- Instance nodes are stored as lightweight placement rows (`is_instance`,
  `main_component_id` → the main component's node row; internals are never
  recursed into — the plugin decides what to send); deletes are tombstoned with their last-known `attrs` and stay in the
  listing (`changeType: deleted`) until cleared.
- `path` is an ltree path of the node's ancestors **plus itself**. Clients send
  plain Figma node ids (`path` as an array of ancestor ids, a dot-joined string
  of them, or omitted to derive it from `parentId`); `src/ltree.js` owns the
  id → ltree-label encoding.
- On startup, before listening, `src/maintenance.js` runs idempotent repair
  steps in batches of 500, one log line each; a failing step is logged as a
  warning and startup continues. Step `change-data` recomputes the change
  columns of rows with a `changeType` but no `changedProps` (nodes synced
  before v0.8.0) with the write path's `changeColumns`, writing only rows whose
  result differs; implemented nodes with unknown `implementedAttrs` stay as
  they are.

## Layout

```
src/app.js          buildApp({ store, config }) — CORS, error handler, /health, v3
src/errors.js       HttpError — service errors with status + code
src/store/memory.js in-memory data layer (tests, RDS_STORE=memory)
src/nodeService.js  NodeSyncService — per-node sync (hashes / sync / exists)
src/ltree.js        Figma node id <-> ltree label/path helpers
src/maintenance.js  startup repair steps (runMaintenance), run by server.js before listen
src/v3/             API v3: index (auth, problems, OpenAPI), read, actions, events, block, insights (summary, work items, trends), plugin (hashes, sync, exists), format (ndjson / md / outline), address, schemas, problem, legacy (hints for removed v1/v2 paths)
src/events/         event outbox (withEvents), buses (memory, Postgres LISTEN/NOTIFY + polling), retention
src/store/postgres.js node-postgres data layer (same interface)
tests/              DB-free unit tests (node --test)
```

## License

[FSL-1.1-ALv2](LICENSE.md) (Functional Source License, Apache-2.0 future
license): free to use, modify, and self-host for any purpose except offering it
as a competing commercial service. Each release becomes Apache-2.0 two years
after it ships. The rest of the repository is Apache-2.0.