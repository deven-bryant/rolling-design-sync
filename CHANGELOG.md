# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com), and the project uses
[Semantic Versioning](https://semver.org). See `RELEASING.md` for how releases
are cut.

## [Unreleased]

## [0.13.0] - 2026-10-10

A redesigned portal, several scopes at once, weekly trends, and clearer plugin
feedback.

### Added
- **Light and dark themes** in the portal: the first visit follows the system
  setting; the sidebar toggle overrides it and is remembered. No flash of the
  wrong theme on load.
- **Several scopes at once:** `under` takes a comma-separated list of up to 50
  node ids (`under=1-2,5-1`) meaning the union of their subtrees, on node
  listings, outlines, summaries, work items and claim filters (MCP and CLI
  included). `group=frame` still needs one root; a summary over several roots
  omits `byFrame`. In the portal, the scope table on Nodes and Work Items is
  multi-select and the copied agent prompt covers every selected scope.
- **Weekly trends:** `GET /v3/insights/trends` (MCP `get_trends`, CLI `trends`)
  reports nodes cleared in the last N days (default 7) vs the N before, and
  nodes newly marked dirty, per file and in total. The portal's Files page shows
  *Cleared this week* and the net change in dirty nodes. `nodes.cleared` events
  now carry `count` and `sync.completed` events `counts.dirty`; trends count
  newly dirtied nodes from syncs made with this version on.
- **Plugin:** a progress bar (with totals while uploading and checking main
  components), the previous message cleared when an upload starts, and a green
  success message that stays until the next upload.
- **Portal:** a scope panel with search on Nodes and Work Items (replacing the
  Scopes tab), Files summary cards and an *Implemented* progress column, Work
  Items search, progress and *Expand instances*, and a node drawer with *Copy
  node prompt*. README and docs screenshots exist in both themes.

### Changed
- **Portal navigation:** the sidebar replaces the file tabs (Files, Nodes, Work
  Items, Activity, Claims, Connect). The Agents page is now **Claims** at
  `/claims`; `/agents` and the old file tab URLs redirect. The file pages no
  longer show breadcrumbs.
- **New palette** (teal brand) across the portal and the plugin; the plugin
  header shows the product name and its real version.
- **Agent prompts** copied from the portal lead with MCP, then the CLI, and walk
  the agent through claim, build, clear (with content hash and commit) and block.
- Security reports go to `security@rollingdesignsync.com` (or GitHub private
  vulnerability reporting).
- Stricter type checking (`strictNullChecks`) over the JavaScript; dependency
  updates (Vitest 5, GitHub Actions v7).

### Upgrade notes
- No migration.
- Re-open the Figma plugin after updating (its bundle changed). Node content
  hashes are unchanged.
- Links to the portal's `/agents` page and file tabs keep working through
  redirects.

## [0.12.0] - 2026-10-03

First public release (beta). Earlier entries are kept below for reference.

### Added
- **Rate limiting** on hosted deployments: per token (600/min), per client IP
  for unauthenticated requests (120/min), and a strict budget for sign-ins and
  rejected tokens (10/min); plugin syncs have their own budget. Over the limit:
  `429 rate_limited` with `Retry-After` and `RateLimit-*` headers. Configure
  with `RDS_RATE_LIMIT_TOKEN`, `RDS_RATE_LIMIT_IP`, `RDS_RATE_LIMIT_AUTH`
  (`0` disables) and `RDS_TRUST_PROXY`; off by default in local mode. The MCP
  server and CLI report the retry time.
- **Component sets:** component references and work items carry their
  component set; `group=set` groups variants under their set with counts,
  node ids, paging and progress.
- **Release pipeline:** tag-driven GitHub Releases, a multi-arch image on GHCR,
  and npm publishing of `@rolling-design-sync/core`, `@rolling-design-sync/mcp`
  and `@rolling-design-sync/agent-cli` through trusted publishing (no stored
  tokens) once the repository is public.
- **Type checking:** `npm run typecheck` (`tsc` over the JavaScript with a typed
  store contract and v3 types generated from the API schemas), run in CI.
- `docs/quickstart.md`, reproducible portal screenshots
  (`npm run screenshots` in `tests/e2e-portal`), `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, issue and PR templates, and Dependabot.

### Changed
- **Node drawer:** opens narrow (505 px) on Change History and widens for the
  Change List.
- **Plugin:** the network allow-list ships with a placeholder
  (`https://rds.example.com`); set `allowedDomains` to your API's origin before
  importing it for a non-local server.

### Removed
- **`FDS_*` environment variables** are no longer read. A set `FDS_*` variable
  logs a startup warning naming its `RDS_*` replacement.

### Fixed
- Dependency advisories in Fastify (HTTP/2 trailer DoS) and `fast-uri`.

### Upgrade notes
- No migration.
- Rename any remaining `FDS_*` variables to `RDS_*` before upgrading.
- Behind a reverse proxy or PaaS router, set `RDS_TRUST_PROXY` so per-IP limits
  see client addresses.
- Re-open the Figma plugin after updating (its bundle version changed). Plugin
  content hashes change for nodes whose component reference gains its set, so
  those nodes show as modified once after the next sync.

## [0.11.1] - 2026-10-02

Portal only — built from the revised Portal design through the product's own
queue (228 nodes cleared).

### Changed
- **Node detail drawer:** a wide drawer with the new Node Details layout —
  **Change List** (the node's changes as a table) and **Change History** (its
  events, newest first) — keeping claim, block / unblock and release with the
  same role rules.
- **Page layout:** every page uses the new `MainLayout` with the revised
  spacing and fills the viewport width.
- **Components:** Table Avatar and Action-icons cells and an empty header cell,
  icon-only tertiary Button, xs Button utility, md Avatar, 44 px gray tabs, the
  Button group's 40 px height, and a new `SectionHeader`.

### Upgrade notes
- No migration and no API change.

## [0.11.0] - 2026-10-01

### Added
- **Portal at `/ui`.** A browser UI served by the API itself (TypeScript,
  React, React Aria Components, Tailwind on design tokens): Files, Node tree
  with a lazy document-order tree, filters in the URL and a node drawer
  (built → now diff, claim, history, block / unblock / release), Work items
  with progress, Activity & agents with a live feed and lease timers, and
  Connect (server status, per-host agent setup, token list). Live updates come
  from the event stream; agent "sprites" animate claims and clears. Spec:
  `docs/ui-portal.md`; component layer built through the product's own queue.
- **Browser sessions.** `POST/GET/DELETE /v3/session` mint a signed,
  `HttpOnly`, `SameSite=Strict` cookie from a viewer or agent token
  (`RDS_SESSION_SECRET`; generated automatically in local mode). Every v3 route
  accepts the cookie; cookie writes need `X-RDS-Client` and a same-origin
  `Origin` (`403 csrf_rejected`). Session writes are attributed to
  `portal:<label>`.
- **Named tokens:** `RDS_*_TOKENS` entries may be `name:token`; names appear in
  events, claims and the portal. Unnamed entries keep their hash label.
- **Portal API:** `GET /v3/status`, `GET /v3/tokens` (labels and last use only),
  `GET /v3/files/{fileKey}/claims` and `GET /v3/claims` (MCP `list_claims`, CLI
  `claims ls`) with node names, `GET /v3/events` across files (JSON and SSE),
  `nodeId=` / `since=` / `order=desc` on event pages, `include=progress` on work
  items, and an optional `worker` on `clear`.
- Browser end-to-end tests (Playwright) against Postgres and the local-mode
  container.

### Fixed
- Renewing a claim returns its nodes in node-id order (Postgres returned them
  in arbitrary order).

### Upgrade notes
- No migration.
- **Set `RDS_SESSION_SECRET`** (32+ random bytes, e.g. `openssl rand -hex 32`)
  on hosted deployments to enable portal sign-in; without it the API works as
  before and `/v3/session` answers `503 sessions_disabled`.
- Optionally name your tokens (`RDS_AGENT_TOKENS=devin:<token>,...`); one token
  per platform is enough — sessions identify themselves with `worker`.
- The Docker image now builds and serves the portal; `/` redirects to `/ui/`.
- Re-open the Figma plugin after updating (its bundle version changed).

## [0.10.1] - 2026-10-01

### Fixed
- **Event bus no longer hammers the database on bad listener credentials.**
  `LISTEN` retries back off from 5 s to a 5-minute cap, and wait the full cap
  after an authentication failure (`28P01`, or Supavisor's `ECIRCUITBREAKER`),
  so a wrong `RDS_LISTEN_URL` can't trip the pooler's circuit breaker and lock
  out the API's own connections.
- **Plugin uploads no longer fail on unresolvable token names.** A style or
  variable definition Figma won't return (for example, an unpublished style
  used inside a library component) is now a non-blocking `[token]` warning;
  the node's own values are still captured, only the token name is missing.

### Upgrade notes
- No migration. Re-open the plugin after pulling (its bundle changed).
- `RDS_LISTEN_URL` must point at the **same** database as `DATABASE_URL`: on
  Supabase, that project's **session pooler** (port 5432, user
  `postgres.<project-ref>`).

## [0.10.0] - 2026-09-30

**Agent ergonomics:** one call to see everything a screen uses, small default
responses, document order, and the `RDS_*` / `rds-*` rename.

### Breaking
- **Commands renamed, no aliases:** the CLI is `rds-agent`
  (`scripts/rds-agent.js`) and the MCP server `rds-mcp`
  (`apps/mcp/bin/rds-mcp.js`). Update MCP client configs that point at
  `fds-mcp.js`.
- **Default listing shape:** for `added` nodes, `changes` is omitted by default
  (`changes=auto`); property names are in the new `changedProps`. Ask for
  values with `changes=diff`, `view=full`, or `get_node`. Change values over
  1 KB are truncated in compact responses (`{ truncated, bytes }`).
- **Default order is document order** (`sort=document`): siblings follow the
  design instead of node-ID order. `sort=path` still gives node-ID order.
- **`format=outline` pages by rendered lines** (`limit` counts lines; the next
  cursor is in `X-RDS-Next-Cursor`).

### Added
- **`expand=instances`** (with `expandDepth`) on the listing, `summary`, and
  `work`: follows instances into their main components, transitively and once
  each, with `via` on expanded nodes; `work?group=component&expand=instances`
  adds `placementsInScope`.
- **`format=outline`**: an indented text tree with component links, nesting
  under the first instance, `(shown above)` for repeats, and `(absolute)`
  markers.
- **Component links on every node:** `isInstance`, `mainComponentId`, and the
  `instance=` filter.
- **MCP defaults:** 25 results per page, a "call again with cursor" line, a
  result-size guard (`RDS_MCP_MAX_RESULT_CHARS`), and text formats passed
  through.
- **`docs/agents.md`:** setting up Claude Code, Cursor, and Devin, sharing the
  environment between the MCP server and the CLI, and recipes.
- **Startup maintenance:** fills in missing change data (`changedProps` /
  categories) for nodes synced before v0.8.0, and document order for existing
  nodes.

### Changed
- **Environment variables are `RDS_*`.** The `FDS_*` names still work until
  1.0, with a deprecation warning at startup.
- Document order: auto-layout frames in flow order (absolutely positioned
  children after), free-form frames, groups, and sections in reading order
  (top to bottom, then left to right). Re-ranked on every sync.

### Fixed
- `summary.byCategory` was all zeros and `changedProps` empty for nodes synced
  before v0.8.0.
- Outlines, listings, work items, and `summary.byFrame` returned siblings in
  node-ID order.

### Upgrade notes
- **Postgres deployments:** apply
  `supabase/migrations/20260930120000_api_v3_document_order.sql` before starting
  this version (additive: one column, two indexes, and the `node` `updated_at`
  trigger now ignores order-only updates). On first start the API fills in
  change data and document order for existing nodes and logs a count for each.
  Local mode and Docker do all of this automatically.
- **Rename** `FDS_*` variables to `RDS_*` (Railway, CI, agent hosts, secrets)
  when convenient, and point MCP configs at `apps/mcp/bin/rds-mcp.js`.

## [0.9.0] - 2026-09-30

**v3 is now the only API.** Live events, planning endpoints, blocking, a
read-only token, and MCP tools and CLI commands generated from the OpenAPI
document.

### Breaking
- **The v1 and v2 routes are removed.** Requests to them get a
  `404 route_not_found` problem whose hint names the v3 route to use. The
  database tables are kept.
- **The Figma plugin now talks to v3 only** (`/v3/files/{fileKey}/hashes`,
  `/sync`, `/exists`) and needs a v0.9.0 API. Re-import it after upgrading.
- **MCP tools are renamed** and now come from the API's `/v3/openapi.json` at
  startup: `list_nodes`, `get_node`, `summarize`, `list_work_items`,
  `clear_nodes`, `claim_nodes`, `renew_claim`, `release_claim`, `block_node`,
  `unblock_node`, `list_events`, `list_files`, `get_file`, `list_scopes`,
  `resolve_url`. `get_design_delta` and `clear_node` are gone.
- **CLI commands** are generated from the same document (`nodes ls`,
  `nodes show`, `summary`, `work`, `clear`, `claim`, `renew`, `release`,
  `block`, `unblock`, `events`, `files ls`, `scopes ls`, `resolve`, …).
  `get-delta` and `clear --node` are gone.

### Added
- **Live events:** `GET /v3/files/{fileKey}/events` streams `sync.completed`,
  `nodes.cleared`, `claim.*`, and `node.blocked` / `node.unblocked` as
  server-sent events, replaying what a reconnecting client missed
  (`Last-Event-ID`, 24 h by default). Without `Accept: text/event-stream` it
  returns a JSON page. Events are written in the same transaction as the change.
  Multi-instance deployments share them through Postgres `LISTEN/NOTIFY`, set
  `FDS_LISTEN_URL` to a direct (non-pooler) connection for real-time delivery,
  or fall back to polling automatically.
- **Planning:** `GET /v3/files/{fileKey}/summary` (counts by state, change
  type, category, type, and frame) and `GET /v3/files/{fileKey}/work`
  (`group=component|frame`, with placement counts per component).
- **Blocking:** `POST /v3/files/{fileKey}/nodes/{nodeId}/block` and `/unblock`;
  a design change unblocks a node automatically.
- **Formats:** `format=ndjson|md` on the listing, work items, and events, streamed.
- **Viewer tokens** (`FDS_VIEWER_TOKENS`, generated in local mode): read-only
  access to every v3 `GET`.
- **`FDS_UI_ORIGINS`:** loopback origins a local UI may use in local mode.
- **Client versions:** the plugin, MCP server, and CLI send `X-RDS-Client`;
  every v3 response carries `X-RDS-Server`.
- **`docs/compatibility.md`:** the compatibility policy that applies from 1.0.

### Changed
- OpenAPI descriptions are written for agents to read as tool docs.
- CI now runs the CLI's tests and fails if its generated command file is stale.

### Upgrade notes
- **Postgres deployments:** apply
  `supabase/migrations/20260930000000_api_v3_events.sql` before starting this
  version (additive: one new table). Local mode and Docker apply it
  automatically.
- **Plugin:** re-import it from this release; older plugins can't sync against
  this API.
- **Agents and scripts:** move from `get-delta` / `clear --node` and v2 URLs to
  the v3 commands above (`fds-agent --help`), and restart MCP clients so they
  pick up the new tool names.

## [0.8.0] - 2026-09-29

**API v3**: agents see *what* changed on each node since it was built, and can
query, claim, and clear nodes in bulk.

### Added
- **Property-level changes.** Every dirty node now carries `changes` — each
  changed property with its `built` and `now` value, a category (`layout`,
  `color`, `typography`, …), and design-token names where the property is bound
  to a variable or style. The API stores a node's attributes when it's cleared,
  so later edits are diffed against what was actually built.
- **`/v3` API** (see `GET /v3/openapi.json` and `docs/api-v3-design.md`):
  - `GET /v3/files`, `/v3/files/{fileKey}`, `/v3/files/{fileKey}/scopes` —
    tracked files and synced scopes with counts.
  - `GET /v3/files/{fileKey}/nodes` — filter by state, subtree and depth, type,
    change type, changed property (`padding*`), category, component, name,
    `since`, and claim; `q=` filter strings; `fields`/`view`; cursor paging with
    `total`; `include=counts` for tree views.
  - `GET /v3/files/{fileKey}/nodes/{nodeId}` — one node in full.
  - `POST /v3/files/{fileKey}/clear` — bulk, hash-guarded clear with per-item
    results.
  - `POST /v3/files/{fileKey}/claims` (+ renew, release) — leases by filter or
    IDs, shared with v2 leases.
  - `GET /v3/resolve?url=` — and `?url=` on any file route — so Figma links and
    `1-2` node IDs work directly.
  - Errors are RFC 9457 problems with a `code` and a `hint`
    (`docs/errors.md`).
- **MCP tools on v3:** `list_nodes`, `get_node`, `clear_nodes`, `claim_nodes`,
  `release_claim`, `resolve_url`.
- **CLI commands on v3:** `nodes ls`, `nodes show`, bulk `clear`, `claim` /
  `renew` / `release`, `resolve`, `--url` everywhere, `--format table`.
- The plugin sends the file name and synced scope with each upload, so the API
  can list files and scopes.

### Changed
- The MCP tools `get_design_delta` / `clear_node` and the CLI's `get-delta` /
  `clear --node` now run on v3 with unchanged output; they are deprecated.
- v1 and v2 routes are unchanged.

### Upgrade notes
- **Postgres deployments must apply the new migration** before running this
  version: `supabase/migrations/20260929180000_api_v3_change_model.sql` (the
  same loop as in `docs/setup.md`). It only adds columns, tables, and indexes,
  and backfills existing rows, so it's safe to apply while the previous version
  is still running. Local mode and the Docker setup apply it automatically.

## [0.7.0] - 2026-09-28

Self-hosting no longer needs a database server, and agents get an MCP server.

### Added
- **Run with Docker.** `docker compose up -d` starts the API in local mode in a
  hardened container: Node 22 image pinned by digest, non-root user, read-only
  root filesystem, all capabilities dropped, port published on `127.0.0.1`
  only, data in the `rds-data` volume. This is now the recommended way to run it
  on your own machine.
- **Local mode (`FDS_STORE=local`).** An embedded Postgres (PGlite) that keeps
  its data in `FDS_DATA_DIR`, using the same migrations and queries as a real
  Postgres. On first start it generates strong plugin and agent tokens and
  stores them in `tokens.json`.
- **Local MCP server** (`apps/mcp`) with `get_design_delta` and `clear_node`, so
  MCP-capable agents (Claude Code, Cursor, Windsurf, Devin) can use the queue
  directly.
- **"Code already matches this design"** option in the plugin: a first sync can
  mark never-seen nodes as implemented instead of dirty (`markImplemented` on
  `POST /v2/nodes/batch`).

### Security
- Local and memory modes serve **this machine only**: they listen on
  `127.0.0.1` by default, accept only requests addressed to `localhost`,
  `127.0.0.1`, or `[::1]` (blocking DNS rebinding), reject requests from web
  pages, and refuse short tokens on a non-loopback address. Team and production
  deployments (`DATABASE_URL`) are unchanged.

### Changed
- CI and the container run on Node 22 (Node 20 is end-of-life). The minimum
  supported version is still Node 20.
- The README is reorganized around the Docker setup; plain-Node local mode and
  the full Postgres walkthrough are in `docs/setup.md`.
- Plugin setup documents the required Figma-assigned plugin ID, and that the
  API URL must use `localhost` rather than `127.0.0.1`.

### For maintainers
- The repository now has a root `Dockerfile`. Platforms such as Railway build
  from it automatically; the image sets no store configuration, so a
  `DATABASE_URL` deployment behaves exactly as before. Check the first deploy
  after upgrading.

## [0.6.0] - 2026-09-28

The project is now **Rolling Design Sync**.

### Changed
- Renamed the project from figma-design-sync to Rolling Design Sync, in line
  with Figma's brand guidelines (no "Figma" in product names). The repository
  moved to `deven-bryant/rolling-design-sync`; old GitHub URLs redirect.
- Packages renamed to the `@rolling-design-sync/*` scope (`api`, `core`,
  `plugin`, `agent-cli`). Update any `npm start -w` or `require()` references
  that used `@figma-design-sync/*`.
- The Figma plugin's display name is now **Rolling Design Sync**.
- Unchanged, so existing deployments keep working: the `FDS_*` environment
  variables, the `fds-agent` CLI name, the API routes, and the database schema.

### Added
- A notice that Rolling Design Sync is not affiliated with Figma.

## [0.5.0] - 2026-09-28

First tagged release.

### Added
- Per-node change tracking (v2): the plugin uploads only nodes whose content
  hash changed; agents pull dirty nodes per subtree and clear them with a
  hash-guarded compare-and-clear (`409 stale_content_hash`).
- Instance placements and on-demand main-component resolution, with
  capture-version stamps so previously captured mains re-scan once.
- Agent CLI (`scripts/fds-agent.js`) for the delta and clear operations.
- Project README, contributing guide, and release process.

### Changed
- All packages (root, API, plugin, core, CLI) now share one version, starting
  at 0.5.0; the plugin continues from its previous 0.4.0.

### Licensing
- Repository licensed under Apache-2.0; `apps/api` under FSL-1.1-ALv2.
