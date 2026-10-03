/** Stands in for the agent token in every snippet; the portal never knows or shows a token value. */
export const TOKEN_PLACEHOLDER = '<your agent token>';

export type AgentHost = 'claude-code' | 'cursor' | 'devin' | 'cli';

export const AGENT_HOSTS: { id: AgentHost; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'devin', label: 'Devin' },
  { id: 'cli', label: 'CLI' },
];

/** The setup for each host, as in docs/agents.md, pointed at `origin`. */
export function agentSetupSnippets(origin: string, fileKey = '<fileKey>'): Record<AgentHost, string> {
  return {
    'claude-code': [
      'claude mcp add rds --scope user --transport stdio \\',
      `  --env RDS_API_BASE_URL=${origin} \\`,
      `  --env RDS_AGENT_TOKEN=${TOKEN_PLACEHOLDER} \\`,
      `  --env RDS_FILE_KEY=${fileKey} \\`,
      '  -- node "$PWD/apps/mcp/bin/rds-mcp.js"',
    ].join('\n'),
    cursor: JSON.stringify(
      {
        mcpServers: {
          rds: {
            command: 'node',
            args: ['/path/to/rolling-design-sync/apps/mcp/bin/rds-mcp.js'],
            env: { RDS_API_BASE_URL: origin, RDS_AGENT_TOKEN: TOKEN_PLACEHOLDER, RDS_FILE_KEY: fileKey },
          },
        },
      },
      null,
      2,
    ),
    devin: [
      '# Devin secrets (repository, user or organization scope)',
      `RDS_API_BASE_URL=${origin}`,
      `RDS_AGENT_TOKEN=${TOKEN_PLACEHOLDER}`,
      '',
      '# Optional: custom MCP server, transport STDIO',
      'command: node',
      "args:    <repo path on Devin's machine>/apps/mcp/bin/rds-mcp.js",
      `env:     RDS_API_BASE_URL, RDS_AGENT_TOKEN, RDS_FILE_KEY=${fileKey}`,
    ].join('\n'),
    cli: [
      `export RDS_API_BASE_URL=${origin}`,
      `export RDS_AGENT_TOKEN='${TOKEN_PLACEHOLDER}'`,
      'export RDS_WORKER=<worker id>',
      'node scripts/rds-agent.js files ls',
    ].join('\n'),
  };
}
