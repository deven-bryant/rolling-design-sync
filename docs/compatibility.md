# Compatibility policy

This policy becomes binding at **1.0 (public launch)**. Before 1.0, minor
releases may break compatibility, with the changes and upgrade steps recorded
in the changelog; patches are fixes only. In particular, the
[API v3 phase-2 transition](api-v3-phase2.md) may remove v1, v2, and legacy
MCP/CLI forms without a deprecation period before launch.

## Covered interfaces

The compatibility contract covers:

- The HTTP API: paths, methods, inputs, responses, errors, and event streams.
- The Figma plugin ↔ API protocol, including sync payloads and hash semantics.
- MCP tool names and input schemas, including their OpenAPI annotations.
- CLI commands, flags, and machine-readable JSON output.
- The database schema and migration path for self-hosters.
- Documented environment variables, their accepted values, and defaults.

For example, removing a CLI flag or renaming `RDS_API_BASE_URL` is a breaking
change even if every HTTP route stays the same. Database compatibility means
a documented upgrade that preserves existing data, not a permanently frozen
schema. Releases follow [RELEASING.md](../RELEASING.md); user-facing changes
and upgrade notes are recorded in [CHANGELOG.md](../CHANGELOG.md) at release
time.

## API path versions

Within a path version such as `/v3`, changes are **additive only**. The API
path version is independent of the product's SemVer version: product 1.0
can serve `/v3`.

| Additive within `/v3` | Breaking; requires a new path version |
|---|---|
| New routes or optional request fields/parameters that leave existing calls unchanged | Removing or renaming a route, method, or input; adding a required input; tightening validation of previously valid requests |
| New response fields, with existing fields and their guarantees preserved | Removing or renaming response fields; changing their type, nullability, presence guarantees, or meaning |
| New enum values that preserve existing meanings, with unknown-value handling as required below | Removing or renaming enum values, or changing the meaning of an existing value |
| New opt-in behavior, filters, or formats | Changing a default, such as `state=dirty` to `state=all`, or changing existing filtering, ordering, or pagination semantics |
| New event types and additional event payload fields | Removing or renaming an event type, or changing an existing payload or replay contract incompatibly |
| New problem codes for new operations or previously unspecified error cases | Removing, renaming, or reassigning existing machine-readable codes, or changing their documented HTTP status or triggering condition |

For example, adding `lastSyncAt` to a response is additive; replacing
`contentHash` with `hash` is breaking. Adding an enum value is an extension,
not permission to redefine `dirty`. Adding a new error for a new route is
additive; changing an existing `file_not_found` response from 404 to 400 is
breaking. Human-readable problem `detail` and `hint` text may improve without
a version change; clients must use status and `code`, not match prose.

Breaking HTTP or plugin protocol changes go in a new path version (for
example, `/v4`) in a product major release. Serve both `/v3` and `/v4` during
the deprecation overlap. The old path keeps its existing contract throughout
that overlap; do not silently turn `/v3` into an alias with `/v4` semantics.

## Deprecation and removal

Before retiring an operation, field, or other API feature, maintainers must:

1. Mark the affected operation or schema property `deprecated: true` in
   OpenAPI and describe the replacement and migration steps.
2. Send `Deprecation` and `Sunset` headers on affected responses, announcing
   the deprecation and the earliest retirement date.
3. Publish a changelog entry with the replacement, upgrade steps, affected
   clients, and retirement schedule.
4. Keep the feature working for **at least two minor releases or 90 days,
   whichever is longer**, starting with the release that announces it.

Both thresholds must be met; if the second subsequent minor has not shipped
by the announced sunset, extend the date. A deprecation notice does not
authorize changing the feature's behavior during the window.

**Removal happens only in the next API version.** The deprecated feature
stays in `/v3` while `/v3` is served, even after the window expires. Its
replacement may be available earlier; the next version can omit it. Retiring
the old path itself requires the same notice and minimum overlap.

For example, a feature deprecated in product 1.2 cannot be retired before
both 1.3 and 1.4 have shipped and 90 days have elapsed. `/v4` may omit it,
but `/v3` continues to support it until that path's announced retirement.

## Clients and version identification

The plugin, MCP server, and CLI identify themselves on requests:

```http
X-RDS-Client: plugin/1.2.0
```

The other names are `mcp` and `cli`. Every v3 response includes the product
version in `X-RDS-Server: <version>`. The server logs the client header and
records it in `data.client` on `sync.completed` and other write events so
maintainers can see which clients still need an upgrade.

The server may give an outdated client an upgrade hint identifying the
supported version and how to update. An old version number alone must not
break a request that still satisfies the served API contract. Any future
minimum-client requirement must be documented, announced through the
deprecation process, and respect that contract; an incompatible-client error
must include an actionable upgrade hint. **Phase 2 adds identification only;
minimum-version enforcement and upgrade hints are not implemented in that
phase.**

The plugin is especially likely to lag: self-hosters import a development
plugin manually. Upgrade notes must explain rebuilding and re-importing its
manifest, as well as updating its API URL or allowed domain if needed; do not
assume an API deployment updates the plugin. MCP discovers annotated tools
from the server's OpenAPI at startup; CLI commands are generated at build
time. Neither mechanism permits removing a stable tool name, command, or
input in a minor release.

Clients must:

- Ignore unknown response fields and accept new enum values without failing
  to decode the response. Preserve an unknown value or use a safe fallback;
  never interpret an unfamiliar node state as permission to clear it.
- Ignore unknown event types and fields while advancing their replay cursor
  past those events. Handle the specified `reset` event by fetching current
  state again before continuing live.
- Handle unfamiliar problem codes using the HTTP status and display an
  available hint rather than crashing. Keep existing code-specific handling.
- Opt into new behavior explicitly; do not assume a newer client feature is
  available solely because a server returns a version header.

For example, a client that knows `node.blocked` must still consume a later
event type without disconnecting or replaying that same event forever.

## Database upgrades

Use **expand → migrate → contract across releases**, allowing old and new API
instances to coexist during a self-hosted deploy:

1. **Expand:** add tables, nullable columns, or compatible defaults without
   dropping or repurposing existing data. Old code must still work.
2. **Migrate:** backfill data and move code to the new representation in a
   later release, keeping the old representation usable during the overlap.
3. **Contract:** remove the obsolete representation only in a separate
   release after supported code no longer needs it. An incompatible schema
   change requires a major release after 1.0.

For example, replace a column by adding a new one, backfilling it while both
remain usable, then dropping the old column in a later, explicitly announced
release. Never combine addition and destruction into one upgrade step.

Migrations apply in filename order and **must never be edited once
released**. Corrections are new migrations. A destructive step (including
table/column drops or data deletion) needs a release of its own, a backup
note, and an upgrade note explaining the required intermediate releases,
data affected, deployment order, and recovery limitations. Obtain maintainer
confirmation before running destructive migrations; phase 2 itself drops no
tables or columns. Do not promise that downgrading the binary reverses a
migration or restores deleted data.

Release CI must prove upgrades from the **previous release's schema** with
representative existing data, not just initialize an empty database. Apply
the new migrations and verify preserved data and working API behavior on
both Postgres and local PGlite. If an upgrade needs an intermediate release,
the upgrade notes must name it and CI must exercise that sequence.

## Deployment modes

- **Local (`RDS_STORE=local`, PGlite):** startup applies pending migrations
  automatically, once each. Read upgrade notes and back up the persistent
  data directory or Docker volume before starting a release with destructive
  steps. Automatic migration does not remove the backup requirement.
- **Self-hosted (`DATABASE_URL`, Postgres):** operators apply the release's
  pending migrations in order **before upgrading API instances**. Expansion
  migrations must work with instances still running the previous release.
  Before a contract release, follow its upgrade notes to complete backfills
  and stop incompatible old instances; take the required backup first.

All covered features must work in both deployment modes. See
[setup.md](setup.md) for configuration and migration instructions.

## SemVer after 1.0

The repository uses one product version across its packages and release tag:

- **Patch (`1.2.0 → 1.2.1`):** compatible fixes; no new required inputs or
  changed documented defaults.
- **Minor (`1.2.0 → 1.3.0`):** additive features and deprecation notices;
  existing API, plugin, MCP, CLI, and configuration contracts remain usable.
- **Major (`1.x → 2.0.0`):** breaking changes to any covered interface,
  including destructive incompatible schema changes or removal/rename of
  environment variables. Provide upgrade notes and honor announced
  deprecation windows. Breaking API changes also require a new path version;
  a product major alone does not permit changing `/v3` incompatibly.

For example, adding an optional environment variable with the existing
behavior as its default is minor; requiring it for previously working
deployments or changing an existing default is major.
