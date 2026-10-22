# UI portal

Status: **agreed.** The portal is the browser UI for local and
self-hosted deployments: see what the design changed, what agents are working
on, and step in when something is stuck. It reads the v3 API
(`docs/api-v3-design.md`, `docs/api-v3-phase2.md`,
`docs/api-v3-agent-ergonomics.md`) and adds only what a browser needs.

**Design:** Figma file *Rolling Design Sync — Portal*
(`PORTAL_DESIGN_FILE` in `apps/portal/src/figma-file.ts`), page **Screens**, built
on Untitled UI. Portal-only
components (Node cell, Agent cell, Diff row) are on **Portal components**.

**Decisions**

| Topic | Decision |
|---|---|
| Sign-in | Signed cookie session minted from a viewer or agent token ([Sign-in and sessions](#sign-in-and-sessions)) |
| Write access | Agent-token sessions may block / unblock / release; viewer sessions are read-only; no new token class |
| Token labels | `name:token` entries in `RDS_*_TOKENS`; unnamed entries keep the hash label |
| Components | **Hand-built** from design tokens, with **React Aria Components** (unstyled, Apache-2.0) for the behavior of complex widgets — no third-party component code ([Component architecture](#component-architecture)) |
| Dogfooding | The portal's components are built **through Rolling Design Sync's own queue**: the Portal Figma file is synced, workers claim its work items, build each component, and clear it |

## Principles

- **The API is the product; the portal is a client.** Every screen is built from
  public v3 routes. Anything the portal needs that agents could use too goes into
  the API, documented in OpenAPI like any other route.
- **Same origin.** The API serves the portal at `/ui`, so there is no CORS, the
  browser sends the session cookie to `/v3` (including the event stream), and
  local mode's `Host`/`Origin` checks stay as they are.
- **Read-mostly.** Signed in with a viewer token you can read everything. Signed
  in with an agent token you can also **block / unblock** nodes and **release**
  claims. The portal never clears nodes (clearing needs a commit reference, so it
  stays with agents) and never shows or edits token values.
- **Live by default.** Open screens follow the event stream; nothing needs a
  refresh.

## Stack

| Piece | Choice |
|---|---|
| Location | New workspace `apps/portal` (`@rolling-design-sync/portal`), license Apache-2.0 like the plugin and core |
| Language / build | TypeScript (strict), Vite, React, React Router |
| UI components | Hand-built in `apps/portal/src/components/` on the design tokens, styled with Tailwind CSS; **React Aria Components** provides accessible behavior (keyboard, focus, ARIA) for Select, Menu, Tabs, Switch, Checkbox, Dialog/drawer and Tooltip |
| Design tokens | `apps/portal/src/styles/tokens.css`: CSS variables taken from the **MIT** Untitled UI React theme (attributed in `NOTICE`) — never copied from the PRO Figma kit — exposed to Tailwind through `@theme` |
| Component tests | Vitest + Testing Library (+ `jest-axe` accessibility checks) |
| API client | Types generated from `/v3/openapi.json` (`openapi-typescript`), a thin `fetch` wrapper, TanStack Query for caching and paging |
| Events | Browser `EventSource` on the v3 stream routes, feeding the query cache |
| Delivery | `npm run build` → `apps/portal/dist`, copied into the Docker image; the API serves it with `@fastify/static` at `/ui` (SPA fallback to `index.html`) |
| Dev | `vite` dev server proxying `/v3` and `/health` to the API (`RDS_PORTAL_API`, default `http://localhost:8787`), so development is same-origin too |

New dependencies are pinned exactly and at least 7 days old.

## Component architecture

Components are built once, composed everywhere. The portal is also the
reference example of the job this product exists for — turning a synced design
system into code — so its component layer follows the design file closely.

### Layers

| Layer | Folder | Contains | May import |
|---|---|---|---|
| Tokens | `src/styles/` | `tokens.css` (CSS variables), Tailwind `@theme` | — |
| Primitives | `src/components/primitives/` | Icon, Text, Stack, Inline, Surface, VisuallyHidden, the `variants()` helper | tokens |
| Components | `src/components/<Name>/` | One per Figma component set: Button, ButtonGroup, Badge, Avatar, Input, Select, Toggle, LoadingIndicator, Checkbox, Tabs, Breadcrumbs, Pagination, Table, Card, Metric, FeedItem, CodeSnippet, ProgressBar, Drawer, Menu, SidebarNav, PageHeader (Tooltip and others when a design needs them) | primitives, other components |
| Domain components | `src/components/domain/` | The portal-only Figma components: NodeCell, AgentCell (with the sprite), DiffRow, plus StateBadge, ChangeBadge, CategoryBadges | components |
| Features | `src/features/<area>/` | Data-connected pieces: query hooks, event wiring, containers such as NodeTable or ClaimsPanel | components, `src/api` |
| Routes | `src/routes/` | Pages: layout, URL state, composition of features | everything |

Imports only go **down** the table (a lint rule enforces it). Everything below
Features is **presentational**: no fetching, no global state, no knowledge of
the API — data and callbacks arrive as props, so every component renders in
isolation, in tests and in the gallery.

### Rules for every component

- **Props mirror the Figma component's properties.** Variant axes become union
  props with the same values in lower case (`size: 'sm' | 'md' | 'lg'`,
  `hierarchy: 'primary' | 'secondary' | 'tertiary' | 'link-color' | 'link-gray'`,
  `color` for Badge), booleans become booleans (`iconLeading`), text properties
  become `children` or named props, instance swaps become `ReactNode` slots
  (`iconLeading={<Icon … />}`). Defaults match the Figma defaults.
- **Composition over configuration.** Multi-part components are compound and
  expose their parts — `Table` / `Table.Header` / `Table.Row` / `Table.Cell`,
  `Card` / `Card.Header` / `Card.Body`, `Drawer` / `Drawer.Header` /
  `Drawer.Body` / `Drawer.Footer`, `Tabs` / `Tabs.List` / `Tabs.Tab` /
  `Tabs.Panel` — instead of one component with a growing list of props. Table
  cells are separate components (`TextCell`, `BadgeCell`, `ProgressCell`, …) a
  row composes freely.
- **Open for extension.** Every component accepts `className` (merged after its
  own classes) and passes remaining DOM props to its root element; leaf
  components forward `ref`. Nothing hard-codes copy, data, or layout width.
- **Styling only through tokens.** Classes use token-backed Tailwind utilities
  (`bg-primary`, `text-tertiary`, `p-xl`, `rounded-md`); no raw hex, no pixel
  values except borders. Variants are declared with the shared `variants()`
  helper (a small typed map from props to classes), so every component handles
  variants the same way.
- **Accessible by construction.** Interactive widgets wrap React Aria
  Components; simple ones use semantic elements (`button`, `table`, `nav`).
  Focus rings use the focus token; nothing relies on color alone (badges carry
  text).
- **Each component ships** `Name.tsx`, `Name.test.tsx` (renders every variant,
  interaction, axe check), an `index.ts` export, and an entry in the dev-only
  gallery route (`/ui/gallery`) showing every variant next to its Figma name.
- **Figma link.** Each component folder has a `figma.ts` mapping the Figma
  component key(s) and variant names to props — the file a design-sync worker
  reads to reconcile a component, and the start of Code Connect later.

### Gallery URLs

Every gallery example also has its own URL, so render checks can screenshot the
portal's components the way they screenshot any other app:

```
/ui/gallery?figma=<set or component name>&variant=<Figma variant string>
```

- **Only that example.** No gallery chrome (no heading, labels or padding): the
  example renders at its natural size inside one `<div data-rds-target>`, the
  screenshot target. Animations and transitions are switched off on that page so
  the screenshot is deterministic.
- **Matching.** `figma` must equal the example's set name exactly (surrounding
  and repeated spaces aside). `variant` is compared property by property, so
  property order and spacing don't matter: `State=Hover,Size=sm` and
  `Size=sm, State=Hover` address the same example. A component without variants
  (an icon such as `arrow-right`, `Vertical Divider`) is addressed with an empty
  `variant`.
- **Set names.** An example's set is its entry's `figma` (the Figma component
  set or component, the name its `figma.ts` maps, e.g. `Buttons/Button`),
  else the entry's `component`. An example that renders another set or whose
  label isn't exactly the variant string (it carries a set prefix or a
  description) declares `set` and/or `variant` itself, e.g. Badge's
  `{ figma: '_Dot · Size=md, Outline=False', set: '_Dot', variant: 'Size=md, Outline=False' }`.
  Descriptive labels (`Sizes (xs · sm · md · lg)`) are addressed by the label
  itself as `variant`.
- **One example per Figma variant.** Each example a render check can target
  names the exact Figma set (or component) and variant string — `Property
  1=Claimed`, `Excluded=False`; a standalone component uses its own name and
  `variant: ''` (`{ figma: 'KV Badge', variant: '' }`). It renders the sample
  content the Figma frame shows (its text, numbers and states) at its natural
  layout; the render check sets the Figma width. Sets that only appear together
  in a component's folder still get their own `set` (`Render Check History`,
  `Diff Status`), spelled as Figma spells them.
- **Documentation examples.** Extra examples (empty and error states, a
  component in a table) keep labels that aren't Figma variant strings — plain
  descriptions without `Property=Value` pairs (`Without the chevron`) — so a
  render check can't match them by accident. Slot components (`Main`,
  `Custom Section header`) aren't render targets; their entries name no Figma
  set.
- **Drift test.** `galleryDrift.test.ts` reads every `figma.ts` and fails when
  a variant it lists (its `variants`, or a one-axis set's `axes`; '' for a
  standalone component) has no gallery example, or when two examples claim the
  same set + variant in the same theme. Untitled UI library parts outside the
  Portal file's synced scopes are listed there as not targets.
- **Theme.** The portal's own theme mechanism (`ThemeProvider`): the target is
  wrapped in `data-theme` set to the variant's `Color Mode` (`Light` / `Dark`,
  treated as the theme rather than a property), else `&theme=light|dark`, else
  the portal's theme — the saved choice, else `prefers-color-scheme`. Of an
  example's theme copies in the gallery (labels ending ` · Dark` or
  ` · Color Mode=Dark`), the one for that theme is rendered, without the
  gallery's own theme wrapper.
- **Unknown target.** A set or variant that matches nothing shows a plain
  "404 — no gallery example" message.
- Without `figma` the route shows the full gallery as before; `/ui/_gallery`
  remains an alias. Like the gallery, these URLs exist in dev builds only.

## Building it through Rolling Design Sync

The component layer is delivered the way a user of this product would deliver
theirs:

1. The Portal Figma file is synced to the API (scope *Section 1*).
2. `list_work_items(group=component, expand=instances)` on that scope is the
   component backlog, grouped into component tasks; each task names its
   components and their Figma keys.
3. A worker claims its components' nodes, reads the design (`get_node` with
   `changes=diff` for values and token names, `format=outline` for structure),
   builds the component to the rules above, and **clears** the nodes with its
   commit once CI is green.
4. Later design changes surface as dirty nodes on the same components and go
   through the same loop.

Workers share **one** named token for their platform (`devin:<token>` in
`RDS_AGENT_TOKENS`), stored once as the Devin secrets `RDS_API_BASE_URL` and
`RDS_AGENT_TOKEN`; each worker identifies itself with its own `worker` id (see
[Token labels](#token-labels)).

## Sign-in and sessions

Browsers can't attach a bearer token to `EventSource`, and keeping tokens in
`localStorage` exposes them to any injected script. So the portal uses a cookie
session minted from a token.

- `POST /v3/session` `{ token }` → validates the token class (**viewer** or
  **agent**; plugin tokens get `403 wrong_token_class`) and sets
  `rds_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when the
  request came over HTTPS, 12-hour lifetime. Responds
  `{ role, label, expiresAt }`.
- `GET /v3/session` → the current `{ role, label, expiresAt }` (401 when signed
  out). `DELETE /v3/session` clears the cookie.
- **Stateless, signed:** the cookie holds `{ role, tokenFingerprint, exp }`,
  HMAC-SHA256-signed with `RDS_SESSION_SECRET`. A session stops working when it
  expires or when its token is removed from `RDS_*_TOKENS` (the fingerprint no
  longer matches), so revoking a token signs its sessions out on every instance
  without shared state.
- `RDS_SESSION_SECRET`: required for sessions in `DATABASE_URL` mode (without it
  `POST /v3/session` returns `503 sessions_disabled` with a hint); local mode
  generates one into `tokens.json`. Same strength rules as tokens.
- **Cookie auth on v3 routes:** every v3 route that accepts a viewer or agent
  token also accepts a valid session with the same role. Bearer tokens keep
  working unchanged and win when both are present.
- **CSRF:** cookie-authenticated `POST`/`DELETE` requests must carry
  `X-RDS-Client: portal/<version>` and an `Origin` equal to the API's own
  origin; otherwise `403 csrf_rejected`. (`SameSite=Strict` already blocks
  cross-site sends; the header check is the second layer.)
- **Actor:** writes made through a session record the actor as
  `portal:<label>` in events (and `blocked_by`), so the activity log shows the
  person, not the token's agent identity.

## Token labels

Today a token's label is `token:` plus a hash prefix. The portal shows labels
everywhere (agents, sessions, Connect), so tokens can be named:

- `RDS_AGENT_TOKENS=devin:<token>,claude-local:<token>` (likewise for plugin and
  viewer tokens). An entry without `name:` keeps today's hash label, so existing
  configs work unchanged. Names: `[a-z0-9._-]{1,40}`, unique per class.
- The label is what appears as an agent's identity when a claim doesn't name a
  `worker`, in events' `actor`, and in the portal. The token value is never
  returned by any route.

**A token is a credential, not an identity.** Give each *platform* or trust
boundary one token — all Devin sessions share `devin:…`, your local Claude Code
has `claude-local:…`, each automation its own — rather than one per worker,
so nobody has to predict how many workers a job needs. Per-session identity
comes from the `worker` id each session passes (claims already require it), and
the portal shows `worker` with the token label beside it (`devin-7f3a · devin`).
Revoking a token signs out every session on that platform at once; that is the
intended blast radius.

To make that identity complete, `clear` gains an optional `worker` (like
`block`'s `by`): when given it becomes the event's `actor`, otherwise the token
label is used as today.

## API additions

All on the v3 router, with OpenAPI schemas, model-facing descriptions, and
`x-rds-mcp` / `x-rds-cli` annotations where an agent would use them too.

| Route | For | Notes |
|---|---|---|
| `POST/GET/DELETE /v3/session` | Sign-in | Above. Not exposed as MCP tools. |
| `GET /v3/status` | Connect, sidebar | `{ version, store: 'postgres' \| 'local' \| 'memory', events: 'listening' \| 'polling', replayHours, plugin: { lastSyncAt, client } }`. Viewer readable. |
| `GET /v3/tokens` | Connect | `[{ class, label, lastUsedAt }]` — labels and last use only, never values. `lastUsedAt` is tracked in memory per instance (best effort; reset on restart). Viewer readable. |
| `GET /v3/files/{fileKey}/claims` | Claims, Node tree, drawer | Active claims: `{ claimId, worker, label, expiresAt, createdAt, nodeCount, nodeIds (≤ 500) }`, soonest expiry first. MCP tool `list_claims`. |
| `GET /v3/claims` | Claims (all files) | The same across files, with `fileKey`. |
| `GET /v3/events` | Activity | The event stream and JSON page across all files (each event has `fileKey`); same parameters as the per-file route plus `fileKey=` to narrow. |
| `nodeId=` on both events routes | Drawer history | Events whose `data` mentions the node (`nodeId`, or `nodeIds` containing it). |
| `since=` on both events JSON pages | Files metrics | ISO time lower bound, for "cleared this week". |
| `include=progress` on `work` | Work items | Per item `{ total, clean }` over the item's nodes (all states, not only dirty), so progress bars don't need extra calls. |
| `kind`, `uses`, `warnings`, `library`, `tracked` on `work` items | Work items, Removal panel | `kind: "removed"` items (a removed root, the components it used with their live placements), `kind: "library"` reference items (`tracked: false`), and `library` on library items. |
| `library` and a null `figmaUrl` on nodes | Node tree, drawer | Library nodes: `{ key, fileKey?, resolved }`; `figmaUrl` opens the library file once resolved, else is null. |
| `PATCH /v3/files/{fileKey}` | File settings | `{ settings: { trackLibraryComponents } }`; agent sessions only. `GET /v3/files/{fileKey}` returns `settings`. |
| `libraryLinks` on `GET /v3/status` | Drawer, File settings | True when the server has `RDS_FIGMA_TOKEN` (library nodes can link to their library file). |

## Screens

Each screen maps to the Figma frame of the same name, in a light and a dark
variant. Data comes from the routes listed; live updates from the event stream
of the file in view (or `/v3/events` on Files and Activity).

Navigation is the sidebar only: Files · Nodes · Work Items · Activity · Claims ·
Connect. Nodes and Work Items open the last visited file. Older links redirect,
keeping their query: `/ui/agents` → `/ui/claims`, `/ui/files/:fileKey` and its
`/scopes` → its Nodes, its `/claims` and `/activity` → the global pages.

The sidebar header holds the theme toggle (light / dark). The choice is saved
per browser (`localStorage['rds-theme']`); with no saved choice the portal
follows the OS `prefers-color-scheme`, live.

While a request is in flight, the screen shows the shared `LoadingIndicator`
(Figma *Loading indicator*, `Type=Line simple`): a spinner with its label in a
`role="status"` element, sized for table rows and text (`sm`) or drawer
sections (`md`); it stops turning under `prefers-reduced-motion`. Table pages
and child rows, the Nodes table's *Render Check* cells, Work items, Files,
the node drawer (node, *Render check* section, History), File settings
sections, scopes, claims, events and tokens use it; errors and empty states
stay plain text. A disabled **Toggle** that is on keeps its brand track,
dimmed, so viewers see which settings are on.

### Files — `/ui/files` (home)
- Metrics, in this order: **Dirty nodes** (sum of `GET /v3/files` counts),
  **Cleared this week** and **Active claims** (unexpired `GET /v3/claims`, with
  the count of distinct agents).
- Trends come from `GET /v3/insights/trends` (7-day windows, all files):
  *Cleared this week* is `total.cleared`, with a `±N%` chip from
  `clearedChangePct` (none when it is `null`: nothing was cleared the week
  before); *Dirty nodes* gets a signed chip from `netDirty` (newly dirtied minus
  cleared this week, e.g. `+31`; up means more dirty, no chip at `0`). The
  numbers come from the event log, so while it holds less than two windows
  (`complete: false`, see `RDS_EVENT_RETENTION_DAYS`) every chip is hidden and
  only the values show. Refreshed on `sync.completed` and `nodes.cleared`.
- Table: `GET /v3/files` — name and key, scopes (`/scopes`), dirty, implemented
  % (`clean / total`), last sync (time + `client`), agents (from claims).
- A file with no scopes shows "Run the plugin on a frame" with a link to Connect.

### Scope panel — on Nodes and Work Items
- `GET /v3/files/:fileKey/scopes` (deleted scopes left out), 10 per page: name
  and type, node id, last sync, child nodes (total, dirty, blocked) and an
  **Open** link to the scope in Figma. **Search Scope** filters by name or node
  id (`1:2` or `1-2`).
- Several scopes can be selected: each row has a checkbox (a row click toggles
  it too), and the header checkbox selects or clears every scope on the page
  (indeterminate when some are). At least one scope stays selected. The
  selection is `?under=` as comma-separated node ids in the panel's order
  (`?under=58:4508,33:3540`); the screen below lists the union of their
  subtrees, and the header and **Copy agent prompt** follow it. A single id
  (`?under=1:2`, older links) selects one scope; without `?under=` the most
  recently synced scope is selected. The card header shows *N selected*;
  **View Nodes** (Work Items) opens Nodes on the selection; Nodes and Work Items
  show an *N Scope(s) Viewed* badge beside their search field.
- With one scope the page header shows it as below. With several, the title is
  "N scopes", the meta line is the latest sync and the summed node and
  component counts (`N scopes · last synced … · N nodes, N components`),
  *Open in Figma* is hidden, and **Copy agent prompt** names every selected
  scope and passes the list as `under`.
- **View Scopes** shows or hides the panel; shown by default, remembered per
  browser.

### Node tree — `/ui/files/:fileKey/nodes?under=&…`
- Header: file and scope name, last sync, node and component counts
  (`/files/:fileKey`, `/scopes`). "Copy agent prompt" copies a self-contained
  prompt for the scope: MCP tools first, the CLI (run from a checkout of
  rolling-design-sync) second — list its work items with `expand=instances`,
  build leaves first, claim each item's `nodeIds`, read the changes
  (`list_nodes` / `get_node`), commit, clear every node with its `contentHash`
  and the commit SHA, re-read stale results, block what cannot be built; an
  item with `kind: "removed"` has its code removed (keeping the components in
  its `uses` that are still placed) and only its root cleared with
  `subtree: true`; an item with `notes` (nodes with `changeType:
  "requested"` when nothing else changed) has its notes read and the code
  fixed to match the design as they describe — clearing resolves them.
  "Open in Figma" links the scope.
- Change filter: Any · Added · Modified · Deleted · **Requested** (open notes
  and no design change). A **Notes** column shows a file icon on nodes with
  open notes (named `N open notes`).
- **File settings** (gear button beside *Copy agent prompt*, tooltip "File
  settings", on Nodes and Work Items) opens a right drawer with the file's
  name and its settings (`PATCH /v3/files/:fileKey` with `{ settings }`; each
  change shows a toast and refetches the work items, nodes, scope counts and
  file metrics; on an error the change reverts and the error shows at the
  top). Viewer sessions see every control disabled with "Sign in with an agent
  token to change file settings."
  - **Library components** — **Track library components**
    (`trackLibraryComponents`, default on): when off, the plugin doesn't scan
    library main components, they drop out of counts and work and appear as
    reference items; instances stay tracked. It also says whether links to
    library files are on (`libraryLinks`; off until `RDS_FIGMA_TOKEN` is set
    on the server).
  - **Render checks** — **Auto-detect check targets** (`autoTargets`, default
    on): every checked section's top-level frames, components and instances,
    each variant of its top-level component sets and every main component in
    it are check targets; off, only screens set up by hand are checked. Under
    it, **Sections**: one *checks* toggle per synced section (not the tokens
    scope), default on → `PATCH …/scopes/:nodeId { checks }`.
  - **Variant mappings** (`variantMappings`): rows of *Property*, *As*
    (Theme or Query, with a *Query key*) and *Values* (`Light=light,
    Dark=dark`); **Add mapping** and a remove button per row.
  - **Theme** — *Theme mode* (`themeMode`: color scheme (default), query
    parameter or localStorage key, with its *Query parameter* / *Storage
    key*, `themeKey`).
  - **Component gallery** — *Gallery URL template* (`gallery.urlTemplate`:
    `/…` or `http(s)://…` with `{key}`, `{nodeId}`, `{set}`, `{variant}`,
    `{prop.<Name>}`) and *Storybook URL* (`gallery.storybookUrl`).
  - **Retention** — *Results kept per target* (`checkRetention`, 1–100,
    default 5; the last passing result is always kept as the baseline).
  Mappings, theme, gallery and retention are saved together with **Save
  check settings**; the toggles save at once.
- The scope panel above the filters.
- Filters map one-to-one to listing parameters (`q`, `state`, `changeType`,
  `category`, `type`); the **Expand instances** toggle adds `expand=instances`.
  Filters live in the URL so views can be shared.
- Table: `GET /v3/files/:fileKey/nodes?under=<scope>&depth=1&include=counts&sort=document`
  for the top level, 25 per page with the cursor; expanding a row loads its
  children the same way (`under=<nodeId>`), and expanding an instance with
  *Expand instances* on loads its main component (`under=<mainComponentId>`,
  shown as `↳ … via <instanceId>`). Columns: Node (Node cell: indent, chevron,
  name, a gray **Library** badge on library nodes, `TYPE · id`, `→ main` for
  instances; it takes the remaining width, at least 375px), Scope (the name of
  the synced scope the row is under, hugging its text), State, Change, What
  changed (first changed prop with its token change, or "N properties"),
  Agent, **Render Check**, Notes. There is no Categories column; the
  *Category* filter stays.
  *Render Check* (`GET /v3/files/:fileKey/targets`) shows a check target's status —
  Mismatch · Passed · Waiting (a target inside it last failed) · Not mapped
  (no gallery entry or route renders it) · Error, also Ready · Requested ·
  Building · Stale — a red **In mismatch** badge on a node a failed check was
  traced to (it has an open `render_check` note), and `—` on other nodes and
  excluded targets. While the targets load, the column shows the loading spinner.
- **Design tokens** (the `TOKENS` scope, "Design tokens"): selecting it lists
  its collections (`VARIABLE_COLLECTION · 2 modes`), each expanding to its
  tokens. Its levels are listed with `fields=…,attrs` so token rows can show
  their resolved type and code name. A token row: the full name
  (`Colors/Background/bg-active`), meta `VARIABLE · COLOR · --color-bg-active`
  (`resolvedType`, then `codeSyntax.WEB` when set), state and change badges as
  usual, category `token` for mode changes. *What changed* lists the changed
  modes with their values — `Dark ■ #202527 → ■ #2b3033` (a swatch for colors,
  plain values otherwise, the target's short name for an alias: `→ gray-800`)
  — two at most, then `+N modes`.
- **Agent sprites:** a claimed row shows its agent's sprite (deterministic avatar
  from the worker name). On `claim.created` the sprite appears on the claimed rows
  in view with a short enter animation, idles while the lease runs, and "poofs" on
  `nodes.cleared`; it fades on `claim.released` or when `expiresAt` passes.
  Animations respect `prefers-reduced-motion`.

### Node detail drawer — `?node=<nodeId>` on the Node tree
- 583px wide (the Change List tab, and its Add Change view, widen it).
- `GET /v3/files/:fileKey/nodes/:nodeId?changes=diff`: header (name with a
  **Library** badge on library nodes, type, id, `→ main`) with the status badges
  under it in the header (Figma *Node Details Header*), **What changed** (Diff rows: built → now as token
  chips, raw values beneath, category badge; "since cleared at <commit> (<age>)").
- **Claim Holder** (Figma *Node Details - Claim Holder*): from `/claims` —
  Name, Claim Time, Lease Expiration as key / value rows, or "Unclaimed · the
  next agent pass you start picks this up"; **Release claim** (agent
  session) → `DELETE /v3/files/:fileKey/claims/:claimId`, confirming first when
  the claim covers other nodes.
- **Notes** (Figma *Node Details - Note Section*): an **Add note** button
  (`Default`) above the Change List opens a **Description** textarea
  (`Edit`; required, 1–4000 characters, `N/4000` counter) with **Add change
  note**; while it is open *Add note* is disabled and a *Cancel* button goes
  back. Adding (`POST …/nodes/:nodeId/notes`, any session —
  viewers too) toasts "Note added — the node needs a change", returns to the
  list and makes the node dirty with a **Requested** badge (and a `note`
  category) when it had no design change. Open notes sit above the Change List
  (`Preview`): *Open notes (N)* with a **Requested** (or **Render mismatch**)
  badge and the note's secondary buttons on one row, then its text, author and
  age, and its screenshots right-aligned; a requested node with no design change shows only
  them, not "nothing changed". The author can **Edit** (`PATCH
  …/notes/:noteId`) or **Delete** their open note; the author or an agent can
  **Dismiss** it after confirming (`POST …/notes/:noteId/dismiss`; the node
  goes back to its design-only state). Clearing the node resolves its notes.
- **Screenshots** on notes (Figma *Node Details - Notes Screenshots*): the
  Add Change form takes up to 3 PNG / JPG / WebP images (5 MB each), dropped,
  pasted or browsed, previewed as thumbnails with a remove button; they upload
  with the note (`images: [{ data, name }]`). Open notes show their
  screenshots as thumbnails (`?size=thumb`) that open the full image in a
  lightbox. With the file's `storeImages` setting off the field is replaced by
  "Screenshots are off for this file: its settings don’t store images."
- **Render check** (Figma *Node Details - Render Check*), from `GET
  …/targets?containing=:nodeId` (the targets that are, or contain, the node):
  - On a **check target**: its status badge (Not set up · Building · Ready ·
    Waiting · Requested · Passed · Render mismatch · Not mapped · Error ·
    Stale), KV badges (Checked · Commit · Source · Limit) of the viewed
    result, *Side by side* (designed and implemented images, differing
    regions outlined) and *Heatmap* tabs, and *Diff Status* (Pixel diff,
    Regions, then each differing region). Images come from `GET
    …/attachments/:id` (thumbnails first, full image in a lightbox), always
    whole (`object-contain`, in a frame of the image's aspect ratio up to
    224 px tall, so region outlines sit on the image) on a light
    checkerboard in both themes, so a transparent reference with dark
    content stays visible. Note screenshots and the lightbox use the same
    backdrop.
    **Request check** (any session) → `POST …/screens/:nodeId/checks`.
  - **Render Check Target Details** (Figma `Excluded=False`): *Source* (Auto
    · detected in a checked section, or Manual · set up as a screen),
    *Route* (an edit button for agents opens an inline form → `PATCH
    …/targets/:nodeId { route }`; it must start with `/`), *Variants* (the
    target's variant properties) and *Theme* (its theme and the file's theme
    mode). **Exclude from checks** (agents; read-only for viewers) → `PATCH
    …/targets/:nodeId { excluded }`; an excluded target (`Excluded=True`)
    shows the hint "Excluded from render checks: it isn’t checked, and it
    stays excluded when targets are detected again…" with *Learn more*
    instead of the details, and no *Request check*.
  - **History** (`GET …/targets/:nodeId/checks`): "Last N results · the last
    pass is always kept as the baseline" (N = `checkRetention`), newest
    first — status, `score · commit`, relative time; the shown result is
    marked **Viewing**, the last pass **Baseline**; selecting another row
    shows that result above.
  - On a **node inside targets**: **Render checks** — "Checks that include
    this node", one row per containing target (name, `Screen · checked 2h
    ago` / `Component · waiting on …`, status) with **Open**, which opens
    the target in the drawer.
  - On a frame or component that **isn't a target**: the hint "This section
    isn’t set up for render checks. Choose Screens or Components for it in
    the plugin to check it automatically." with *Learn more* — on a slot
    component (`slotComponent` from `?containing=`: a main component with a
    SLOT of its own, which is not detected as a target) instead "This is a
    slot component, so it isn’t checked on its own. It’s checked through the
    screens and components that fill its slot."; agents get
    **Set up check** (route, viewport, theme / query, threshold and masks,
    `PUT …/screens/:nodeId`), which makes it a manual target.
  A mismatch adds a **Render mismatch** badge and the `render` category; its
  `render_check` note is badged too, with **Go to target**. On a node inside
  a mismatched target whose note is on another node, *Open notes* starts
  with the target's note (Figma *Preview Target Note Reference*): **Render
  mismatch** badge, **Go to target**, the note text, and the part of the
  heatmap traced to the node ("Cropped from the heatmap").
  `render_check.*` and `file.settings_changed` events refresh it live.
- **History:** `GET /v3/files/:fileKey/events?nodeId=…` as a feed — including
  "Added a note", "Resolved a note by clearing it at <commit>" and "Dismissed
  a note: <reason>".
- Footer: Copy node prompt (the scope prompt's steps for this node, reading its open notes too) · **Block…** (agent session; reason required, 1–500
  chars) or **Unblock** · Open in Figma (for a library node, its library
  file). A library node with no `figmaUrl` (unresolved) gets **Copy component
  key** instead (secondary; toast "Component key copied"); while
  `/v3/status` reports `libraryLinks: false` its tooltip reads "Library
  component. Set RDS_FIGMA_TOKEN on the server to open it in its library file."
- **Removal panel** (a removed work item's root, opened from Work Items): above
  the claim and Change List, "Removed from the design" — remove the code that
  rendered the root, keep components that are still used — then *Components it
  used* (those with no live placements first): name, `N placements left` /
  `none left`, and a **Keep** (success) or **Likely unused** (warning) badge;
  the item's `warnings` ("“Pricing card” was deleted from the design but 2
  instances still use it."); **Copy removal prompt** copies an agent prompt to
  remove the code, keep the used components, consider removing the unused
  ones, then clear the root with `subtree: true` (MCP `clear_nodes`, or the
  HTTP call: the CLI's `clear` has no subtree flag).
- **Design token** drawer: the name with a gray **Token** badge, meta as on
  its row, "Used by N layers" (`usage.layers`), and one Change List row per
  changed mode (`value:Light`, `value:Dark`…) with swatches; an alias links to
  the token it points at (opens that token's drawer). Tokens have no canvas
  link, so there is no *Open in Figma*; *Copy node prompt* tells the agent to
  update the code variable named by `codeSyntax` (WEB, else the token name)
  for each changed mode, then clear.
- Viewer sessions see the same drawer without the agent action buttons; they
  can still add notes (and edit, delete or dismiss their own).

### Work items — `/ui/files/:fileKey/work`
- `GET /v3/files/:fileKey/work?group=component|frame&expand=instances&include=progress&under=<scopes>`,
  `under` passed as selected (comma-separated for several scopes).
- Above the table, as on the Node tree: the node search field (`?q=`, the same
  name / node id / `key:value` parsing as Nodes) with the *N Scope(s) Viewed*
  badge, then the group switch (By component · By frame) and **Expand
  instances** (on by default; off is `?expand=none` and drops
  `expand=instances`). *By frame* needs one root: with several scopes it is
  disabled with a tooltip and the list is grouped by component.
- Columns: component (name, key, variants), placements in this screen / in file,
  dirty of total (`· N notes` with open notes), categories, progress (`clean / total`), agent (from claims).
  Long component names and agent names truncate so the table fits 1440 px.
  Library items get a gray **Library** badge after the name.
- A row opens the Node tree filtered to that component (`under=<key>`).
- **Removed items** (`kind: "removed"`, design deleted in Figma that was
  built): a red **Removed** badge after the name, Placements `—`, Nodes
  `N layers removed` (`Done` once cleared). The row opens the node drawer on
  the removed root (`?node=<root>` on Work Items) with the Removal panel.
- **Reference items** (`kind: "library"`, `tracked: false`: library components
  the file doesn't track): the **Library** badge, Nodes "Library · not
  tracked", Progress `—`, no Removed or Dirty wording. The row opens the Node
  tree searching its placements (`q=component:<key>`).

- **Token items** (`kind: "tokens"`, one per collection of the design-tokens
  scope): the collection name with a gray **Tokens** badge, `VARIABLE_COLLECTION`,
  Placements `—`, Nodes "3 tokens changed" (`Done` once cleared), Progress as
  usual. The row opens the Node tree on that collection
  (`under=tokens:<collectionKey>`). *Copy agent prompt* has a line for them:
  update the code variables (each token's `codeSyntax`, WEB, else the token
  name) for every changed mode, then clear the tokens.
- *By frame* adds a **Render check** column (status badge, `N% differ`) and
  **Request checks (N ready)**, which requests every ready or stale screen on
  the page.

### Activity — `/ui/activity` (all files)
- Live feed: `GET /v3/events` stream (or the file's), newest first, grouped by
  minute; each entry links to its file / nodes. A "Pause live" toggle buffers new
  events with a count until resumed.

### Claims — `/ui/claims` (all files)
- `GET /v3/claims` grouped by worker — nodes held, files, soonest lease expiry,
  and a per-claim **Release** (agent session).

### Connect — `/ui/connect`
- Health metrics from `GET /v3/status` (server version, events listening /
  polling, plugin last seen).
- "Connect an agent": host tabs (Claude Code · Cursor · Devin · CLI) with the
  exact config for **this** server's URL, `<your agent token>` as a placeholder
  (the portal never inserts a real token), and a link to `docs/agents.md`.
- Tokens: `GET /v3/tokens` — class, label, what it can do, last used.

### Sign-in — `/ui/sign-in`
- One field (token) and a submit button; any 401 from the API sends the user
  here and back afterwards. Local mode shows where the viewer token is
  (`docker compose exec -T api node -p "require('/data/tokens.json').viewer"`).

## Live updates

- One `EventSource` per open file view, one for `/v3/events` on Files and
  Activity; reconnects replay via `Last-Event-ID` automatically. An
  `event: reset` refetches the visible queries.
- Event → cache: `sync.completed` refetches the file's visible node pages,
  summary and work items; `nodes.cleared`, `node.blocked` / `node.unblocked`
  update the affected rows in place; `claim.*` update claims and sprites;
  `render_check.requested` / `.passed` / `.mismatch` refetch the check
  targets, their histories and the drawer's render check;
  `file.settings_changed` refetches the file, its scopes and the targets.
- A status dot in the sidebar card shows live / reconnecting / polling.

## Non-goals (this phase)

- Clearing nodes, editing tokens or server settings, uploading from the browser.
- Accounts, multiple users with roles, teams — the self-hosted portal has token
  sessions only.
- Mobile layouts.

Parallel portal work owns disjoint folders; to keep it conflict-free there is no
shared barrel file (each folder has its own `index.ts`) and gallery entries are
per-component `Name.gallery.tsx` files the gallery discovers with
`import.meta.glob`.
