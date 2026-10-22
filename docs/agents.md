# Agents — host setup and recipes

How to give a coding agent (Claude Code, Cursor, Devin, or anything with a
shell) access to the Rolling Design Sync queue, and what to ask it once it has
it. It assumes an API is already running — `docker compose up -d` from the
[README](../README.md#get-started), or a team deployment
([docs/setup.md](setup.md)).

Agents have two ways in, and both read the same variables:

- **The MCP server** (`apps/mcp/bin/rds-mcp.js`, stdio) — tools such as
  `list_nodes`, `list_work_items`, `list_claims`, `claim_nodes` and `clear_nodes`, generated
  from the API's `GET /v3/openapi.json`. Details: [apps/mcp/README.md](../apps/mcp/README.md).
- **The CLI** (`node scripts/rds-agent.js`, zero dependencies) — the same
  operations as shell commands (`nodes ls`, `work`, `claim`, `clear`, …).
  Details: [scripts/README.md](../scripts/README.md).

Both need a checkout of this repo with Node 22.22+; run `npm install` in it once
for the MCP server (the CLI needs nothing installed).

## 1. The variables

| Variable | Read by | Required | Meaning |
|---|---|---|---|
| `RDS_API_BASE_URL` | MCP, CLI | yes | API origin, e.g. `http://localhost:8787` for the Docker setup. |
| `RDS_AGENT_TOKEN` | MCP, CLI | yes | An **agent** token (not the plugin or viewer token). |
| `RDS_FILE_KEY` | MCP | no | Default `fileKey`, so tool calls can omit it. |
| `RDS_WORKER` | CLI | no | Default `--worker` for `claim`, `block` and `unblock`. |
| `RDS_MCP_DEFAULT_LIMIT` | MCP | no | Page size when a listing call omits `limit` (default 25). |
| `RDS_MCP_MAX_RESULT_CHARS` | MCP | no | Tool-result size budget (default 50,000); larger results come back as smaller pages. |

Each host below sets them in two places: in the **MCP server's `env`** (the
host starts the server with exactly that environment) and, where the host has a
shell tool, in the **shell's environment**, so `node scripts/rds-agent.js`
sees the same values.

A leftover pre-0.10 `FDS_`-prefixed variable is ignored (with one startup warning
naming its `RDS_` replacement); rename it.

## 2. Get the agent token (once)

Copy the token into your host's config yourself. Agents are not expected to
read `tokens.json` — and many agent harnesses forbid reading secret files — so
the token has to reach them through the host config below.

**Docker (local mode).** The container generates the tokens on first start
and keeps them in its `rds-data` volume. Print the agent token from the repo
directory:

```bash
docker compose exec -T api node -p "require('/data/tokens.json').agent"
```

(`docker compose logs api` also shows it, from the first start only.) The
token stays the same across restarts and rebuilds; only `docker compose down -v`
deletes it, and then every host config needs the new one.

**Local mode without Docker** (`RDS_STORE=local`): the same file is
`<RDS_DATA_DIR>/tokens.json`; with the `RDS_DATA_DIR` from
[docs/setup.md](setup.md#single-user-no-database-server):

```bash
node -p "require('$HOME/.rolling-design-sync/tokens.json').agent"
```

A container token and a plain-Node token are different; the API rejects the
other one with `401 invalid_token`.

**Team deployment** (Postgres mode): use one of the API's `RDS_AGENT_TOKENS`
from whoever runs the API — the one for your platform (below).

### One token per platform, one worker id per agent

A token is a credential, not an identity. Give each **platform** (or trust
boundary) its own named agent token and share it across that platform's
sessions — every Devin session uses `devin:…`, your local Claude Code
`claude-local:…`, Cursor `cursor:…`:

```bash
RDS_AGENT_TOKENS=devin:<token>,claude-local:<token>,cursor:<token>
```

The name is the token's label in events, claims and the portal
([docs/setup.md](setup.md#2-api-tokens)), and revoking one token cuts off one
platform. Each agent *instance* then identifies itself with its own stable
**worker id** — `RDS_WORKER` for the CLI, `worker` on MCP calls — e.g.
`devin-7f3a` or `claude-1`; the portal shows it with the token label beside it
(`devin-7f3a · devin`). Don't mint a token per worker: you don't need to know in
advance how many agents a job runs.

In the snippets below, replace `<agent-token>` with that value and
`/path/to/rolling-design-sync` with the absolute path of your checkout. The
token is a secret: put it in **user-level** config, never in a file you commit.

## 3. Claude Code

Add the MCP server at user scope (stored in `~/.claude.json`, not in the
project):

```bash
claude mcp add rds --scope user --transport stdio \
  --env RDS_API_BASE_URL=http://localhost:8787 \
  --env RDS_AGENT_TOKEN=<agent-token> \
  --env RDS_FILE_KEY=<fileKey> \
  -- node /path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js
```

Put the server name (`rds`) **first**: `--env` takes several values, so a name
placed after it is read as one more `KEY=value` and the command fails with
"Invalid environment variable format". `RDS_FILE_KEY` is optional; everything
after `--` is the command Claude Code runs to start the server. Run from your
checkout's root, you can use `"$PWD/apps/mcp/bin/rds-mcp.js"` for the path, and
`$(docker compose exec -T api node -p "require('/data/tokens.json').agent")`
for the token (Docker local mode). Check the result with `claude mcp get rds`.

For the CLI, put the same variables in the `env` block of your Claude Code
settings. Claude Code writes that block into its own environment, so commands
its shell tool runs — `node scripts/rds-agent.js …` — see them. Use your user
settings, `~/.claude/settings.json` (or `.claude/settings.local.json` in the
project, which must stay uncommitted — **not** `.claude/settings.json`, which is
checked in):

```json
{
  "env": {
    "RDS_API_BASE_URL": "http://localhost:8787",
    "RDS_AGENT_TOKEN": "<agent-token>",
    "RDS_WORKER": "claude-1"
  }
}
```

Merge the `env` key into the file if it already exists. Restart Claude Code,
then check with `/mcp` (the `rds` server is connected) and by asking it to run
`node scripts/rds-agent.js files ls`.

## 4. Cursor

Add the server to `~/.cursor/mcp.json` (user-level; `.cursor/mcp.json` in a
project works too, but then keep the token out of it as shown below):

```json
{
  "mcpServers": {
    "rds": {
      "command": "node",
      "args": ["/path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js"],
      "env": {
        "RDS_API_BASE_URL": "http://localhost:8787",
        "RDS_AGENT_TOKEN": "<agent-token>",
        "RDS_FILE_KEY": "<fileKey>"
      }
    }
  }
}
```

Cursor also resolves `${env:NAME}` in `env` values, so you can keep the token
in your shell profile instead (`export RDS_AGENT_TOKEN=…` in `~/.zshrc` or
`~/.bashrc`) and write `"RDS_AGENT_TOKEN": "${env:RDS_AGENT_TOKEN}"`. Exporting
`RDS_API_BASE_URL` and `RDS_AGENT_TOKEN` in the profile is also what makes the
CLI work in the terminals Cursor's agent runs commands in.

Check under **Cursor Settings → MCP** that `rds` is enabled and lists its tools.

## 5. Devin

Devin runs on its own cloud machine, so it can't reach an API that listens on
your laptop's `localhost` (the Docker setup). Point it at an API it can reach —
a team deployment ([docs/setup.md](setup.md#3-host-the-api-appsapi)) — or run
local mode on Devin's machine as part of its environment setup.

1. **Secrets.** Add `RDS_API_BASE_URL` and `RDS_AGENT_TOKEN` (and optionally
   `RDS_WORKER`) as Devin secrets — scoped to the repository you build in, or
   to your user or organization. Devin provides secrets to its sessions as
   environment variables, so the CLI works as-is:
   `node scripts/rds-agent.js files ls`.
2. **MCP (optional).** Add a custom MCP server in Devin's MCP settings with
   transport **STDIO**, command `node`, argument
   `<repo path on Devin's machine>/apps/mcp/bin/rds-mcp.js`, and the
   environment variables `RDS_API_BASE_URL` and `RDS_AGENT_TOKEN` (plus
   `RDS_FILE_KEY` if you like). If the server can't start it exits with a
   message naming the missing variable, or `RDS_API_BASE_URL` when the API
   isn't reachable.

## 6. Other hosts

Any MCP client that launches stdio servers works: run
`node /path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js` with the variables
above in its environment. [apps/mcp/README.md](../apps/mcp/README.md) has a
Windsurf snippet. Anything with a shell can use the CLI once
`RDS_API_BASE_URL` and `RDS_AGENT_TOKEN` are exported.

## 7. Recipes

Every recipe starts from a Figma link to the screen, section or component —
copy it from Figma (**Copy link to selection**). Tools and commands take the
link as `url` / `--url` (or as the CLI's first argument) and read the file key
and node from it. The examples use:

```bash
LINK='https://www.figma.com/design/AbC123/App?node-id=2-1'
```

A prompt as short as *"What's in this screen? `<link>`"* is enough for an agent
with the MCP server; its instructions teach the loop below.

### What's in this screen

The whole screen as an indented tree, with every component it uses nested under
the first instance that reaches it:

```text
MCP: list_nodes { "url": "<link>", "expand": "instances", "format": "outline" }
CLI: node scripts/rds-agent.js nodes ls "$LINK" --expand instances --format outline
```

```text
Screen (FRAME) · added
  Button (INSTANCE → 10:1 Button) · added
    ↳ Button (COMPONENT) · added
      Icon (INSTANCE → 20:1 Icon) · added
        ↳ Icon (COMPONENT) · added
          Glyph (VECTOR) · added
  Button (INSTANCE → 10:1 (shown above)) · added
```

This lists the dirty nodes (the default `state`); add `state=all` for the full
structure. The outline comes whole (no default `limit`, up to 2,000 rows); with
`limit` it is paged by rendered lines, so nesting and `(shown above)` read the
same on every page — the MCP result then ends with its `More results` line, and
the CLI's `--all` follows the pages.

### What do I build first

Changes grouped by component, with how often this screen uses each:

```text
MCP: list_work_items { "url": "<link>", "group": "component", "expand": "instances", "changes": "names" }
CLI: node scripts/rds-agent.js work "$LINK" --group component --expand instances --changes names
```

Each item has the component (`key`, `name`), its `nodeIds`, the
`changedProps`, `placements` (file-wide) and `placementsInScope` (in this
screen); nodes outside any component form the last item, `key: null`. Build the
components first — fixing a coded component once fixes every place it is used —
then the screen's own nodes. Add `--format outline` for a readable version.
`summarize` / `summary` gives the counts only. For progress over time,
`get_trends` / `trends` counts the nodes cleared and newly dirtied in the last
`windowDays` days (default 7) per file, with the change vs the window before.
Add `include: "progress"` / `--include progress` to get `{total, clean}` on
each item across all states, independent of the `state` filter and the
50-node ID cap. Other listing filters still apply.

For **building a design system**, prefer `group=set`: it merges variants into
one item named like the Figma component set (`Table cell`, `Badge`, …), with
`set: { id, key, name }` and `variants: [{ key, name, nodeCount }]`. The item's
`nodeIds` span the matching nodes of all variants; standalone components keep
their own items. Node `component.set` and outline `Set / Variant` links provide
the same context when reading the design.

```text
MCP: list_work_items { "url": "<link>", "group": "set", "expand": "instances", "changes": "names" }
CLI: node scripts/rds-agent.js work "$LINK" --group set --expand instances --changes names
```

### Library components

Nodes of library (remote) components carry `library: { key, fileKey?, resolved }`;
their `figmaUrl` opens the component in its library file once the server has
resolved it (`RDS_FIGMA_TOKEN`), else it is `null` — find the component in the
library by `key`. A file can stop tracking them:

```text
MCP: update_file_settings { "url": "<link>", "settings": { "trackLibraryComponents": false } }
CLI: node scripts/rds-agent.js files settings --url "$LINK" --track-library-components=false
```

Then library nodes leave listings, counts and progress (`library=include` or
`only` still lists them), and with `expand=instances` each library component a
screen uses is a `kind: "library"` reference item (`tracked: false`, no nodes,
with `placements`): use the library component as is — nothing to build or clear.

### Design tokens

Figma variables sync as their own scope, `tokens`: one `tokens:<collectionKey>`
node per collection and one `token:<variableKey>` node per variable, with one
`value:<Mode>` property per mode. A token change dirties the token, not the
layers that use it. Work them collection by collection:

```text
MCP: list_work_items { "fileKey": "<key>", "under": "tokens", "changes": "diff", "include": "usage" }
CLI: node scripts/rds-agent.js work --file-key <key> --under tokens --changes diff --include usage
```

Each `kind: "tokens"` item is a collection; its `changes` show each changed
mode (`value:Dark: #202527 → #2b3033`, an alias as `{ alias, name }`) and
`usage` how many layers use each token. For every token, update the code
variable named by its `codeSyntax` (WEB, else the token name) in each changed
mode, then clear it like any node (`clear_nodes` with its `contentHash`).
`get_node` on a token shows its `codeSyntax`, every mode's value and `usage`.

### The clear loop

1. **Read** the dirty nodes of what you're working on, with the hashes:
   `list_nodes { "url": "<link>" }` /
   `node scripts/rds-agent.js nodes ls "$LINK"`. Each node has its `changes`
   (`{ prop: { built, now } }`; added nodes list `changedProps` — ask for
   `changes=diff` or `get_node` for their values) and a `contentHash`.
2. **Implement** each node, pulling live details for *that node only* from the
   Figma MCP via its `figmaUrl`.
3. **Commit**, then **clear** the nodes with the hashes you read and the
   commit SHA:
   ```text
   MCP: clear_nodes { "url": "<link>", "commitRef": "<sha>", "items": [ { "nodeId": "2:1", "contentHash": "<hash>" } ] }
   CLI: node scripts/rds-agent.js clear --url "$LINK" --commit-ref <sha> 2:1=<hash> 5:1=<hash>
   ```
4. **Stale** items changed after you read them; the result carries the current
   `contentHash`. Re-read that node (`get_node` /
   `node scripts/rds-agent.js nodes show 5:2 --file-key AbC123`), implement the
   newer change, and clear it with the new hash — never retry the old one.
5. **Notes.** A node with open `notes` (`changeType: "requested"` when the
   design is otherwise built; work items count them) was noted by a person or
   agent as not matching the design. Read the notes, fix the code to match the
   design as they describe, then clear the node — clearing resolves its notes.
   Add one yourself with `add_note` /
   `node scripts/rds-agent.js notes add 5:2 --file-key AbC123 --body "…"`;
   dismiss a wrong one with `dismiss_note` (it does not clear the node).
6. **Block** a node you can't implement instead of clearing it:
   `block_node` / `node scripts/rds-agent.js block 5:2 --file-key AbC123 --reason "…"`.

7. **Removed design.** A work item with `kind: "removed"` is a built screen
   (or layer) that was deleted in Figma — one item per removed root, cleared
   once. Remove the code that rendered the root; keep the components in its
   `uses` with `livePlacements > 0` (still used elsewhere), consider removing
   those with `livePlacements: 0`, and heed `warnings`
   (`main_removed_with_live_placements`: a deleted main component still has
   live instances). Then clear just the root with `subtree: true`:
   ```text
   MCP: clear_nodes { "url": "<link>", "commitRef": "<sha>", "items": [ { "nodeId": "2:1", "contentHash": "<hash>", "subtree": true } ] }
   ```
   The result's `subtreeCleared` counts the deleted nodes below it cleared with
   it. `not_removed` means the node isn't deleted — clear it normally.
   Deleting something that was never built creates no work at all.

8. **Render checks.** Screens (frames set up with `set_screen`: a `route` and a
   viewport) are compared with their Figma reference as built. Run requested
   render checks with `rds-agent check`: for each
   `list_render_checks { "status": "requested" }` /
   `node scripts/rds-agent.js checks ls --file-key AbC123 --status requested`,
   open the check's `route` at its `viewport` (with its `theme` / `query`),
   take a 1× screenshot and send it with `submit_render_check`
   (`{ "checkId": "…", "image": "<base64 PNG>" }`; `error` if it would not
   render). The API scores it and returns a heatmap. Fix render-mismatch notes
   like any note: a `source: "render_check"` note on the screen root lists the
   differing regions; look at its heatmap with `get_attachment` (an image), fix
   the screen, then `request_render_check` and run it again — a pass resolves
   the note. Notes from people may carry screenshots too (`get_attachment`).
   With automatic targets, **end your pass with `rds-agent check --ready`**
   (see [Render checks](#render-checks)): it checks every target your pass
   finished, and any mismatch comes back as notes on the nodes to fix.

Repeat until the listing is empty.

### Parallel agents with claims

When several agents share a file, each leases its nodes first so no two build
the same thing. Give every agent its own stable worker id (`RDS_WORKER` for the
CLI) and reuse it on every call.

```bash
# Take up to 20 free dirty nodes under the screen
node scripts/rds-agent.js claim "$LINK" --worker agent-a --label "Checkout screen" --limit 20

# Later: the nodes this agent holds, as nodeId=hash pairs, cleared in one call
node scripts/rds-agent.js nodes ls "$LINK" --claimed mine --worker agent-a --fields nodeId,contentHash --all \
  | jq -r '.nodes[] | "\(.nodeId)=\(.contentHash)"' \
  | node scripts/rds-agent.js clear --url "$LINK" --commit-ref <sha> -
```

- `claim_nodes` / `claim` takes a `filter` (the listing's filters, e.g. `under` — one node
  id, or several comma-separated for the union of their subtrees — `type`, `component`) or exact `nodeIds` (claim a work item's `nodeIds` to
  take one component). It returns only the nodes it actually leased — free,
  expired, or already yours; work on those only. An empty `nodes` means nothing
  free matched.
- `clear_nodes` releases what it clears. For the rest, `release_claim` /
  `node scripts/rds-agent.js release <claimId> --url "$LINK"`; for long work
  `renew_claim` / `renew <claimId>` before `expiresAt` (default lease 15 min,
  `RDS_CLAIM_TTL_SECONDS` on the API).
- `list_claims` / `node scripts/rds-agent.js claims ls --file-key <fileKey>`
  lists unexpired claims, soonest expiry first, with worker, label, expiry,
  node count and up to 500 still-leased node IDs per claim. Call it before
  claiming to see who holds what; the portal's Claims page shows the same
  leases, live.
- `list_nodes` with `claimed=false` shows what nobody holds; `claimed=mine`
  needs `worker` (the CLI's `nodes ls` doesn't fill it from `RDS_WORKER`).

### Paging

The MCP server returns 25 results per listing call unless the call passes
`limit` (`format=outline`: the whole outline, or `limit` lines); a result that ends with `More results: call again with cursor="…"` has
more — repeat the call with that cursor and every other input unchanged. The CLI
returns the API's default page (100) and follows every page with `--all`.

### Render checks

A render check compares the built screen with its Figma frame, pixel by pixel,
on the API. RDS never starts one: someone requests it (the portal, or
`request_render_check` / `rds-agent checks request`) and an agent or a CI job
runs it where the app runs, with `rds-agent check`.

**Automatic targets — one switch per section.** Every synced section is
checked unless someone turns it off: the Figma plugin's checkbox *Check this
section's screens and components* (on by default, saved on the section), or
`set_scope_checks` / `node scripts/rds-agent.js scopes checks 1-2 --file-key AbC123 --checks=false`.
With the file setting `autoTargets` on (the default), a checked section's
targets are the union of its top-level frames / components / instances, every
variant of its top-level component sets and every main component inside it —
each node once, no screen / component levels. Slot components (a main
component with a SLOT of its own) are not targets: they are checked through
the screens and components that place them with their slots filled. The plugin uploads each changed
target's reference with its node map; nothing to set up per frame. To skip
one frame, exclude it: `update_check_target { "excluded": true }` /
`rds-agent targets set 2-5 --file-key AbC123 --excluded` (the portal's
*Exclude from checks*). An excluded target keeps its history, never blocks
others, is left out of the ready list and `check --all`, and stays excluded
when targets are re-detected.

- **Rendering: gallery first, then the route.** Every target renders from the
  app's gallery when it has an entry there — the file setting
  `gallery.urlTemplate` (e.g. `/gallery?figma={set}&variant={variant}`) or
  `gallery.storybookUrl` (stories tagged `figma:<component key>`), see
  [the gallery contract](#the-gallery-contract) below — else at its route,
  else it is **Not mapped** (shown, never blocks).
- **Routes.** Variants that differ only in **mapped** properties
  (`variantMappings`, e.g. `{ "Color Mode": { "as": "theme", "values": {
  "Light": "light", "Dark": "dark" } } }`) share one route; the first
  `rds-agent check --url <full url>` of a target without one saves it for the
  whole family (`update_check_target { "route": "/files" }` does the same).
  `themeMode` says how a theme reaches the app: `color-scheme` (default),
  `query` (`?<themeKey>=dark`) or `storage` (localStorage). Variant mappings
  apply to gallery and route alike.
- **Which targets contain a node.** `list_check_targets { "containing": "4-1" }`
  lists the targets a node is part of (itself, its ancestors, and anything
  placing an instance of a component it is in), each with its status, last
  check and open render notes.
- **The ready list.** `list_check_targets { "status": "ready" }` /
  `rds-agent targets ls --status ready` lists the targets your pass finished
  (no dirty nodes under them, no result for their current design) in check
  order by containment — a target containing other targets (nested, or as
  instances) comes after them — with everything needed to render each. A
  target containing one whose latest result is a mismatch is **waiting** on
  it instead; *not mapped* and excluded targets never block.
- **End every pass with `rds-agent check --ready --base-url <app>`.** A
  mismatch is traced through the node map to the deepest layer with its own
  record (inside an instance, the main component's layer, so you fix it once);
  an area spanning more than two layers goes to their nearest common parent.
  Each gets a `render_check` note, and the target a summary note with the
  heatmap. A later pass resolves the render notes under the target.
- `list_target_checks` shows a target's history (latest first); each keeps
  `checkRetention` results (default 5) plus its last pass.
- **What counts as a difference.** Pixels are compared by perceptual colour
  distance (YIQ, tolerance 0.1); masked areas are skipped and a size mismatch
  counts the uncovered area as differing. A differing pixel that is
  *anti-aliasing* is not counted in `score`: it sits on an intensity slope
  (it has both darker and lighter neighbours) and either that slope ends in a
  flat area in both images (pixelmatch's detector), or the other image also
  has an edge at the same spot (Figma and the browser drew the same edge with
  different rasterization). So text that only differs in sub-pixel position
  or smoothing passes, while a missing or moved element, a shifted block or a
  colour change still counts — content missing from one image is flat there.
  The trade-off: a glyph change *in the same place* (bold vs regular, a wrong
  letter) is only partly counted, its edges overlapping; at body text sizes it
  still scores well over 1%. Ignored pixels are reported as `antialiased`
  (the note says "N more ignored as anti-aliasing") and drawn faint grey on
  the heatmap; differing regions are built from counted pixels only.

#### The gallery contract

The gallery renders one target (a variant, a component or a frame) at a time in the app. Set one of the two
in the file settings (`update_file_settings`, or
`rds-agent files settings --file-key AbC123 --gallery '{"urlTemplate":"/gallery?figma={set}&variant={variant}"}'`):

- **URL convention** (any framework). `gallery.urlTemplate` is a path (or full
  URL) with placeholders, each filled URL-encoded: `{key}` (the variant's
  component key), `{nodeId}`, `{set}` (component set, or component name),
  `{variant}` (Figma's variant string, `Size=sm, State=Hover`) and
  `{prop.<Name>}` (one variant property). The page renders that one variant
  with sample props and marks it with `data-rds-target`; the CLI gives that
  element the variant's Figma width (border-box; its height flows) and
  screenshots it (else the viewport, clipped to the Figma size):

  ```text
  /gallery?figma={set}&variant={variant}
    → /gallery?figma=Button&variant=Size%3Dsm%2C%20State%3DHover
  /components/{set}/{prop.Size}-{prop.State}
    → /components/Button/sm-Hover
  ```

  ```tsx
  // /gallery: render the requested variant inside the marked element
  <div data-rds-target style={{ display: 'inline-block' }}>
    <Button size="sm" state="hover">Save</Button>
  </div>
  ```

- **Storybook.** `gallery.storybookUrl` (or `--storybook <url>`; relative to
  `--base-url` when it is a path). Tag each story with the variant it renders:

  ```ts
  export const SmallHover: Story = {
    args: { size: 'sm' },
    tags: ['figma:3f2a9c0e1b4d…'],      // the variant's component key
    // or: tags: ['figma-node:12:34'],   // its node id
  };
  ```

  Tags are in Storybook's `index.json`, so the CLI resolves key → story id
  without a build step, opens `iframe.html?id=<story id>&viewMode=story` and
  screenshots `#storybook-root` (or a `[data-rds-target]` inside it). The
  component key is in `targets ls` (`render.key`) and in the portal.

A target with no entry (no story with its tag, or a template placeholder it
has no value for) renders at its route instead; with no route either it is
**not mapped**: shown, never an error, never blocks other targets.
`rds-agent check --file-key AbC123 --list-unmapped` prints them to add.

**Themes.** The file setting `themeMode` says how a target's theme (from a
mapped variant property, e.g. `Color Mode=Dark` → `dark`) reaches the app:

| `themeMode` | What the CLI does |
|---|---|
| `color-scheme` (default) | Emulates `prefers-color-scheme: dark` / `light` — no app change. |
| `query` | Adds `?<themeKey>=<theme>` (default key `theme`) to the URL. |
| `storage` | Before the page loads, sets localStorage `<themeKey>` = `<theme>` and adds `<theme>` as a class on `<html>`. |

**Nightly regressions.** `rds-agent check --all` checks every target (not only
ready ones), for regressions in clean nodes after shared-code edits:

```yaml
on:
  schedule: [{ cron: '0 3 * * *' }]
jobs:
  render-checks:
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.64.1-noble   # = your playwright version
    env:
      RDS_API_BASE_URL: https://rds.example.com
      RDS_AGENT_TOKEN: ${{ secrets.RDS_AGENT_TOKEN }}
      RDS_WORKER: nightly
    steps:
      - uses: actions/checkout@v5
      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"
      - run: npm ci && npm run build
      - run: npm run start & npx --yes wait-on http://localhost:3000
      - run: npx --yes @rolling-design-sync/agent-cli check --file-key AbC123 --base-url http://localhost:3000 --all
```

**Manual setup, once per screen** (rev9 screens, still supported). Pick the frame (usually a direct child of a scope
section, e.g. `View=Files, Color Mode=Light`) and tell RDS where it renders:

```bash
node scripts/rds-agent.js screens set 2-1 --file-key AbC123 --route /files --width 1440 --height 900
node scripts/rds-agent.js screens set 2-5 --file-key AbC123 --route /files --query theme=dark --theme dark
```

The viewport defaults to the frame's size; use one screen per viewport and
theme. At its next sync the Figma plugin uploads the frame's reference image.
Masks (rectangles in frame px that the comparison skips) and the threshold
(default 1 % of pixels) are part of the same settings: `set_screen` /
`PUT /v3/files/{fileKey}/screens/{nodeId}` with
`"masks": [{ "x": 1180, "y": 16, "width": 240, "height": 32 }]`.

**Run the requested checks.** In the app's repo, with the app running:

```bash
npm i -D playwright && npx playwright install chromium   # once
node /path/to/rolling-design-sync/scripts/rds-agent.js check \
  --file-key AbC123 --base-url http://localhost:3000 --requested
```

For each requested check it opens `base-url + route (+ query)` at the screen's
viewport with reduced motion and a frozen clock, waits for network idle and web
fonts, takes a viewport-sized PNG and submits it with the commit
(`git rev-parse HEAD`). `--screen 2-1` requests a check of one screen and runs
it. `--storage-state auth.json` signs the browser in (a Playwright storage
state saved from a login). Exit code: `0` all passed, `1` a render mismatch,
`2` an error. A mismatch adds a `render_check` note with the heatmap to the
screen — fix it like any note (step 8 of [the clear loop](#the-clear-loop)),
then request and run the check again.

**Make the page deterministic.** The screenshot must match a static design:

- **Fixture data.** Render the screen with the same data the design shows —
  a seeded database, a mocked API or a fixture route — not live data.
- **Masks** for what can't be fixed: avatars, ads, maps, clocks from the
  server. Keep them small; masked pixels are never compared.
- **Fonts.** Font rendering differs between machines: run checks in the same
  image every time — Playwright's published Docker image
  (`mcr.microsoft.com/playwright:v<version>-noble`, the version of your
  `playwright` package) — and self-host the design's web fonts.
- Interactive states (hover, open menus) are out of scope: check the screen as
  it first renders.

**In CI** (GitHub Actions), after the app is built:

```yaml
render-checks:
  runs-on: ubuntu-latest
  container: mcr.microsoft.com/playwright:v1.64.1-noble   # = your playwright version
  env:
    RDS_API_BASE_URL: https://rds.example.com
    RDS_AGENT_TOKEN: ${{ secrets.RDS_AGENT_TOKEN }}
    RDS_WORKER: ci
  steps:
    - uses: actions/checkout@v5
    - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"
    - run: npm ci && npm run build
    - run: npm run start & npx --yes wait-on http://localhost:3000
    - run: npx --yes @rolling-design-sync/agent-cli check --file-key AbC123 --base-url http://localhost:3000 --requested
```

The job fails on a mismatch or an error; the results, heatmaps and notes are in
the portal. `rds-agent check --help` lists every flag
([scripts/README.md](../scripts/README.md#render-checks-rds-agent-check)).
