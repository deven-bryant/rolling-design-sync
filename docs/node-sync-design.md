# Node-sync redesign (v2) — baseline-free per-node change tracking

> **Historical.** This is the v2 design that introduced per-node change
> tracking; it was implemented, then superseded by API v3
> ([`docs/api-v3-design.md`](api-v3-design.md)). It's kept because the code,
> tests and migrations refer to it. The v1 and v2 routes it describes no
> longer exist.

Status: **planned**, ships **additively** on top of the current per-scope model
(`docs/architecture.md`). New `node` table + v2 routes land **alongside** the
existing tables/routes so `main` stays deployable at every merge. Removing the
v1 per-scope model (tables + routes) is a **separate, later, explicitly-confirmed
cutover** — do not drop anything in this change.

## Why

The per-scope model requires the user to think about baselines. The desired UX
is: run the plugin on any section/frame/component and have per-node snapshots +
deltas grow **organically**, with worker agents pulling only the changed nodes
for a given subtree and mapping them to code via Code Connect (`figma.ts`).

"No baselining" does not remove the baseline concept — it makes it an
**automatic per-node last-implemented snapshot** that advances when a worker
clears a node. That is the same correctness guarantee as v1's verified baseline,
at per-node granularity, managed for the user.

## Model

- **Per-node rolling store** keyed by `(file_key, node_id)`. One row per node;
  its `jsonb` holds **only that node's own attributes** (no nested children — the
  tree is `parent_id` + a materialized `path`). No structural duplication.
- `content_hash = sha256(stable(attrs))` where `stable()` is the existing
  canonical serializer in `packages/core`. **The same core code computes hashes
  on the plugin and the server**, so they always agree.
- `implemented_hash` = the hash a worker last cleared = the **auto-baseline**.
  `dirty = content_hash <> implemented_hash`.
- **Instances are not tracked in v1.** Store **main components + non-instance
  nodes** only. Rationale: in this workflow instances change only via their main
  component, and a code component propagates to all its usages exactly like a
  Figma instance — fix the coded component once (found via `figma.ts`) and all
  screens follow. (`component_usage` edge table is deferred; add later only if an
  affected-screens QA list is wanted. Assumption: no per-instance overrides; if
  that slips we add instance-override detection.)

## Schema (additive migration)

```
node                                   -- current state, ONE row per tracked node
  (file_key, node_id) PK
  node_type text, name text, parent_id text
  path        ltree                    -- materialized path of ancestor node_ids
  attrs       jsonb                    -- this node's OWN attributes only
  content_hash text
  implemented_hash text                -- auto-baseline (advanced on clear)
  dirty        boolean                 -- content_hash <> implemented_hash
  implemented_commit text, implemented_at timestamptz   -- audit
  claimed_by text, claim_expires_at timestamptz         -- multi-agent lease
  deleted_at timestamptz               -- tombstone (node vanished from Figma)
  created_at, updated_at
  indexes: GIST(path); partial (file_key) WHERE dirty; btree(file_key,node_type)
```

Enable the `ltree` extension. Leave the v1 tables (`tracked_scope`, `snapshot`,
`changeset`, `checklist_item`, `verification`) in place, untouched.

## Sync flow (plugin)

1. `GET /v2/scopes/:nodeId/hashes` → `{ nodeId: content_hash }` for that node's
   subtree (server reads by `path <@`). Small payload.
2. Plugin scans the Figma scope, computes each node's `content_hash` with
   `packages/core`, and diffs against the returned map:
   - present & hash differs, or absent from map → **changed/new**
   - in the map but not scanned → **deleted** (tombstone)
3. `POST /v2/nodes/batch` with only the changed/new nodes (id, parent_id, path,
   node_type, name, attrs, content_hash) + a list of deleted node ids. Server
   upserts (`ON CONFLICT (file_key,node_id) DO UPDATE`), sets `dirty` where
   `content_hash <> implemented_hash`, and tombstones deletes. Skips instance
   nodes (record only main-component + non-instance nodes).

## Agent flow

- `GET /v2/nodes/:nodeId/delta?claim=true&worker=<id>` → structured list of
  **dirty** nodes in that subtree (`path <@`), each with `node_id`, `node_type`,
  `name`, `attrs` (for deleted: last-known attrs), `content_hash`, and
  `parent_id`. Optional claim leases them.
- Worker resolves each dirty node → code via `figma.ts` (Code Connect), edits
  code, then clears:
- `POST /v2/nodes/clear` `{ fileKey, nodeId, contentHash, commitRef }` —
  **hash-guarded compare-and-clear**: only clears if the node's current
  `content_hash` still equals `contentHash`; sets `implemented_hash = content_hash`,
  `dirty=false`, records `implemented_commit`/`implemented_at`. If the hash
  changed since the worker read it, reject (`409 stale`) so a newer, unimplemented
  edit is never marked done.

## Code Connect resolution ladder

For each dirty node with no `figma.ts` mapping:
1. **Classify** — raw layout/text/vector (no mapping expected) → edit its owning
   screen/page in code. Component/component-set → continue.
2. **Resolve (bounded, no guessing):** reuse an existing mapping for the same
   main-component key; else name/convention search in `src/components/**`; use
   Figma MCP to disambiguate.
3. **High-confidence single match** → fix code AND **backfill the `figma.ts`** in
   the same commit (self-heals; reviewed in the merge diff).
4. **No/ambiguous match** → do NOT edit; mark the node **blocked** with the
   candidate list and surface it.

## Testing / CI

- API unit tests are **DB-free** (memory store) so the base `ci.yml` stays green
  with no database.
- The per-node end-to-end flow is covered against a real Postgres in the
  **e2e** workflow (extend the existing `e2e.yml`/`tests/`).

## Main-component resolution (v2.1)

Skipping instances leaves a gap: a scanned page is mostly instances, so almost
nothing is tracked, and any instance whose main component isn't in the DB is a
dangling reference. Fix: **instances stay unrecorded, but every instance's main
component is guaranteed to exist in the DB**, resolved on demand.

Rule: while scanning a scope, for each INSTANCE, resolve its main
(`getMainComponentAsync()`). If the main isn't already stored, **navigate to it
and scan its definition into the DB** — recursively, because a main is itself
built from instances (transitive closure of every referenced main). The mains
are stored as ordinary non-instance node rows via the existing batch upsert; the
instance nodes themselves are still not stored.

Same file, other page (the common case here — one file, pages like
`Application Components` / `Page Designs`): the main is a **local node**, fully
traversable. Load lazily under `documentAccess: dynamic-page` — rely on
`getMainComponentAsync()` + `getNodeByIdAsync()` to load only the pages actually
referenced. **Do not** call `loadAllPagesAsync()` (memory). External published
libraries (not the current setup): `figma.importComponentByKeyAsync(key)` /
`importComponentSetByKeyAsync(key)` return a traversable node — no stubs, no dead
ends.

Efficient plugin traversal (worklist over *main components*):
- `capturedMains: Set` — mains scanned/queued this run (dedup + cycle guard).
- `presentInDb: Set` — mains already stored, from a **batched** existence check.
- `mainQueue` — mains still to scan; drain to closure.
- One `getMainComponentAsync()` per instance (no cheap sync id), but only **one
  subtree scan per unique main**; skip mains in `capturedMains ∪ presentInDb`.

New API surface: `POST /v2/nodes/exists { fileKey, nodeIds }` →
`{ present: [nodeId,…] }` (lookup on the existing `node` table; no schema
change). A present main is left as-is — its own edits are picked up when its
page/component is scanned as a scope. Identity stays `(file_key, node_id)`
(single file); `component_key` remains deferred (only needed for external
libraries + the future instance→main link).

## Instance placements (v2.2) — supersedes "instances not stored"

Storing only main components leaves a page (which is assembled from instances)
almost empty and scatters the real work across the file. So instances ARE now
stored — as lightweight **placement rows** — while their internals still are not.

Two distinct links per node:
- **Tree edge** (`parent_id` / `path`): the node's place in the Figma page
  hierarchy. An instance's `parent_id` is the frame it sits in — so a single
  subtree query (`path <@ scope`) returns the whole page, instances included.
  **This makes a page self-contained; no cross-page scoping needed to implement
  it.**
- **Component reference** (`main_component_id`, the one-to-many link): on the
  instance row, pointing at its main component's node row (guaranteed present by
  main-resolution). A worker walks the page tree → for each instance follows
  `main_component_id` → maps that main to code via `figma.ts`.

Rules:
- Record the **instance node itself** (its own props + overrides via
  `componentProperties` + `parent_id`/`path` + `main_component_id`). Its
  `content_hash` covers **only placement/overrides** — so editing a main's
  internals dirties the *main*, never its instances (no fan-out).
- **Do NOT recurse into an instance's children** — those live once in the main
  definition, reached via the FK. (Skip a node only if a *strict ancestor* is an
  instance; the instance node itself is kept.)
- Main-resolution (v2.1) is unchanged and feeds the FK: every referenced main is
  still scanned in.

Schema (additive): add `is_instance boolean` + `main_component_id text` to
`node`, index `(file_key, main_component_id)`. No hard FK (a main may be upserted
later in the same sync); it's a soft reference resolved by presence.

API: batch upsert **stores** instances now (drop the instance skip; persist
`is_instance` + `main_component_id`); the subtree delta returns them. (A
whole-file delta for "sync every component" is still a possible later add, but
page implementation no longer needs it.)

First-scan dirty is unchanged: on a fresh scan everything is dirty, so a worker's
first pass is "if code already matches, clear; else fix then clear."

## Stale-main refresh (v2.3)

Main-resolution (v2.1) scans only **missing** mains. But a main captured before
instance support (v2.2) keeps its instance-less subtree, so the page graph
dead-ends: `instance → main → (no nested instances recorded)`. We need existing
mains to self-heal, without perpetually re-scanning genuine leaf components.

Fix — a **capture-version stamp**:
- Schema: add `capture_version smallint not null default 1` to `node`.
- API: a server constant `CAPTURE_VERSION` (now `2` = instance-aware). Stamp
  `capture_version = CAPTURE_VERSION` on **every** upsert. Rows written before
  the migration keep the default `1`.
- `/v2/nodes/exists` returns `{ present: [...], stale: [...] }`, where `stale ⊆
  present` are ids with `capture_version < CAPTURE_VERSION`. The version
  threshold lives server-side; the plugin doesn't hard-code it.
- Plugin main-resolution: re-scan a main if **absent OR in `stale`** (was:
  absent only).

Result: the first sync after deploy transitively re-scans the referenced-main
graph once (backfilling instance placements everywhere), then reverts to
incremental. Because it's a version stamp (not a "has no instances" heuristic),
genuine leaf components are re-scanned once and then left alone — no perpetual
re-traversal. Expect that first heal sync to be heavy (it walks the whole
referenced graph); subsequent syncs are cheap.

## Out of scope (v1 of this redesign)

- `component_usage` / instance tracking.
- Dropping the v1 per-scope tables/routes (separate confirmed cutover).
- CRM-repo Code Connect backfill + a CI lint for unmapped components (tracked
  separately in that project).
