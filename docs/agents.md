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
5. **Block** a node you can't implement instead of clearing it:
   `block_node` / `node scripts/rds-agent.js block 5:2 --file-key AbC123 --reason "…"`.

6. **Removed design.** A work item with `kind: "removed"` is a built screen
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
