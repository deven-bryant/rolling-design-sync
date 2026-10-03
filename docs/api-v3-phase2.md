# API v3 — phase 2 design

Status: **draft for review.** Builds on `docs/api-v3-design.md` (phase 1, shipped
in v0.8.0), whose principles, addressing rules, errors, and code layout still
apply.

Phase 2 makes v3 the *only* API: it adds live events, planning endpoints,
blocking, a read-only token, and client versioning; moves the plugin to v3;
generates the MCP tools and CLI commands from the OpenAPI document; and removes
v1, v2, and the pre-v3 MCP tools and CLI forms. Nothing is public yet, so
removals need no deprecation period (see "Compatibility" for the policy that
applies once it is).

## Deployment modes

This repository is the single-tenant, self-hostable product. Every phase-2
feature must work in both modes; mode-specific constraints are called out where
they matter.

| Mode | Shape | Implications for the API |
|---|---|---|
| **Local** | Docker on one machine: API (local mode, PGlite) and, later, a UI; local agents use the Figma MCP and our MCP server. | One process; in-memory event bus. Loopback-only, so the UI's own origin must be explicitly allowed (see "Viewer token and UI origins"). Remote cloud agents can't reach it. |
| **Self-hosted** | API on a VM/PaaS with Postgres (e.g. Railway + Supabase); a team and remote agent sessions share it. | Possibly several API instances (replicas, or old and new during a deploy); Postgres `LISTEN/NOTIFY` needs a session-capable connection (Supabase's transaction pooler can't `LISTEN`); proxies cut idle connections; shared tokens today (per-agent tokens are a planned addition). |

## 1. Events (server-sent events with replay)

### Model

A new `event` table is the single source of events and the activity log:

| Column | Meaning |
|---|---|
| `id bigserial primary key` | Monotonic; used as the SSE `id` and for replay. |
| `file_key text not null` | Events are per file. |
| `type text not null` | See below. |
| `actor text` | `plugin`, or the worker / token label that caused it. |
| `data jsonb not null default '{}'` | Small payload: IDs, counts, labels, commit refs — **never node attributes or other design content**. |
| `created_at timestamptz not null default now()` | |

Index on `(file_key, id)`.

**Coarse types** (bulk operations produce one event, not one per node):

| Type | `data` |
|---|---|
| `sync.completed` | `rootNodeId`, `counts` (as `sync_event`) |
| `nodes.cleared` | `nodeIds` (≤ 500), `commitRef`, `worker` |
| `claim.created` / `claim.renewed` / `claim.released` | `claimId`, `worker`, `label`, `expiresAt`, `nodeIds` (≤ 500) |
| `node.blocked` / `node.unblocked` | `nodeId`, `reason`, `by`, `auto` (true when a design change unblocked it) |

There is no expiry event: clients use each claim's `expiresAt`.

**Transactional outbox.** An event row is inserted **in the same transaction**
as the change it describes, so there are no lost or phantom events. After
commit, the service publishes `{ fileKey, id }` on the event bus.

### Event bus

An interface with two implementations, chosen at startup:

- **In-memory** — `RDS_STORE=local|memory` (single process).
- **Postgres** — `DATABASE_URL` mode: `NOTIFY rds_events, '{"fileKey":…,"id":…}'`
  after commit; each API instance `LISTEN`s on one dedicated connection.
  `RDS_LISTEN_URL` (optional) supplies a session-capable connection string for
  listening; if `LISTEN` is unavailable, the instance **falls back to polling**
  the `event` table every 2 s. Notifications carry only IDs; subscribers read the
  rows (so the 8 KB `NOTIFY` limit never matters).

The interface is small (`publish(fileKey, id)`, `subscribe(fileKey, fn)`) so a
deployment can swap in another broker (e.g. Redis or NATS).

### Routes

- `GET /v3/files/{fileKey}/events` with `Accept: text/event-stream` — the
  stream. Replays events after `Last-Event-ID` (header) or `?after=<id>`, then
  streams live. `?types=` filters by type. A comment heartbeat every 20 s keeps
  proxies from closing the connection. If the requested ID is older than the
  replay window, the server sends one `event: reset` so the client re-fetches
  state, then continues live.
- The same route **without** `Accept: text/event-stream` returns a JSON page:
  `{ events, nextAfter }` with `?after=`, `?limit=` (default 100, max 1000),
  `?types=`. Agents without SSE support and the activity log use this.
- Auth: agent or viewer token in `Authorization`. (Browser `EventSource` can't
  send headers; the UI phase adds short-lived stream tickets — out of scope
  here.)

### Retention

- Replay window: `RDS_EVENT_REPLAY_HOURS` (default 24).
- Events older than `RDS_EVENT_RETENTION_DAYS` (default 30) are deleted on
  startup and hourly.

## 2. Summaries and work items

- `GET /v3/files/{fileKey}/summary` — takes the listing filters (default
  `state=dirty`) and returns `{ total, byState, byChangeType, byCategory,
  byType, byFrame }`. `byFrame` groups by the ancestor one level below `under`
  (`[{ nodeId, name, count }]`) and is present only when `under` is given.
- `GET /v3/files/{fileKey}/work?group=component|frame` — dirty nodes bundled
  into work items, with the listing filters and cursor paging:
  - `group=component`: key = the node's nearest ancestor-or-self of type
    `COMPONENT` or `COMPONENT_SET`; nodes with none form one item with
    `key: null`. Each item carries `placements` (instance rows whose
    `mainComponentId` is that key) so agents see how many screens a fix reaches.
  - `group=frame`: key = the ancestor one level below `under`; **`under` is
    required** (400 problem with a hint otherwise).
  - Item: `{ key, name, type, nodeCount, categories, changedProps, placements?,
    nodeIds (≤ 50), more }`.

## 3. Blocking

- `POST /v3/files/{fileKey}/nodes/{nodeId}/block` `{ reason, worker? }`
  (`reason` 1–500 chars) sets `blocked_*`, releases the node's lease, and emits
  `node.blocked`. `POST …/unblock` clears it and emits `node.unblocked`.
- The phase-1 auto-unblock on a content change now also emits `node.unblocked`
  with `auto: true`.
- Blocked nodes are excluded from `state=dirty` (as in phase 1) and appear with
  `state=blocked`.

## 4. Response formats

Listing, work items, and the events JSON page accept `format`:

- `json` (default).
- `ndjson` — one JSON object per line (nodes, items, or events), streamed.
- `md` — a markdown checklist for agents: one line per node,
  `- [ ] **Name** (TYPE) — paddingLeft 16 → 24; fills color/brand/500 → color/brand/600 · [Figma](url)`.

## 5. Viewer token and UI origins

- **Third token class**, `RDS_VIEWER_TOKENS`: read-only. Allowed: every v3 `GET`
  (files, scopes, nodes, node, summary, work, events, resolve). Everything else
  → `403` `wrong_token_class`. Local mode also generates a `viewer` token into
  `tokens.json`.
- **UI origins in embedded modes:** `RDS_UI_ORIGINS` (comma-separated) lists
  origins allowed through the embedded-mode `Origin` check, in addition to no
  `Origin` and `null`. Each entry must be a loopback origin
  (`http://localhost:<port>`, `http://127.0.0.1:<port>`); anything else is a
  startup error.

## 6. Client versions

- The plugin, MCP server, and CLI send `X-RDS-Client: <name>/<version>`
  (`plugin`, `mcp`, `cli`).
- Every v3 response carries `X-RDS-Server: <version>`.
- The server logs the client header, and each `sync.completed` / write event
  stores it in `data.client` — the raw material for knowing which old clients
  are still in use.
- Enforcement (minimum versions, upgrade hints) is defined by
  `docs/compatibility.md` and is not built in this phase.

## 7. The plugin on v3

Plugin-token routes with the same semantics as their v2 counterparts, v3
addressing and problem errors:

| v3 | Replaces |
|---|---|
| `GET /v3/files/{fileKey}/hashes?under=` | `GET /v2/scopes/:nodeId/hashes` |
| `POST /v3/files/{fileKey}/sync` | `POST /v2/nodes/batch` (same body, including `markImplemented`, `fileName`, `rootNodeId`) |
| `POST /v3/files/{fileKey}/exists` | `POST /v2/nodes/exists` |

The plugin switches to them and sends `X-RDS-Client`.

## 8. Generated MCP tools and CLI commands

- **Annotations.** Each v3 operation meant for agents carries
  `x-rds-mcp: { tool: "<name>" }` and `x-rds-cli: { command: "<words>" }` in its
  schema. Plugin routes and `openapi.json` carry neither, so they are never
  exposed to agents. Operation `summary`/`description` texts are written for
  models: what it does, when to use it, what to do on the common errors.
- **MCP server: runtime.** At startup it fetches `/v3/openapi.json` from
  `RDS_API_BASE_URL` and registers one tool per `x-rds-mcp` operation, using the
  operation's JSON Schemas directly (MCP tool schemas are JSON Schema). A server
  older or newer than the MCP package just yields a different tool set. Figma
  `url` inputs keep working. The server instructions keep teaching the loop.
- **CLI: build time.** A script generates `scripts/commands.generated.json` from
  the OpenAPI document (via `buildApp`, no network); the CLI interprets it and
  stays dependency-free. CI regenerates it and fails on a diff. Output and error
  formatting stay hand-written.

## 9. Removals

All in this phase (nothing is public, so no deprecation period):

- MCP tools `get_design_delta`, `clear_node`; CLI forms `get-delta`,
  `clear --node`.
- v1 routes and their code (`service.js`, `reconcile.js`, v1 tests, `tests/e2e.test.js`).
  `HttpError` moves out of `service.js` first (`nodeService.js` imports it).
- v2 routes (after the plugin is on v3) and `tests/e2e-nodes.test.js`, whose
  coverage the v3 e2e suite must already include.
- **Tables stay.** Dropping the v1 tables (and any unused v2 columns) is a
  separate migration that deletes data, requires a backup, and must be confirmed
  by the maintainer before it runs anywhere.

## 10. Compatibility

`docs/compatibility.md` states the policy that takes effect at 1.0 (public
launch):

- Within an API version, changes are additive only; removals, renames, and
  meaning changes need a new version.
- Deprecation: `deprecated: true` in OpenAPI, `Deprecation` and `Sunset`
  headers, changelog; kept at least two minor releases or 90 days (whichever is
  longer); removed only in the next API version.
- Clients identify themselves (`X-RDS-Client`); the server may answer outdated
  clients with an upgrade hint.
- Database changes use expand → migrate → contract across releases.
- CI proves upgrades from the previous release's schema.
- SemVer: 1.0 at launch; breaking changes are majors afterwards.

## Extension points

Generic seams that other deployments can build on without forking:

- **Event bus** — the `publish` / `subscribe` interface; the in-memory and
  Postgres implementations are the only ones in this repo.
- **Event log** — an append-only, ordered table other consumers (for example,
  outgoing webhooks) can read from after the stream's own delivery.
- **Hosting** — the event stream holds long-lived connections, so the API needs
  a long-running process (a container or VM), not serverless functions.
