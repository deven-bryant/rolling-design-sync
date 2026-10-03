# Releasing

How changes reach `main` and become a tagged release. Maintainers only.

## Branch model

```
feature/<slug>  ──merge --no-ff──▶  dev  ──release merge──▶  main  ──▶  tag vX.Y.Z
```

- **`dev`** is the integration branch. Every change lands on a short-lived
  branch and is merged into `dev` with `--no-ff`. Pull requests target `dev`.
- **`main`** only moves in a release. It always equals the latest tagged
  release, and production deploys from it.
- Nobody commits directly on `dev` or `main`, force-pushes either, or moves or
  deletes a pushed tag.
- A release happens only when the maintainer explicitly asks for one. Agents
  never cut a release on their own initiative.

## Versioning

- **One version for the whole repo**, following [SemVer](https://semver.org).
  Every `package.json` (root, `apps/*`, `packages/*`, `scripts/`) carries the
  same version, and the tag is `v<version>`.
- While in `0.x`: bump the **minor** for new features or breaking changes, the
  **patch** for fixes only.
- Each version of `apps/api` becomes Apache-2.0 two years after its release
  (FSL-1.1-ALv2), so the tag date is that version's release date. Never re-tag.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com). Entries
are written **at release time** from the merges since the previous tag — not in
each feature branch, which would make parallel branches conflict on the same
file:

```bash
git log --merges --first-parent --format='- %s' vPREV..dev   # everything merged since the last release
```

Summarize for users (what changed and why it matters), not commit by commit.

## Cutting a release

Replace `X.Y.Z` with the new version and `vPREV` with the previous tag.

1. **Check `dev`.** It is clean, up to date with `origin/dev`, and CI + E2E are
   green on its HEAD:
   ```bash
   git switch dev && git pull --ff-only origin dev
   gh run list --branch dev --limit 4 --json name,status,conclusion,headSha
   ```
2. **Prepare the release on a branch off `dev`** (`release/vX.Y.Z`):
   ```bash
   npm version X.Y.Z --workspaces --include-workspace-root --no-git-tag-version
   (cd scripts && npm version X.Y.Z --no-git-tag-version)   # scripts/ is not an npm workspace
   ```
   - In `apps/mcp/package.json`, set the `@rolling-design-sync/core` dependency
     to `^X.Y.Z` (`npm version` doesn't update it), then refresh the lockfile
     with `npm install --package-lock-only`. CI checks this.
   - In `CHANGELOG.md`, turn `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`
     and add a fresh empty `## [Unreleased]` above it.
   - Update the `Version` line at the top of `apps/figma-plugin/README.md`.
   - `npm ci && npm test && npm run build`, commit (explicit paths), and merge
     into `dev` with `--no-ff`. Wait for CI + E2E to go green on `dev`.
3. **Merge into `main` and tag:**
   ```bash
   git switch main && git pull --ff-only origin main
   git merge --no-ff dev -m "Release vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main vX.Y.Z
   git switch dev
   ```
   Pushing the tag starts the release workflows (next section).
4. **Verify and ship.** The **Release** and **Docker** runs for the tag are
   green, CI + E2E are green on `main`, and production redeploys from `main`.
   Submit the plugin to Figma Community when it changed.

## What a tag publishes

Pushing a `vX.Y.Z` tag runs two workflows. Neither uses a stored secret.

- **`.github/workflows/release.yml`**
  1. **verify** — checks that the tag matches every `package.json` version and
     that `CHANGELOG.md` has an `X.Y.Z` section, then `npm ci`, the tests, the
     build, and the package-contents check (`.github/scripts/check-pack.mjs`).
  2. **npm** — publishes `@rolling-design-sync/core`, then
     `@rolling-design-sync/agent-cli`, then `@rolling-design-sync/mcp` with
     [trusted publishing](https://docs.npmjs.com/trusted-publishers) (GitHub
     OIDC, npm ≥ 11.5.1) and provenance. A package whose version is already on
     npm is skipped, so a re-run after a partial failure is safe. A prerelease
     (`X.Y.Z-beta.1`) goes to the `next` dist-tag. **Only runs when the
     repository is public**; in a private repository the run logs a notice
     instead.
  3. **github-release** — creates the GitHub Release `vX.Y.Z` with the
     `CHANGELOG.md` section as notes (marked prerelease for `X.Y.Z-*`); skipped
     if it already exists.
- **`.github/workflows/docker.yml`** — builds the root `Dockerfile` for
  `linux/amd64` and `linux/arm64` and pushes
  `ghcr.io/<owner>/rolling-design-sync:X.Y.Z` and `:latest` (`:latest` is not
  moved by a prerelease) with the workflow's `GITHUB_TOKEN`. To rebuild a
  release's image (e.g. for a base-image fix), run the workflow by hand
  (**Actions → Docker → Run workflow**) and pick the tag; it refuses to run on
  a branch.

If a run fails part-way, fix the cause and re-run it (**Re-run all jobs**):
versions already on npm are skipped and an existing Release is kept.

## One-time setup (maintainer)

Do these once, in the public repository, around the first release:

1. **GHCR package visibility.** After the first Docker run, open the
   `rolling-design-sync` package (GitHub profile → **Packages**) →
   **Package settings** → **Change visibility** → **Public**. New packages are
   private by default.
2. **First npm publish by hand.** Trusted publishing can only be configured on
   a package that exists. Before pushing the first tag, from a clean checkout
   of the release commit, logged in to npm (`npm login`) with publish rights
   on the `@rolling-design-sync` scope:
   ```bash
   (cd packages/core && npm publish --access public --provenance=false)
   (cd scripts && npm publish --access public --provenance=false)
   (cd apps/mcp && npm publish --access public --provenance=false)
   ```
   (Provenance needs CI, so these first versions have none. The workflow then
   skips them as already published.)
3. **Trusted publisher, per package.** On npmjs.com → the package →
   **Settings** → **Trusted Publisher** → **GitHub Actions**: organization or
   user `<owner>`, repository `rolling-design-sync`, workflow filename
   `release.yml`, no environment, and allow `npm publish`. Then, under
   **Publishing access**, require two-factor authentication and disallow
   tokens, so only the workflow can publish.

## Hotfixes

- **Normal case:** fix on `dev` through the usual branch flow, then cut a patch
  release (`X.Y.Z+1`).
- **Urgent, and `dev` has unreleased work you don't want to ship:** branch
  `fix/<slug>` from the latest tag, bump the patch version and changelog
  on that branch, merge it into `main` with `--no-ff`, tag, push, then merge
  `main` back into `dev` so the fix isn't lost.
