# Quickstart

From a clean machine to a coding agent clearing its first Figma changes, in six
steps. Everything runs on your machine: the API and portal in Docker, the plugin
in Figma desktop, the agent tools from this checkout.

You need **git**, **Docker** (with Compose), the **Figma desktop app**, and
**Node 20+** for the agent tools.

## 1. Start the API

```bash
git clone https://github.com/deven-bryant/rolling-design-sync.git
cd rolling-design-sync
docker compose up -d
curl -s http://localhost:8787/health      # {"ok":true}
```

The API and its portal run at **`http://localhost:8787`**, reachable from this
machine only. On first start the container generates three tokens and keeps
them, with the data, in the `rds-data` Docker volume (`/data/tokens.json` inside
the container) — they survive restarts and rebuilds; `docker compose down -v`
deletes them.

| Token | Used by | Can |
|---|---|---|
| `plugin` | the Figma plugin | upload syncs |
| `agent` | the MCP server and CLI | read, claim, clear, block |
| `viewer` | you, in the portal | read only |

Print one when you need it (run these from the checkout):

```bash
docker compose exec -T api node -p "require('/data/tokens.json').plugin"
docker compose exec -T api node -p "require('/data/tokens.json').agent"
docker compose exec -T api node -p "require('/data/tokens.json').viewer"
```

Treat them like passwords: paste them into user-level config, never into a file
you commit.

<details>
<summary>Prefer a published image? (coming with the first public release)</summary>

Once the image is published on GHCR, the same hardened container runs without a
checkout:

```bash
docker run -d --name rds -p 127.0.0.1:8787:8787 -v rds-data:/data \
  -e RDS_STORE=local -e RDS_DATA_DIR=/data -e HOST=0.0.0.0 \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  ghcr.io/deven-bryant/rolling-design-sync:latest
docker exec rds node -p "require('/data/tokens.json').plugin"
```

You still need a checkout for the Figma plugin (step 2) until it is published.

</details>

## 2. Import the Figma plugin and sync a frame

1. **Get a plugin ID.** Figma only lets a plugin save its settings if its
   manifest has a Figma-assigned ID. In Figma desktop choose
   **Plugins → Development → New plugin…**, create a throwaway plugin, and copy
   the `"id"` from the `manifest.json` it generates.
2. **Add it to the manifest.** Paste it into `apps/figma-plugin/manifest.json`
   as `"id": "<your id>",` right after `"name"`. Keep it out of commits — it's
   yours.
3. **Import the plugin.** **Plugins → Development → Import plugin from
   manifest…** and choose `apps/figma-plugin/manifest.json`.
4. **Configure it.** In the plugin's **Settings**, set the API base URL to
   `http://localhost:8787` and the upload token to the `plugin` token, then
   **Save settings**. Use `localhost`, not `127.0.0.1` — Figma only allows
   hostnames.
5. **Sync.** Select one Section or Frame, click **Use selection**, paste the
   file's URL, and click **Upload snapshot**.

The first sync marks every node dirty — tick **Code already matches this
design** before uploading if your app already implements it. Later syncs upload
only what changed.

**API on another machine?** `devAllowedDomains` in the manifest already allows
`http://localhost:8787`. For any other server, add its origin (scheme + host, no
path) to `networkAccess.allowedDomains` and reload the plugin — Figma blocks
every other domain:

```json
"networkAccess": {
  "allowedDomains": ["https://rds.example.com"],
  "devAllowedDomains": ["http://localhost:8787"]
}
```

<details>
<summary>No Figma at hand? Sync a node with curl</summary>

```bash
PLUGIN_TOKEN=$(docker compose exec -T api node -p "require('/data/tokens.json').plugin")
curl -s -X POST http://localhost:8787/v3/files/AbCdEf123456GhIjKl7890/sync \
  -H "Authorization: Bearer $PLUGIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"fileName":"Sandbox","rootNodeId":"1:1","upserts":[
        {"nodeId":"1:1","nodeType":"FRAME","name":"Checkout","attrs":{"width":390},"contentHash":"h1"},
        {"nodeId":"1:2","nodeType":"FRAME","name":"Pay button","parentId":"1:1","path":["1:1"],"attrs":{"paddingLeft":16},"contentHash":"h2"}]}'
```

The rest of this guide works the same with
`https://www.figma.com/design/AbCdEf123456GhIjKl7890/Sandbox?node-id=1-1` as the
link.

</details>

## 3. Connect an agent

Install the checkout's dependencies once (the MCP server needs them; the CLI
needs nothing):

```bash
npm install
```

Replace `<your agent token>` below with the `agent` token from step 1, and
`<fileKey>` with the segment after `/design/` in your Figma link (optional — it
saves passing the file on every call).

**Claude Code** — run from the checkout's root:

```bash
claude mcp add rds --scope user --transport stdio \
  --env RDS_API_BASE_URL=http://localhost:8787 \
  --env RDS_AGENT_TOKEN=<your agent token> \
  --env RDS_FILE_KEY=<fileKey> \
  -- node "$PWD/apps/mcp/bin/rds-mcp.js"
```

**Cursor** — add to `~/.cursor/mcp.json`, with the absolute path of your
checkout:

```json
{
  "mcpServers": {
    "rds": {
      "command": "node",
      "args": ["/path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js"],
      "env": {
        "RDS_API_BASE_URL": "http://localhost:8787",
        "RDS_AGENT_TOKEN": "<your agent token>",
        "RDS_FILE_KEY": "<fileKey>"
      }
    }
  }
}
```

**CLI** — any agent with a shell, or you:

```bash
export RDS_API_BASE_URL=http://localhost:8787
export RDS_AGENT_TOKEN='<your agent token>'
export RDS_WORKER=claude-1
node scripts/rds-agent.js files ls --format table
```

`files ls` lists the file you synced. [docs/agents.md](agents.md) covers the
other hosts (including Devin), keeping the token in user-level config, and one
worker id per agent.

## 4. Open the portal

Open **[http://localhost:8787/ui](http://localhost:8787/ui)**, paste the
`viewer` token and press **Sign in**. **Files** lists what the plugin synced;
open a file for its node tree, work items, activity, claims and scopes. An
`agent` token signs in too, and can also block nodes and release claims.

![Files](images/portal-files.png)

## 5. Run the loop

Give the agent a link to the screen (in Figma: **Copy link to selection**). A
prompt as short as *"Implement the changes in this screen: `<link>`"* is enough
with the MCP server — its instructions teach the loop. These are the same steps
with the CLI:

```bash
LINK='https://www.figma.com/design/AbCdEf123456GhIjKl7890/Sandbox?node-id=1-1'
```

**List the work.** Changes grouped by component — build components first, then
the screen's own nodes:

```bash
node scripts/rds-agent.js work "$LINK" --expand instances --format outline
```

*Portal:* the file's **Work items** tab shows the same groups with their
progress, and the **Nodes** tab marks each node `Dirty` with what changed.

![Work items](images/portal-work-items.png)

**Claim.** Lease the nodes so parallel agents don't build the same thing:

```bash
node scripts/rds-agent.js claim "$LINK" --label "Checkout screen" --limit 20
```

*Portal:* the nodes show the worker's avatar, the **Activity** page logs
`claim.created`, and **Agents** lists who holds what — live, without a reload.

![Activity and agents](images/portal-activity.png)

**Build.** For each node, the agent reads its `changes` (`{ prop: { built, now } }`)
and pulls live design context for *that node only* through the Figma MCP. A node
it can't build yet gets blocked with a reason
(`node scripts/rds-agent.js block <nodeId> --file-key <fileKey> --reason "…"`), which
the portal shows as `Blocked`.

*Portal:* click a node to open its drawer: **Change List** has each changed
property from what was built to what the design says now, design tokens
included; **Change History** has its claims, clears and blocks.

![Change List](images/portal-node-changes.png)

**Clear.** After committing, clear the nodes with the `contentHash` the agent
read and the commit SHA:

```bash
node scripts/rds-agent.js nodes ls "$LINK" --claimed mine --worker "$RDS_WORKER" --fields nodeId,contentHash --all \
  | jq -r '.nodes[] | "\(.nodeId)=\(.contentHash)"' \
  | node scripts/rds-agent.js clear --url "$LINK" --commit-ref "$(git rev-parse --short HEAD)" -
```

(Run the clear in your app's repository, or pass its SHA; without `jq`, list the
pairs yourself: `clear --url "$LINK" --commit-ref <sha> 1:1=<hash> 1:2=<hash>`.)
A `stale` result means the design changed after the agent read it: read the
node again and redo it — never retry the old hash.

*Portal:* cleared nodes turn `Clean`, their claim is released, and the
`nodes.cleared` event names the commit. The next sync after a design edit makes
exactly the edited nodes dirty again.

```bash
node scripts/rds-agent.js nodes ls "$LINK" --format table     # 0 of 0 nodes
```

## 6. Going further: a team server

The Docker setup accepts requests addressed to `localhost` only. For a team, run
the same API against **Postgres** (with `ltree`; Supabase works) on any host
that runs a long-lived Node process, with named tokens per person and platform,
and point the plugin's `allowedDomains` at it.
[docs/setup.md](setup.md) walks through the migrations, tokens, hosting, the
portal's session secret, and every environment variable.
