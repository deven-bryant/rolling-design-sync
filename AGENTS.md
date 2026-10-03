# rolling-design-sync — agent instructions

Instructions for AI coding agents working on this repo. Human contributors: see
`CONTRIBUTING.md`.

## Branches and pull requests

- **`dev` is the integration branch.** Work on a short-lived feature branch cut
  from `dev`, open a pull request targeting `dev`, and merge with `--no-ff`.
  Never commit directly on `dev` or `main`; never force-push.
- **`main` only moves in a release** (`dev` merged into `main`, tagged
  `vX.Y.Z`); production deploys from it.
- **Releases happen only when a maintainer explicitly asks.** Follow
  `RELEASING.md`. Never merge into `main`, create tags, or bump versions
  otherwise.
- Stage commits by explicit path (never `git add -A`).

## Scope of this repo

This repository is the open-source, single-tenant product: the plugin, the API
for local and self-hosted use, core, the MCP server, and the CLI. Hosted-service
design (multi-tenancy, accounts/sign-in, plan limits, billing, business
metrics) and business planning **do not belong here** — not in code, docs, or
issues. They are maintained separately by the maintainers. Public code may add
generic extension points (interfaces other deployments can implement),
described without reference to any hosted product.

## Project

Figma → code change-sync service. A Figma plugin scans a scope (one Section or
Frame), uploads a normalized snapshot through an authenticated API, and worker
agents pull a compact work queue and record verification. The server owns the
diff and a last-verified baseline per scope.

**Read `docs/architecture.md` before working on this repo** — it holds the data
model, the verified-baseline reconciliation algorithm, the API surface, and the
locked decisions. `docs/setup.md` covers Supabase + hosting + env vars.

### Layout (npm workspaces)

| Path | Contents |
|------|----------|
| `apps/figma-plugin` | The Figma scanner/uploader plugin (built bundle `code.js` + `src/`). |
| `apps/api` | Standalone Fastify service: upload + queue REST API, diff + reconcile. |
| `apps/portal` | Browser UI served by the API at `/ui` (Vite/React/TS). |
| `apps/mcp` | MCP server exposing the v3 API to agent hosts. |
| `packages/core` | Pure diff core (normalize/diff/link) shared by plugin + API; no Figma/browser deps. |
| `scripts/` | Agent CLI wrapping the queue operations. |
| `supabase/migrations/` | SQL schema. |
| `tests/` | Cross-package integration tests. |

### Build & test

```bash
npm install                      # root, installs all workspaces
npm test                         # runs every workspace's tests
npm run build                    # builds every workspace
# portal only:
npm run typecheck && npm run lint   # in apps/portal
# plugin only:
cd apps/figma-plugin && node build.js && node --test tests/plugin.test.js
# CLI command surface regenerates from the OpenAPI doc:
npm run gen -w scripts           # rewrites scripts/commands.generated.json — commit it
```

Config comes from env vars — copy `.env.example` to `.env`. Never commit `.env`
or the Supabase service-role key. `node scripts/check-public-tree.js` must stay
green: no real Figma file keys, deployment hostnames, or secrets in the tree —
use the dummy keys from the tests and `https://rds.example.com` as the example
host.
