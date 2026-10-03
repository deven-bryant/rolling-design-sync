# rolling-design-sync — architecture

> **v3 only.** The API serves `/v3` (see "API v3" below) and `GET /health`.
> The v1 per-scope snapshot/checklist API and the v2 per-node routes were
> removed; any of their paths is a `404 route_not_found` problem whose `hint`
> names the v3 route to use. Their tables and columns (`tracked_scope`,
> `snapshot`, `changeset`, `checklist_item`, `verification`, and every `node`
> column) are retained — no migration drops them. The sections on the
> verified-baseline model, the v1 data model and the v1 API surface below are
> kept as the design history of those tables.

## Problem

The current Figma→code workflow has each remote worker start cold and re-derive
a whole design from a Figma node via the Figma MCP. Workers reliably nail big
structure but drop individual sub-items in a multi-item task, and brute-force
deep MCP scans are expensive and unreliable. We want a **precise, pre-computed
work queue** of exactly what changed, so a worker fetches design context via MCP
only for the specific affected nodes.

## Solution overview

A Figma plugin scans a **scope** (one Section or Frame) and produces a
normalized snapshot of every node + tracked property. The plugin uploads that
snapshot through an authenticated API. The **server** owns the source of truth:
it keeps a rolling snapshot and a *last-verified baseline* per scope, computes a
**compact diff**, and reconciles it into a living **checklist**. Worker agents
pull the compact work queue, implement each item (using Figma MCP for live
context on just that node), and record verification. When every item for a scope
is verified, the server advances the verified baseline.

```
Figma Desktop                Hosted API (apps/api)              Supabase Postgres
+-------------+  snapshot    +----------------------+  sql      +----------------+
|   plugin    | -----------> | POST /scopes/:id/    | --------> | tracked_scope  |
| (scanner +  |  (full,      |      snapshots       |           | snapshot       |
|  uploader)  |   authed)    |  diff vs verified    |           | changeset      |
+-------------+              |  baseline + reconcile|           | checklist_item |
                             +----------------------+           | verification   |
Worker agent (remote)                  ^                         +----------------+
+-------------------+  REST (authed)    |
| list_pending      | ------------------+
| get_change_details|   Figma MCP for live node context (only affected nodes)
| record_verify     |
+-------------------+
```

## Key decisions (locked)

1. **Diff runs server-side.** The plugin uploads the full normalized snapshot;
   the server computes the compact diff and reconciles the checklist. This
   centralizes truth, handles reverts cleanly, and lets us reuse the plugin's
   pure diff core (`packages/core`, extracted from the plugin's `src/core.js`).
2. **API is a standalone, host-agnostic Node/TS service** in `apps/api`
   (Fastify), config via env vars, deployable to Railway/Render/Fly (always-on)
   or a serverless host (with the Supabase pooler). No platform SDK lock-in.
3. **Agent interface is REST + a thin CLI** in `scripts/` (three operations:
   `list_pending_changes`, `get_change_details`, `record_verification`).
4. **Plugin auth = static bearer token** pasted into the plugin UI (stored in
   Figma `clientStorage`); Supabase credentials never leave the server. The
   plugin manifest must add the API domain to `networkAccess.allowedDomains`.

## The verified-baseline model (the important part)

Two problems must not happen:
- **Dropping an unimplemented change.** Scan B adds a change; scan C leaves it
  unchanged. A naive B→C diff is empty, but the agent still owes that work.
- **Implementing a reverted change.** A change made then undone before
  implementation should quietly disappear from the queue.

Both are solved by diffing against the **last verified baseline**, not the
previous scan:

- Each scope stores a `verified_baseline_snapshot` (the last snapshot whose
  entire checklist was verified) and a `latest_snapshot` (the most recent scan,
  the "rolling snapshot").
- On every upload the server computes `diff(verified_baseline, latest)` — the
  *complete outstanding set* — and **reconciles** it into the checklist:
  - New diff entry with no matching open item → **insert** a `pending` item.
  - Diff entry matching an existing item (same `node_id` + `change_type` + same
    changed-property set) → keep it and its status/evidence.
  - Existing `pending`/`claimed` item whose diff entry vanished (design reverted
    to baseline) → **auto-close** as `obsolete`.
  - Existing `verified` item still present in the diff → keep as `verified`
    (baseline hasn't advanced yet).
- When **all** items for the scope are `verified`, the server advances
  `verified_baseline_snapshot := latest_snapshot`, which empties the outstanding
  set. (Automatic; the plugin's old manual "advance baseline" is retired.)

Reconciliation key: `node_id + change_type + sorted(changed property names)`.
If the *same* node changes to *different* values before implementation, that is
a new item bound to the newer scan (see verification binding below).

## Compact vs full payloads

The plugin's current report embeds full `before`/`after` node records on every
item — that is what makes the JSON huge. We keep the full snapshot **server-side
only** (as the rolling snapshot / baseline). The **agent-facing** checklist item
is compact:

```json
{
  "nodeId": "1481:409613",
  "frameId": "1481:404968",
  "changeType": "modified",
  "changes": { "paddingLeft": { "before": 16, "after": 24 } },
  "figmaUrl": "https://www.figma.com/design/<key>/Design?node-id=1481-409613",
  "status": "pending"
}
```

Exceptions carry just enough extra context in a `context_snapshot` field:
- `added` → the new node's initial normalized record (agent needs it to build).
- `deleted` → the previous normalized record (MCP can no longer fetch it).
- `moved` → previous **and** current parent id (`parentBefore` / `parentAfter`).

`get_change_details` may return the fuller record; `list_pending_changes` stays
compact.

## Data model (Supabase Postgres)

Types use `jsonb` for variable-shaped property diffs; plain columns for what we
filter on (scope, scan, status).

### `tracked_scope`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `file_key` | text | Figma file key |
| `frame_id` | text | Section/Frame node id (scope root) |
| `scope_name` | text | last-seen name (readability only) |
| `latest_snapshot_id` | uuid fk → snapshot | rolling snapshot |
| `verified_baseline_snapshot_id` | uuid fk → snapshot | last fully-verified |
| `created_at` / `updated_at` | timestamptz | |

Unique on `(file_key, frame_id)`.

### `snapshot`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `scope_id` | uuid fk | |
| `captured_at` | timestamptz | plugin capture time |
| `schema_version` | int | from core |
| `coverage` | text | coverage statement |
| `warnings` | jsonb | array |
| `nodes` | jsonb | full normalized node map (the heavy field) |
| `published` | bool | true only after the whole upload completes |

Only publish (`published=true`) after the full multi-part upload lands; diff/
reconcile run against published snapshots only (atomicity).

### `changeset`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `scope_id` | uuid fk | |
| `from_snapshot_id` | uuid fk | verified baseline used |
| `to_snapshot_id` | uuid fk | the scan diffed |
| `captured_at` | timestamptz | |
| `state` | text | `open` / `superseded` |

A changeset records which scan produced the current outstanding set and is what
verification binds to.

### `checklist_item`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `scope_id` | uuid fk | |
| `changeset_id` | uuid fk | the scan this item is bound to |
| `node_id` | text | changed node |
| `frame_id` | text | owning frame/section context id |
| `change_type` | text | `added` / `modified` / `moved` / `deleted` |
| `changes` | jsonb | compact `{prop: {before, after}}` |
| `context_snapshot` | jsonb null | only for added/deleted/moved |
| `figma_url` | text null | null for deleted |
| `reconcile_key` | text | `node_id|change_type|sorted(props)` |
| `status` | text | `pending`/`claimed`/`implemented`/`verified`/`obsolete`/`blocked` |
| `created_at` / `updated_at` | timestamptz | |

### `verification`
| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `item_id` | uuid fk | |
| `changeset_id` | uuid fk | must match the item's current changeset |
| `status` | text | `verified` / `blocked` |
| `code_paths` | jsonb | array of repo paths touched |
| `commit_ref` | text null | commit / PR reference |
| `evidence` | text | required non-empty for `verified` |
| `blockers` | text null | when `blocked` |
| `agent` | text | token label / worker id |
| `created_at` | timestamptz | |

**Verification binding:** `record_verification` must pass the `changeset_id` the
item currently belongs to. If a newer scan superseded the item (its
`changeset_id` moved), the write is rejected so an agent can't mark a stale
change complete.

**Multi-agent claim:** to stop two parallel workers grabbing the same item,
`list_pending_changes` can optionally lease/claim items (`pending → claimed`
with a `claimed_by` + `claim_expires_at`); expired claims revert to `pending`.

## API surface (apps/api)

Removed. The v1 routes (`POST /scopes`, `POST /scopes/:id/snapshots`,
`POST /snapshots/:id/parts`, `POST /snapshots/:id/publish`,
`GET /scopes/:id/pending`, `GET /items/:id`, `POST /items/:id/verification`)
and their service (`ChangeSyncService`, the reconcile engine and the v1 store
methods) are gone; the v1 tables above remain in the schema, unused. The
current surface is "API v3" below.

## Agent CLI (scripts/)

`scripts/rds-agent.js` is generated from `GET /v3/openapi.json`: one command
per agent operation (`nodes ls`, `nodes show`, `claim`, `clear`, `block`,
`summary`, `work`, …). It reads `RDS_API_BASE_URL` and `RDS_AGENT_TOKEN` from
env. The MCP server (`apps/mcp`) registers its tools from the same spec
(`list_nodes`, `get_node`, `claim_nodes`, `clear_nodes`, …).

## Shared diff core (packages/core)

`packages/core` is the plugin's pure `src/core.js` (normalize / stable / diff /
link / sameDesign) extracted as a shared module with **no Figma or browser
deps**, so both the plugin build and the API import the exact same diff logic.
The plugin's `build.js` concatenates `packages/core` + its Figma adapter into
`code.js` (Figma plugins can't use module imports at runtime).

## Plugin changes required

- `manifest.json`: add the API base domain to
  `networkAccess.allowedDomains` (currently `["none"]`).
- UI: fields for **API base URL** + **upload token**, persisted in
  `clientStorage`.
- Replace the local "download JSON / advance baseline" flow with **Upload
  snapshot** — POST the full snapshot (chunked) and publish. The server does the
  diffing and baseline advancement, so the plugin no longer stores baselines
  itself (document/file baseline modes are retired for the synced workflow).

## Integration with agent workflows

Without this service, a coding agent implementing a design typically re-scans
the whole Figma node. With it, the agent pulls the compact queue for the scope
first, uses the Figma MCP only for the specific affected nodes, then records
clears the nodes it built (`POST /v3/files/{fileKey}/clear`).

## Open items / future

- Row-level security policies if we ever let the plugin/agents hit Supabase
  directly instead of through the API.
- Rotating/DB-backed tokens instead of static env tokens.

## Node sync (the `node` table)

The per-node design in `docs/node-sync-design.md` (first served as `/v2`, now
through the v3 plugin and agent routes): one `node` row per `(file_key,
node_id)` (`supabase/migrations`).

Plugin (plugin tokens):
- `GET /v3/files/{fileKey}/hashes?under=<nodeId>` — `{ [nodeId]: contentHash }`
  for that node's subtree (`path <@` the node's path); `{}` when the node was
  never scanned. Tombstoned nodes are omitted.
- `POST /v3/files/{fileKey}/sync` — `{upserts: [{nodeId, parentId, path,
  nodeType, name, attrs, contentHash, isInstance?, mainComponentId?}],
  deletedNodeIds: [...]}`. Upserts by `(file_key, node_id)`, sets
  `dirty = content_hash <> implemented_hash` (so a node edited back to its
  implemented state goes clean again), tombstones the deleted ids keeping their
  last-known `attrs`, and **stores instance placements** (`is_instance` is set
  for `nodeType: 'INSTANCE'` or `isInstance: true`; `main_component_id` from
  `mainComponentId`, a soft reference to the main's node row). Returns counts
  `{fileKey, upserted, dirty, tombstoned, skippedInstances}` (`skippedInstances`
  is always `0`, kept for client compatibility).
- `POST /v3/files/{fileKey}/exists` — `{present, stale}` for up to 5000 ids;
  `stale` are rows written by an older `capture_version` (re-scan them).

Agent (agent tokens): the dirty nodes of a subtree are
`GET /v3/files/{fileKey}/nodes?under=<nodeId>` (with `attrs` — last-known for
deleted ones — under `view=full`); `POST /v3/files/{fileKey}/claims` leases
them. `POST /v3/files/{fileKey}/clear` is the hash-guarded compare-and-clear:
only an item whose stored `content_hash` still equals its `contentHash`
advances `implemented_hash`, sets `dirty=false` and records
`implemented_commit`/`implemented_at`; otherwise it comes back `stale`, so a
newer unimplemented edit is never marked done.

`path` is an **ltree** materialized path of the node's ancestors **plus the node
itself**. Clients send plain Figma node ids — `path` as an array of ancestor ids
(root first, `[]` for the subtree root) or a dot-joined string of them, or omit
it to have the server derive it from `parentId`. `apps/api/src/ltree.js` owns the
id → ltree-label encoding (`:` → `_3a`, etc.), so no client deals in ltree
syntax. Hashes come from `packages/core` `contentHash`, identical on plugin and
server.

### First-scan baseline (`markImplemented`)

A first scan normally makes every node dirty (empty auto-baseline). When the
code already matches the design, the plugin can instead declare the scanned
nodes implemented:

- `POST /v3/files/{fileKey}/sync` accepts an optional top-level
  `markImplemented` (boolean, default `false`; any other type →
  `400 invalid_parameter`, nothing written).
- With `markImplemented: true`, every upsert whose `(file_key, node_id)` has
  **no existing row** is inserted with `implemented_hash = content_hash`,
  `dirty = false`, `implemented_commit = 'baseline'`, `implemented_at = now`.
- Rows that already exist — including tombstoned ones — are upserted exactly
  as without the flag (`dirty = content_hash <> implemented_hash`, tombstone
  revived); the flag never clears pending work and never touches existing
  implemented columns. `deletedNodeIds` are unaffected.
- The response keeps `{fileKey, upserted, dirty, tombstoned, skippedInstances}`
  and, when the flag is `true`, adds `baselined` — the number of rows inserted
  as implemented. With the flag off or omitted the response is unchanged.
- Atomic per row: in Postgres the insert branch of the `insert … on conflict`
  sets the implemented columns from the flag while the `on conflict do update`
  branch never touches them; the whole batch runs in one transaction.
  `MemoryStore` has the same semantics. No schema change.

A baselined node behaves like any cleared node afterwards: a later design edit
dirties it against the baseline hash.

## API v3 (`/v3`)

`docs/api-v3-design.md` is the full design; the route reference is
`GET /v3/openapi.json` and `apps/api/README.md`, the error codes are in
`docs/errors.md`. v3 is the whole API: the plugin routes write the `node`
rows and the agent routes read and act on them. Migration
`20260929180000_api_v3_change_model.sql` only adds columns and tables.

**Change columns on `node`.** Every sync upsert and every clear maintains:

- `implemented_attrs` — the attrs as last cleared (or baselined): "what was
  built". The per-property diff an agent sees is `packages/core`
  `diffAttrs(implemented_attrs, attrs)`, each change tagged with a category
  (`layout`, `color`, `typography`, `effects`, `component`, `content`,
  `structure`, `prototype`, `other`).
- `change_type` — `added` (never implemented), `modified`, `deleted`
  (tombstoned), or null when clean.
- `changed_props`, `change_categories` — the top-level properties and categories
  that differ, GIN-indexed so `changed=` / `category=` filter in the database.
- `blocked_at`, `blocked_by`, `blocked_reason` — a blocked node is not dirty,
  and a content-hash change unblocks it (phase 1 reads these; the block/unblock
  endpoints are phase 2).

The backfill keeps pre-v3 rows consistent: `dirty` stays the source of truth,
`implemented_attrs` is filled only where the current attrs are the implemented
ones, and nodes dirtied before v3 read as `changesKnown: false` until their
next clear.

**Claims.** `claim` rows (`claim_id`, `file_key`, `worker`, `label`,
`expires_at`) group a lease so it renews and releases as a unit; `node.claim_id`
links nodes to it. The lease itself is the node's `claimed_by` /
`claim_expires_at` pair, so there is one lease mechanism: an expired lease is
free, and a live one is never stolen.
Clearing a node releases its lease.

**Sync events.** A sync that carries `fileName` or `rootNodeId` records a
`sync_event` (`file_key`, `root_node_id`, `counts: {uploaded, changed, added,
deleted, baselined}`, `created_at`) in the sync's transaction. The latest
event per root is a *scope* (`GET /v3/files/{fileKey}/scopes`); older events
are kept for the phase-2 summaries and event stream.

**Files.** `file` has one row per Figma file seen (`file_key`, `name`,
`last_sync_at`, `created_at`); every sync upserts it, `fileName` names it.
`GET /v3/files` lists them with node counts, and the file key scopes every other
v3 route (`/v3/files/{fileKey}/…`, or `?url=<figma link>`).

**Errors.** Every v3 error is an RFC 9457 problem with a stable `code` and a
`hint` (`apps/api/src/v3/problem.js`).
