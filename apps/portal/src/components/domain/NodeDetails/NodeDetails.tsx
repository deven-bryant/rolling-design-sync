import { useId, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Badge } from '../../Badge';
import { Card } from '../../Card';
import { Feed, FeedItem } from '../../FeedItem';
import { Pagination } from '../../Pagination';
import { cx, Text, VisuallyHidden } from '../../primitives';
import { SectionHeader } from '../../SectionHeader';
import { Table, TextCell } from '../../Table';
import { Tabs } from '../../Tabs';

/** Figma `State`: which tab is showing. */
export type NodeDetailsState = 'change-list' | 'change-history';

/** One side of a change: the token (or raw value) and, under it, the raw value. */
export interface NodeDetailsValue {
  value: ReactNode;
  detail?: ReactNode;
}

/** One `Change List` row. */
export interface NodeDetailsChange {
  attribute: string;
  from: NodeDetailsValue;
  to: NodeDetailsValue;
}

/** One `Change History` feed item. */
export interface NodeDetailsEvent {
  id: string | number;
  /** `<Avatar size="lg" />`. */
  avatar: ReactNode;
  name: ReactNode;
  time: ReactNode;
  dateTime?: string;
  /** What happened. */
  children: ReactNode;
}

export interface NodeDetailsProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Figma `State`, controlled; pair with `onStateChange`. */
  state?: NodeDetailsState;
  /** The initial `state` when uncontrolled. */
  defaultState?: NodeDetailsState;
  onStateChange?: (state: NodeDetailsState) => void;
  /** Header `Text`: the node's name. */
  title: ReactNode;
  /** Header `Supporting Content`: type, id, main component. */
  description?: ReactNode;
  /** Header `Actions` (e.g. the drawer's close button). */
  actions?: ReactNode;
  /** `Status`: the node's badges, named by a visually hidden `Status` label. */
  status?: ReactNode;
  /** Content under the status row (a block notice, the block form). */
  children?: ReactNode;
  /** `Section / Claim` title. */
  claimTitle?: ReactNode;
  /** `Section / Claim` subtitle: who holds the claim, or that nobody does. */
  claimSubtitle: ReactNode;
  /** A second claim line (label, other nodes covered). */
  claimNote?: ReactNode;
  /** The claim's button (`Release claim`). */
  claimAction?: ReactNode;
  /** Content under the claim row (a confirmation, an error). */
  claimContent?: ReactNode;
  /** `Change List` rows. */
  changes: readonly NodeDetailsChange[];
  /** `Change List` card `Supporting text`. */
  changesDescription?: ReactNode;
  /** `Change List` card `Dropdown icon` slot (a `<Menu>`). */
  changesMenu?: ReactNode;
  /** Shown in the card instead of the table when there are no rows. */
  changesEmpty?: ReactNode;
  /** Rows per table page. */
  pageSize?: number;
  /** The change list's pagination landmark name; make it unique when a page shows more than one `NodeDetails`. */
  paginationLabel?: string;
  /** `Change History` feed items, newest first. */
  history: readonly NodeDetailsEvent[];
  /** Shown instead of the feed when there are no items (loading, error, empty). */
  historyEmpty?: ReactNode;
  ref?: Ref<HTMLElement>;
}

const changeCount = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

function ChangeList({
  changes,
  description,
  menu,
  empty,
  pageSize,
  paginationLabel,
}: {
  changes: readonly NodeDetailsChange[];
  description?: ReactNode;
  menu?: ReactNode;
  empty?: ReactNode;
  pageSize: number;
  paginationLabel: string;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(changes.length / pageSize));
  const current = Math.min(page, pageCount);
  const rows = changes.slice((current - 1) * pageSize, current * pageSize);
  return (
    <Card>
      <Card.Header
        title="Change List"
        headingLevel={3}
        badge={<Badge color="brand">{changeCount(changes.length)}</Badge>}
        description={description}
        menu={menu}
      />
      {changes.length ? (
        <>
          <div className="overflow-x-auto">
            <Table aria-label="Change list">
              <Table.Header>
                <Table.HeaderCell className="w-0 bg-secondary">Attribute</Table.HeaderCell>
                <Table.HeaderCell className="bg-secondary">From</Table.HeaderCell>
                <Table.HeaderCell className="bg-secondary">To</Table.HeaderCell>
              </Table.Header>
              <Table.Body>
                {rows.map(change => (
                  <Table.Row key={change.attribute}>
                    <TextCell className="whitespace-nowrap">{change.attribute}</TextCell>
                    <TextCell supportingText={change.from.detail}>{change.from.value}</TextCell>
                    <TextCell supportingText={change.to.detail}>{change.to.value}</TextCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
          <Pagination label={paginationLabel} page={current} pageCount={pageCount} onPageChange={setPage} />
        </>
      ) : (
        <Card.Body className="px-3xl py-xl">
          <Text color="tertiary">{empty}</Text>
        </Card.Body>
      )}
    </Card>
  );
}

/**
 * Figma `Node Details` (`State=Change List` · `State=Change History`): a node's header, status badges and
 * claim, then its changes as a table or its history as a feed, switched by `button-gray` tabs. It fills its
 * container; status, claim text and table columns hug, and the claim row is space-between (`gap-4xl`, or
 * `gap-6xl` in `Change History`).
 */
export function NodeDetails({
  state,
  defaultState = 'change-list',
  onStateChange,
  title,
  description,
  actions,
  status,
  children,
  claimTitle = 'Claim Holder',
  claimSubtitle,
  claimNote,
  claimAction,
  claimContent,
  changes,
  changesDescription,
  changesMenu,
  changesEmpty = 'Nothing changed.',
  pageSize = 10,
  paginationLabel = 'Change list pages',
  history,
  historyEmpty = 'No history yet.',
  className,
  ref,
  ...rest
}: NodeDetailsProps) {
  const statusId = useId();
  const claimId = useId();
  const [uncontrolledState, setUncontrolledState] = useState(defaultState);
  const current = state ?? uncontrolledState;
  const compact = current === 'change-history';
  return (
    <article ref={ref} {...rest} data-state={current} className={cx('flex w-full flex-col gap-4xl bg-primary', className)}>
      <SectionHeader>
        <SectionHeader.Title>{title}</SectionHeader.Title>
        {description != null && <SectionHeader.SupportingContent>{description}</SectionHeader.SupportingContent>}
        {actions != null && <SectionHeader.Actions>{actions}</SectionHeader.Actions>}
      </SectionHeader>
      {status != null && (
        <div className="flex items-center gap-lg py-xxs">
          <VisuallyHidden id={statusId}>Status</VisuallyHidden>
          <div aria-labelledby={statusId} role="group" className="flex flex-wrap items-center gap-md">
            {status}
          </div>
        </div>
      )}
      {children}
      <div role="group" aria-labelledby={claimId} className="flex flex-col gap-lg">
        <div className={cx('flex items-start justify-between', compact ? 'gap-6xl' : 'gap-4xl')}>
          <div className="flex min-w-0 flex-col gap-md">
            <Text as="h3" id={claimId} size="lg" weight="semibold">
              {claimTitle}
            </Text>
            <div className="flex flex-col">
              <Text as="p" color="tertiary">
                {claimSubtitle}
              </Text>
              {claimNote != null && (
                <Text as="p" color="tertiary">
                  {claimNote}
                </Text>
              )}
            </div>
          </div>
          {claimAction}
        </div>
        {claimContent}
      </div>
      <Tabs
        type="button-gray"
        size="md"
        className="gap-lg"
        selectedKey={current}
        onSelectionChange={key => {
          setUncontrolledState(key as NodeDetailsState);
          onStateChange?.(key as NodeDetailsState);
        }}
      >
        <Tabs.List aria-label="Node details" className="px-xs">
          <Tabs.Tab id="change-list">Change List</Tabs.Tab>
          <Tabs.Tab id="change-history">Change History</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="change-list" className="px-md">
          <ChangeList changes={changes} description={changesDescription} menu={changesMenu} empty={changesEmpty} pageSize={pageSize} paginationLabel={paginationLabel} />
        </Tabs.Panel>
        <Tabs.Panel id="change-history" className="px-md">
          {history.length ? (
            <Feed divider="none" aria-label="Change history" className="w-fit max-w-full">
              {history.map(({ id, children: what, ...item }) => (
                <FeedItem key={id} {...item}>
                  {what}
                </FeedItem>
              ))}
            </Feed>
          ) : (
            <Text as="p" color="tertiary">
              {historyEmpty}
            </Text>
          )}
        </Tabs.Panel>
      </Tabs>
    </article>
  );
}
