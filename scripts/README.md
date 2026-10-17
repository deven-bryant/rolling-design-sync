# @rolling-design-sync/agent-cli (`rds-agent`)

Zero-dependency Node (>= 20) CLI over the file-scoped **v3** agent API of
[Rolling Design Sync](https://github.com/deven-bryant/rolling-design-sync).
Intended for non-interactive use from a worker session: list what changed in
Figma since it was last built, lease it, and clear it once it's committed.

From a checkout of the repository, run it as `node scripts/rds-agent.js` —
nothing to install (only `check` needs
[Playwright](#render-checks-rds-agent-check)) — or use the npm package (`npx @rolling-design-sync/agent-cli`,
binary `rds-agent`). New to Rolling
Design Sync? Start with the [quickstart](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/quickstart.md).

The commands, their flags and the requests they send come from
`commands.generated.json`, which `gen-commands.js` builds from the API's OpenAPI
document (every operation annotated `x-rds-cli`). Addressing, paging, output and
error formatting are hand-written ([`docs/api-v3-phase2.md`](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/api-v3-phase2.md)).

```bash
export RDS_API_BASE_URL=https://rds.example.com
export RDS_AGENT_TOKEN=<one of RDS_AGENT_TOKENS>
export RDS_WORKER=agent-7            # optional default for --worker
```

Getting those values into an agent host (Claude Code, Cursor, Devin), and the
agent recipes, are in [docs/agents.md](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/agents.md).

Every request sends `Authorization: Bearer $RDS_AGENT_TOKEN` and
`X-RDS-Client: cli/<version>`.

`rds-agent --help` lists the commands; `rds-agent <command> --help` lists a
command's flags, types, defaults and descriptions.

## Flags

Path, query and JSON-body parameters become flags (`camelCase` → `--kebab-case`):
`fileKey` is `--file-key`, a claim's `ttlSeconds` is `--ttl-seconds`, the
properties of a claim's `filter` are `--state`, `--under`, … Other path
parameters (`<nodeId>`, `<claimId>`) are positional arguments. List values are
comma-separated (`--node-ids 2-1,2-3`). Unknown flags are rejected with the list
of valid ones.

## Addressing

- **File** — every file-scoped command takes `--file-key <key>` *or*
  `--url <figma link>` (the link's file key is used, and for commands with a
  `<nodeId>` the link's `node-id` when the argument is left out). `resolve`
  takes the link as its argument.
- **Nodes** — ids are accepted as `1:2` or `1-2` (the form in Figma links)
  everywhere: positional ids, `--under`, `--component`, `--node-ids`, and the
  `<nodeId>` of `clear` items.

## Paging

`--limit` and `--cursor` (`--after` for `events`) fetch one page; `--all`
follows the page token to the end and prints one merged response.

```bash
# Dirty text nodes under a section, straight from a Figma link
rds-agent nodes ls --url "https://www.figma.com/design/AbC123/App?node-id=1-1" --under 1-1 --type TEXT

# Everything whose layout changed, ids + hashes only, every page
rds-agent nodes ls --file-key AbC123 --category layout --fields nodeId,contentHash --all
```

## Bulk clear

```bash
rds-agent clear --file-key AbC123 --commit-ref 3f2a9c1 2-1=<contentHash> 2:3=<contentHash>

# Read nodeId=hash pairs (one per line or whitespace-separated, # comments) from stdin with `-`
rds-agent nodes ls --file-key AbC123 --under 1-1 --fields nodeId,contentHash --all \
  | jq -r '.nodes[] | "\(.nodeId)=\(.contentHash)"' \
  | rds-agent clear --file-key AbC123 --commit-ref 3f2a9c1 -
```

Each item is hash-guarded on its own and reported as `cleared`, `stale` (the
design changed since you read it; `contentHash` is the current one) or
`not_found`. The request still exits `0`; a `stale: …` / `not found: …` note per
item that was not cleared goes to stderr. Lists longer than the API's item limit
are sent in batches and merged.

## Leases

```bash
rds-agent claim --file-key AbC123 --worker agent-7 --label "Text pass" --ttl-seconds 900 --limit 10 --type TEXT
rds-agent claim --file-key AbC123 --node-ids 2-1,2-3
rds-agent renew <claimId> --file-key AbC123 --ttl-seconds 900
rds-agent release <claimId> --file-key AbC123
```

`--worker` defaults to `$RDS_WORKER` wherever it is a body field (`claim`,
`block`, `unblock`); `nodes ls --claimed mine` needs an explicit `--worker`.

## Output

`--format json` (default) prints the API response pretty-printed on stdout.
`--format table` prints aligned columns for people:

```text
$ rds-agent nodes ls --file-key AbC123 --format table
NODE  NAME    TYPE   CHANGE    CATEGORIES  CLAIMED
2:1   Card    FRAME  modified  layout      -
2:2   Header  FRAME  modified  layout      -
2:3   Title   TEXT   modified  content     agent-7 (Text pass)
3 of 3 nodes
```

`--format ndjson` and `--format md` (`nodes ls`, `work`, `events`) are streamed
by the API and printed as received: one JSON object per line, or a markdown
checklist. They return every match from the cursor on, so `--all` is not needed.
`--format outline` (`nodes ls`, `work`) prints the whole outline; with
`--limit` it is one page of that many lines, and `--all` follows the API's
`X-RDS-Next-Cursor` header and joins the pages.

## Render checks: `rds-agent check`

Hand-written beside the generated commands: screenshots screens of the built
app and submits them as render check results (the API compares them with the
screens' Figma references). The only command that needs more than Node:
[Playwright](https://playwright.dev), an optional peer dependency loaded only by
`check`, from the current project or the CLI's own folder:

```bash
npm i -D playwright && npx playwright install chromium
```

```bash
rds-agent check --file-key AbC123 --base-url http://localhost:3000 --requested
rds-agent check --file-key AbC123 --base-url http://localhost:3000 --screen 2-1
```

1. `--requested` runs every requested check of the file
   (`checks ls --status requested`); `--screen <nodeId>` requests a check of
   that screen first (`checks request`), then runs it.
2. Each check carries its screen's settings: `route`, `viewport`, `theme`,
   `query`.
3. Playwright opens `base-url + route (+ query)` in a fresh context at the
   viewport size (device scale 1), `reducedMotion: 'reduce'`, `colorScheme`
   from a `dark` / `light` theme and the clock frozen at
   2025-01-01T12:00:00Z (`page.clock`); it waits for network idle and
   `document.fonts.ready`, then takes a viewport-sized PNG (not full page).
4. It submits the PNG (`checks submit`) with the commit ref and source; a page
   that fails to load is submitted as the check's `error`.
5. It prints each result — status, score vs limit, differing regions — and a
   total:

```text
2:1  passed  score 0.2% <= limit 1%  0c3d…
2:5  mismatch  score 4.5% > limit 1%  9a1e…
  region 10,20 300x40 (1234 px)
2 checks: 1 passed, 1 mismatch, 0 errors
```

| Flag | Description |
|------|-------------|
| `--file-key` | **Required.** The Figma file key. |
| `--base-url` | **Required.** Where the built app runs. |
| `--screen <nodeId>` / `--requested` | **One required.** Which checks to run. |
| `--storage-state <file>` | Playwright storage state (cookies, local storage) for a signed-in app. |
| `--browser` | `chromium` (default), `firefox` or `webkit`. |
| `--timeout <ms>` | Per page: navigation, network idle and fonts. Default 30000. |
| `--commit-ref` | Default: `git rev-parse HEAD` when run in a git repo. |
| `--source` | Default: `$RDS_WORKER`, else `rds-agent check`. |

Exit code `0` when every check passed (or none was requested), `1` on any
render mismatch, `2` on any error (usage, API, missing Playwright, a page that
did not render) — usable as a CI step. Setup, fixture data, masks and a GitHub
Actions example: [docs/agents.md, "Render checks"](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/agents.md#render-checks).

## Errors

Exit code is `0` on success (and for `--help`) and `1` on usage or API errors
(`check`: see above).
v3 errors are problem documents; the CLI prints them on stderr as:

```text
error: File not found — No tracked file with key 'https://www.figma.com/design/AbC123/App'.
hint: That looks like a Figma URL. Use the file key 'AbC123', or pass ?url=<figma link> with '-' as the file key.
```

## Regenerating

After changing an annotated operation in `apps/api/src/v3`, run `npm run gen`
in this folder and commit `commands.generated.json` and this README (the
reference below is generated too). CI runs `npm run gen:check`, which fails when
either is out of date.

<!-- BEGIN GENERATED COMMANDS (npm run gen) -->

## Command reference

Generated from the API's OpenAPI document (API 3.0.0) — one command per `x-rds-cli` operation.

| Command | Request | Summary |
|---------|---------|---------|
| [`files ls`](#rds-agent-files-ls) | `GET /v3/files` | List tracked files |
| [`files show`](#rds-agent-files-show) | `GET /v3/files/{fileKey}` | Get a file |
| [`files settings`](#rds-agent-files-settings) | `PATCH /v3/files/{fileKey}` | Change file settings |
| [`scopes ls`](#rds-agent-scopes-ls) | `GET /v3/files/{fileKey}/scopes` | List synced scopes |
| [`nodes ls`](#rds-agent-nodes-ls) | `GET /v3/files/{fileKey}/nodes` | List nodes |
| [`nodes show`](#rds-agent-nodes-show) | `GET /v3/files/{fileKey}/nodes/{nodeId}` | Get a node |
| [`resolve`](#rds-agent-resolve) | `GET /v3/resolve` | Resolve a Figma link |
| [`claims ls`](#rds-agent-claims-ls) | `GET /v3/files/{fileKey}/claims` | List file claims |
| [`claim`](#rds-agent-claim) | `POST /v3/files/{fileKey}/claims` | Claim nodes |
| [`clear`](#rds-agent-clear) | `POST /v3/files/{fileKey}/clear` | Clear implemented nodes |
| [`renew`](#rds-agent-renew) | `POST /v3/files/{fileKey}/claims/{claimId}/renew` | Renew a claim |
| [`release`](#rds-agent-release) | `DELETE /v3/files/{fileKey}/claims/{claimId}` | Release a claim |
| [`events`](#rds-agent-events) | `GET /v3/files/{fileKey}/events` | List file events |
| [`block`](#rds-agent-block) | `POST /v3/files/{fileKey}/nodes/{nodeId}/block` | Block a node |
| [`unblock`](#rds-agent-unblock) | `POST /v3/files/{fileKey}/nodes/{nodeId}/unblock` | Unblock a node |
| [`notes list`](#rds-agent-notes-list) | `GET /v3/files/{fileKey}/nodes/{nodeId}/notes` | List a node's notes |
| [`notes add`](#rds-agent-notes-add) | `POST /v3/files/{fileKey}/nodes/{nodeId}/notes` | Add a note to a node |
| [`notes dismiss`](#rds-agent-notes-dismiss) | `POST /v3/files/{fileKey}/notes/{noteId}/dismiss` | Dismiss a note |
| [`attachments get`](#rds-agent-attachments-get) | `GET /v3/files/{fileKey}/attachments/{attachmentId}` | Get an attached image |
| [`screens ls`](#rds-agent-screens-ls) | `GET /v3/files/{fileKey}/screens` | List screens |
| [`screens set`](#rds-agent-screens-set) | `PUT /v3/files/{fileKey}/screens/{nodeId}` | Configure a screen |
| [`screens rm`](#rds-agent-screens-rm) | `DELETE /v3/files/{fileKey}/screens/{nodeId}` | Remove a screen |
| [`checks request`](#rds-agent-checks-request) | `POST /v3/files/{fileKey}/screens/{nodeId}/checks` | Request a render check |
| [`checks ls`](#rds-agent-checks-ls) | `GET /v3/files/{fileKey}/checks` | List render checks |
| [`checks show`](#rds-agent-checks-show) | `GET /v3/files/{fileKey}/checks/{checkId}` | Get a render check |
| [`checks submit`](#rds-agent-checks-submit) | `POST /v3/files/{fileKey}/checks/{checkId}/result` | Submit a render check result |
| [`summary`](#rds-agent-summary) | `GET /v3/files/{fileKey}/summary` | Summarize changes |
| [`trends`](#rds-agent-trends) | `GET /v3/insights/trends` | Weekly trends |
| [`work`](#rds-agent-work) | `GET /v3/files/{fileKey}/work` | List work items |

### rds-agent files ls

`GET /v3/files`

Every file the plugin has synced, most recently synced first, with node counts (total, dirty, clean, blocked) and the last sync time. Use it to find a `fileKey` when you have no Figma link; with a link, pass it as `url` (or use `resolve_url`).

### rds-agent files show

`GET /v3/files/{fileKey}`

One tracked file's node counts and last sync time: a quick check of how much is dirty. For counts by category, type or frame use `summarize`. `file_not_found`: the file was never synced — take the key from `list_files`, or pass the Figma link as `url` with fileKey '-'.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |

### rds-agent files settings

`PATCH /v3/files/{fileKey}`

Changes a tracked file's settings; returns the file with every setting (defaults filled in). Agent tokens and agent portal sessions only (viewers get wrong_token_class). `trackLibraryComponents` (default true): false stops tracking library (remote) components — the plugin stops scanning library mains at its next sync, and stored library nodes drop out of listings, summaries, counts, work-item progress and trends (nothing is deleted; true restores them). Instances of library components stay tracked; with `expand=instances` their mains appear as `kind: "library"` reference items. `storeImages` (default true): false refuses every image upload for the file (note screenshots, screen references, render-check results) with images_disabled. Unknown settings are invalid_parameter. Emits `file.settings_changed` (`data.settings`) when a setting changes; its actor is the body's `worker` when given, `portal:<label>` on a session-authenticated call, else the token label.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--track-library-components` | boolean | body `settings.trackLibraryComponents` | Default true. false: library (remote) components are not tracked — the plugin does not scan or upload library mains, and stored library nodes are left out of listings, summaries, counts, work-item progress and trends (not deleted; `library=include` still lists them). Instances of library components stay tracked. |
| `--store-images` | boolean | body `settings.storeImages` | Default true. false: the API stores no images for the file — note screenshots, screen reference images and render-check results are refused with images_disabled (images already stored are kept). |
| `--worker` | string | body `worker` | Your worker id; recorded as the event actor (default: the token label). |

### rds-agent scopes ls

`GET /v3/files/{fileKey}/scopes`

The scopes (sections/frames) the plugin has synced in a file: each root's name, last sync, and current counts. Only nodes under these roots exist in the API; a `node_not_found` usually means the node is outside every scope and must be synced from the plugin first.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |

### rds-agent nodes ls

`GET /v3/files/{fileKey}/nodes`

Nodes of a file with their property-level changes — by default the dirty ones (design changed since last built), compact, in document order (the design's layer order), 100 per page. The main read for implementation work: filter by subtree (`under` — one node id or several comma-separated — or a `url` with node-id), type, change, category, component or name; values within a parameter are OR, parameters are AND. Each node's `changes` is `{ prop: { built, now } }` and `contentHash` is what `clear_nodes` needs. For counts only use `summarize`; to work component by component use `list_work_items`. Every node carries `changedProps` and, for instances, `isInstance` / `mainComponentId` (`instance=true` lists only instances). By default (`changes=auto`) `added` nodes have no `changes` — on a fresh sync every node is added, so pages stay small; get their values with `changes=diff`, `view=full` or `get_node`. Change values over 1 KB are replaced by `{ truncated: true, bytes }` and the page has `truncated: true`; `view=full` or `get_node` returns them whole. `expand=instances` returns everything a screen uses in one call: with `under` = the screen, it adds the main components its instances point at (and theirs, transitively), each once; filters apply to that union (`expand=instances&state=dirty` = every dirty node the screen uses). Scope nodes come first, then each component in discovery order; expanded nodes carry `via` (the instance that reached them), and `expansion` reports the count, `truncated` and `unresolved` (unsynced) components. Page with `nextCursor` → `cursor`. On `unknown_parameter` / `invalid_parameter` follow `hint`; on `invalid_cursor` keep every other parameter unchanged or drop `cursor`.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--state` | string | query `state` | Comma-separated: dirty, clean, blocked, requested, all. Default dirty (changed since last built or with open notes, not blocked); `requested`: dirty only by open notes; `all` for every state. |
| `--under` | string | query `under` | Only this node's subtree, the node included (1:2 or 1-2). Several subtrees: up to 50 comma-separated ids (1:2,1:5) for their union, each node once, in the order given. Defaults to the `url` link's node-id. |
| `--depth` | integer | query `depth` | Needs `under`: at most this many levels below it — below each root when there are several (1 = direct children). |
| `--type` | string | query `type` | Comma-separated Figma node types, e.g. TEXT,INSTANCE,FRAME. |
| `--change-type` | string | query `changeType` | Comma-separated: added, modified, deleted, requested (dirty nodes only; `requested`: built as designed but with open notes). |
| `--has-notes` | true\|false | query `hasNotes` | true: only nodes with open notes; false: only nodes without. |
| `--changed` | string | query `changed` | Comma-separated changed property names (fills, paddingLeft); a trailing `*` matches a prefix (padding*). |
| `--category` | string | query `category` | Comma-separated change categories: layout, color, typography, effects, component, content, structure, prototype, token, other, note, render. |
| `--component` | string | query `component` | Comma-separated main component ids: the components and all their instances. |
| `--name` | string | query `name` | Comma-separated case-insensitive name globs (`*`, `?`), e.g. Button*. |
| `--since` | string | query `since` | ISO 8601 time: only nodes changed at or after it. |
| `--claimed` | string | query `claimed` | Comma-separated: true (leased), false (free), mine (leased to `worker`). |
| `--worker` | string | query `worker` | Your worker id; needed with `claimed=mine`. |
| `--instance` | true\|false | query `instance` | true: only component instances (`isInstance`); false: only other nodes. |
| `--library` | include\|exclude\|only | query `library` | Library nodes (remote main components / sets and their layers): include, exclude, or only them. Default: include when the file tracks library components (`settings.trackLibraryComponents`), else exclude. |
| `--q` | string | query `q` | All the filters above in one string: space-separated `key:value` pairs, e.g. `state:dirty under:1:2 changed:fills` (several subtrees: `under:1:2,1:5`); quote values with spaces (name:"Primary Button"). A key may not also be passed as its own parameter. |
| `--view` | compact\|full | query `view` | compact (default: state, changes, hash, claim, block) or full (adds attrs, implementedAttrs, path; change values never truncated). |
| `--changes` | auto\|diff\|names | query `changes` | auto (default): the built→now diff for modified and deleted nodes, omitted for added ones (their property names are in `changedProps`) — keeps fresh-sync pages small; diff: the diff for every node, including added ones' full values; names: never `changes`, only `changedProps`. Ask for `changes=diff` (or `get_node`) when you need the values of added nodes. |
| `--fields` | string | query `fields` | Comma-separated node fields to return (overrides view): nodeId, name, type, parentId, isInstance, mainComponentId, component, state, changeType, changedProps, changes, changesKnown, contentHash, figmaUrl, library, claim, blocked, notes, screen, attrs, implementedAttrs, path, deleted, notesResolved, history, descendants, usage, via (`via` needs `expand=instances`). |
| `--include` | string | query `include` | Comma-separated: counts, usage. `counts` adds subtree counts (`descendants`) to each node; `usage` adds `usage: { layers }` to each design token (`token:<variableKey>`). |
| `--sort` | document\|path\|updatedAt\|name\|-document\|-path\|-updatedAt\|-name | query `sort` | document (default: the design's layer order — auto-layout flow order, else top-to-bottom, left-to-right), path (node-id path order), updatedAt or name; prefix `-` for descending. |
| `--limit` | integer | query `limit` | Page size (default 100, max 1000). With format=outline: rendered lines per page (default: every line). |
| `--cursor` | string | query `cursor` | The previous page's `nextCursor`, unchanged, with all other parameters the same (else `invalid_cursor`). With format=outline: the previous response's `X-RDS-Next-Cursor` header (a line position in the rendered outline). |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--expand` | instances | query `expand` | `instances`: also include the subtree of every main component the scope's instances use (the scope is `under`, or the whole file) — transitively through instances inside those components, breadth-first, each component once. Use it for "everything this screen uses" / "which components do I build for this screen". Other filters apply after expansion; `depth` cannot be combined with it. |
| `--expand-depth` | integer | query `expandDepth` | With `expand=instances`: at most this many instance → main hops (default 10, max 20; 1 = only the components the scope uses directly). |

`--format`: also `ndjson`, `md`, `outline` (from the server); `--all`: follows `nextCursor`.

### rds-agent nodes show

`GET /v3/files/{fileKey}/nodes/{nodeId}` — arguments: `<nodeId>`

One node in full: state, property changes (whole values, never truncated), component link (`isInstance`, `mainComponentId`), current `contentHash`, claim, block, subtree counts and history (when and in which commit it was last built). Use it to re-read a node before clearing it — e.g. after `clear_nodes` reports it `stale`. `node_not_found`: check the id against the link's node-id and that it is under a synced scope (`list_scopes`).

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--fields` | string | query `fields` | Comma-separated node fields to return (default: all): nodeId, name, type, parentId, isInstance, mainComponentId, component, state, changeType, changedProps, changes, changesKnown, contentHash, figmaUrl, library, claim, blocked, notes, screen, attrs, implementedAttrs, path, deleted, notesResolved, history, descendants, usage. |
| `--changes` | auto\|diff\|names | query `changes` | diff (default): the whole built→now diff, never truncated — the way to read an added node's values; auto: omitted for added nodes; names: never `changes`, only `changedProps`. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |

### rds-agent resolve

`GET /v3/resolve`

Turns a Figma link into `{ fileKey, nodeId }` (nodeId as 1:2; `null` when the link has no node-id). Needs no tracked file. Most calls also take the link directly as `url` with '-' path parameters, so use this only when you need the ids themselves. `invalid_url`: pass a figma.com/design/… link, URL-encoded.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--url` | string | query `url` | **Required.** A Figma design link, e.g. https://www.figma.com/design/<fileKey>/<name>?node-id=1-2. |

### rds-agent claims ls

`GET /v3/files/{fileKey}/claims`

Active (unexpired) claims, soonest expiry first. `nodeCount` counts nodes still leased to each claim; `nodeIds` contains at most 500 of them in node-id order; `nodes` names the first 3 in document order. Cleared, released, expired or reassigned nodes are excluded. Use this to see agents at work, then list_nodes with claimed=mine and worker to inspect a worker's nodes.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |

### rds-agent claim

`POST /v3/files/{fileKey}/claims`

Leases nodes to `worker` so parallel agents do not implement the same nodes. Claim before working when other agents may share the file; alone, you can skip claims. Select by `nodeIds` or by `filter` (not both; neither = the dirty nodes, up to `limit`). Only free, expired or already-yours nodes are taken, and the response lists exactly those — work on those only; an empty `nodes` means nothing free matched. The lease ends at `expiresAt`: `renew_claim` before then for long work; `clear_nodes` releases cleared nodes, `release_claim` the rest.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--worker` | string | body `worker` | **Required.** A stable id for your agent session; reuse it on every call. |
| `--label` | string | body `label` | A short human-readable name for the work, shown in logs and UIs. |
| `--ttl-seconds` | integer | body `ttlSeconds` | Lease length in seconds (default: the server's RDS_CLAIM_TTL_SECONDS; capped at 86400 = 24 h). |
| `--limit` | integer | body `limit` | At most this many nodes (default 100 with a filter; every listed id with nodeIds). |
| `--node-ids` | string,… | body `nodeIds` | Exact node ids to claim (1:2 or 1-2); unknown ids are skipped. |
| `--q` | string | body `filter.q` | All the filters above in one string: space-separated `key:value` pairs, e.g. `state:dirty under:1:2 changed:fills` (several subtrees: `under:1:2,1:5`); quote values with spaces (name:"Primary Button"). A key may not also be passed as its own parameter. |
| `--state` | string | body `filter.state` | Comma-separated: dirty, clean, blocked, requested, all. Default dirty (changed since last built or with open notes, not blocked); `requested`: dirty only by open notes; `all` for every state. |
| `--under` | string | body `filter.under` | Only this node's subtree, the node included (1:2 or 1-2). Several subtrees: up to 50 comma-separated ids (1:2,1:5) for their union, each node once, in the order given. Defaults to the `url` link's node-id. |
| `--depth` | integer | body `filter.depth` | Needs `under`: at most this many levels below it — below each root when there are several (1 = direct children). |
| `--type` | string | body `filter.type` | Comma-separated Figma node types, e.g. TEXT,INSTANCE,FRAME. |
| `--change-type` | string | body `filter.changeType` | Comma-separated: added, modified, deleted, requested (dirty nodes only; `requested`: built as designed but with open notes). |
| `--changed` | string | body `filter.changed` | Comma-separated changed property names (fills, paddingLeft); a trailing `*` matches a prefix (padding*). |
| `--category` | string | body `filter.category` | Comma-separated change categories: layout, color, typography, effects, component, content, structure, prototype, token, other, note, render. |
| `--component` | string | body `filter.component` | Comma-separated main component ids: the components and all their instances. |
| `--instance` | true\|false | body `filter.instance` | true: only component instances (`isInstance`); false: only other nodes. |
| `--name` | string | body `filter.name` | Comma-separated case-insensitive name globs (`*`, `?`), e.g. Button*. |
| `--since` | string | body `filter.since` | ISO 8601 time: only nodes changed at or after it. |
| `--library` | include\|exclude\|only | body `filter.library` | Library nodes (remote main components / sets and their layers): include, exclude, or only them. Default: include when the file tracks library components (`settings.trackLibraryComponents`), else exclude. |
| `--has-notes` | true\|false | body `filter.hasNotes` | true: only nodes with open notes; false: only nodes without. |

### rds-agent clear

`POST /v3/files/{fileKey}/clear` — arguments: `<nodeId>=<contentHash> … | -`

Records nodes as implemented (up to 500 per call) once your code matches the design: they become clean, their current design becomes the new baseline, and their leases are released. Send each node with the `contentHash` you implemented (from `list_nodes` / `get_node`). Each item is checked on its own and the call is 200 even when some fail: `cleared`; `stale` — the design changed since you read it, so re-read that node with `get_node`, implement the new changes and clear it with the returned `contentHash`; `not_found` — a wrong id; `not_removed` — `subtree: true` on a node that is not deleted (nothing cleared). Removed design (a `kind: "removed"` work item): once its code is gone, clear just its root with `subtree: true` — that also clears every dirty deleted node below it (`subtreeCleared`); live nodes below are untouched. Clear only what you actually built; never clear to hide changes (use `block_node` for nodes you cannot implement). The `nodes.cleared` event's actor is the body's `worker` when given, `portal:<label>` on a session-authenticated call, else the token label.

Arguments: The nodes to clear (1–500), each with the `contentHash` you implemented. (body `items`)

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--commit-ref` | string | body `commitRef` | The commit (SHA or ref) that implements the nodes; shown in node history. |
| `--worker` | string | body `worker` | Your worker id; recorded as the `nodes.cleared` actor (default: the token label). |

### rds-agent renew

`POST /v3/files/{fileKey}/claims/{claimId}/renew` — arguments: `<claimId>`

Extends the lease (to now + `ttlSeconds`) on the nodes still held under this claim; nodes cleared, released, expired or re-claimed since are not renewed, and the response lists the rest. Renew before `expiresAt` while work takes longer than the lease. `claim_not_found`: the id is wrong — take a new claim with `claim_nodes`.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--ttl-seconds` | integer | body `ttlSeconds` | Lease length in seconds (default: the server's RDS_CLAIM_TTL_SECONDS; capped at 86400 = 24 h). |

### rds-agent release

`DELETE /v3/files/{fileKey}/claims/{claimId}` — arguments: `<claimId>`

Ends the claim and frees the nodes still under it, so other agents can take them. Call it when you stop without clearing everything (cleared nodes are already released). `claim_not_found`: the id is wrong; an unreleased lease simply expires at `expiresAt`.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |

### rds-agent events

`GET /v3/files/{fileKey}/events`

The file's activity log, oldest first: syncs, clears, claims, blocks (IDs, counts and labels, never design content). Use it to see what changed since you last looked, or who holds what. JSON page `{ events, nextAfter }`: poll with `after` = the previous `nextAfter`; `after=0` starts from the oldest retained event. After a `sync.completed`, re-read the affected nodes. To read the newest events first, pass `order=desc`: the page `{ events, nextBefore }` is newest first; pass `before` = the previous `nextBefore` for the next older page (omit `before` to start at the newest event). A page shorter than `limit` is the last one. Filters apply the same in both orders. Types: sync.completed, nodes.cleared, claim.created, claim.renewed, claim.released, node.blocked, node.unblocked, file.settings_changed, note.added, note.resolved, note.dismissed, render_check.requested, render_check.passed, render_check.mismatch. With `Accept: text/event-stream`: a server-sent-event stream. Each message has `id` (the event id), `event` (the type) and `data` (the event as JSON). It replays the events after `Last-Event-ID` (header, sent by EventSource on reconnect) or `?after=`, then streams live; without either it streams live only. A `: heartbeat` comment is sent every 20 s. When the requested id is older than the replay window (RDS_EVENT_REPLAY_HOURS), one `event: reset` is sent instead of the replay — re-fetch state — and the stream continues live. `format` applies to the JSON page only (`ndjson` / `md` stream every event after `after` — with order=desc, before `before`, newest first — up to `limit` when given). `nodeId` matches data.nodeId or a member of data.nodeIds in JSON and SSE. `since` is an inclusive ISO timestamp lower bound on JSON pages (ignored for SSE). Filters combine with types, after and before. `order` and `before` apply to JSON pages only (SSE is always oldest first).

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--after` | integer | query `after` | Only events with a greater id: the previous page's `nextAfter` (default 0 = from the start of the log). |
| `--before` | integer | query `before` | Only events with a smaller id: with order=desc, the previous page's `nextBefore` (default: from the newest event). JSON pages only. |
| `--order` | asc\|desc | query `order` | Default `"asc"`. `asc` (default): oldest first, page with `after` / `nextAfter`. `desc`: newest first, page with `before` / `nextBefore`. JSON pages only; SSE is unchanged. |
| `--types` | string | query `types` | Comma-separated event types: sync.completed, nodes.cleared, claim.created, claim.renewed, claim.released, node.blocked, node.unblocked, file.settings_changed, note.added, note.resolved, note.dismissed, render_check.requested, render_check.passed, render_check.mismatch. |
| `--limit` | integer | query `limit` | JSON page size (default 100, max 1000). |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--node-id` | string | query `nodeId` | Only events mentioning this node in data.nodeId or data.nodeIds (1:2 or 1-2); JSON and SSE. |
| `--since` | string | query `since` | Inclusive ISO timestamp lower bound on createdAt for JSON pages; ignored for SSE. |

`--format`: also `ndjson`, `md` (from the server); `--all`: follows `nextAfter`.

### rds-agent block

`POST /v3/files/{fileKey}/nodes/{nodeId}/block` — arguments: `<nodeId>`

Marks a node you cannot implement (missing asset, unclear or impossible design, needs a human) as blocked, with a reason (1–500 chars) a person can act on. It leaves the default dirty listing (list it with `state=blocked`) until `unblock_node` or its next design change, and its lease is released. Blocking a blocked node replaces the reason. Use it instead of clearing a node you did not build.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--reason` | string | body `reason` | **Required.** Why the node cannot be implemented and what would unblock it. |
| `--worker` | string | body `worker` | Your worker id; recorded as `by` (default: the token label). |

### rds-agent unblock

`POST /v3/files/{fileKey}/nodes/{nodeId}/unblock` — arguments: `<nodeId>`

Removes a node's block once its blocker is resolved: it is dirty again (back in the default listing) or clean, by its hashes. `unblocked: false` when it was not blocked — nothing changed. A design change unblocks a node on its own.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--worker` | string | body `worker` | Your worker id; recorded as `by` (default: the token label). |

### rds-agent notes list

`GET /v3/files/{fileKey}/nodes/{nodeId}/notes` — arguments: `<nodeId>`

The notes on a node, newest first: its open ones (default), or `status=all` for resolved and dismissed ones too.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--status` | open\|all | query `status` | open (default) or all. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |

### rds-agent notes add

`POST /v3/files/{fileKey}/nodes/{nodeId}/notes` — arguments: `<nodeId>`

Records that the built node does not match the design, with what is wrong. An open note makes the node dirty — `changeType: requested` (category `note`) when its design is otherwise built, or its design change plus category `note` — and keeps it dirty across re-syncs. The node is listed with its open `notes` until it is cleared (`clear_nodes` resolves its notes) or the note is dismissed. Viewer tokens and sessions may add notes too. Returns the note and the node's new state; a tombstoned node cannot take notes.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--body` | string | body `body` | **Required.** What does not match the design, as a person would say it (1–4000 chars). |
| `--worker` | string | body `worker` | Your worker id, recorded on the note. |

### rds-agent notes dismiss

`POST /v3/files/{fileKey}/notes/{noteId}/dismiss` — arguments: `<noteId>`

Closes an open note without changing the build (e.g. it is wrong or already handled); the node's state is recomputed without it. Its author or any agent may dismiss it. To resolve a note by fixing the code, clear the node instead.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--reason` | string | body `reason` | Why it was dismissed. |

### rds-agent attachments get

`GET /v3/files/{fileKey}/attachments/{attachmentId}` — arguments: `<attachmentId>`

The bytes of a stored image: a note screenshot, a screen's reference image or a render check's built screenshot or heatmap. `size=thumb` returns the thumbnail (WebP, at most 480 px wide). Any signed-in caller (agent, viewer, portal session) of the file; served with `cache-control: private` and `x-content-type-options: nosniff`.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--size` | full\|thumb | query `size` | full (default) or thumb. |

### rds-agent screens ls

`GET /v3/files/{fileKey}/screens`

The frames configured for render checks, by node id, each with its settings and computed `status` (building: nodes under it are dirty; ready: built and no result for its current design; requested; passed; mismatch; error), `stale` (the last result is for an older design) and last check.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--under` | string | query `under` | Only screens at or under this node id (e.g. a section). |

### rds-agent screens set

`PUT /v3/files/{fileKey}/screens/{nodeId}` — arguments: `<nodeId>`

Makes a FRAME or COMPONENT a screen for render checks, or changes its settings: the `route` its built page renders at, the `viewport` (200–8192 px; default: the frame's size), optional `theme` / `query`, `masks` (rectangles inside the viewport ignored by the comparison) and `threshold` (0–100 % of pixels; default 1). The plugin uploads its reference image at its next sync. Agent tokens and agent sessions only.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--route` | string | body `route` | **Required.** App route, starting with `/` (e.g. `/settings`). |
| `--width` | integer | body `viewport.width` |  |
| `--height` | integer | body `viewport.height` |  |
| `--theme` | string | body `theme` | Theme the page renders in (e.g. `dark`), passed to the renderer. |
| `--query` | string | body `query` | Query string added to the route (no leading `?`). |
| `--threshold` | number | body `threshold` | Max % of differing pixels that still passes (default 1). |

### rds-agent screens rm

`DELETE /v3/files/{fileKey}/screens/{nodeId}` — arguments: `<nodeId>`

Stops render-checking a frame: deletes its settings, reference image and checks (their images too). Agent tokens and agent sessions only.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |

### rds-agent checks request

`POST /v3/files/{fileKey}/screens/{nodeId}/checks` — arguments: `<nodeId>`

Asks for a render check of a screen; an agent runs it (`rds-agent check`) and submits the result. Returns the open request when one is already pending (idempotent). Any signed-in caller, viewers included. Emits `render_check.requested`.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |

### rds-agent checks ls

`GET /v3/files/{fileKey}/checks`

Render checks, newest first; `status=requested` lists the ones waiting for an agent to run them (with each screen's route, viewport, theme, query and masks). The 10 newest checks of each screen are kept.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--status` | requested\|passed\|mismatch\|error | query `status` | Only checks in this status (`requested`: waiting for an agent). |
| `--node-id` | string | query `nodeId` | Only this screen's checks. |
| `--limit` | integer | query `limit` | Default 100. |

### rds-agent checks show

`GET /v3/files/{fileKey}/checks/{checkId}` — arguments: `<checkId>`

One render check with its score, differing regions and the reference, built and heatmap images (get_attachment fetches them).

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |

### rds-agent checks submit

`POST /v3/files/{fileKey}/checks/{checkId}/result` — arguments: `<checkId>`

Submits the built screenshot (PNG, base64, rendered at the screen's viewport) for a requested check. The API compares it with the reference for the screen's current design (no resizing; pixels outside the smaller image differ; masks are skipped) and returns the score, regions and a heatmap. score <= threshold passes (resolves open render-check notes; emits `render_check.passed`); otherwise mismatch: a `render_check` note with the images is added to the screen (dirty, category `render`) and `render_check.mismatch` is emitted. Send `error` instead of `image` when the page could not be rendered. reference_missing when the plugin has not uploaded a reference for the current design. Agent tokens only.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--error` | string | body `error` | Why the screen could not be rendered (instead of image). |
| `--commit-ref` | string | body `commitRef` | The commit the screenshot was rendered from. |
| `--source` | string | body `source` | What rendered it (e.g. `rds-agent check`, a CI job). |

### rds-agent summary

`GET /v3/files/{fileKey}/summary`

Counts of the nodes the `list_nodes` filters match (default: dirty) by state, change type, change category and node type — a cheap overview before listing or planning work. With one `under` (e.g. a page), `byFrame` also counts per child frame of it (not with several `under` ids). With `expand=instances` the counts cover everything the scope uses — its nodes plus the main components its instances reach, transitively (`byFrame` still counts only nodes under `under`): how big is this screen, components included? Returns no nodes; use `list_nodes` or `list_work_items` for those.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--state` | string | query `state` | Comma-separated: dirty, clean, blocked, requested, all. Default dirty (changed since last built or with open notes, not blocked); `requested`: dirty only by open notes; `all` for every state. |
| `--under` | string | query `under` | Only this node's subtree, the node included (1:2 or 1-2). Several subtrees: up to 50 comma-separated ids (1:2,1:5) for their union, each node once, in the order given. Defaults to the `url` link's node-id. |
| `--depth` | integer | query `depth` | Needs `under`: at most this many levels below it — below each root when there are several (1 = direct children). |
| `--type` | string | query `type` | Comma-separated Figma node types, e.g. TEXT,INSTANCE,FRAME. |
| `--change-type` | string | query `changeType` | Comma-separated: added, modified, deleted, requested (dirty nodes only; `requested`: built as designed but with open notes). |
| `--changed` | string | query `changed` | Comma-separated changed property names (fills, paddingLeft); a trailing `*` matches a prefix (padding*). |
| `--category` | string | query `category` | Comma-separated change categories: layout, color, typography, effects, component, content, structure, prototype, token, other, note, render. |
| `--component` | string | query `component` | Comma-separated main component ids: the components and all their instances. |
| `--instance` | true\|false | query `instance` | true: only component instances (`isInstance`); false: only other nodes. |
| `--name` | string | query `name` | Comma-separated case-insensitive name globs (`*`, `?`), e.g. Button*. |
| `--since` | string | query `since` | ISO 8601 time: only nodes changed at or after it. |
| `--claimed` | string | query `claimed` | Comma-separated: true (leased), false (free), mine (leased to `worker`). |
| `--worker` | string | query `worker` | Your worker id; needed with `claimed=mine`. |
| `--library` | include\|exclude\|only | query `library` | Library nodes (remote main components / sets and their layers): include, exclude, or only them. Default: include when the file tracks library components (`settings.trackLibraryComponents`), else exclude. |
| `--has-notes` | true\|false | query `hasNotes` | true: only nodes with open notes; false: only nodes without. |
| `--q` | string | query `q` | All the filters above in one string: space-separated `key:value` pairs, e.g. `state:dirty under:1:2 changed:fills` (several subtrees: `under:1:2,1:5`); quote values with spaces (name:"Primary Button"). A key may not also be passed as its own parameter. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--expand` | instances | query `expand` | `instances`: also include the subtree of every main component the scope's instances use (the scope is `under`, or the whole file) — transitively through instances inside those components, breadth-first, each component once. Use it for "everything this screen uses" / "which components do I build for this screen". Other filters apply after expansion; `depth` cannot be combined with it. |
| `--expand-depth` | integer | query `expandDepth` | With `expand=instances`: at most this many instance → main hops (default 10, max 20; 1 = only the components the scope uses directly). |

### rds-agent trends

`GET /v3/insights/trends`

How fast the backlog moves: nodes cleared and nodes newly dirtied by syncs in the last `windowDays` days (default 7) and the change in clears vs the window before, for the whole server (`total`) and each tracked file (`files`); `fileKey` narrows both to one file. Counts come from the event log, so `complete` is false when RDS_EVENT_RETENTION_DAYS (`retentionDays`) keeps less than two windows — `clearedPrevious` and `clearedChangePct` may then undercount. Returns no nodes.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--window-days` | integer | query `windowDays` | Default `7`. Window length in days, 1–14 (default 7). |
| `--file-key` | string | query `fileKey` | Only this tracked file (file_not_found otherwise). |

### rds-agent work

`GET /v3/files/{fileKey}/work`

The nodes the `list_nodes` filters match (default: dirty) bundled into work items — the best way to plan: fix a component once and its instances follow. Items are in document order (the design's layer order, by each item's key node), paged by `cursor`; each has its node ids (`claim_nodes` takes them), changed properties and categories. `group=component` (default): by the nearest COMPONENT / COMPONENT_SET ancestor-or-self; nodes with none form one item with `key: null`, listed last. Removed design (group=component and group=set): deleted nodes that were built are grouped under their removed root — the topmost deleted node — into one `kind: "removed"` item (after the component items, before `key: null`, in the roots' document order), unless that root sits inside a live component (then they are part of that component's item). For a removed item: remove the code that rendered the root; keep components in `uses` with `livePlacements > 0` (still used elsewhere), consider removing those with 0; heed `warnings`; then clear the root with `subtree: true` (`clear_nodes`) — one item clears the whole removed subtree. Deleted nodes that were never built are not work (they resolve at sync). Design tokens (group=component and group=set): the dirty tokens of each collection form one `kind: "tokens"` item (key = the collection node id, after the component and removed items, before `key: null`). For each token, update the code variable named by its `codeSyntax` (WEB, else the token name) for every changed `value:<Mode>`, then clear it. `include=usage` adds how many layers use each token. `group=set`: merge variants of each known component set into one item named like the Figma set, with its Figma key, set reference and variants [{ key, name, nodeCount }]. Use this to build a design system. Standalone components and variants whose set is unavailable keep their component item; the default grouping is unchanged. `group=frame`: by the ancestor one level below `under` (required); the `under` node itself is in the `key: null` item. `include=progress` adds { total, clean } for each returned item across all states, independent of state= and the nodeIds cap. Use clean / total for a progress bar. `expand=instances` answers "which components do I need to build for this screen, and how often does it use each?": with `under` = the screen, items also cover every main component its instances reach (transitively, each once; filters apply after expansion), and with `group=component` each item has `placementsInScope` beside the file-wide `placements`. Nodes of expanded components that are outside `under` fall in the `key: null` item with `group=frame`. Notes: a node someone noted as not matching the design is dirty with `changeType: requested` (category `note`) when its design is otherwise built, and grouped like any dirty node; `notes` counts an item's open notes. Read the notes (`get_node` or `list_notes`), fix the code to match the design as they describe, then clear the node — clearing resolves its notes. Each item's `changes` maps its listed node ids to their diffs (`changes=auto`: modified and deleted nodes; `diff`: added ones too; `names`: none — `changedProps` only). Values over 1 KB are `{ truncated: true, bytes }` and the page has `truncated: true`; `get_node` returns them whole.

| Flag | Type | Sent as | Description |
|------|------|---------|-------------|
| `--file-key` | string | path `fileKey` | **Required.** The Figma file key, e.g. `AbCdEf123456` from figma.com/design/<fileKey>/… — not a URL. Pass '-' to take it from `url` instead. |
| `--state` | string | query `state` | Comma-separated: dirty, clean, blocked, requested, all. Default dirty (changed since last built or with open notes, not blocked); `requested`: dirty only by open notes; `all` for every state. |
| `--under` | string | query `under` | Only this node's subtree, the node included (1:2 or 1-2). Several subtrees: up to 50 comma-separated ids (1:2,1:5) for their union, each node once, in the order given. Defaults to the `url` link's node-id. |
| `--depth` | integer | query `depth` | Needs `under`: at most this many levels below it — below each root when there are several (1 = direct children). |
| `--type` | string | query `type` | Comma-separated Figma node types, e.g. TEXT,INSTANCE,FRAME. |
| `--change-type` | string | query `changeType` | Comma-separated: added, modified, deleted, requested (dirty nodes only; `requested`: built as designed but with open notes). |
| `--changed` | string | query `changed` | Comma-separated changed property names (fills, paddingLeft); a trailing `*` matches a prefix (padding*). |
| `--category` | string | query `category` | Comma-separated change categories: layout, color, typography, effects, component, content, structure, prototype, token, other, note, render. |
| `--component` | string | query `component` | Comma-separated main component ids: the components and all their instances. |
| `--instance` | true\|false | query `instance` | true: only component instances (`isInstance`); false: only other nodes. |
| `--name` | string | query `name` | Comma-separated case-insensitive name globs (`*`, `?`), e.g. Button*. |
| `--since` | string | query `since` | ISO 8601 time: only nodes changed at or after it. |
| `--claimed` | string | query `claimed` | Comma-separated: true (leased), false (free), mine (leased to `worker`). |
| `--worker` | string | query `worker` | Your worker id; needed with `claimed=mine`. |
| `--library` | include\|exclude\|only | query `library` | Library nodes (remote main components / sets and their layers): include, exclude, or only them. Default: include when the file tracks library components (`settings.trackLibraryComponents`), else exclude. |
| `--has-notes` | true\|false | query `hasNotes` | true: only nodes with open notes; false: only nodes without. |
| `--q` | string | query `q` | All the filters above in one string: space-separated `key:value` pairs, e.g. `state:dirty under:1:2 changed:fills` (several subtrees: `under:1:2,1:5`); quote values with spaces (name:"Primary Button"). A key may not also be passed as its own parameter. |
| `--url` | string | query `url` | A Figma link (figma.com/design/<fileKey>/…?node-id=1-2). Supplies the path parameters given as '-'; on routes with `under`, its node-id is the default `under`. |
| `--expand` | instances | query `expand` | `instances`: also include the subtree of every main component the scope's instances use (the scope is `under`, or the whole file) — transitively through instances inside those components, breadth-first, each component once. Use it for "everything this screen uses" / "which components do I build for this screen". Other filters apply after expansion; `depth` cannot be combined with it. |
| `--expand-depth` | integer | query `expandDepth` | With `expand=instances`: at most this many instance → main hops (default 10, max 20; 1 = only the components the scope uses directly). |
| `--group` | component\|frame\|set | query `group` | component (default): by nearest component; set: merge all matching variants of a known component set (best for design systems); frame: by child frame of `under` (needs exactly one `under`). |
| `--changes` | auto\|diff\|names | query `changes` | auto (default): each item's `changes` has the diffs of its modified and deleted nodes; diff: of every listed node, added ones included (their full values); names: no `changes`, only `changedProps`. |
| `--limit` | integer | query `limit` | Items per page (default 100, max 1000). With format=outline: rendered lines per page (default: every line). |
| `--cursor` | string | query `cursor` | The previous page's `nextCursor`, unchanged, with all other parameters the same (else `invalid_cursor`). With format=outline: the previous response's `X-RDS-Next-Cursor` header (a line position in the rendered outline). |
| `--include` | string | query `include` | Comma-separated: progress, usage. progress: add total and clean node counts across all states for each work item; usage: add `usage: { nodeId: { layers } }` to token items. |

`--format`: also `ndjson`, `md`, `outline` (from the server); `--all`: follows `nextCursor`.

<!-- END GENERATED COMMANDS -->

## Tests

`npm test` in this folder: the generator against the annotated operations and
its drift check, request building, and every command end to end against a real
`buildApp` server (memory store) on an ephemeral port.

## License

[Apache-2.0](LICENSE), like the rest of the repository except `apps/api`
(FSL-1.1-ALv2).
