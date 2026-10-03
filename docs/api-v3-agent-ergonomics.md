# API v3 — agent ergonomics (phase 2.5)

Status: **approved.** Builds on `docs/api-v3-design.md` and
`docs/api-v3-phase2.md`, whose rules still apply. Where those documents and
this one disagree, this document wins.

## Why

Field testing an agent against a freshly synced design (v0.9.0 era) showed
friction that forced the agent to write scripts around what should be single
calls:

- It couldn't see which nodes are **instances** or which **component** they
  come from, and nothing follows instances into their components — a
  "full-depth delta of this screen" took one call per component, recursively.
- On a **fresh sync every node is `added`**, and an added node's `changes`
  carries every attribute with its full value, so the default (compact)
  response was nearly as large as `view=full` and overflowed the agent's
  tool-result limit even with paging.
- Tool pages of 100 heavy nodes are too big for MCP clients.
- The CLI and MCP server need the same environment, and it wasn't documented
  per agent host.
- The environment variables and commands still carried the old project name.

## 1. Rename: `FDS_*` → `RDS_*`, `fds-*` → `rds-*`

- **Environment variables:** every `FDS_<NAME>` becomes `RDS_<NAME>` (API, MCP
  server, CLI, tests, `compose.yaml`, `.env.example`, CI, docs). Until 1.0, each
  component still reads `FDS_<NAME>` when `RDS_<NAME>` is unset, and logs one
  warning per variable at startup: `FDS_X is deprecated; set RDS_X`. When both
  are set, `RDS_*` wins (and the warning says so). One shared helper per package
  does this lookup — no scattered fallbacks.
- **Commands, no aliases:** the CLI `scripts/fds-agent.js` → `scripts/rds-agent.js`
  (bin `rds-agent`), the MCP bin `fds-mcp` → `rds-mcp`
  (`apps/mcp/bin/rds-mcp.js`, server name `rds-mcp`). `fds-agent` / `fds-mcp`
  stop existing.
- Unchanged: the `X-RDS-*` headers, the `rds_events` channel, the `rds-data`
  volume, internal-only files, and database objects.

## 2. Component links in every node

- `isInstance` (boolean) and `mainComponentId` (string or `null`) join the
  **compact** node fields (so they appear by default, in node detail, and in
  `fields=`).
- New listing filter `instance=true|false`.

## 3. Compact changes

- New field **`changedProps`**: the sorted names of the changed properties
  (from the stored `changed_props`), in the compact view.
- New query parameter **`changes=auto|diff|names`** on the listing, node detail,
  and work items:
  - `auto` (default): `changes` carries the built→now diff for `modified` and
    `deleted` nodes, and is **omitted** for `added` nodes (their property
    names are in `changedProps`; values come from `changes=diff`, `view=full`,
    `get_node`, or the Figma MCP via `figmaUrl`).
  - `diff`: the diff for every node (today's behavior).
  - `names`: never include `changes`; `changedProps` only.
- **Large values are truncated in compact responses:** any single change side
  whose JSON is longer than 1 KB becomes
  `{ "truncated": true, "bytes": <n> }`; `view=full`, node detail, and
  `changes=diff` with `fields` including `changes` on node detail return it
  whole. The response carries `truncated: true` when it happened.

## 4. Expanding through instances

New query parameter **`expand=instances`** on the listing, `summary`, and
`work` routes (and `expandDepth`, default 10, max 20).

- **Traversal:** start from the scope (`under`, or the whole file). Every
  instance row reached (regardless of the listing's filters) adds its
  `mainComponentId`'s subtree (the main component node inclusive) to the scope,
  transitively, breadth-first. Each main component is expanded **once**
  (deduplicated; cycles impossible to loop on). Depth counts instance→main hops.
- **Filters apply after expansion** (e.g. `expand=instances&state=dirty` →
  every dirty node the screen actually uses).
- **Annotation:** nodes reached through an instance carry
  `via: { instanceId, mainComponentId, depth }` (the first — shortest — path
  found); nodes in the original scope have `via: null`. `via` is a compact field
  only when `expand` is set.
- **Order:** with `sort=path`, the original scope first, then each expanded
  component in discovery order, each in path order. Cursors encode the
  component ordinal, so paging is stable.
- **Limits:** at most 500 distinct components per request (`expansionLimit`
  hit → the response includes `expansion: { components, truncated: true }` and
  a hint); main components that were never synced are listed in
  `expansion.unresolved` rather than failing.
- **Summary / work:** aggregate over the expanded set. With
  `work?group=component&expand=instances`, each item also carries
  `placementsInScope` — instances of it reached from the scope — alongside the
  file-wide `placements`: *"which components do I need to build for this screen,
  and how often does it use each?"*
- SQL: a recursive CTE over instance → main edges, then the usual filtered
  listing over the union of subtrees (ltree `<@ any(...)`); PGlite runs the same
  SQL; `MemoryStore` mirrors it.

## 5. Outline format

`format=outline` on the listing (and work items) returns `text/plain`: an
indented tree, one line per node:

```
Team View (FRAME) · added
  Page header (INSTANCE → 1:27892 Page header/Simple) · added
    ↳ Page header/Simple (COMPONENT) · added          ← expanded, when expand=instances
      Breadcrumbs (INSTANCE → 1:28001 Breadcrumbs) · added
  Table (INSTANCE → 1:37155 Table/Team members) · added
```

- Indentation follows the tree (relative to `under`); with `expand=instances`,
  a component's subtree is nested under the **first** instance that reached it;
  later instances of the same component show `→ 1:27892 (shown above)`.
- The listing's filters and `fields` don't change the line format; `changes`
  are summarized as a count (`· modified (3: paddingLeft, fills, …)`).
- Streams like `ndjson`/`md`, up to `limit` when given, else up to 2,000
  lines, with a final `… N more (use cursor/limit)` line.

## 6. MCP server defaults

- **Default page size 25** for tools whose operation takes `limit`, when the
  caller doesn't pass one (`RDS_MCP_DEFAULT_LIMIT`).
- **Paging surfaced:** when a result has `nextCursor`, the tool result ends with
  a short line: `More results: call again with cursor="…"`.
- **Size guard:** if a tool result would exceed `RDS_MCP_MAX_RESULT_CHARS`
  (default 50,000), the server re-requests with the limit halved until it fits
  (minimum 1). If one item is still too large, it returns it with the note
  "result truncated — use fields= or get_node". Paging stays correct because
  every retry is a real API request.
- **Text formats:** tool calls with `format=md|ndjson|outline` return the text
  as-is (text content), not JSON-parsed.
- Server instructions mention `expand=instances`, `format=outline`, and
  `changes=` for the common "what's in this screen" and "what do I build" asks.

## 7. Agent-environment docs

A new `docs/agents.md`, linked from the README, covering:

- The two variables every agent tool needs (`RDS_API_BASE_URL`,
  `RDS_AGENT_TOKEN`; optional `RDS_FILE_KEY`), and that the MCP server and the
  CLI read the same ones.
- Setup for **Claude Code** (`claude mcp add … --env`, and the settings `env`
  block so shell tools like the CLI get the same variables), **Cursor**
  (`mcp.json` `env`), and **Devin** (secrets).
- For Docker local mode: how the user copies the agent token out of the
  container once and stores it in the host config — agents are not expected to
  read `tokens.json` (and agent hosts forbid it).
- Recipes: "what's in this screen" (`format=outline&expand=instances`), "what
  do I build first" (`work?group=component&expand=instances`), the clear loop,
  claims for parallel agents.

## 8. Repairing missing change data (follow-up)

Field testing found nodes whose `changeType` is set but whose `changedProps` /
`changeCategories` are empty: rows synced before v0.8.0 and backfilled by its
migration, which could only set `change_type` in SQL. The plugin re-uploads only
changed nodes, so a re-sync never rewrites them, and `summary.byCategory` and
compact `changedProps` stay empty.

- **Startup maintenance:** `apps/api/src/maintenance.js` runs a list of repair
  steps after the store opens and before the server listens (all three stores).
  Each step is idempotent, batched (500 rows), logs one line with its count, and
  never blocks startup on failure (logs a warning and continues).
- **Step `change-data`:** for rows with `change_type is not null` and
  `cardinality(changed_props) = 0`, recompute the change columns with the same
  function the write path uses (`nodeService` change computation) and write
  them only when they differ. Rows whose change set genuinely can't be known
  (implemented without `implemented_attrs`) recompute to the same value and are
  left alone.
- No migration.

## 9. Document order (follow-up)

"Tree order" sorted by the ltree path text — a chain of node IDs — so siblings
came back in node-ID order (Table `1:94997` before Page header `1:95723`). v3
now orders by **document order**, derived from what the plugin already
captures (`childOrder`, `layoutMode`, `layoutPositioning`, `relativeTransform`).

**Sibling rank**, computed per parent over its stored children:

| Parent | Rank |
|---|---|
| Auto-layout (`layoutMode` `HORIZONTAL` / `VERTICAL` / `GRID`) | Flow children (`layoutPositioning` ≠ `ABSOLUTE`) in `childOrder` order, then absolute children in `childOrder` order. |
| Anything else (`layoutMode` `NONE` or absent: free-form frames, groups, sections, non-auto-layout components) | Reading order: by y, then x (translation of `relativeTransform`, i.e. `[1][2]`, `[0][2]`), ties by `childOrder` index. Children without a transform go after, by `childOrder` index. |
| Either | Children missing from `childOrder` go last, by node ID. |

**Order key:** a new nullable `order_key text` column (additive migration,
index on `(file_key, order_key)`): the parent's key + `.` + the rank zero-padded
to 5 digits. Nodes whose parent isn't stored (scope roots, component roots)
get `00000`; ties between roots break by path. Tombstoned nodes keep their last
key.

- **Maintained on write:** after each sync batch, re-rank the children of every
  parent the batch touched (a child inserted/updated/tombstoned, or the parent's
  `childOrder` / `layoutMode` changed, or — in a free-form parent — a child's
  `relativeTransform` / `layoutPositioning` changed), and rewrite the keys of the
  children whose rank changed and of their descendants (one statement per moved
  subtree, by path prefix).
- **Backfill:** maintenance step `document-order` fills `order_key` for rows
  where it is null (parents before children), in JS, batched.
- **Used everywhere "tree order" is promised:** new `sort=document` (the new
  default); `sort=path` stays, documented as node-ID path order. Expansion
  order becomes component ordinal, then document order. `format=outline`,
  work-item `nodeIds`, and `summary.byFrame` use document order. Cursors encode
  the order key.
- **Outline:** nodes with `layoutPositioning: ABSOLUTE` get an `(absolute)`
  marker.

## 10. Outline paging (follow-up)

Field testing: with the MCP default `limit=25`, an expanded outline nested only
the components whose rows happened to land on the first page, and repeats
couldn't say `(shown above)` — `limit` selected **rows before rendering**, and
nesting needs the whole set. Replaces the paging rules in section 5:

- `format=outline` always **renders the full result** (the filtered, expanded
  set in document order, capped at 2,000 rows; beyond that the final
  `… N more` line stays), then **pages by rendered lines**: `limit` is the
  number of lines, and the cursor is an opaque line offset bound to the query
  (a cursor from a different query → the usual 400 problem). Without `limit`,
  every line is returned. Concatenating all pages equals the unpaged text.
- The response carries `X-RDS-Next-Cursor` when more lines remain (text bodies
  have no JSON `nextCursor`), and the last line of a non-final page is followed
  by nothing else — the MCP server adds its usual paging line from the header.
- **MCP server:** no default `limit` for `format=outline`; the size guard trims
  outline text to whole lines within the budget and continues with a cursor for
  the next line (a real API request with `limit` = lines kept), instead of
  halving `limit`.

## 11. Component sets

Captured component references carry `set: { id, key, name }` when a variant's
parent is a Figma `COMPONENT_SET`. This includes instance mains, scanned
components and remote library mains. An inaccessible parent omits `set` without
blocking sync. Only nodes whose `componentReference` gains `set` get a new
content hash on the next scan; unrelated nodes keep their hashes.

Node detail and compact listings expose the captured reference as `component`
(also selectable with `fields=component`); its `set` is optional. Outline
instance links read `→ <main id> Set / Variant` when the set is known.

Work items carry `set` when known. `group=component` remains the default, one
item per nearest component. New **`group=set`** merges the matching variants of
each set into one item: `key` is the Figma set key (falling back to its node id
when unavailable), `name` is the set name, `type` is `COMPONENT_SET`, and
`variants` is `[{ key, name, nodeCount }]` in document order. Variant keys are
Figma component keys (node ids when unavailable). Counts and node ids cover
the filtered nodes across all variants, even when the set itself was not synced
(e.g. library components). A matching set root counts toward `nodeCount` but
not toward any variant. Standalone components and variants whose set is unknown
keep their component items; nodes outside components still form the final
`key: null` item. Paging, the 50-node-id cap, changes, expansion and
`include=progress` apply to the merged item just as to component items.

Use `list_work_items` with `group=set&expand=instances` to plan implementation
by design-system component names such as `Table cell` and `Badge`.

## Schema changes

Any change to the v3 schemas regenerates the CLI's command file
(`npm run gen` in `scripts/`) and commits it — CI's drift check requires it.
