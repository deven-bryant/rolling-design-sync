/** Stands in for the agent token in every snippet; the portal never knows or shows a token value. */
export const TOKEN_PLACEHOLDER = '<your agent token>';

/** The MCP server `docker compose up -d` runs next to a local API (compose.yaml). */
export const LOCAL_MCP_URL = 'http://localhost:8788/mcp';

export type AgentHost = 'claude-code' | 'cursor' | 'devin' | 'cli';

export const AGENT_HOSTS: { id: AgentHost; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'devin', label: 'Devin' },
  { id: 'cli', label: 'CLI' },
];

/** `origin` is this machine (the Docker setup), so agents use its tokenless MCP server. */
export function isLocalOrigin(origin: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const devin = (apiUrl: string) =>
  [
    '# Devin secrets (repository, user or organization scope)',
    `RDS_API_BASE_URL=${apiUrl}`,
    `RDS_AGENT_TOKEN=${TOKEN_PLACEHOLDER}`,
    '',
    '# Optional: custom MCP server, transport STDIO',
    'command: node',
    "args:    <repo path on Devin's machine>/apps/mcp/bin/rds-mcp.js",
    'env:     RDS_API_BASE_URL, RDS_AGENT_TOKEN',
  ].join('\n');

/**
 * The setup for each host, as in docs/agents.md, pointed at `origin`. A local origin gets the Docker setup's
 * MCP server (no token); any other gets the stdio server with the API's URL and an agent token.
 */
export function agentSetupSnippets(origin: string): Record<AgentHost, string> {
  if (isLocalOrigin(origin))
    return {
      'claude-code': [
        '# In your rolling-design-sync checkout, its .mcp.json already connects Claude Code.',
        '# From any other project:',
        `claude mcp add rds --scope user --transport http ${LOCAL_MCP_URL}`,
      ].join('\n'),
      cursor: JSON.stringify({ mcpServers: { rds: { url: LOCAL_MCP_URL } } }, null, 2),
      devin: ["# Devin runs in the cloud and can't reach this machine. Give it a team API it can reach:", devin('https://<your team API>')].join('\n'),
      cli: [
        '# From your rolling-design-sync checkout: no token or variables needed',
        'docker compose exec api rds-agent files ls',
      ].join('\n'),
    };
  return {
    'claude-code': [
      'claude mcp add rds --scope user --transport stdio \\',
      `  --env RDS_API_BASE_URL=${origin} \\`,
      `  --env RDS_AGENT_TOKEN=${TOKEN_PLACEHOLDER} \\`,
      '  -- node "$PWD/apps/mcp/bin/rds-mcp.js"',
    ].join('\n'),
    cursor: JSON.stringify(
      {
        mcpServers: {
          rds: {
            command: 'node',
            args: ['/path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js'],
            env: { RDS_API_BASE_URL: origin, RDS_AGENT_TOKEN: TOKEN_PLACEHOLDER },
          },
        },
      },
      null,
      2,
    ),
    devin: devin(origin),
    cli: [
      `export RDS_API_BASE_URL=${origin}`,
      `export RDS_AGENT_TOKEN='${TOKEN_PLACEHOLDER}'`,
      'export RDS_WORKER=<worker id>',
      'node scripts/rds-agent.js files ls',
    ].join('\n'),
  };
}
