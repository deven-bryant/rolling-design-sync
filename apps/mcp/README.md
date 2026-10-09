# @rolling-design-sync/mcp

A local (stdio) [MCP](https://modelcontextprotocol.io) server over the
[Rolling Design Sync](https://github.com/deven-bryant/rolling-design-sync)
**v3** API, so any MCP-capable coding agent (Claude Code, Cursor,
Windsurf, Devin, …) can list what changed in Figma since it was last built,
lease work, and clear implemented nodes without a bespoke CLI. It talks to
whatever API `RDS_API_BASE_URL` points at (self-hosted, `RDS_STORE=local`, or
hosted).

## How tools are discovered

The server has no hand-written tools. At startup it fetches
`${RDS_API_BASE_URL}/v3/openapi.json` and registers one tool per operation
annotated `x-rds-mcp: { tool: "<name>" }`:

- **Name** — the annotation's `tool`; **title** — the operation's `summary`;
  **description** — its `summary` and `description` (written for models).
- **Input schema** — the operation's path and query parameters plus the
  properties of its JSON body, with their JSON Schemas passed through as-is
  (a body that isn't an object, or whose properties collide with a parameter
  name, becomes one `body` input).
- **Calls** map the inputs back onto the HTTP request (path, query, body) with
  the agent token and `X-RDS-Client: mcp/<version>`. JSON responses are
  returned as JSON text; `format=ndjson|md` responses as the API's text.
- **Errors** come back as tool errors built from the v3 problem:
  `HTTP <status> <method> <path> — <title> (<code>): <detail>`, then the API's
  `Hint:` line (and `Valid parameters:` when it lists them). Inputs the tool
  doesn't take are rejected before any request is sent.

Operations without the annotation (the plugin routes, `openapi.json`) are
never exposed. If the API can't be reached, answers with something other than
an OpenAPI document, or lists no annotated operations, the server exits with a
message naming `RDS_API_BASE_URL` instead of starting with no tools.

**The tool set follows the connected server's version:** an older or newer
API simply yields a different set of tools, with that server's schemas and
descriptions. Nothing in this package needs to change when the API adds or
changes an operation.

### Figma links and defaults

- Every tool whose route takes `fileKey` / `nodeId` also takes a Figma link as
  `url` (`https://www.figma.com/design/<fileKey>/…?node-id=1-2`); the server
  then sends `-` for those path parameters and lets the API read the link, so
  `fileKey` and `nodeId` are optional there.
- Wherever a node id is expected (`nodeId`, `under`, `nodeIds[]`, including
  inside the body such as `clear_nodes` `items[].nodeId`), a Figma link with a
  `node-id` is accepted and turned into the node id; with no `fileKey` / `url`,
  the file key comes from those links (all must name the same file).
- Otherwise `fileKey` defaults to `RDS_FILE_KEY`.

## Tools (as of this API version)

The tools the current `apps/api` exposes (`GET /v3/openapi.json` is the source
of truth; a different server version may list more or fewer):

| Tool | Route | What it is for |
|------|-------|----------------|
| `list_files` | `GET /v3/files` | The tracked files. |
| `get_file` | `GET /v3/files/{fileKey}` | One file with its counts. |
| `list_scopes` | `GET /v3/files/{fileKey}/scopes` | The synced scopes (sections / frames) of a file. |
| `list_nodes` | `GET /v3/files/{fileKey}/nodes` | The work queue (dirty nodes by default) with each node's `changes`, `contentHash`, `claim` and `figmaUrl`; filters, `q`, `fields`, `cursor` paging, `format`. |
| `get_node` | `GET /v3/files/{fileKey}/nodes/{nodeId}` | One node with its `changes`, counts and history; re-read a `stale` node here. |
| `resolve_url` | `GET /v3/resolve` | A Figma link → `{ fileKey, nodeId }`. |
| `summarize` | `GET /v3/files/{fileKey}/summary` | Counts of what changed, by category, type and component. |
| `list_work_items` | `GET /v3/files/{fileKey}/work` | Changes grouped into work items (e.g. one per component). |
| `get_trends` | `GET /v3/insights/trends` | Nodes cleared and newly dirtied in the last `windowDays` days, per file and in total. |
| `claim_nodes` | `POST /v3/files/{fileKey}/claims` | Lease nodes (by `nodeIds` or `filter`) to a `worker`. |
| `renew_claim` | `POST /v3/files/{fileKey}/claims/{claimId}/renew` | Extend a lease. |
| `release_claim` | `DELETE /v3/files/{fileKey}/claims/{claimId}` | Hand back what a claim still holds. |
| `clear_nodes` | `POST /v3/files/{fileKey}/clear` | Bulk, hash-guarded clear of implemented nodes; each item `cleared`, `stale` or `not_found`. |
| `block_node` | `POST /v3/files/{fileKey}/nodes/{nodeId}/block` | Mark a node you can't implement, with a reason. |
| `unblock_node` | `POST /v3/files/{fileKey}/nodes/{nodeId}/unblock` | Undo a block. |
| `list_events` | `GET /v3/files/{fileKey}/events` | The file's activity log (syncs, clears, claims, blocks), paged with `after`. |

The pre-v3 tools `get_design_delta` and `clear_node` are gone; use
`list_nodes` (with `under`) / `claim_nodes` and `clear_nodes`.

The loop the server instructions teach the agent:

1. `list_nodes` for the screen or component being worked on (or `claim_nodes`
   when several agents share a file; `summarize` / `list_work_items` for an
   overview).
2. Implement each node's `changes` — what changed since it was built — mapping
   it to code via Code Connect / `figma.ts` mappings where present, and pulling
   live details for **that node only** from the Figma MCP via its `figmaUrl`.
3. `clear_nodes` with the `nodeId` + `contentHash` pairs it read and the commit
   SHA. On `stale`, re-read that node with `get_node` and implement the newer
   change; never retry the old hash. `block_node` what can't be implemented.

`nodeId` is a Figma node id such as `1:2`; the `1-2` form from a Figma link is
accepted too. The file key is the `<fileKey>` in `figma.com/design/<fileKey>/…`.

## Example session

```text
> list_nodes { "url": "https://www.figma.com/design/AbCdEf123456/App?node-id=2-1", "fields": "nodeId,name,changeType,changes,contentHash" }
{ "fileKey": "AbCdEf123456", "total": 2, "nextCursor": null, "nodes": [
  { "nodeId": "2:1", "name": "Card", "changeType": "modified", "contentHash": "9f…",
    "changes": { "paddingLeft": { "built": 12, "now": 16, "category": "layout" } } },
  { "nodeId": "2:5", "name": "Title", "changeType": "modified", "contentHash": "4c…",
    "changes": { "fontSize": { "built": 14, "now": 16, "category": "typography" } } } ] }

  … agent edits Card.tsx and Title.tsx, commits 1a2b3c4 …

> clear_nodes { "fileKey": "AbCdEf123456", "commitRef": "1a2b3c4",
                "items": [ { "nodeId": "2:1", "contentHash": "9f…" }, { "nodeId": "2:5", "contentHash": "4c…" } ] }
{ "fileKey": "AbCdEf123456", "totals": { "cleared": 1, "stale": 1, "notFound": 0 }, "results": [
  { "nodeId": "2:1", "status": "cleared", "contentHash": "9f…" },
  { "nodeId": "2:5", "status": "stale",   "contentHash": "7d…" } ] }

> get_node { "fileKey": "AbCdEf123456", "nodeId": "2:5", "fields": "changes,contentHash" }
{ "fileKey": "AbCdEf123456", "contentHash": "7d…",
  "changes": { "fontSize": { "built": 14, "now": 18, "category": "typography" } } }

  … agent updates Title.tsx, commits 5e6f7a8 …

> clear_nodes { "fileKey": "AbCdEf123456", "commitRef": "5e6f7a8", "items": [ { "nodeId": "2:5", "contentHash": "7d…" } ] }
{ "fileKey": "AbCdEf123456", "totals": { "cleared": 1, "stale": 0, "notFound": 0 }, "results": [ … ] }

> get_node { "fileKey": "AbCdEf123456", "nodeId": "9:9" }
HTTP 404 GET /v3/files/AbCdEf123456/nodes/9%3A9 — Node not found (node_not_found): …
Hint: …
```

## Environment

| Variable | Required | Meaning |
|----------|----------|---------|
| `RDS_API_BASE_URL` | yes | API origin, e.g. `http://127.0.0.1:8787`. |
| `RDS_AGENT_TOKEN` | yes | An agent token (`RDS_AGENT_TOKENS` on the API; `agent` in `tokens.json` for `RDS_STORE=local` — [docs/agents.md](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/agents.md#2-get-the-agent-token-once) shows how to copy it out). |
| `RDS_FILE_KEY` | no | Default `fileKey`, so single-file users needn't pass it on every call. |
| `RDS_MCP_DEFAULT_LIMIT` | no | Page size when a listing call omits `limit` (default 25); not applied to `format=outline`, which comes whole. |
| `RDS_MCP_MAX_RESULT_CHARS` | no | Tool-result size budget (default 50,000); larger results come back as smaller pages (an outline as fewer whole lines, via `limit`, with its `X-RDS-Next-Cursor` as the cursor). |

The server exits with a message naming the missing variable(s) if a required
one is unset, and with a message naming `RDS_API_BASE_URL` if the API can't be
reached at startup (it needs the API running to know its tools).

## Install

New to Rolling Design Sync? The [quickstart](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/quickstart.md) runs the
API, the Figma plugin and this server end to end.

From a checkout of the repository (Node 20+) — the supported path today:

```bash
npm install
```

The server entry point is `apps/mcp/bin/rds-mcp.js`. The npm package
(`npx @rolling-design-sync/mcp`, binary `rds-mcp`) is coming with the first
public release. Setup for **Claude Code, Cursor and Devin** — with the CLI
getting the same variables, and the agent token copied out of Docker — is in
[docs/agents.md](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/agents.md), along with the recipes. For other clients, replace `/path/to/rolling-design-sync`
with the absolute path of your checkout and fill in the env values. The token is
a secret — keep these configs out of version control (use your client's
user-level config).

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "rds": {
      "command": "node",
      "args": ["/path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js"],
      "env": {
        "RDS_API_BASE_URL": "http://127.0.0.1:8787",
        "RDS_AGENT_TOKEN": "<agent-token>",
        "RDS_FILE_KEY": "<fileKey>"
      }
    }
  }
}
```

### Other clients

Any client that launches stdio servers works: run
`node /path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js` with the env above.

## Local API note

With `RDS_STORE=local` or `memory`, the API only accepts a loopback `Host`
(`localhost`, `127.0.0.1`, `[::1]`, any port) and rejects browser `Origin`s.
Point `RDS_API_BASE_URL` at `http://localhost:<PORT>` or
`http://127.0.0.1:<PORT>` with the port the API is published on.

## Development

```bash
npm test -w @rolling-design-sync/mcp    # DB-free: memory-store API on a loopback port + in-memory / stdio MCP clients
npm run build -w @rolling-design-sync/mcp
```

## License

[Apache-2.0](LICENSE), like the rest of the repository except `apps/api`
(FSL-1.1-ALv2).
