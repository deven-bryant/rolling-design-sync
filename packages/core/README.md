# @rolling-design-sync/core

The pure diff core of [Rolling Design Sync](https://github.com/deven-bryant/rolling-design-sync),
a per-node design-implementation ledger for Figma: normalization, content
hashing, property-level diffs, change categories and Figma link helpers. The
Figma plugin and the API share it, so a node hashes the same in both places.

It has no Figma, browser or Node runtime dependencies (it uses `node:crypto`
when available and a pure-JS SHA-256 otherwise) and no network access.

**Most users want one of these instead:**

- [`@rolling-design-sync/mcp`](https://www.npmjs.com/package/@rolling-design-sync/mcp) —
  the MCP server that gives Claude Code, Cursor and other agents the queue.
- [`@rolling-design-sync/agent-cli`](https://www.npmjs.com/package/@rolling-design-sync/agent-cli) —
  the `rds-agent` CLI for agents with a shell.

Install this package directly only to build your own tooling on the same hashes
and diffs:

```bash
npm install @rolling-design-sync/core
```

```js
const core = require('@rolling-design-sync/core');

core.contentHash({ paddingLeft: 16 });              // stable hash of normalized attrs
core.parseFigmaUrl('https://www.figma.com/design/AbCdEf123456GhIjKl7890/App?node-id=2-1');
// { fileKey: 'AbCdEf123456GhIjKl7890', nodeId: '2:1' }
core.diffAttrs({ paddingLeft: 16 }, { paddingLeft: 24 }).changes;
// { paddingLeft: { built: 16, now: 24, category: 'layout' } }
```

| Export | What it does |
|---|---|
| `normalize`, `stable` | Canonical form of a value (sorted keys, rounded numbers) and its JSON. |
| `contentHash`, `sha256` | The node hash the plugin uploads and the API compares. |
| `diffAttrs` | Property-level diff of built vs. current attrs, with design-token names. |
| `categoryOf`, `CATEGORY_RULES` | Which change category (`layout`, `color`, `typography`, …, `token` for a design token's `value:<Mode>`) a property belongs to. |
| `isTokenNodeId`, `TOKENS_ROOT_ID` | Whether a node id is a design-token node (`tokens`, `tokens:<collectionKey>`, `token:<variableKey>`). |
| `parseFigmaUrl`, `fileKey`, `normalizeNodeId`, `link` | Figma links ↔ file keys and node ids. |

The API (`/v3`) and its data model are documented in the
[repository](https://github.com/deven-bryant/rolling-design-sync); which
package versions work with which API is in its
[compatibility policy](https://github.com/deven-bryant/rolling-design-sync/blob/main/docs/compatibility.md).

## License

[Apache-2.0](LICENSE).
