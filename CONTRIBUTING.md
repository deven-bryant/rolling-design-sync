# Contributing

Thanks for your interest in Rolling Design Sync. Bug reports, feature ideas and
pull requests are welcome.

- **Questions and ideas:** start a thread in
  [Discussions](https://github.com/deven-bryant/rolling-design-sync/discussions).
- **Bugs and feature requests:** open an issue from one of the templates.
- **Security problems:** never in public — follow `SECURITY.md`.

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need **Node.js 22** (with npm) and, for the local container and the
end-to-end setup, **Docker**.

```bash
git clone https://github.com/deven-bryant/rolling-design-sync.git
cd rolling-design-sync
npm ci             # installs every workspace
npm test           # unit tests for all workspaces (no database needed)
npm run build
(cd scripts && npm test)   # agent CLI; scripts/ is not an npm workspace
```

To run the API while you work, `docker compose up -d` starts it in local mode,
or run it from the checkout with `RDS_STORE=local npm start -w
@rolling-design-sync/api` (see `docs/setup.md`). The end-to-end suite runs
against a real Postgres; `.github/workflows/e2e.yml` shows the exact setup,
including applying `supabase/migrations/` in order.

## Where things are

| Path | Contents |
|---|---|
| `apps/api` | Fastify API: sync, queue, diff and reconcile; serves the portal at `/ui` |
| `apps/figma-plugin` | The Figma plugin that scans and uploads a scope |
| `apps/mcp` | MCP server for coding agents |
| `apps/portal` | Browser UI (React, TypeScript) |
| `packages/core` | Pure diff core shared by the plugin and the API |
| `scripts/` | Agent CLI |
| `supabase/migrations/` | SQL schema |
| `tests/` | Cross-package integration tests |

Read `docs/architecture.md` before changing the API or the diff/hash logic —
the plugin and the server share `packages/core`, so a hash change must keep both
sides in agreement. API changes also follow `docs/compatibility.md`.

### Types

The API, MCP server, `packages/core` and the agent CLI stay JavaScript but are
type-checked: `npm run typecheck` runs `tsc` over them (see `tsconfig.json`;
tests and the Figma plugin are not covered yet), and CI runs it too. Add types
with JSDoc (`@param`, `@typedef`, `@type`) where the checker cannot infer them.
Both stores implement the contract in `apps/api/src/store/types.d.ts`; a
method added to one store goes there too. The v3 request and response types
come from the schemas in `apps/api/src/v3/schemas.js`: after changing a schema,
run `npm run gen:types` and commit `apps/api/src/v3/openapi.generated.d.ts`
(`npm run gen:types:check` fails when it is stale).

### Portal

The portal's components are layered — tokens, primitives, components, domain
components, features, routes — and imports only go down that list; a lint rule
enforces it. Everything below features is presentational (data and callbacks
arrive as props). Read
[Component architecture in `docs/ui-portal.md`](docs/ui-portal.md#component-architecture)
before adding or changing a component. In `apps/portal`, CI also runs:

```bash
npm run typecheck
npm run lint
npm run gen:api:check    # API types match /v3/openapi.json
```

## Pull requests

- **Branch from `dev` and open the PR against `dev`.** `main` holds tagged
  releases only.
- Keep each PR to one coherent change, with tests, and update the docs it
  affects.
- `npm ci && npm test && npm run build` must pass; CI runs the same plus the
  portal checks, the agent CLI tests and the Postgres end-to-end suite.
- Changes to the database schema go in a **new** migration under
  `supabase/migrations/`; never edit an applied one.
- New dependencies are pinned to an exact version that was published at least
  7 days ago.
- Never commit secrets: no `.env`, tokens, connection strings or real Figma
  file keys in code, tests or logs.
- No sign-off or CLA is needed — just open the PR.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org):
`<type>(<scope>): <summary>`, where the type is one of `feat`, `fix`, `docs`,
`refactor`, `test` or `chore` and the scope names the area, for example:

```
feat(portal): add SectionHeader
fix(api): reject a clear whose hash is stale
docs(setup): explain local-mode token files
```

## Releases

Maintainers cut releases from `dev` when they're ready, following
`RELEASING.md`: one version for the whole repo (SemVer, `0.x` for now), a tag
`vX.Y.Z`, and a GitHub Release. `CHANGELOG.md` is written at release time from
the merged changes, so **don't edit it in your PR** — describe the user-facing
change in the PR instead.

## License

The repository has two licenses, and your contribution is licensed under the
one that covers the code you change:

- **`apps/api/`**: the Functional Source License, Version 1.1, ALv2 Future
  License (FSL-1.1-ALv2; see `apps/api/LICENSE.md`). Each version becomes
  available under the Apache License, Version 2.0 two years after its release.
- **Everything else**: the Apache License, Version 2.0 (see `LICENSE`).

See `NOTICE` for attributions.
