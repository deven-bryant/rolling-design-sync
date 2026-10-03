# Rolling Design Sync — Figma plugin

Version 0.12.0. A runnable JavaScript development plugin with editable source and
no build step required for installation.

Setting it up for the first time? The
[quickstart](../../docs/quickstart.md#2-import-the-figma-plugin-and-sync-a-frame)
walks through the plugin ID, import, settings and first sync.

_Rolling Design Sync is not affiliated with, endorsed, or sponsored by Figma,
Inc. Figma is a trademark of Figma, Inc._

Select a Figma **section or frame**, then **sync** it through an authenticated
API. The plugin fetches the scope's stored per-node content hashes
(`GET /v3/files/{fileKey}/hashes?under=`), hashes every scanned node locally with the
shared `packages/core` `contentHash()`, and uploads only the **changed / new
nodes plus deletion tombstones** (`POST /v3/files/{fileKey}/sync`). Instances are
recorded as lightweight **placement rows** (their own props + overrides,
`isInstance: true`, `mainComponentId` pointing at the main's row); layers
inside an instance are skipped — they live once in the main definition. The
server (`apps/api`) marks changed nodes dirty and hands them to coding agents;
there is no baseline to manage. Every batch also carries the file name
(`fileName`, from `figma.root.name`) and the synced scope's node ID
(`rootNodeId`), so the API can list files and synced scopes.

**Main-component resolution.** Every instance's main component is guaranteed to
exist on the server: the plugin resolves each instance's main
(`getMainComponentAsync()`), asks the API which mains are already stored
(`POST /v3/files/{fileKey}/exists`, batched), and lazily loads + scans the ones that are
**absent or `stale`** — transitively, since a main is itself built from
instances — with the same rules (instances inside a main become placement rows
too; their internals are skipped). Mains on other pages are loaded on
demand via `getNodeByIdAsync()` (never `loadAllPagesAsync()`); mains from
published libraries are imported with `importComponentByKeyAsync()`. A main
that is present and current is left alone — its own edits are picked up when
its page or component is synced as a scope. The result panel reports mains
resolved / scanned / re-scanned (stale) / already present; a main that cannot
be loaded is reported as a `[main component]` warning and does not block the
upload.

`stale` is the API's own judgement (`capture_version` below the server's
`CAPTURE_VERSION`): a main captured before instance support kept an
instance-less subtree, so re-scanning it backfills its instance placements.
The plugin hard-codes no version threshold. Because the stamp is a version and
not a "has no instances" guess, the first sync after the server ships a new
capture version walks the referenced-main graph once (expect it to be heavy,
with the usual yield/pause cadence keeping the UI responsive) and later syncs
go back to being incremental. Within a single run each main is still scanned at
most once (dedup + cycle guard).

See the service docs for the big picture: `../../docs/node-sync-design.md`
(per-node model, hashing), `../../docs/api-v3-phase2.md` (the v3 plugin
routes), `../../docs/architecture.md` and
`../../docs/setup.md` (Supabase + hosting + env vars, including the
`RDS_PLUGIN_TOKENS` this plugin authenticates with).

> **v3 routes.** The plugin calls only the v3 plugin routes
> (`/v3/files/{fileKey}/hashes`, `…/sync`, `…/exists`) with the same request
> bodies the v2 routes took, and sends `X-RDS-Client: plugin/<version>` (the
> version from `package.json`, baked into `code.js` by `build.js`) on every
> request. API errors are shown as the problem's `title` and `hint`; a `401` /
> `403` also says the upload token was rejected. It needs an API that serves
> the v3 plugin routes.

> **Changed in 0.4.0 (delta sync).** The plugin no longer uploads a full
> snapshot to the v1 `/scopes` + `/snapshots` routes. It uploads only what
> changed since the last sync (through the v2 node routes then; the v3 plugin
> routes now, above).

> **Changed in 0.3.0 (upload flow).** Earlier versions saved a local baseline in
> the document / a JSON file and emitted Markdown+JSON reports. That is gone. The
> plugin now scans and uploads; the server does the rest. The manifest also
> declares network access (previously `"none"`), and you must configure an API
> URL + upload token in the plugin UI.

## Install in Figma Desktop

Figma requires its desktop app for local plugin development. You do not need to
publish the plugin to use it yourself.

1. Open the **Figma desktop app**, open a Figma Design file, and choose
   **Plugins → Development → New plugin**.
2. Name it **Rolling Design Sync**, choose **Figma design**, choose **Custom
   UI**, and save the generated plugin to a folder, e.g.
   `Documents/Figma-Plugins/Design-Change-Sync`.
3. Copy **`code.js`** and **`ui.html`** from this folder into the folder Figma
   generated, replacing its files. `code.js` is a ready-to-run pre-bundled file
   (built from `../../packages/core` + `src/plugin.js`) — no npm/TypeScript step
   for installation.
4. Open the **manifest.json Figma generated**, keep its Figma-assigned `id`, and
   make the other fields match this repo's `manifest.json`:

```json
{
  "name": "Rolling Design Sync",
  "id": "KEEP_YOUR_FIGMA_ASSIGNED_ID_HERE",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["https://YOUR-API-HOST"],
    "devAllowedDomains": ["http://localhost:8787"],
    "reasoning": "Uploads scoped design snapshots to the self-hosted rolling-design-sync API declared in allowedDomains."
  }
}
```

5. In Figma, choose **Plugins → Development → Rolling Design Sync** (or
   **Import plugin from manifest** if it isn't listed). Keep the installed folder
   in place — Figma reads its files from there.

> **⚠ `allowedDomains` must match your deployed API host.** Figma's network
> sandbox blocks any request to a domain not listed here, so uploads silently
> fail if it's wrong. This repo's `manifest.json` ships a **placeholder**
> (`https://rds.example.com`) — replace it with your real
> API origin (scheme + host, no path). `devAllowedDomains` allows
> `http://localhost:8787` for a locally-run API — use `localhost`, not
> `127.0.0.1`; Figma rejects IP addresses in these lists. Changing the API domain later
> means editing the manifest and reloading the plugin.

Keep your Figma-assigned `id` across updates so per-scope client settings
persist. Official docs: https://developers.figma.com/docs/plugins/plugin-quickstart-guide/ ·
Manifest: https://developers.figma.com/docs/plugins/manifest/

## Configure (once per machine)

In the plugin's **1 · Settings** panel:

- **API base URL** — your deployed API origin (must match `allowedDomains`).
- **Upload token** — one of the server's `RDS_PLUGIN_TOKENS`.

Click **Save settings**. Both are stored in Figma **clientStorage on this
machine only** — never committed, never shared. Use **Show token** to reveal it
while typing.

## First use

1. Fill in **Settings** and **Save settings** (above).
2. Select exactly one **Section** or **Frame** in the Layers panel, then click
   **Use selection** (panel 2). The chosen scope shows as `name · id`.
3. Paste this file's **Figma file URL** (`https://www.figma.com/design/…`). Its
   file key identifies the tracked scope on the server; the plugin can't verify
   the URL belongs to the current file, so check it.
4. Click **Upload snapshot**. Pause design edits while it scans — the plugin
   captures the scope (with a verification pass), fetches the stored hashes,
   compares, and uploads only the delta in batches.
5. Read the **3 · Sync result** panel: counts of **changed**, **new** and
   **deleted** nodes uploaded, plus **unchanged** (skipped because the hash
   matched), **instances recorded**, **inside instances skipped** (layers
   inside instances), and **dirty** (nodes the server now flags
   for agents). On the first sync of a scope every tracked node is *new*; a
   repeat sync with no edits uploads nothing.

**Code already matches the design?** Before clicking **Upload snapshot**, tick
**Code already matches this design — mark newly scanned nodes as implemented**.
The plugin then sends `markImplemented: true` on every `POST …/sync`
of that run (scope nodes and resolved mains alike), so nodes the server has
never seen are stored as already implemented instead of dirty. Nodes synced
before — and their pending changes — are unaffected. The result panel reports
how many nodes were **baselined** (summed across batches). The checkbox is
unchecked by default, is never saved to clientStorage, and resets after each
sync.

From there, coding agents pull the dirty nodes and clear them via the API / the
`scripts/rds-agent.js` CLI — not through this plugin. Sync again after further
design edits to refresh the delta.

## What the scan captures

A scoped snapshot of the selected section/frame and all descendants (including
hidden instance layers). Tracked: layout & sizing, padding/gaps, local
transforms, fills/strokes/effects, text and formatting runs, vector
paths/networks, component/variant properties, hierarchy & child order, current
variable modes and resolved bindings, referenced style definitions, and exposed
prototype reactions. Numeric precision 0.0001; root-canvas translation ignored.

Limits: it resolves styles/variables the plugin can access (current
consumer-mode values only — test other themes/modes separately); it does not
diff entire remote libraries, extract image binaries (only paint hashes), map
Figma IDs to repo files, or verify motion/accessibility/app logic. Review those
and shared-component impact in the running app.

## Modify the code

| File | Purpose |
| --- | --- |
| `../../packages/core/index.js` | Pure normalization / diff / link helpers (shared with the API) |
| `src/core.js` | Re-export of `@rolling-design-sync/core` for the plugin tests |
| `src/plugin.js` | Figma traversal, dependency resolution, snapshot capture, hash delta + batched upload, UI actions |
| `ui.html` | Plugin interface (Settings, scope, sync result) |
| `code.js` | Ready-to-run bundle used by Figma |
| `build.js` | Dependency-free source bundler (`packages/core` + `src/plugin.js`) |
| `tests/plugin.test.js` | Node tests with a mocked Figma runtime + mocked network |
| `manifest.json` | Template; retain your Figma-assigned ID and set `allowedDomains` to your host |

From the repo root: `npm ci`, then in this folder `node build.js` and
`node --test`. Copy the rebuilt `code.js` (and any changed `ui.html`) into your
installed plugin folder and reload. Tests use a mocked Figma API and a mocked
network; this package has not been run inside the Figma desktop app in this
environment — do a first-run check on a small section before relying on it.

## API references

- Node IDs: https://developers.figma.com/docs/plugins/api/properties/nodes-id/
- Client storage: https://developers.figma.com/docs/plugins/api/figma-clientStorage/
- Network access: https://developers.figma.com/docs/plugins/manifest/#networkaccess
- Text segments: https://developers.figma.com/docs/plugins/api/StyledTextSegment/
- Figma MCP: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
