import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, type ApiResponse } from '../../api/client';
import { Badge, type BadgeProps } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Text } from '../../components/primitives';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { BadgeCell, Table, TextCell } from '../../components/Table';
import { useNow } from '../../api/hooks/useNow';
import { relativeTime } from '../activity/time';

export type TokenInfo = ApiResponse<'/v3/tokens'>[number];
type TokenClass = NonNullable<TokenInfo['class']>;

export const tokenClasses: Record<TokenClass, { label: string; color: BadgeProps['color']; can: string; scope: string; env: string }> = {
  plugin: { label: 'Plugin', color: 'blue', can: 'Upload syncs', scope: 'hashes, sync, exists', env: 'RDS_PLUGIN_TOKENS' },
  agent: { label: 'Agent', color: 'brand', can: 'Read, claim, clear, block', scope: 'every v3 agent route', env: 'RDS_AGENT_TOKENS' },
  viewer: { label: 'Viewer', color: 'gray', can: 'Read only', scope: 'every v3 GET, events', env: 'RDS_VIEWER_TOKENS' },
};

/** `Tokens`: the configured token classes and labels with their last use — never a token value. */
export function TokensTable({
  title = 'Tokens',
  description = 'Configured on the server (RDS_*_TOKENS). The portal shows labels and last use only — never token values.',
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: ({ signal }) => api.get('/v3/tokens', { signal }) });
  const now = useNow(30_000);
  const rows = tokens.data ?? [];
  const classes = new Set(rows.map(t => t.class)).size;
  const seen = new Map<string, number>();

  return (
    <Card className={className}>
      <Card.Header
        title={title}
        badge={<Badge color="brand">{`${classes} ${classes === 1 ? 'class' : 'classes'}`}</Badge>}
        description={description}
      />
      <Card.Body>
        {tokens.isPending ? (
          <LoadingIndicator size="md" label="Loading tokens…" className="px-3xl py-xl" />
        ) : tokens.error ? (
          <Text as="p" color="error-primary" className="px-3xl py-xl">
            Couldn’t load tokens: {tokens.error.message}
          </Text>
        ) : (
          <Table aria-label="Tokens">
            <Table.Header>
              <Table.HeaderCell>Class</Table.HeaderCell>
              <Table.HeaderCell>Label</Table.HeaderCell>
              <Table.HeaderCell>Can</Table.HeaderCell>
              <Table.HeaderCell>Last used</Table.HeaderCell>
            </Table.Header>
            <Table.Body>
              {rows.map((token, i) => {
                const info = token.class ? tokenClasses[token.class] : undefined;
                const index = (seen.get(token.class ?? '') ?? 0) + 1;
                seen.set(token.class ?? '', index);
                return (
                  <Table.Row key={`${token.class}:${token.label}:${i}`}>
                    <BadgeCell>
                      <Badge color={info?.color ?? 'gray'}>{info?.label ?? token.class ?? 'Unknown'}</Badge>
                    </BadgeCell>
                    <TextCell supportingText={info ? `${info.env} #${index}` : undefined}>{token.label ?? '—'}</TextCell>
                    <TextCell supportingText={info?.scope}>{info?.can ?? '—'}</TextCell>
                    <TextCell>{token.lastUsedAt ? relativeTime(token.lastUsedAt, now) : 'Never'}</TextCell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
}
