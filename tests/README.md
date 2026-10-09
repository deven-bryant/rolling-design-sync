# Cross-package end-to-end tests

`e2e-v3.test.js` drives a **running** API (`apps/api`) over HTTP. CI runs it in
`.github/workflows/e2e.yml` (separate from `ci.yml`) in three jobs: a real
Postgres (every `supabase/migrations/*.sql` applied), `RDS_STORE=local`
(PGlite), and the hardened container image.

It covers v3 (`docs/api-v3-design.md`, `docs/api-v3-phase2.md`): files, listing,
detail, claims, hash-guarded bulk clear, events, block, summary/work, viewer
token, a full plugin sync through the plugin routes (`…/exists` → `…/hashes` →
`…/sync`) with tombstones, instance placements (no fan-out from main-only
edits), `expand=instances` through a synced screen, the first-scan baseline
(`markImplemented`), document order (listing and outline follow Figma's
layer order, not node ids, and re-rank after edits), and capture-version
staleness on `…/exists` (older versions are seeded only when `DATABASE_URL`
reaches the API's database, i.e. the Postgres job). The v1 and v2 APIs were
removed; their unknown paths are a `route_not_found` problem.

Env: `RDS_API_URL` (default `http://127.0.0.1:8787`), `RDS_PLUGIN_TOKEN`,
`RDS_AGENT_TOKEN`, `RDS_VIEWER_TOKEN` (must be in the API's `RDS_PLUGIN_TOKENS` /
`RDS_AGENT_TOKENS` / `RDS_VIEWER_TOKENS`), optional `DATABASE_URL`. Every test uses
its own random `fileKey`, so the suite is safe to re-run against a shared database.

## Run locally

```bash
docker run -d --name fds-pg -e POSTGRES_PASSWORD=pg -p 5433:5432 postgres:16-alpine
for f in supabase/migrations/*.sql; do docker exec -i fds-pg psql -v ON_ERROR_STOP=1 -U postgres < "$f"; done

DATABASE_URL=postgresql://postgres:pg@127.0.0.1:5433/postgres PGSSLMODE=disable \
RDS_PLUGIN_TOKENS=e2e-plugin-token RDS_AGENT_TOKENS=e2e-agent-token RDS_VIEWER_TOKENS=e2e-viewer-token \
  npm start -w @rolling-design-sync/api &

DATABASE_URL=postgresql://postgres:pg@127.0.0.1:5433/postgres \
RDS_PLUGIN_TOKEN=e2e-plugin-token RDS_AGENT_TOKEN=e2e-agent-token RDS_VIEWER_TOKEN=e2e-viewer-token node --test tests/e2e-v3.test.js
```

## Portal (browser)

`e2e-portal/` drives the built portal (`/ui`) in Chromium with Playwright
(pinned in its own `package.json`) against a running API: a viewer signs in,
finds the seeded file, expands a frame and an instance (*Expand instances*),
opens a node drawer with no actions and signs out; an agent blocks and unblocks
a node and releases a claim; and a claim, then a clear, made through the API
add and poof the row's agent sprite without a reload; and the sidebar
navigation, the old file-tab links redirecting, the scope panel (selection,
*View Nodes*, its remembered visibility) and the theme toggle. Each test seeds its own
file through `…/sync` with the plugin token (the instance tree from
`e2e-v3.test.js`). CI runs it in the Postgres job and in `e2e-portal`, the
hardened local-mode container signing in with its generated `tokens.json`.

Env: `RDS_API_URL`, and either `RDS_TOKENS_FILE` (a local-mode `tokens.json`)
or `RDS_PLUGIN_TOKEN` / `RDS_AGENT_TOKEN` / `RDS_VIEWER_TOKEN`. The API must
serve a portal build (`npm run build -w @rolling-design-sync/portal`).

```bash
npm ci --prefix tests/e2e-portal
npx --prefix tests/e2e-portal playwright install --with-deps chromium

docker compose up -d --build
docker compose exec -T api cat /data/tokens.json > /tmp/rds-tokens.json
cd tests/e2e-portal && RDS_TOKENS_FILE=/tmp/rds-tokens.json npx playwright test
```

