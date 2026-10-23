# rolling-design-sync — setup

The full self-hosting walkthrough behind the root README's
[Self-hosting](../README.md#self-hosting) section. You need the Figma desktop
app, plus one of:

- **Docker** (or Node 22.23.4+ and nothing else) — a single user on one machine can
  run the API with an embedded Postgres
  ([Run with Docker](#run-with-docker-recommended-for-local-use),
  [Single user, no database server](#single-user-no-database-server)).
- **Postgres with the `ltree` extension** — for a team or production
  (sections 1–5 below). Supabase works out of the box.

Nothing here is destructive; you can tear the database down and recreate it
freely while prototyping.

## Run with Docker (recommended for local use)

The repo-root `compose.yaml` runs the API in local mode (`RDS_STORE=local`) in
a hardened container built from the root `Dockerfile`:

```bash
docker compose up -d
docker compose logs api     # the generated plugin, agent and viewer tokens (first start)
```

- **URL.** `http://localhost:8787` — the plugin's API base URL and the agents'
  `RDS_API_BASE_URL`. The port is published on the host's loopback
  (`127.0.0.1:8787`) only.
- **Data.** The embedded database and `tokens.json` live in the `rds-data`
  named volume (mounted at `/data`), so they survive `docker compose restart`,
  `down`/`up`, and rebuilds; `docker compose down -v` deletes them. Read a token
  back with `docker compose exec api node -p "require('/data/tokens.json').plugin"`
  (`.agent` for the agent token, `.viewer` for the portal's read-only token). The container's tokens are separate from any
  `tokens.json` a plain-Node local run created on the host — a token from one is
  rejected (`401`) by the other.
- **Hardening.** Read-only root filesystem (only `/data` and a `/tmp` tmpfs are
  writable), all Linux capabilities dropped, `no-new-privileges`, and the
  process runs as the image's non-root `node` user.
- **Image.** Node 22 pinned by digest, production dependencies of the API only,
  and `supabase/migrations/` so local mode migrates itself on start. The image
  sets no `RDS_STORE`, `HOST`, or `RDS_DATA_DIR`; `compose.yaml` supplies them.
  Run without any of them, it behaves like `npm start` and needs
  `DATABASE_URL` (see [3. Host the API](#3-host-the-api-appsapi)).

Inside the container the API binds `0.0.0.0` so Docker can forward the port;
the `Host` check below still limits it to requests addressed to a loopback
host.

## Single user, no database server

`RDS_STORE=local` runs the API against an embedded, in-process Postgres
(PGlite) persisted to a directory. It uses the same migrations and the same
queries as a real Postgres. There is nothing else to provision: point
`RDS_DATA_DIR` at a directory to keep and start the API from the repo root:

```bash
npm install
RDS_STORE=local RDS_DATA_DIR=$HOME/.rolling-design-sync npm start -w @rolling-design-sync/api
```

- **Data directory.** `RDS_DATA_DIR` defaults to `./data`, resolved against the
  working directory (`apps/api/data` under `npm start -w`). It is created with
  mode `0700` if it doesn't exist; the database lives in its `pgdata/`
  subdirectory.
- **Migrations apply automatically.** On every start the API applies each file
  in `supabase/migrations/` that it hasn't applied yet, in filename order, each
  in its own transaction, and records it in a `schema_migrations` table.
- **Tokens are generated for you.** For each token class not set in the
  environment (`RDS_PLUGIN_TOKENS`, `RDS_AGENT_TOKENS`, `RDS_VIEWER_TOKENS`), the
  API reads it from `<RDS_DATA_DIR>/tokens.json`
  (`{ "plugin": "…", "agent": "…", "viewer": "…" }`), generating
  a random 64-character token on first start. Newly generated tokens are printed
  once and written to the file with mode `0600`; later starts reuse them.
  Tokens set in the environment take precedence over the file. Read them back
  with:
  ```bash
  node -p "require('$HOME/.rolling-design-sync/tokens.json').plugin"
  node -p "require('$HOME/.rolling-design-sync/tokens.json').agent"
  node -p "require('$HOME/.rolling-design-sync/tokens.json').viewer"
  ```
- **One API process only.** The embedded database is a single connection owned
  by one process; never point two API processes at the same data directory.
  Use Postgres for anything shared or production.

`RDS_STORE=memory` is the throwaway variant: nothing is persisted, no token file
is written, and you must supply `RDS_PLUGIN_TOKENS` / `RDS_AGENT_TOKENS`
yourself (see [2. API tokens](#2-api-tokens)).

### Safe defaults in the embedded modes

Both `RDS_STORE=local` and `RDS_STORE=memory` are meant for one person's
machine, so the API locks itself down (`apps/api/src/config.js`, `app.js`):

- **Loopback bind.** It listens on `127.0.0.1` unless `HOST` is set.
- **Strong tokens off loopback.** If `HOST` is a non-loopback address, the API
  refuses to start while any configured token is shorter than 32 characters.
  On loopback it starts but prints a warning.
- **Loopback `Host` only, always.** Whatever `HOST` is, a request whose
  `Host` header doesn't name a loopback host — `localhost`, `127.0.0.1`, or
  `[::1]`, on any port or none (case-insensitive) — gets `403 forbidden_host`
  before auth. This blocks DNS rebinding (the attacker's hostname ends up in
  `Host`) while port mappings such as Docker's `127.0.0.1:<any>:8787` keep
  working.
- **No web `Origin`.** A request carrying any `Origin` header other than `null`
  gets `403 forbidden_origin`, whatever `HOST` is. The Figma plugin
  (sandboxed, `Origin: null`) and non-browser callers (the CLI, the MCP server,
  `curl`) send no web origin and are unaffected. To use a local browser UI
  (a dev server on this machine), list its origin in `RDS_UI_ORIGINS`, e.g.
  `RDS_UI_ORIGINS=http://localhost:5173`; only `http://localhost:<port>` and
  `http://127.0.0.1:<port>` are accepted, and any other entry stops the API at
  startup. Pair it with a viewer token (`RDS_VIEWER_TOKENS`) for a read-only UI.

So the embedded modes are strictly **this machine only**: another device on
your LAN can't use them even if `HOST` is `0.0.0.0`. For LAN or team access,
run Postgres mode (`DATABASE_URL`).

None of these apply with `DATABASE_URL` (Postgres mode): there the API listens
on `0.0.0.0` by default, accepts any `Host`, and your bearer tokens are the
boundary.

## 1. Postgres (Supabase)

Any Postgres with the **`ltree`** and **`pgcrypto`** extensions available works
(the migrations run `create extension if not exists` for both, so the
connecting role must be allowed to create them). Supabase ships both; on a
self-managed server they come with the standard contrib package (included in
the official `postgres` Docker image).

With Supabase:

1. Create a Supabase project at https://supabase.com (any region close to you).
2. From **Project Settings → Database → Connection string**, copy the
   **direct** string (port `5432`) if you host the API on an always-on platform
   (Railway/Render/Fly), or the **pooler / Transaction** string (port `6543`) if
   you host serverless (Vercel/Edge). This becomes `DATABASE_URL`.

The API connects only through `DATABASE_URL`; it does not use the supabase-js
client, so it needs no Supabase project URL or service-role key. It connects
with TLS (without verifying the server certificate) unless `PGSSLMODE=disable`
— set that for a local Postgres without TLS.

### Apply the migrations

Apply every file in `supabase/migrations/` in filename order (the same loop as
the root README):

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

Or paste each file, in order, into the Supabase SQL editor.

**The startup check.** On every start in Postgres mode, before it listens, the
API runs one read-only probe per file in `supabase/migrations/` — a query that
is true when that migration's effect (its table, column or constraint) is in the
database. If every probe passes it starts. If any fails it **refuses to start**
and exits non-zero, listing the missing files in order with the `psql` loop for
just those files:

```text
Database schema is missing 2 migration(s); refusing to start. Apply, in this order:
  20261013000000_api_v3_library_components.sql
  20261014000000_api_v3_node_notes.sql
From the repository root:
  for f in supabase/migrations/20261013000000_api_v3_library_components.sql supabase/migrations/20261014000000_api_v3_node_notes.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
Or set RDS_AUTO_MIGRATE=true to apply them at startup. See docs/setup.md, "Apply the migrations".
```

**`RDS_AUTO_MIGRATE=true`** (default `false`) makes the API apply them itself:
it takes a Postgres advisory lock (so of several instances starting at once,
one applies and the others wait, then find nothing to do), re-runs the probes,
applies only the failing files in filename order, each in its own transaction,
logging `Applying migration <file>` for each, re-probes, releases the lock and
starts — or exits if a probe still fails. A database whose probes all pass is
left untouched: no statement other than the probes runs. A fresh, empty
database is bootstrapped by applying every file. The lock is held on one
session, so run with a **direct** connection (port 5432) in `DATABASE_URL`, not
a transaction pooler. The connecting role needs the rights the migrations need
(creating tables, indexes and the two extensions).

**Upgrading** the API to a release with new migration files means either
applying just those files, in order, before starting it (the refusal message
lists them), or starting it once with `RDS_AUTO_MIGRATE=true`. Back up the
database first either way.

**`RDS_SCHEMA_CHECK=off`** skips the check entirely, with a warning at every
start, for operators who manage the schema another way. Not recommended: a
missing migration then surfaces as `500` errors on the routes that need it.

The probes and migrations never log the connection string or row data. Local
mode (`RDS_STORE=local`) doesn't use this check; it keeps tracking its own
migrations in `schema_migrations` (see
[Single user, no database server](#single-user-no-database-server)).

**Upgrading from before v0.8.0.** Nodes synced before v0.8.0 were migrated
with a change type but no changed properties or categories. The API repairs
them on its next start, in every store mode: a startup maintenance step
recomputes their change data and logs `Maintenance change-data: N row(s)
repaired.` (0 once done). No migration or re-sync is needed; a failed step is
logged as a warning and the API starts anyway.

You do **not** need Supabase Auth, Storage, or RLS — access is gated by the
API's bearer tokens and the service holds the DB credentials. (Supabase's own
MCP can still be handy for ad-hoc inspection of the tables.)

## 2. API tokens

The API accepts three classes of static bearer token. Generate each with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
- `RDS_PLUGIN_TOKENS` — one or more (comma-separated) tokens the Figma plugin
  presents when uploading snapshots (upload routes only). Issue one per user if
  you like.
- `RDS_AGENT_TOKENS` — one or more tokens worker agents present when reading the
  queue and recording verification (queue routes only). Keep these distinct
  from plugin tokens.
- `RDS_VIEWER_TOKENS` — optional read-only tokens for dashboards and UIs: every
  v3 `GET` (files, scopes, nodes, events, resolve), nothing else. A write with
  one is `403 wrong_token_class`.

The split is deliberate: a leaked plugin token can't read or clear the queue,
an agent token can't upload, and a viewer token can't change anything. The API
refuses to start with no tokens at all. (Local mode generates all three for
you — see above.)

**Named tokens.** Any entry may be `name:token`, where the name matches
`[a-z0-9._-]{1,40}` and is unique within its class (otherwise the API refuses
to start): `RDS_AGENT_TOKENS=maya:<token>,bot:<token>`. A named token's label
is the name — events, claims without a worker and `portal:<label>` actors show
it instead of the `token:<hash>` label unnamed tokens keep. Token-strength
checks apply to the token part only.

**Browser sessions and the portal.** A browser signs in with a viewer or agent
token at `POST /v3/session` and gets an `rds_session` cookie
(`HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, `Secure` on HTTPS) that
authenticates every v3 route the same way as the token it was minted from —
that is what lets a browser open the SSE stream, which can't carry an
`Authorization` header. The cookie is signed with `RDS_SESSION_SECRET`; in
`DATABASE_URL` mode it must be set or the session routes answer
`503 sessions_disabled`, and in `RDS_STORE` modes a `session` secret is
generated into `tokens.json` on first start. Cookie-authenticated writes also
need `X-RDS-Client: portal/…` and a same-origin `Origin` (else
`403 csrf_rejected`), and record `portal:<label>` as the event actor.

The API serves the built portal itself: `GET /ui` (and `/` redirecting to
`/ui/`) serves `RDS_PORTAL_DIR` — `apps/portal/dist` by default — with an SPA
fallback; build it with `npm ci && npm run build -w @rolling-design-sync/portal`.

## The portal (`/ui`)

The API serves a browser portal at **`/ui`** — `http://localhost:8787/ui` in
the Docker setup (`/` redirects there). It shows the tracked files, each scope's
node tree with what changed, work items, claims and activity, updated live as
agents claim and clear. The Docker image includes the build; from a checkout,
build it once with `npm ci && npm run build -w @rolling-design-sync/portal`
([apps/portal/README.md](../apps/portal/README.md)).

**Signing in.** Open `/ui`, paste a token at the sign-in page and press
**Sign in**:

- a **viewer** token (`RDS_VIEWER_TOKENS`; in local mode `.viewer` in
  `tokens.json`, e.g.
  `docker compose exec -T api node -p "require('/data/tokens.json').viewer"`)
  gives a read-only portal;
- an **agent** token can also block and unblock nodes and release claims from a
  node's drawer. A plugin token can't sign in.

The token is exchanged once for a 12-hour `rds_session` cookie (see *Browser
sessions* above) and isn't kept in the browser. **Sign out** is in the account
menu at the bottom of the sidebar.

**`RDS_SESSION_SECRET`.** Local and memory mode generate it (the `session`
entry of `tokens.json`). With `DATABASE_URL`, set it yourself — a random
32-byte hex string, generated like a token — or sign-in fails with
`503 sessions_disabled`. Changing it signs every browser out.

**Named tokens.** Give people and platforms `name:token` entries
(`RDS_VIEWER_TOKENS=design:<token>`,
`RDS_AGENT_TOKENS=devin:<token>,claude-local:<token>`) so the portal's account
card, Agents and Connect pages and the activity log show `design` or `devin`
instead of a `token:<hash>` label. In local mode, a class set in the environment
replaces the generated token of that class.

## 3. Host the API (apps/api)

Recommended: an **always-on** platform so it's a normal long-running process.

- **Railway / Render / Fly.io / a VM** (recommended): run it from the repo root
  (the API loads `packages/core` from the npm workspace), install with
  `npm ci`, start with `npm start -w @rolling-design-sync/api`, and set
  `DATABASE_URL`, `RDS_PLUGIN_TOKENS`, `RDS_AGENT_TOKENS`, and optionally
  `PORT`, `HOST`, `LOG_LEVEL`, `RDS_CLAIM_TTL_SECONDS`, `RDS_BODY_LIMIT_BYTES`
  (see the [table](#environment-variable-summary)). Behind the platform's
  router, set `RDS_TRUST_PROXY=1` so [rate limits](#rate-limits) count real
  client IPs. The platform gives you a
  free HTTPS URL like `https://rds.example.com`.
  `GET /health` returns `{"ok":true}` for health checks.
- **Docker builds (maintainers).** Railway builds from a root `Dockerfile`
  automatically once one exists, so the repo's `Dockerfile` switches Railway
  from its Node builder to a Docker build. Production keeps working because the
  image is neutral — no `RDS_STORE`, `HOST`, or `RDS_DATA_DIR`, so it runs
  `DATABASE_URL` mode on `0.0.0.0` and Railway's `PORT` — but check the first
  deploy after the `Dockerfile` lands (build log, `GET /health`, one upload).
- **Custom domain (optional):** to serve it at `figma-sync.yourdomain.com`, add
  the custom domain in the host, then create a **CNAME** record at your DNS
  provider pointing that **subdomain** to the host's target hostname. TLS is
  auto-provisioned. Use a subdomain, not the apex/root (apex can't be a CNAME).
- **Vercel / Edge alternative:** works but runs as serverless functions — you
  must use the Supabase **pooler** connection string (port 6543), and mind cold
  starts and per-request time limits.

### Rate limits

Every API instance counts requests in one-minute fixed windows, in memory (each
instance and each restart counts on its own):

| Budget | Default | Counted per | Variable |
|--------|---------|-------------|----------|
| Token | 600/min | token (by fingerprint; bearer or session cookie) | `RDS_RATE_LIMIT_TOKEN` |
| Plugin sync | 120/min | plugin token, on `…/hashes`, `…/sync` and `…/exists` instead of the token budget | on whenever the token budget is |
| IP | 120/min | client IP, requests without a token | `RDS_RATE_LIMIT_IP` |
| Auth | 10/min | client IP: every `POST /v3/session` and every `401` to a request that sent a token or session cookie | `RDS_RATE_LIMIT_AUTH` |

A full upload of a 2,000-node scope takes a handful of plugin requests (one
hashes read, one `/sync` per 2 MB batch, one `/exists` per 1,000 unresolved
main components), well inside the sync budget. Once an IP spends its auth budget,
every request from it is refused until the window ends — valid token or not —
which slows token guessing. `GET /health` and CORS preflights are never limited.

Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`
(seconds until the window ends). Over a limit the API answers `429`
[`rate_limited`](errors.md#rate-limited) with `Retry-After`; the CLI and the MCP
server report the retry time. `0` disables one budget. The defaults apply with
`DATABASE_URL`; the embedded modes (`RDS_STORE`) default every budget to `0`,
and setting a variable turns that one on.

**Behind a proxy (Railway, Render, Fly, nginx, Caddy, a load balancer)** the
API sees the proxy's address, so every client shares one IP budget. Set
`RDS_TRUST_PROXY` to take the client from `X-Forwarded-For`: the number of
proxies in front of the API (`1` for a single platform router or reverse
proxy), `true` to trust the whole header (only if your proxy overwrites it), or
the proxies' addresses / CIDR ranges (`10.0.0.0/8,127.0.0.1`). Leave it unset
when clients reach the API directly: then `X-Forwarded-For` is ignored, since
any client could forge it to dodge the IP and auth budgets.

Start on the free platform subdomain; switch to a custom domain later by
updating the plugin manifest and settings (section 4) and the agents'
`RDS_API_BASE_URL` — no server rebuild.

## 4. Self-hosting the plugin

The plugin is in `apps/figma-plugin`. A Figma plugin can only call domains
listed in `apps/figma-plugin/manifest.json` → `networkAccess.allowedDomains`;
Figma's sandbox blocks everything else, so uploads fail if it's wrong. The repo
ships a placeholder there.

1. **Add a Figma-assigned plugin ID.** Without one, Figma refuses the plugin's
   settings storage ("Cannot access client storage without a plugin ID"). In
   Figma desktop, choose **Plugins → Development → New plugin…**, create a
   throwaway plugin, and copy the `"id"` from the `manifest.json` Figma
   generates into `apps/figma-plugin/manifest.json` (right after `"name"`).
   Keep it out of commits — it's yours, not the project's.
2. Set `allowedDomains` to your API's **origin** — scheme + host, no path:
   ```json
   "networkAccess": {
     "allowedDomains": ["https://figma-sync.yourdomain.com"],
     "devAllowedDomains": ["http://localhost:8787"],
     "reasoning": "…"
   }
   ```
   `devAllowedDomains` already allows `http://localhost:8787`, so a locally-run
   API (including local mode) needs no network change. Point the plugin at
   `localhost`, not `127.0.0.1`: Figma rejects IP addresses in these lists
   ("must be a valid URL"), so the plugin can't call the IP form even though the
   server logs it.
3. In Figma desktop, import it as a development plugin: **Plugins →
   Development → Import plugin from manifest…**, and pick
   `apps/figma-plugin/manifest.json`.
4. In the plugin's **Settings**, set:
   - **API base URL** — the API origin from step 2 (or
     `http://localhost:8787`).
   - **Upload token** — one of your `RDS_PLUGIN_TOKENS` (in local mode, `plugin`
     in `tokens.json`).

The settings persist in Figma `clientStorage` on your machine; they are not
committed anywhere. If you change domains later, edit `allowedDomains` and
reload the plugin. See [apps/figma-plugin/README.md](../apps/figma-plugin/README.md)
for install details and what a scan captures.

## 5. Configure worker agents

Each worker needs `RDS_API_BASE_URL` (the API base URL, e.g.
`http://localhost:8787` in local mode) and `RDS_AGENT_TOKEN` (one of your
`RDS_AGENT_TOKENS`; in local mode, `agent` in `tokens.json`) in its environment.
[docs/agents.md](agents.md) covers the rest: getting the token into Claude
Code, Cursor or Devin (as secrets, never committed), the MCP server and CLI, and
the agent recipes.

## Image storage

Note screenshots, the plugin's screen reference images and render-check
results (built screenshot + heatmap) are re-encoded (metadata stripped), get a
thumbnail and are served only to token / session holders
(`GET /v3/files/{fileKey}/attachments/{id}`). Where they live:

- **`DATABASE_URL`:** the `blob` table, capped at `RDS_BLOB_MAX_BYTES` (1 GiB).
- **`RDS_STORE=local`:** files under `RDS_DATA_DIR/blobs`.
- **`RDS_STORE=memory`:** memory (gone on restart).
- **`RDS_BLOB_URL=s3://bucket/prefix`** (any mode): an S3-compatible bucket,
  with `RDS_BLOB_ACCESS_KEY_ID` / `RDS_BLOB_SECRET_ACCESS_KEY`, plus
  `RDS_BLOB_ENDPOINT` for non-AWS providers and `RDS_BLOB_PATH_STYLE=true` for
  MinIO. The bucket stays private: the API proxies every image.

A file's `storeImages` setting (`PATCH /v3/files/{fileKey}`, default `true`)
turns image uploads off for it (`409 images_disabled`); text notes still work.

## Environment variable summary

Only the `RDS_` names are read. A leftover pre-0.10 `FDS_`-prefixed variable is
ignored: the component logs one warning at startup naming its `RDS_`
replacement, so rename it.

| Variable | Used by | Default | Purpose |
|----------|---------|---------|---------|
| `DATABASE_URL` | API | — | Postgres connection string (Supabase direct 5432 / pooler 6543); ignored when `RDS_STORE` is set |
| `RDS_STORE` | API | — | `local` for a persistent embedded store, `memory` for a throwaway one (no database server either way; this machine only) |
| `RDS_DATA_DIR` | API | `./data` | Local-mode data directory, relative to the working directory (`apps/api` under `npm start -w`) |
| `RDS_PLUGIN_TOKENS` | API | — (local mode: generated) | Comma-separated tokens the plugin may use (upload routes only) |
| `RDS_AGENT_TOKENS` | API | — (local mode: generated) | Comma-separated tokens agents may use (queue routes only) |
| `RDS_VIEWER_TOKENS` | API | — (local mode: generated) | Comma-separated read-only tokens (v3 `GET` routes only) |
| `RDS_SESSION_SECRET` | API | — (local mode: generated into `tokens.json`) | Secret that signs the `rds_session` browser-session cookie; sessions are `503 sessions_disabled` without it in `DATABASE_URL` mode |
| `RDS_PORTAL_DIR` | API | `apps/portal/dist` | Built portal directory the API serves at `/ui` |
| `RDS_UI_ORIGINS` | API | — | Embedded modes: comma-separated browser UI origins to allow, `http://localhost:<port>` / `http://127.0.0.1:<port>` only (anything else fails startup) |
| `PORT` | API | `8787` | Listen port |
| `HOST` | API | `0.0.0.0`; `127.0.0.1` when `RDS_STORE` is set | Listen address. With `RDS_STORE` set, requests must still be addressed to a loopback host |
| `LOG_LEVEL` | API | `info` | Log verbosity |
| `RDS_CLAIM_TTL_SECONDS` | API | `900` | How long an agent's lease on a node lasts |
| `RDS_BODY_LIMIT_BYTES` | API | 64 MiB | Max request body |
| `RDS_RATE_LIMIT_TOKEN` | API | `600`; `0` when `RDS_STORE` is set | Requests per minute per token (bearer or session cookie); `0` disables. See [Rate limits](#rate-limits) |
| `RDS_RATE_LIMIT_IP` | API | `120`; `0` when `RDS_STORE` is set | Requests per minute per client IP for requests without a token; `0` disables |
| `RDS_RATE_LIMIT_AUTH` | API | `10`; `0` when `RDS_STORE` is set | Sign-ins (`POST /v3/session`) plus rejected (`401`) tokens per minute per client IP; `0` disables |
| `RDS_TRUST_PROXY` | API | off | Take the client IP from `X-Forwarded-For`: a hop count (`1` behind one proxy), `true` (every hop), or proxy addresses/CIDRs. Leave unset unless a proxy you control sits in front |
| `PGSSLMODE` | API | — | Set to `disable` for a local Postgres without TLS |
| `RDS_AUTO_MIGRATE` | API | `false` | Postgres mode: `true` applies the migrations the startup schema check finds missing (under an advisory lock) instead of refusing to start. See [Apply the migrations](#apply-the-migrations) |
| `RDS_SCHEMA_CHECK` | API | on | Postgres mode: `off` skips the startup schema check, with a warning. Not recommended |
| `RDS_LISTEN_URL` | API | `DATABASE_URL` | Direct (non-pooler) Postgres URL for the live-event listener; without `LISTEN` the API polls every 2 s |
| `RDS_EVENT_REPLAY_HOURS` | API | `24` | How far back an event stream replays on reconnect; older cursors get a `reset` |
| `RDS_EVENT_RETENTION_DAYS` | API | `30` | Events older than this are pruned (startup and hourly) |
| `RDS_FIGMA_TOKEN` | API (optional) | — | Figma personal access token with the `library_assets:read` scope: library component keys resolve to their library file, so library nodes link there. Without it their `figmaUrl` is null. Server-side only; never logged or returned |
| `RDS_IMAGE_MAX_BYTES` | API | 5 MiB | Max size of one uploaded image (note screenshot, screen reference, render-check result) |
| `RDS_BLOB_URL` | API (optional) | — | `s3://<bucket>/<prefix>`: keep images in an S3-compatible bucket instead of the store (see [Image storage](#image-storage)) |
| `RDS_BLOB_ENDPOINT` | API (optional) | AWS | S3-compatible endpoint (R2, MinIO, …), `http(s)://` |
| `RDS_BLOB_REGION` | API (optional) | `us-east-1` | Bucket region (signing) |
| `RDS_BLOB_ACCESS_KEY_ID` / `RDS_BLOB_SECRET_ACCESS_KEY` | API (with `RDS_BLOB_URL`) | — | Bucket credentials; never logged or returned |
| `RDS_BLOB_PATH_STYLE` | API (optional) | `false` | `true` for path-style bucket URLs (MinIO) |
| `RDS_BLOB_MAX_BYTES` | API | 1 GiB | Postgres driver: total image bytes kept in the database; more is `507 blob_store_full` |
| `RDS_API_BASE_URL` | CLI / MCP | — | API base URL |
| `RDS_AGENT_TOKEN` | CLI / MCP | — | This worker's agent token (one of `RDS_AGENT_TOKENS`) |
| `RDS_FILE_KEY` | MCP (optional) | — | Default Figma file key, so tools can omit `fileKey` |
| `RDS_WORKER` | CLI (optional) | — | Default `--worker` for `claim`, `block`, `unblock` |
| `RDS_MCP_DEFAULT_LIMIT` | MCP (optional) | `25` | Page size when a listing tool call omits `limit` |
| `RDS_MCP_MAX_RESULT_CHARS` | MCP (optional) | `50000` | Tool-result size budget; larger results come back as smaller pages |

## What is NOT needed

- No database server for a single user (`RDS_STORE=local`).
- No Supabase Auth / RLS / service-role key (API bearer tokens gate access).
- No custom domain (platform subdomain works).
- No Vercel account (Railway/Render recommended instead).
