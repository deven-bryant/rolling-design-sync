import type { ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AgentCell } from '../../components/domain/AgentCell';
import { Text, VisuallyHidden } from '../../components/primitives';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { Table, TextCell } from '../../components/Table';
import { useClaims } from '../../api/hooks/useClaims';
import { useNow } from '../../api/hooks/useNow';
import { leaseLeft, relativeTime } from './time';
import { groupByWorker, useCanRelease, useClaimsLive, useReleaseClaim, type Claim, type WorkerClaims } from './useClaims';

export interface ClaimsPanelProps {
  /** Only this file's claims. */
  fileKey?: string;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
}

const nodes = (n: number) => `${n} ${n === 1 ? 'node' : 'nodes'}`;
const firstAndMore = (first: string | undefined, total: number) => (first === undefined ? '' : total > 1 ? `${first}, +${total - 1}` : first);
/** `Table, +3 · Checkout`: the first named node and the first file, each with how many more. */
const holdingText = (group: WorkerClaims) => {
  const first = group.nodes[0];
  const node = first ? firstAndMore(first.name ?? first.nodeId, Math.max(group.nodeCount, 1)) : '';
  return [node, firstAndMore(group.fileNames[0], group.fileNames.length)].filter(Boolean).join(' · ');
};

/** `Agents`: who holds which nodes across files, with live lease countdowns and per-claim Release. */
export function ClaimsPanel({
  fileKey,
  title = 'Agents',
  description = 'Who holds which nodes, and when each lease runs out',
  className,
}: ClaimsPanelProps) {
  const claims = useClaims();
  useClaimsLive();
  const canRelease = useCanRelease();
  const release = useReleaseClaim();
  const now = useNow(1000);
  const live = (claims.data ?? []).filter(
    c => (!fileKey || c.fileKey === fileKey) && (!c.expiresAt || Date.parse(c.expiresAt) > now),
  );
  const workers = groupByWorker(live);

  const releaseName = (claim: Claim) => `Release ${claim.label ?? claim.claimId ?? 'claim'} (${nodes(claim.nodeCount ?? 0)})`;

  return (
    <Card className={className}>
      <Card.Header title={title} badge={<Badge color="brand">{workers.length} active</Badge>} description={description} />
      <Card.Body>
        {claims.isPending ? (
          <LoadingIndicator size="md" label="Loading claims…" className="px-3xl py-xl" />
        ) : claims.error ? (
          <Text as="p" color="error-primary" className="px-3xl py-xl">
            Couldn’t load claims: {claims.error.message}
          </Text>
        ) : workers.length === 0 ? (
          <Text as="p" color="tertiary" className="px-3xl py-xl">
            No agent holds nodes right now.
          </Text>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Agents">
              <Table.Header>
                <Table.HeaderCell>Agent</Table.HeaderCell>
                <Table.HeaderCell>Holding</Table.HeaderCell>
                <Table.HeaderCell>Lease</Table.HeaderCell>
                {canRelease && (
                  <Table.HeaderCell>
                    <VisuallyHidden>Release</VisuallyHidden>
                  </Table.HeaderCell>
                )}
              </Table.Header>
              <Table.Body>
                {workers.map(group => {
                  const soonest = group.claims[0];
                  return (
                    <Table.Row key={group.worker}>
                      <Table.Cell>
                        <AgentCell worker={group.worker} when={group.label ?? undefined} />
                      </Table.Cell>
                      <TextCell supportingText={holdingText(group)}>{nodes(group.nodeCount)}</TextCell>
                      <TextCell supportingText={soonest?.createdAt ? `claimed ${relativeTime(soonest.createdAt, now).toLowerCase()}` : 'no lease'}>
                        {soonest?.expiresAt ? leaseLeft(soonest.expiresAt, now) : '—'}
                      </TextCell>
                      {canRelease && (
                        <Table.Cell>
                          <div className="flex flex-col items-end gap-xs">
                            {group.claims.map(claim => (
                              <Button
                                key={claim.claimId}
                                hierarchy="secondary"
                                size="sm"
                                aria-label={releaseName(claim)}
                                loading={release.isPending && release.variables?.claimId === claim.claimId}
                                onPress={() => release.mutate(claim)}
                              >
                                Release
                              </Button>
                            ))}
                          </div>
                        </Table.Cell>
                      )}
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
