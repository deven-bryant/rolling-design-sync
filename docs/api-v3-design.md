# API v3 — design

Status: **approved for phase 1.** Decisions are recorded at the end.

## Why a v3

The v2 agent API has one real read — "dirty nodes under this node" — and one
write — "clear this node". That makes it clunky for people and agents alike:

- **It returns state, not change.** A dirty node comes back with *all* its
  attributes; the agent has to guess what changed. The server can't do better
  today: it keeps only the *hash* of the implemented version, not its content.
- **No querying.** No filters, no field selection, no paging (the whole subtree
  is loaded, then sliced), no way to discover files or synced scopes.
- **Awkward addressing.** `fileKey` repeated as a query parameter, colon node IDs
  in paths, nothing accepts the Figma link people actually have.
- **One node at a time.** Clearing 40 nodes is 40 requests; leases ride on a read.
- **Unhelpful errors.** `404 Node not found` doesn't say the file key was a URL.

v3 fixes these with a new resource model under `/v3`. v2 (and v1) keep working
unchanged until the plugin, MCP server, and CLI have moved over; then v1 and v2
are retired together.

## Principles

1. **Answer "what changed since it was built"**, per property, compactly.
2. **One query shape everywhere.** The same filter parameters drive listing,
   claiming, summaries, and (later) the event stream and UI.
3. **Small by default.** Compact responses; opt into more with `fields` / `view`.
4. **Accept what people have.** Figma links and `1-2` node IDs work anywhere.
5. **Filter in the database**, never by loading a subtree into memory — the same
   SQL must run on Postgres and the embedded PGlite store.
6. **UI-ready.** Everything a node-tree UI needs (lazy tree expansion, counts,
   live agent activity) is a first-class API capability, not a UI hack.

## Resource model

Everything is scoped to a **file** (the Figma file key). Auth is unchanged: plugin
tokens for sync routes, agent tokens for everything else.

| Route | Purpose | Phase |
|---|---|---|
| `GET /v3/files` | Tracked files: key, name, node/dirty/blocked counts, last sync | 1 |
| `GET /v3/files/{fileKey}` | One file's summary counts | 1 |
| `GET /v3/files/{fileKey}/scopes` | Synced roots (sections/frames) with names and counts | 1 |
| `GET /v3/files/{fileKey}/nodes` | **Filterable, pageable node listing** (see below) | 1 |
| `GET /v3/files/{fileKey}/nodes/{nodeId}` | One node: state, changes, claim, block, history summary | 1 |
| `POST /v3/files/{fileKey}/clear` | **Bulk, hash-guarded clear** | 1 |
| `POST /v3/files/{fileKey}/claims` | Lease nodes (by filter or IDs) to a worker | 1 |
| `POST /v3/files/{fileKey}/claims/{claimId}/renew` | Extend a lease | 1 |
| `DELETE /v3/files/{fileKey}/claims/{claimId}` | Release a lease | 1 |
| `GET /v3/resolve?url=` | Figma link → `{ fileKey, nodeId }` | 1 |
| `GET /v3/openapi.json` | Generated OpenAPI document for all v3 routes | 1 |
| `GET /v3/files/{fileKey}/summary` | Counts by change category, node type, top-level frame | 2 |
| `GET /v3/files/{fileKey}/work` | Dirty nodes grouped into work items (`group=component\|frame`) | 2 |
| `POST /v3/files/{fileKey}/nodes/{nodeId}/block` · `/unblock` | Park a node with a reason | 2 |
| `GET /v3/files/{fileKey}/events` | Server-sent events: sync, dirty, claimed, cleared, blocked | 2 |
| `GET /v3/files/{fileKey}/hashes` · `POST /v3/files/{fileKey}/sync` | Plugin routes on v3 | 2 |

### Addressing rules

- `{fileKey}` is the key only. If a caller passes something that looks like a
  Figma URL, the error says so and shows the extracted key (see "Errors").
- `{nodeId}` accepts `1:2` or `1-2`; a plain `\d+-\d+` is normalized to `\d+:\d+`.
  Other IDs (e.g. instance-internal `I1:2;3:4`) are taken as-is, URL-encoded.
- Anywhere a file-scoped route is used, `?url=<figma link>` may replace the path
  parameters (`/v3/files/-/nodes?url=…`), resolved with `packages/core`'s
  existing parser. `GET /v3/resolve` exposes the same resolution directly.

## The change model (the core of v3)

### What's stored

Per node, in addition to today's columns:

| Column | Meaning |
|---|---|
| `implemented_attrs jsonb` | The node's attributes **as of its last clear** (or first-scan baseline). Written only when the stored `content_hash` equals the hash being cleared, so it always matches `implemented_hash`. |
| `change_type text` | For dirty nodes: `added` (never implemented), `modified`, `deleted` (tombstoned). `null` when clean. |
| `changed_props text[]` | Top-level attribute names that differ between `implemented_attrs` and `attrs`. Computed at write time (sync, clear). |
| `change_categories text[]` | Categories of those properties (below). |
| `claim_id uuid` | The v3 claim a node's lease belongs to (see "Claims"). |
| `blocked_at` `blocked_by` `blocked_reason` | Block state (columns added in phase 1; endpoints in phase 2). |

GIN indexes on `changed_props` and `change_categories` make property filters
cheap on both stores.

### What's returned

A dirty node's `changes` is a property-level diff against what was built:

```json
{
  "nodeId": "1:93312",
  "name": "Button/Primary",
  "type": "COMPONENT",
  "state": "dirty",
  "changeType": "modified",
  "changes": {
    "paddingLeft": { "built": 16, "now": 24, "category": "layout" },
    "fills": {
      "built": { "token": "color/brand/500", "value": "#3B5BDB" },
      "now":   { "token": "color/brand/600", "value": "#364FC7" },
      "category": "color"
    }
  },
  "contentHash": "9f2c…",
  "figmaUrl": "https://www.figma.com/design/…?node-id=1-93312"
}
```

- **Tokens by name.** When a changed property is bound to a variable or style,
  the value is shown as `{ token, value }` using the `resolvedVariables` /
  `styleDefinitions` the plugin already captures. Unbound values are raw.
- `added` nodes have `built: null` for every property; `deleted` nodes have
  `now: null` and keep their last-known attributes.
- **Categories** come from one static map in `packages/core` (shared with the
  plugin): `layout`, `color`, `typography`, `effects`, `component`, `content`,
  `structure`, `prototype`, `other`.

### Diff rules

- Compare **top-level attribute keys** of `implemented_attrs` and `attrs` with
  `core.stable` (key-order-insensitive). A key present on one side only is a
  change with `null` on the other side.
- **Excluded from the diff** (they are lookup tables, not design properties):
  `resolvedVariables`, `styleDefinitions`, `resolvedVariableModes`. They are
  still used for token resolution below.
- `changed_props` is the sorted list of changed keys; `change_categories` is the
  sorted, de-duplicated list of their categories.

### Category map

Assigned by attribute name (the plugin's captured field list); anything not
listed is `other`.

| Category | Attributes |
|---|---|
| `layout` | `width` `height` `x` `y` `rotation` `layoutMode` `layoutWrap` `layoutPositioning` `layoutAlign` `layoutGrow` `layoutSizingHorizontal` `layoutSizingVertical` `primaryAxis*` `counterAxis*` `itemSpacing` `counterAxisSpacing` `padding*` `minWidth` `maxWidth` `minHeight` `maxHeight` `constraints` `clipsContent` `grid*` `layoutGrids` `gridStyleId` `strokesIncludedInLayout` `itemReverseZIndex` |
| `color` | `fills` `strokes` `fillStyleId` `strokeStyleId` `opacity` `blendMode` `stroke*` (weights, align, cap, join, dash, miter) `dashPattern` |
| `typography` | `fontName` `fontSize` `fontWeight` `textCase` `textDecoration*` `letterSpacing` `lineHeight` `textAlign*` `textAutoResize` `paragraph*` `list*` `hanging*` `textTruncation` `maxLines` `textStyleId` `openTypeFeatures` `leadingTrim` `textWrapStyle` `indentation` `textSegments` |
| `effects` | `effects` `effectStyleId` `cornerRadius` `*Radius` `cornerSmoothing` `isMask` `visible` |
| `component` | `componentProperties` `componentPropertyReferences` `componentPropertyDefinitions` `variantProperties` `mainComponentId` `isInstance` `overrides` |
| `content` | `characters` `hyperlink` `vectorPaths` `vectorNetwork` `booleanOperation` `arcData` `pointCount` `innerRadius` |
| `structure` | `parentId` `childIds` `children` `name` |
| `prototype` | `reactions` `overflowDirection` `numberOfFixedChildren` `overlay*` |
| — (token lookups; not diffed) | `boundVariables` `explicitVariableModes` |

Patterns ending in `*` are prefix matches; `*Radius` is a suffix match. The map
lives in core as data so it can grow without touching callers.

### Token resolution

For a changed property `P` on side S (built or now), using that side's attrs:

1. **Variable:** if `boundVariables[P]` is `{ id }` (or an array whose first
   entry is), and `resolvedVariables[id]` exists → `token` = its `name`.
2. **Style:** else if `P` is `fills` / `strokes` / `effects` / `layoutGrids` /
   a text property, and the matching `fillStyleId` / `strokeStyleId` /
   `effectStyleId` / `gridStyleId` / `textStyleId` is set and present in
   `styleDefinitions` → `token` = the style's `name`.
3. Otherwise no token: the value is returned raw (not wrapped).

When a token is found the value is `{ token, value }`, where `value` is the raw
attribute value. `bound` variable changes with an identical raw value still
count as changes (the binding is a design decision).

### Migration of existing data

- Clean nodes (`content_hash = implemented_hash`): `implemented_attrs := attrs` —
  exact.
- Dirty nodes that were implemented before but have no stored implemented
  attributes: `changes` is unknown until their next clear. They are returned
  with `changeType: "modified"`, `changes: null`, `changesKnown: false`.
- Never-implemented nodes: `changeType: "added"`.

## Listing: `GET /v3/files/{fileKey}/nodes`

All parameters are optional. Comma-separated values within one parameter mean
**OR**; different parameters combine with **AND**.

| Parameter | Example | Meaning |
|---|---|---|
| `state` | `dirty` | `dirty` (default), `clean`, `blocked`, `all`. Blocked nodes are excluded from `dirty`. |
| `under` | `1:93299` | Only this node's subtree (inclusive). |
| `depth` | `1` | With `under`, limit to N levels below it (tree UIs expand lazily with `depth=1`). |
| `type` | `TEXT,INSTANCE` | Node types. |
| `changeType` | `added,modified` | Kinds of change. |
| `changed` | `fills,padding*` | Changed property names; `*` is a suffix wildcard. |
| `category` | `typography` | Change categories. |
| `component` | `1:500` | Instances placed from this main component (plus the main itself). |
| `name` | `Button*` | Name glob (case-insensitive). |
| `since` | `2026-09-28T00:00Z` | Changed at or after this time. |
| `claimed` | `false` | `true`, `false`, or `mine` (with `worker`). |
| `q` | `state:dirty under:1:93299 changed:fills` | Compact filter string; each `key:value` maps to the parameter of that name. |
| `view` | `compact` | `compact` (default) or `full` (adds `attrs`, `implementedAttrs`, `path`). |
| `fields` | `nodeId,name,changes` | Return only these fields (overrides `view`). |
| `include` | `counts` | Adds `descendants: { total, dirty, blocked }` per node (for tree UIs). |
| `sort` | `document` | `document` (default: the design's layer order, `docs/api-v3-agent-ergonomics.md` section 9), `path` (node-id path order), `updatedAt`, `name`; prefix `-` for descending. |
| `limit` | `100` | Page size, default 100, max 1000. |
| `cursor` | opaque | From the previous page's `nextCursor`. |

Response:

```json
{ "fileKey": "SpQe…", "nodes": [ … ], "nextCursor": "eyJ…", "total": 212 }
```

`total` is the count matching the filter (computed when cheap; omitted
otherwise). Compact nodes carry: `nodeId`, `name`, `type`, `parentId`,
`state`, `changeType`, `changes`, `contentHash`, `figmaUrl`, `claim`
(`{ worker, label, expiresAt }` or `null`), `blocked` (`{ reason, by, at }` or
`null`).

## Actions

### Bulk clear — `POST /v3/files/{fileKey}/clear`

```json
{ "commitRef": "a1b2c3d", "items": [ { "nodeId": "1:93312", "contentHash": "9f2c…" }, … ] }
```

- Up to 500 items. Each item is hash-guarded independently.
- **Partial success**: the request succeeds (`200`) and reports per item —
  `cleared`, `stale` (design changed; includes the current `contentHash`), or
  `not_found` — plus totals. There is no all-or-nothing mode.
- Clearing stores `implemented_attrs`, resets `changed_props`/`change_type`, and
  releases any claim on the node.

### Claims

- `POST …/claims` with `{ worker, label?, ttlSeconds?, limit?, nodeIds? | filter? }`
  where `filter` takes the listing parameters. Returns
  `{ claimId, worker, expiresAt, nodes: [compact…] }`. Only unclaimed (or
  expired, or already-yours) nodes are taken; the response lists them.
- `worker` identifies the agent session; `label` is a short display name (for
  logs and the future UI's agent sprites).
- `…/renew` extends the lease; `DELETE` releases it; clearing a node releases
  it; expiry releases it automatically.
- **One lease mechanism for v2 and v3.** A node is claimed exactly when its
  existing `claimed_by` / `claim_expires_at` say so (`claim_expires_at > now`).
  v3 additionally records a `claim` row (`claim_id`, `file_key`, `worker`,
  `label`, `created_at`, `expires_at`) and sets `node.claim_id`, so a lease can
  be renewed or released as a unit. v3 claims set `claimed_by = worker` and
  `claim_expires_at = expires_at` on each node, so v2 sees them; a v2 lease
  appears in v3 as `claim: { claimId: null, worker, label: null, expiresAt }`.
- Renew/release act on the nodes still pointing at that `claim_id`; a node that
  was cleared or re-claimed since is left alone.

## Supporting data

- **`sync_event`** — one row per plugin sync: `file_key`, `root_node_id`,
  `counts` (`uploaded`, `changed`, `added`, `deleted`, `baselined`), `created_at`. Powers
  `/scopes`, "last sync" times, and the events stream, and is the raw material
  for activity history.
- **`file`** — `file_key` (PK), `name`, `last_sync_at`, `created_at`. The name
  comes from the plugin (`figma.root.name`).
- Both need a small, additive plugin change: send `fileName` and
  `rootNodeId` with its sync batches (the v2 batch route accepts them as
  optional fields in phase 1).

## Errors

All v3 errors use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem
details with two extra members:

```json
{
  "type": "https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/errors.md#file-not-found",
  "title": "File not found",
  "status": 404,
  "code": "file_not_found",
  "detail": "No tracked file with key 'https://www.figma.com/design/SpQe…'.",
  "hint": "That looks like a Figma URL. Use the file key 'AbCdEf123456GhIjKl7890', or pass ?url=…"
}
```

Hints cover the known traps: URL-as-key, hyphen node IDs that don't exist in
either form, wrong token class, stale hash (with the current hash).

## OpenAPI and tooling

- Every v3 route declares JSON Schemas for params, query, body, and responses
  (Fastify validates with them). `@fastify/swagger` renders
  `GET /v3/openapi.json` from the same schemas.
- Phase 1: the MCP server and CLI are updated by hand to v3 and **tested against
  the OpenAPI document**. Phase 2: generate their tool/command definitions from
  it so they can't drift.
- New MCP tools: `list_nodes`, `get_node`, `clear_nodes`, `claim_nodes`,
  `release_claim`, `resolve_url` (plus `summarize` / `get_work_items` in
  phase 2). They accept Figma URLs directly.
- New CLI: `fds nodes ls --dirty --under 1:93299 --changed fills`,
  `fds nodes show <id>`, `fds clear --commit <sha> <id>=<hash>…`,
  `fds claim …`, all accepting `--url`.

## Delivery

**Phase 1 (first cut):** change model, listing (incl. tree support), clean
addressing + `resolve`, files/scopes/node detail, bulk clear, claims, problem
errors, OpenAPI, `sync_event` + `file`, MCP and CLI on v3.

**Phase 2** (designed in `docs/api-v3-phase2.md`): summaries and work items, block/unblock, the event stream,
alternative response formats (`format=ndjson|md`), generated MCP/CLI, plugin on
v3 routes.

**Phase 3:** retire v1 and v2; the UI (below).

## Future: a UI (phase 3)

A web UI served alongside the API, for local and self-hosted deployments:

- **Node tree table**: the file's node tree with each node's state, change
  type, and changed categories — paginated, searchable, filterable. It uses the
  listing endpoint directly (`under` + `depth=1` + `include=counts` to expand
  lazily; the same filter parameters for search).
- **Agent sprites**: small generated avatars (seeded from the claim's `worker`)
  shown inline on the nodes an agent has claimed, animating while it works and
  "poofing" when the node is cleared. Driven by the events stream
  (`claim.created`, `nodes.cleared`, `claim.released`; see
  `docs/api-v3-phase2.md`) and each claim's `label`.
- **Needs from the API**: tree queries with counts, claim identity and labels,
  the event stream, and read-only authentication (the `viewer` token class and
  UI origins in phase 2), plus short-lived stream tickets for the browser.

## Implementation notes (phase 1)

- **Code layout.** v3 lives in `apps/api/src/v3/` (`index.js` registers it;
  `read.js`, `actions.js`, `schemas.js`, `problem.js`, `address.js`). `app.js`
  gains one `app.register(require('./v3'))` line and nothing else.
- **Store interface.** New methods on both `PostgresStore` and `MemoryStore`
  (unit tests use the latter, so they must behave identically):
  `listNodes(fileKey, filter, page)`, `getNodeV3(fileKey, nodeId)`,
  `listFiles()`, `listScopes(fileKey)`, `recordSync(event)`,
  `upsertFile(file)`, `createClaim(...)`, `renewClaim(...)`,
  `releaseClaim(...)`. Postgres filters in SQL (ltree `<@` for `under`,
  `nlevel` for `depth`, `&&` on the array columns); nothing loads a whole
  subtree to filter it in JS. PGlite runs the same SQL.
- **Paging.** `cursor` is base64url JSON of the last row's sort key and
  `node_id`; ties break on `node_id`. `sort=document` orders by the root's
  path, then `order_key` (document order; `docs/api-v3-agent-ergonomics.md`
  section 9); `sort=path` orders by the `ltree` path's text, then `node_id`. `total` is always returned (a `count(*)` with the same
  filter).
- **`figmaUrl`** comes from `core.link(fileKey, nodeId)`, as in v2.
- **Validation.** Unknown query parameters are a `400` with a hint listing the
  valid ones (typos otherwise silently widen a filter).
- **Dependencies** (e.g. `@fastify/swagger`) are pinned exactly, to a release at
  least 7 days old.

## Decisions

1. **Bulk clear is partial-success only**, with per-item results. No atomic mode.
2. **Blocked nodes unblock automatically when their content hash changes** — the
   designer may have resolved the ambiguity. Explicit unblock also works.
   (Block/unblock ship in phase 2; the columns are added in phase 1.)
3. **The plugin moves to v3 routes in phase 2.** In phase 1 it only adds
   optional `fileName` and `rootNodeId` to its v2 batch uploads.
4. **Listing defaults to `state=dirty`** — the work queue.
