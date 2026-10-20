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

### Removed design

- **Never-built deletions resolve themselves.** A sync that tombstones a node
  whose `implemented_hash` is null (it was never built) stores it as a
  **clean** tombstone (`dirty = false`, change columns cleared): it is not
  work. The sync result and the `sync.completed` event count them as
  `autoResolved`; they are not in `counts.dirty` (nor in trends' `dirtied`). If
  the node reappears in a later sync it is `added` again. Dirty never-built
  tombstones stored before this rule are resolved by migration
  `20261012000000_api_v3_auto_resolve_never_built.sql` (Postgres, and the
  local PGlite store, which applies migrations at startup); the memory store
  keeps no data across restarts, so it has none to migrate.
- **Removed work items.** With `group=component` and `group=set`, a deleted
  node's **removed root** is the topmost tombstoned node on its path (its
  parent is live or not stored). Deleted nodes whose removed root is not inside
  a live `COMPONENT` / `COMPONENT_SET` form one item per removed root:
  `kind: "removed"`, `key` = the root's id, the root's `name` / `type`,
  `nodeCount`, `nodeIds` (document order, root first), `changedProps` /
  `categories`, `progress` with `include=progress`, and
  - `uses: [{ componentId, name, set?, remote?, placementsRemoved, livePlacements }]`
    — the main components referenced by instance rows inside the removed
    subtree; `livePlacements` counts the file's non-tombstoned instance rows of
    that main. Those with `livePlacements: 0` come first, then by name and id.
  - `warnings: [{ code: "main_removed_with_live_placements", componentId, livePlacements }]`
    — a COMPONENT / COMPONENT_SET inside the removed subtree (the root
    included) that still has live instances elsewhere; empty when none.

  Removed items come after the component (and set) items and before the
  `key: null` item, in the document order of their roots. Other items have no
  `kind`. A layer deleted inside a live component stays in that component's
  item; `group=frame` is unchanged; `expand=instances` never expands removed
  design (only live instances reach main components).
- **Subtree clear.** A `clear` item with `subtree: true` on a tombstoned root
  clears, when the root's `contentHash` matches, the root and every dirty
  tombstoned descendant (live descendants are untouched) and reports
  `subtreeCleared: n` on the root's result; the `nodes.cleared` event lists
  and counts them all. `subtree: true` on a live node is the per-item status
  `not_removed` (nothing cleared). `MAX_CLEAR_ITEMS` still bounds the items per
  request, and each request is one transaction.

An agent handling a removed item removes the code that rendered the root,
keeps the components in `uses` with `livePlacements > 0`, considers removing
those with `0`, and then clears the root with `subtree: true`.
- **Categories** come from one static map in `packages/core` (shared with the
  plugin): `layout`, `color`, `typography`, `effects`, `component`, `content`,
  `structure`, `prototype`, `other`.

### Library components

- **Library nodes.** `node.library` (migration
  `20261013000000_api_v3_library_components.sql`) flags a **remote** (library)
  main component / component set and every row inside it. A sync upsert may
  send `library: true`; the server also flags COMPONENT / COMPONENT_SET rows
  whose own `componentReference.remote` is true and the subtrees of the mains
  (and sets) that instance rows with a remote reference point at. The flag is
  never unset by a later sync. The migration backfills rows stored before it
  (Postgres and PGlite); the memory store has no stored data to backfill.
  Instances (placements, overrides) are never library nodes.
- **File settings.** `file.settings` (jsonb); one setting,
  `trackLibraryComponents` (default `true` when absent). `GET /v3/files`,
  `GET /v3/files/{fileKey}` and the plugin's `…/hashes` return `settings` with
  defaults filled in. `PATCH /v3/files/{fileKey}` with
  `{ settings: { trackLibraryComponents }, worker? }` (agent token or agent
  session; viewers `403`; unknown setting `invalid_parameter`; unknown file
  `file_not_found`) emits `file.settings_changed` (`data: { settings }`) when a
  setting changes; its actor follows the clear rules.
- **Tracking off.** Library nodes are left out of node listings, summaries,
  file and scope counts, work-item `progress` and trends (`sync.completed`
  `counts.libraryDirty` and `nodes.cleared` `data.libraryCount`, present when
  non-zero, are subtracted); nothing is deleted and turning it back on restores
  them. The `library=include|exclude|only` filter (default: include when on,
  exclude when off) still reaches them. With `expand=instances`
  (`group=component` or `set`) every library main the expansion reaches is a
  **reference item**: `kind: "library"`, `tracked: false`, `nodeCount: 0`, no
  `nodeIds`, no `progress`, `placements` / `placementsInScope` as usual.
  Clearing or claiming library nodes by id still works.
- **Library links.** With `RDS_FIGMA_TOKEN` (optional, server-side only) a
  library component key resolves through `GET /v1/components/{key}` /
  `/v1/component_sets/{key}` (`meta.file_key`, `meta.node_id`) into the
  `library_component` cache — in the background after a sync commits and on
  read, never blocking or failing a request, with a short timeout and at most
  one retry per hour for failures. Library nodes and items carry
  `library: { key, fileKey?, resolved }`; `figmaUrl` is the library file + the
  main's node id when resolved, else `null`. `GET /v3/status` reports
  `libraryLinks: true|false`.

### Design tokens

Figma variables are tracked as nodes in the `node` table, so dirty, claim,
clear, block, history and events work for them unchanged.

- **Ids.** One scope per file, root **`tokens`** (type `TOKENS`, name "Design
  tokens"); one node per collection, **`tokens:<collectionKey>`**
  (`VARIABLE_COLLECTION`; attrs `name`, `modes`, `remote`); one node per
  variable, **`token:<variableKey>`** (`VARIABLE`; attrs `name`,
  `resolvedType`, `description`, `scopes`, `codeSyntax`, `variableId`,
  `remote` and one **`value:<Mode name>`** per mode — a normalized value or an
  alias `{ alias: "token:<key>", name }`). They are never rewritten like
  `1-2` → `1:2`, are URL-safe as path segments, and have `figmaUrl: null`
  (also on the scope and on token work items).
- **Sync.** The plugin uploads tokens through `POST …/sync` with
  `rootNodeId: "tokens"` and reads `GET …/hashes?under=tokens`, which also
  carries `tokens: { "<nodeId>": { variableId, remote, collectionId } }` for
  every live variable (in place of the root's own hash: the plugin re-sends the
  root on every tokens sync). A token is tombstoned only through
  `deletedNodeIds` — a local variable gone from the file's local variables;
  never a library one, nor one a sync did not mention — and a collection only
  once all its tokens are tombstoned.
- **Identity.** A token is its variable key; `variableId` is the Figma id of
  the imported copy the sync reached, which a library re-import can change.
  When a token's attrs differ from its implemented attrs only in `variableId`,
  the sync keeps it clean and moves its baseline (`implemented_hash` /
  `implemented_attrs`) to the new attrs, counted as `rebaselined` in the sync
  result and `sync.completed` counts (not dirty, not changed, no clear event);
  a batch that upserts the `tokens` root does the same for every stored token
  dirty only by its id. `variableId` is never listed in `changedProps` or
  `changes`. The content hash is unchanged.
- **Scope.** `GET …/scopes` lists it as "Design tokens" (`TOKENS`) with counts.
  Document order: collections by name, then each collection's variables by
  name, compared `/`-group by group so a group's tokens stay together.
- **Diffs.** A `value:<Mode>` change is category **`token`** (an alias diffs as
  its `{ alias, name }` target); `description` is `content`, `name` is
  `structure`, `codeSyntax` / `scopes` / `resolvedType` are `other`. Markdown
  lines read `bg-active (VARIABLE) — value:Dark #202527 → #2b3033`, an alias
  as `{gray/900}`.
- **Work items.** With `group=component` and `group=set`, token nodes form one
  item per collection: `kind: "tokens"`, `key` = the collection node id,
  `name` = the collection name, `nodeIds` = its dirty tokens, `changedProps`
  (e.g. `value:Dark`), `progress`; a changed root forms its own item (`key:
  "tokens"`). Token items come after the component and removed items, before
  `key: null`; deleted tokens stay in their collection's item (never a removed
  item). `group=frame` with `under=tokens` groups by collection the same way.
  For each token: update the code variable named by `codeSyntax` (WEB, else the
  token name) for each changed mode, then clear it.
- **Usage.** `usage: { layers }` on a token — the number of live (not
  tombstoned) nodes whose stored `attrs.resolvedVariables` has an entry whose
  `key` is the token's variable key (whichever imported id it is under) — on `GET …/nodes/{nodeId}`, and with `include=usage` on token
  listings and token work items (`usage: { nodeId: { layers } }`). One store
  query per request (a jsonb scan of the file's live rows; no index).

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
| `content` | `characters` `hyperlink` `vectorPaths` `vectorNetwork` `booleanOperation` `arcData` `pointCount` `innerRadius` `description` |
| `structure` | `parentId` `childIds` `children` `name` |
| `prototype` | `reactions` `overflowDirection` `numberOfFixedChildren` `overlay*` |
| `token` | `value:*` (a design token's value in one mode) |
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

### Node notes

A person (viewer) or agent can note that a built node does not match the
design: `POST …/nodes/{nodeId}/notes { body, worker? }` (body 1–4000 chars).

- **State.** A node is dirty when its `content_hash` differs from its
  `implemented_hash` *or* it has open notes. A design-clean node with open
  notes reads `changeType: "requested"`, `changeCategories: ["note"]`,
  `changedProps: []`; with design changes too, the design `changeType` wins
  and `note` is added to its categories. Re-sync never cleans a node with open
  notes; tombstoned nodes take no notes.
- **Resolution.** Clearing a node resolves its open notes in the same
  transaction (`resolved_by`, `commit_ref`); a stale clear resolves nothing.
  Dismissing (author or any agent) or deleting (author only) the last open
  note recomputes the node's state. Only the author edits an open note.
- **Reads.** Nodes carry their open `notes: [{ noteId, body, author,
  createdAt }]` (listing, detail, outline, markdown); `get_node` adds
  `notesResolved`. `state=requested`, `changeType=requested` and
  `hasNotes=true|false` filter; work items count open `notes`; summary counts
  `requested`, and a note on a clean node counts as dirtied in trends.
- **Events.** `note.added` (with `dirtied`), `note.resolved`, `note.dismissed`
  (with `reason`) carry `{ nodeId, noteId, author }` — never the body.
- **Storage.** `node_note` (`note_id`, `file_key`, `node_id`, `body`, `author`,
  `worker`, `status` open | resolved | dismissed, `created_at`, `updated_at`,
  `resolved_at`, `resolved_by`, `commit_ref`), with a partial index on open
  notes per node.
- **Auth.** These are the only writes viewer tokens and sessions may make;
  session writes follow the usual CSRF rules.

### Screenshots and render checks

- **Images.** Notes take up to 3 `images` (base64 PNG / JPEG / WebP, ≤ 5 MB,
  ≤ 8192 px a side; the type is sniffed from the bytes). Each is re-encoded
  (metadata stripped), gets a ≤ 480 px WebP thumbnail and is an `attachment`
  row (`attachment_id`, `owner_kind` note | screen | check, `kind`
  screenshot | reference | built | heatmap, size, dimensions, sha256) whose
  bytes sit in the blob store (`blob` table, local files or an S3 bucket).
  They are served only with credentials, `nosniff`, sandboxed. Deleting a note
  deletes its images. `storeImages: false` on a file refuses new ones.
- **Screens.** `screen` rows mark a FRAME or COMPONENT (not a section) as a
  page of the app: `route`, `viewport`, `theme?`, `query?`, `masks`,
  `threshold` (% of pixels, default 1). The **design version** hashes the
  content hashes of the screen and every live node under it; the plugin
  uploads a 1× reference for screens whose reference is for another version
  (`references-needed`).
- **Checks.** Anyone signed in requests a check (idempotent while
  `requested`); an agent submits the built screenshot. The API compares it
  with the reference — no resizing, size differences count as differing,
  masks skipped, YIQ distance with anti-aliasing tolerance — and stores
  `score`, up to 10 merged `regions` and a heatmap. Over the threshold is
  `mismatch`: a `render_check` note (author `render-check`, the three images
  attached) dirties the screen root as `requested` with category `render`.
  A pass resolves those notes. A design change makes the last result
  `stale`. Each target keeps its `checkRetention` newest results (default 5) plus its last pass. Events
  `render_check.requested|passed|mismatch` carry ids and the score only.
- **Reads.** Nodes and work items carry `screen: { status, stale, score }` on
  screen roots (`building` while nodes under it are dirty, then `ready`,
  `requested`, `passed`, `mismatch`, `error`).

### Check targets

- **Targets.** A `screen` row is a check target: `source` manual
  (set_screen) | auto, `family_key`, `theme`, `query`, `gallery` (the CLI's
  resolution cache), `mask_node_ids`, `node_map_id` and `excluded`. `level`
  is deprecated (kept readable: `component` for a main component below its
  scope's top level, else `screen`). Rev9 screens are `manual` / `screen`.
- **Scope checks.** `scope_setting (file_key, node_id, checks)` — one switch
  per scope, true for scopes without a row. The plugin sends `checks` with a
  sync batch that has `rootNodeId` (omitted = unchanged); the deprecated
  `scopeKind` maps `screens` / `components` to true and `none` to false (the
  migration backfills stored kinds the same way). `PATCH …/scopes/{nodeId}`
  `{ checks }` changes it; `…/scopes` lists each scope's `checks`.
- **Detection.** With `autoTargets` (file setting, default true), each checked
  scope → the union of its top-level FRAME / COMPONENT / INSTANCE nodes, each
  variant of a top-level COMPONENT_SET and every main COMPONENT inside it
  (library nodes excluded), each node once. Auto rows follow syncs, scope
  switches and settings changes; a node that stops qualifying loses its auto
  target with its checks and images. `excluded` is never reset by
  re-detection. `autoTargets: false` leaves only manual screens.
- **Exclude.** `PATCH …/targets/{nodeId}` `{ excluded }`: an excluded target
  keeps its history, matches no `status` filter (so it leaves the ready
  list), never blocks and is skipped by `rds-agent check --all`.
- **Families.** Variants of one set whose properties differ only in mapped
  ones (`variantMappings`: `as` theme | query, `key`, `values`) share a
  `family_key`; `target_family (file_key, family_key, route)` holds the route,
  set with `PATCH …/targets/{nodeId}` (route capture). A lone frame is its own
  family. Theme / query come from the mapped properties; `themeMode`
  (`color-scheme` | `query` | `storage`) and `themeKey` say how the renderer
  applies the theme.
- **Node maps.** `PUT …/screens/{nodeId}/reference` takes `nodeMap: [{ nodeId,
  mainNodeId?, x, y, width, height, depth }]` (≤ 20000 entries, ≤ 2 MiB of
  JSON), stored as a `node_map` JSON attachment with the reference.
- **Ready list.** `GET …/targets` computes each target's status (rev9's plus
  `waiting`: it would be ready but a contained target — nested, or placed as
  an instance, transitively — last failed; not-mapped (no gallery entry and
  no route) and excluded targets never block) and returns them in check order
  by containment depth (contained targets first), then document order.
  `render` carries the gallery info (key, set, variant string, props) and the
  route + theme / query for every target: the CLI tries the gallery, then the
  route, else reports *Not mapped*. `?containing=<nodeId>` returns the targets
  containing a node (at or above it, placing an instance of a main component
  it is in, or containing such a target) with `renderNotes` (open render-check
  notes in the target, and the latest).
- **Attribution.** On a mismatch with a node map, each differing region goes
  to the deepest touched entries with their own record (an instance sublayer
  → `mainNodeId`; an entry is dropped when a deeper touched entry covers its
  whole overlap); more than 2 → their nearest common parent (the target when
  that is outside it). Those nodes get `render_check` notes, the target a
  summary note with the images; `render_check.attribution` records them. A
  mismatch dismisses the target's earlier render notes; a pass resolves the
  open render notes under the target and those its earlier checks attributed.
  `maskNodeIds` become mask rectangles from the node map.
- **History.** `GET …/targets/{nodeId}/checks`, latest first. Each target
  keeps `checkRetention` (default 5) results plus its last pass; pruned
  results' images are deleted.

## Supporting data

- **`sync_event`** — one row per plugin sync: `file_key`, `root_node_id`,
  `counts` (`uploaded`, `changed`, `added`, `deleted`, `baselined`, `autoResolved`), `created_at`. Powers
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
