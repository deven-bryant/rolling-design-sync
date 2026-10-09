import type { HTMLAttributes, ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Pagination } from '../../components/Pagination';
import { Text } from '../../components/primitives';
import { ProgressCell, Table, TextCell } from '../../components/Table';
import { AgentCell } from '../../components/domain/AgentCell';
import { CategoryBadges } from '../../components/domain/CategoryBadges';
import { NodeCell } from '../../components/domain/NodeCell';
import { useFileClaims } from '../../api/hooks/useFileClaims';
import { useNow } from '../../api/hooks/useNow';
import { formatCount, percent, plural, timeAgo } from '../files';
import { itemClaim, useWorkItems, useWorkLive, type FileClaim, type WorkGroup, type WorkItem } from './api';

export interface WorkTableProps extends HTMLAttributes<HTMLDivElement> {
  fileKey: string;
  /** The scope (screen) node id. */
  under?: string;
  /** The scope's name, for the card description. */
  scopeName?: string;
  group: WorkGroup;
  /** 1-based cursor page. */
  page: number;
  onPageChange: (page: number) => void;
  /** A row with a key was activated. */
  onOpenComponent: (key: string) => void;
  pageSize?: number;
}

const CATEGORIES_SHOWN = 2;

const columns = (group: WorkGroup) =>
  group === 'component' ? ['Component', 'Placements', 'Nodes', 'Categories', 'Progress', 'Agent'] : ['Frame', 'Nodes', 'Categories', 'Progress', 'Agent'];

/** `22 dirty` / `of 30 nodes`, or `Done` / `11 nodes cleared` once every node is clean. */
export function nodesSummary(item: WorkItem): { text: string; supporting: string } {
  const total = item.progress?.total ?? item.nodeCount ?? 0;
  const clean = item.progress?.clean ?? 0;
  if (total > 0 && clean >= total) return { text: 'Done', supporting: `${plural(clean, 'node')} cleared` };
  return { text: `${formatCount(total - clean)} dirty`, supporting: `of ${plural(total, 'node')}` };
}

/** The item's progress, 0–100: `clean / total`. */
export const itemProgress = (item: WorkItem): number => percent(item.progress?.clean ?? 0, item.progress?.total ?? 0);

function AgentColumn({ claim, now }: { claim: FileClaim | undefined; now: number }) {
  return (
    <Table.Cell>
      {claim?.worker ? (
        <AgentCell worker={claim.worker} when={claim.createdAt && `claimed ${timeAgo(claim.createdAt, now, 'short')}`} />
      ) : (
        <AgentCell worker="—" avatar={false} when="unclaimed" />
      )}
    </Table.Cell>
  );
}

function WorkRow({
  item,
  group,
  claims,
  now,
  onOpenComponent,
}: {
  item: WorkItem;
  group: WorkGroup;
  claims: readonly FileClaim[];
  now: number;
  onOpenComponent: (key: string) => void;
}) {
  const { key } = item;
  const name = item.name ?? (key ? key : group === 'component' ? 'Not in a component' : 'Not in a frame');
  const nodes = nodesSummary(item);
  return (
    <Table.Row aria-label={name} onAction={key ? () => onOpenComponent(key) : undefined}>
      <Table.Cell>
        <NodeCell name={name} meta={key ? `${item.type ?? 'NODE'} · ${key}` : undefined} />
      </Table.Cell>
      {group === 'component' &&
        (key ? (
          <TextCell supportingText={`${formatCount(item.placements ?? 0)} in file`}>
            {formatCount(item.placementsInScope ?? 0)} in this screen
          </TextCell>
        ) : (
          <TextCell>—</TextCell>
        ))}
      <TextCell supportingText={nodes.supporting}>{nodes.text}</TextCell>
      <Table.Cell>
        <CategoryBadges categories={item.categories ?? []} max={CATEGORIES_SHOWN} />
      </Table.Cell>
      <ProgressCell className="min-w-40" value={itemProgress(item)} label={`${name} progress`} />
      <AgentColumn claim={itemClaim(item, claims)} now={now} />
    </Table.Row>
  );
}

function MessageRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <Table.Row>
      <Table.Cell colSpan={span}>
        <Text color="tertiary">{children}</Text>
      </Table.Cell>
    </Table.Row>
  );
}

/** The Work items card: `GET …/work` for the scope, one cursor page, live from the file's event stream. */
export function WorkTable({
  fileKey,
  under,
  scopeName,
  group,
  page,
  onPageChange,
  onOpenComponent,
  pageSize,
  className,
  ...rest
}: WorkTableProps) {
  useWorkLive(fileKey);
  const work = useWorkItems({ fileKey, under, group, pageSize, page });
  const claims = useFileClaims(fileKey);
  const now = useNow();
  const heads = columns(group);
  const scope = scopeName ?? 'this screen';
  const description =
    group === 'component'
      ? `Components ${scope} uses. Build leaves first, then the composites that contain them.`
      : `Frames in ${scope}, in layer order.`;
  return (
    <Card {...rest} className={className}>
      <Card.Header
        title="Work items"
        badge={work.total !== undefined && <Badge color="brand">{plural(work.total, group)}</Badge>}
        description={description}
      />
      <Card.Body>
        <Table aria-label="Work items">
          <Table.Header>
            {heads.map(head => (
              <Table.HeaderCell key={head}>{head}</Table.HeaderCell>
            ))}
          </Table.Header>
          <Table.Body>
            {work.isPageLoading && <MessageRow span={heads.length}>Loading work items…</MessageRow>}
            {work.isError && <MessageRow span={heads.length}>Couldn&apos;t load work items.</MessageRow>}
            {!work.isPageLoading && !work.isError && work.items.length === 0 && (
              <MessageRow span={heads.length}>No work items here.</MessageRow>
            )}
            {work.items.map((item, i) => (
              <WorkRow
                key={item.key ?? `none-${i}`}
                item={item}
                group={group}
                claims={claims.data?.claims ?? []}
                now={now}
                onOpenComponent={onOpenComponent}
              />
            ))}
          </Table.Body>
        </Table>
      </Card.Body>
      {(page > 1 || work.hasNext) && <Pagination page={page} hasNext={work.hasNext} onPageChange={onPageChange} label="Work items pages" />}
    </Card>
  );
}
