import type { ReactNode } from 'react';
import { Card } from '../../components/Card';
import { CodeSnippet } from '../../components/CodeSnippet';
import { Tabs } from '../../components/Tabs';
import { AGENT_HOSTS, agentSetupSnippets, type AgentHost } from './snippets';

export interface AgentSetupProps {
  /** The API origin agents point at; this server's by default. */
  origin?: string;
  /** Pre-fills `RDS_FILE_KEY`. */
  fileKey?: string;
  defaultHost?: AgentHost;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** `Connect an agent`: host tabs with the exact setup for this server, the token left as a placeholder. */
export function AgentSetup({
  origin = window.location.origin,
  fileKey,
  defaultHost = 'claude-code',
  title = 'Connect an agent',
  description = 'The MCP server and the rds-agent CLI read the same two variables. Store the token in user-level config, never in a repo.',
  className,
}: AgentSetupProps) {
  const snippets = agentSetupSnippets(origin, fileKey);
  return (
    <Card className={className}>
      <Card.Header title={title} description={description} />
      <Card.Body className="px-3xl pb-3xl">
        <Tabs type="button-gray" size="sm" defaultSelectedKey={defaultHost} className="gap-lg">
          <Tabs.List aria-label="Agent host" items={AGENT_HOSTS}>
            {host => <Tabs.Tab id={host.id}>{host.label}</Tabs.Tab>}
          </Tabs.List>
          {AGENT_HOSTS.map(host => (
            <Tabs.Panel key={host.id} id={host.id}>
              <CodeSnippet code={snippets[host.id]} aria-label={`${host.label} setup`} />
            </Tabs.Panel>
          ))}
        </Tabs>
      </Card.Body>
    </Card>
  );
}
