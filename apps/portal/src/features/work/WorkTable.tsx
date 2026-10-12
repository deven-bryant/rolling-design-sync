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
  /** The scope (screen) node id; several comma-separated. */
  under?: string;
  /** The scope's name, for the card description (e.g. `the 2 selected scopes`). */
  scopeName?: string;
  /** How many scopes `scopeName` covers (plural wording). */
  scopeCount?: number;
  group: WorkGroup;
  /** The node search (see `WorkQuery.q`). */
  q?: string;
  /** `expand=instances` (default on). */
  expandInstances?: boolean;
  /** 1-based cursor page. */
  page: number;
  onPageChange: (page: number) => void;
  /** A row with a key was activated. */
  onOpenComponent: (key: string) => void;
  /** A removed item was activated: open the node drawer on its root (default: `onOpenComponent`). */
  onOpenRemoved?: (nodeId: string) => void;
  /** A library reference item (not tracked) was activated: show its placements (default: `onOpenComponent`). */
  onOpenPlacements?: (key: string) => void;
  pageSize?: number;
}

const CATEGORIES_SHOWN = 2;

const columns = (group: WorkGroup) =>
  group === 'component' ? ['Component', 'Placements', 'Nodes', 'Categories', 'Progress', 'Agent'] : ['Frame', 'Nodes', 'Categories', 'Progress', 'Agent'];

/** A library component the file doesn't track: placements only, nothing to build. */
export const isReference = (item: WorkItem): boolean => item.kind === 'library' && item.tracked === false;

/** The item is (in) a library component: a reference item, or a component / set item with a library key node. Never a frame item. */
export const isLibraryItem = (item: WorkItem, group: WorkGroup = 'component'): boolean =>
  item.kind === 'library' || (group !== 'frame' && item.key != null && item.library != null);

/**
 * `22 dirty` / `of 30 nodes`, or `Done` / `11 nodes cleared` once every node is clean; a removed item reads
 * `41 layers removed`, a reference item `Library · not tracked`.
 */
export function nodesSummary(item: WorkItem): { text: string; supporting?: string } {
  if (isReference(item)) return { text: 'Library · not tracked' };
  const total = item.progress?.total ?? item.nodeCount ?? 0;
  const clean = item.progress?.clean ?? 0;
  if (total > 0 && clean >= total) return { text: 'Done', supporting: `${plural(clean, 'node')} cleared` };
  if (item.kind === 'removed') return { text: `${plural(total, 'layer')} removed` };
  return { text: `${formatCount(total - clean)} dirty`, supporting: `of ${plural(total, 'node')}` };
}

function ItemBadges({ item, group }: { item: WorkItem; group: WorkGroup }) {
  const removed = item.kind === 'removed';
  const library = isLibraryItem(item, group);
  return (
    <>
      {removed && <Badge color="error">Removed</Badge>}
      {library && <Badge color="gray">Library</Badge>}
    </>
  );
}

/** The item's progress, 0–100: `clean / total`. */
export const itemProgress = (item: WorkItem): number => percent(item.progress?.clean ?? 0, item.progress?.total ?? 0);

function AgentColumn({ claim, now }: { claim: FileClaim | undefined; now: number }) {
  return (
    <Table.Cell>
      {claim?.worker ? (
        <AgentCell
          className="max-w-28"
          worker={claim.worker}
          when={claim.createdAt && `claimed ${timeAgo(claim.createdAt, now, 'short')}`}
        />
      ) : (
        <AgentCell className="max-w-28" worker="—" avatar={false} when="unclaimed" />
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
  onOpenRemoved = onOpenComponent,
  onOpenPlacements = onOpenComponent,
}: {
  item: WorkItem;
  group: WorkGroup;
  claims: readonly FileClaim[];
  now: number;
  onOpenComponent: (key: string) => void;
  onOpenRemoved?: (nodeId: string) => void;
  onOpenPlacements?: (key: string) => void;
}) {
  const { key } = item;
  const name = item.name ?? (key ? key : group === 'component' ? 'Not in a component' : 'Not in a frame');
  const nodes = nodesSummary(item);
  const removed = item.kind === 'removed';
  const reference = isReference(item);
  const open = removed ? onOpenRemoved : reference ? onOpenPlacements : onOpenComponent;
  return (
    <Table.Row aria-label={name} onAction={key ? () => open(key) : undefined}>
      <Table.Cell>
        <NodeCell
          className="max-w-60"
          name={name}
          meta={key ? `${item.type ?? 'NODE'} · ${key}` : undefined}
          badges={removed || isLibraryItem(item, group) ? <ItemBadges item={item} group={group} /> : undefined}
        />
      </Table.Cell>
      {group === 'component' &&
        (key && !removed ? (
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
      {reference ? (
        <TextCell className="min-w-32">—</TextCell>
      ) : (
        <ProgressCell className="min-w-32" value={itemProgress(item)} label={`${name} progress`} />
      )}
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
  scopeCount = 1,
  group,
  q,
  expandInstances,
  page,
  onPageChange,
  onOpenComponent,
  onOpenRemoved,
  onOpenPlacements,
  pageSize,
  className,
  ...rest
}: WorkTableProps) {
  useWorkLive(fileKey);
  const work = useWorkItems({ fileKey, under, group, q, expandInstances, pageSize, page });
  const claims = useFileClaims(fileKey);
  const now = useNow();
  const heads = columns(group);
  const scope = scopeName ?? 'this screen';
  const description =
    group === 'component'
      ? `Components ${scope} ${scopeCount > 1 ? 'use' : 'uses'}. Build leaves first, then the composites that contain them.`
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
                onOpenRemoved={onOpenRemoved}
                onOpenPlacements={onOpenPlacements}
              />
            ))}
          </Table.Body>
        </Table>
      </Card.Body>
      {(page > 1 || work.hasNext) && <Pagination page={page} hasNext={work.hasNext} onPageChange={onPageChange} label="Work items pages" />}
    </Card>
  );
}
