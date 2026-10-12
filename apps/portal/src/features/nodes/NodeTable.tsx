import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { buildUrl } from '../../api/client';
import { useFileClaims } from '../../api/hooks/useFileClaims';
import { useNow } from '../../api/hooks/useNow';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AgentCell } from '../../components/domain/AgentCell';
import { CategoryBadges } from '../../components/domain/CategoryBadges';
import { ChangeBadge } from '../../components/domain/ChangeBadge';
import { NodeCell } from '../../components/domain/NodeCell';
import { StateBadge } from '../../components/domain/StateBadge';
import { Input } from '../../components/Input';
import { Menu } from '../../components/Menu';
import { Pagination } from '../../components/Pagination';
import { Select, SelectItem } from '../../components/Select';
import { Table, TextCell } from '../../components/Table';
import { Toggle } from '../../components/Toggle';
import { cx, Icon, Text } from '../../components/primitives';
import { CATEGORIES, categoriesOf, type Category } from './categories';
import { nodeMeta, timeAgo, whatChanged } from './format';
import { useNodeLiveUpdates, type NodeLiveUpdates } from './live';
import { filterParams, nodePageParams, PAGE_SIZE, splitUnder, useChildNodes, useFile, useNodePage, useScope } from './queries';
import type { ChangeFilter, FileClaim, NodeFilters, NodeItem, StateFilter } from './types';

/** How long the search box waits after typing before it updates the filters. */
export const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS = [
  { id: 'state', label: 'State', width: 'w-25' },
  { id: 'change', label: 'Change', width: 'w-28' },
  { id: 'categories', label: 'Categories', width: 'w-43' },
  { id: 'changed', label: 'What changed', width: 'w-45' },
  { id: 'agent', label: 'Agent', width: 'w-45' },
] as const;
export type NodeColumn = (typeof COLUMNS)[number]['id'];

const STATE_OPTIONS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'dirty', label: 'Dirty' },
  { id: 'clean', label: 'Clean' },
  { id: 'blocked', label: 'Blocked' },
];
const CHANGE_OPTIONS: { id: ChangeFilter | 'any'; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'added', label: 'Added' },
  { id: 'modified', label: 'Modified' },
  { id: 'deleted', label: 'Deleted' },
];
const CATEGORY_OPTIONS: { id: Category | 'any'; label: string }[] = [{ id: 'any', label: 'Any' }, ...CATEGORIES.map(c => ({ id: c, label: c }))];
const NODE_TYPES = [
  'FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'TEXT', 'RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR', 'BOOLEAN_OPERATION',
];
const TYPE_OPTIONS = [{ id: 'any', label: 'Any' }, ...NODE_TYPES.map(t => ({ id: t, label: t }))];

/** The closed select reads `State: All`; the open list just `All`. */
function Prefixed({ prefix, children }: { prefix: string; children: ReactNode }) {
  return (
    <>
      <span className="hidden in-[button]:inline">{prefix}: </span>
      {children}
    </>
  );
}

interface FilterSelectProps<K extends string> {
  label: string;
  value: K;
  options: { id: K; label: string }[];
  onChange: (value: K) => void;
}

function FilterSelect<K extends string>({ label, value, options, onChange }: FilterSelectProps<K>) {
  return (
    <Select aria-label={label} className="min-w-35 flex-1" selectedKey={value} onSelectionChange={key => key != null && onChange(String(key) as K)}>
      {options.map(o => (
        <SelectItem key={o.id} id={o.id} textValue={o.label}>
          <Prefixed prefix={label}>{o.label}</Prefixed>
        </SelectItem>
      ))}
    </Select>
  );
}

export interface NodeFiltersBarProps {
  filters: NodeFilters;
  onFiltersChange: (filters: NodeFilters) => void;
  /** Shown beside the search field, e.g. the *1 Scope Viewed* badge. */
  addon?: ReactNode;
}

/** The Node tree's filter row: search, state, change, category, type and *Expand instances*. */
export function NodeFiltersBar({ filters, onFiltersChange, addon }: NodeFiltersBarProps) {
  const q = filters.q ?? '';
  const [draft, setDraft] = useState(q);
  const [committed, setCommitted] = useState(q);
  if (q !== committed) {
    setCommitted(q);
    setDraft(q);
  }
  useEffect(() => {
    if (draft === q) return undefined;
    const timer = setTimeout(() => onFiltersChange({ ...filters, q: draft.trim() ? draft : undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, q, filters, onFiltersChange]);

  const set = (patch: Partial<NodeFilters>) => onFiltersChange({ ...filters, ...patch });
  const any = <K extends string>(value: K) => (value === 'any' ? undefined : value);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center gap-lg">
        <Input
        aria-label="Search nodes"
        className="w-70"
        type="search"
        placeholder="Search name, node id, or key:value"
        tooltip="Plain text matches node names, a node id lists that node, and key:value pairs (state:dirty changed:fills) filter like the API's q."
        iconLeading={<Icon name="search-lg" size="md" />}
        value={draft}
        onChange={setDraft}
        />
        {addon}
      </div>
      <div className="flex flex-wrap items-center gap-lg">
      <FilterSelect label="State" value={filters.state ?? 'all'} options={STATE_OPTIONS} onChange={state => set({ state })} />
      <FilterSelect
        label="Change"
        value={filters.changeType ?? 'any'}
        options={CHANGE_OPTIONS}
        onChange={v => set({ changeType: any(v) as ChangeFilter | undefined })}
      />
      <FilterSelect
        label="Category"
        value={filters.category ?? 'any'}
        options={CATEGORY_OPTIONS}
        onChange={v => set({ category: any(v) as Category | undefined })}
      />
      <FilterSelect label="Type" value={filters.type ?? 'any'} options={TYPE_OPTIONS} onChange={v => set({ type: any(v) })} />
      <Toggle className="ml-auto shrink-0" isSelected={!!filters.expandInstances} onChange={on => set({ expandInstances: on || undefined })}>
        Expand instances
      </Toggle>
      </div>
    </div>
  );
}

interface RowContextValue {
  fileKey: string;
  filters: NodeFilters;
  columns: ReadonlySet<NodeColumn>;
  onOpenNode?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  live: NodeLiveUpdates;
  claims: ReadonlyMap<string, FileClaim>;
  now: number;
}

const RowContext = createContext<RowContextValue | null>(null);

function useRowContext(): RowContextValue {
  const ctx = use(RowContext);
  if (!ctx) throw new Error('NodeTable rows render inside NodeTable.');
  return ctx;
}

function Dash() {
  return <Text color="quaternary">—</Text>;
}

function AgentColumn({ node }: { node: NodeItem }) {
  const { live, claims, now } = useRowContext();
  const id = node.nodeId ?? '';
  const sprite = live.sprites[id];
  const onEnd = (state: Parameters<NodeLiveUpdates['onSpriteEnd']>[1]) => live.onSpriteEnd(id, state);
  const claim = node.claim;
  if (claim?.worker) {
    const since = claim.claimId ? claims.get(claim.claimId)?.createdAt : undefined;
    return (
      <AgentCell
        worker={claim.worker}
        when={since ? `claimed ${timeAgo(since, now, 'short')}` : 'claimed'}
        spriteState={sprite?.state === 'enter' ? 'enter' : 'idle'}
        onSpriteAnimationEnd={onEnd}
      />
    );
  }
  if (sprite && (sprite.state === 'poof' || sprite.state === 'fade')) {
    return (
      <AgentCell
        worker={sprite.worker}
        when={sprite.state === 'poof' ? 'cleared just now' : 'released'}
        spriteState={sprite.state}
        onSpriteAnimationEnd={onEnd}
      />
    );
  }
  if (node.blocked) {
    return <AgentCell worker={node.blocked.by ?? 'unknown'} when={node.blocked.reason ? `blocked: ${node.blocked.reason}` : 'blocked'} />;
  }
  return <AgentCell worker="—" when="unclaimed" avatar={false} />;
}

interface NodeRowViewProps {
  node: NodeItem;
  depth: number;
  via?: string;
  expandable: boolean;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}

function NodeRowView({ node, depth, via, expandable, expanded, onToggle }: NodeRowViewProps) {
  const { columns, onOpenNode, selectedNodeId } = useRowContext();
  const id = node.nodeId ?? '';
  const name = node.name ?? id;
  const changed = whatChanged(node);
  const categories = categoriesOf(node.changedProps ?? []);
  return (
    <Table.Row
      data-node-id={id}
      selected={!!selectedNodeId && selectedNodeId === id}
      onAction={onOpenNode ? () => onOpenNode(id) : undefined}
    >
      <Table.Cell className="w-88 py-lg">
        <NodeCell
          name={name}
          meta={nodeMeta(node, via)}
          badges={node.library ? <Badge color="gray">Library</Badge> : undefined}
          depth={depth}
          expandable={expandable}
          expanded={expanded}
          onToggle={onToggle}
          toggleLabel={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
        />
      </Table.Cell>
      {columns.has('state') && <Table.Cell>{node.state ? <StateBadge state={node.state} /> : <Dash />}</Table.Cell>}
      {columns.has('change') && <Table.Cell>{node.changeType ? <ChangeBadge change={node.changeType} /> : <Dash />}</Table.Cell>}
      {columns.has('categories') && (
        <Table.Cell>{categories.length ? <CategoryBadges categories={categories} max={2} /> : <Dash />}</Table.Cell>
      )}
      {columns.has('changed') &&
        (changed ? (
          <TextCell className="max-w-45" supportingText={changed.supportingText}>
            {changed.text}
          </TextCell>
        ) : (
          <Table.Cell>
            <Dash />
          </Table.Cell>
        ))}
      {columns.has('agent') && (
        <Table.Cell>
          <AgentColumn node={node} />
        </Table.Cell>
      )}
    </Table.Row>
  );
}

function StatusRow({ children, depth = 0 }: { children: ReactNode; depth?: number }) {
  const { columns } = useRowContext();
  return (
    <tr>
      <td colSpan={columns.size + 1} className="h-14 border-b border-secondary px-3xl py-lg">
        <div style={{ paddingLeft: `calc(${depth} * 1.5rem + 1.75rem)` }}>
          <Text color="tertiary">{children}</Text>
        </div>
      </td>
    </tr>
  );
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

interface TreeRowProps {
  node: NodeItem;
  depth: number;
  /** The instance this main-component row was reached through. */
  via?: string;
  /** Children already loaded with this row (the scope root's page, a main component's subtree). */
  preloaded?: NodeItem[];
  more?: ReactNode;
  defaultExpanded?: boolean;
}

/** A row and, once expanded, its lazily loaded children. */
function TreeRow({ node, depth, via, preloaded, more, defaultExpanded = false }: TreeRowProps) {
  const { filters } = useRowContext();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const followMain = !!filters.expandInstances && !!node.isInstance && !!node.mainComponentId && !via;
  const expandable = preloaded ? preloaded.length > 0 : followMain || (node.descendants?.total ?? 0) > 0;
  let children: ReactNode = null;
  if (expanded && expandable) {
    if (preloaded) {
      children = (
        <>
          {preloaded.map(child => (
            <TreeRow key={child.nodeId} node={child} depth={depth + 1} />
          ))}
          {more}
        </>
      );
    } else if (followMain) children = <MainComponentRows instance={node} depth={depth + 1} />;
    else children = <ChildRows parentId={node.nodeId ?? ''} depth={depth + 1} />;
  }
  return (
    <>
      <NodeRowView node={node} depth={depth} via={via} expandable={expandable} expanded={expanded && expandable} onToggle={setExpanded} />
      {children}
    </>
  );
}

function useLevel(parentId: string) {
  const { fileKey, filters } = useRowContext();
  const query = useChildNodes(fileKey, parentId, filters);
  const nodes = query.data?.pages.flatMap(p => p.nodes ?? []) ?? [];
  const more = query.hasNextPage ? (
    <MoreRow loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
  ) : null;
  return { query, nodes, more };
}

function MoreRow({ loading, onMore }: { loading: boolean; onMore: () => void }) {
  const { columns } = useRowContext();
  return (
    <tr>
      <td colSpan={columns.size + 1} className="border-b border-secondary px-3xl py-md">
        <Button hierarchy="link-color" size="sm" onPress={onMore} loading={loading}>
          Show more
        </Button>
      </td>
    </tr>
  );
}

function ChildRows({ parentId, depth }: { parentId: string; depth: number }) {
  const { query, nodes, more } = useLevel(parentId);
  const children = nodes.filter(n => n.nodeId !== parentId);
  if (query.isPending) return <StatusRow depth={depth}>Loading…</StatusRow>;
  if (query.isError) return <StatusRow depth={depth}>Couldn’t load child nodes: {errorText(query.error)}</StatusRow>;
  if (!children.length) return <StatusRow depth={depth}>No child nodes match the filters.</StatusRow>;
  return (
    <>
      {children.map(n => (
        <TreeRow key={n.nodeId} node={n} depth={depth} />
      ))}
      {more}
    </>
  );
}

/** *Expand instances*: an instance's main component (`↳ … via <instanceId>`) and its children. */
function MainComponentRows({ instance, depth }: { instance: NodeItem; depth: number }) {
  const mainId = instance.mainComponentId ?? '';
  const { query, nodes, more } = useLevel(mainId);
  if (query.isPending) return <StatusRow depth={depth}>Loading main component…</StatusRow>;
  if (query.isError) return <StatusRow depth={depth}>Couldn’t load main component {mainId}: {errorText(query.error)}</StatusRow>;
  const main = nodes.find(n => n.nodeId === mainId);
  const children = nodes.filter(n => n.nodeId !== mainId);
  if (main) {
    return <TreeRow node={main} depth={depth} via={instance.nodeId} preloaded={children} more={more} defaultExpanded />;
  }
  if (!children.length) return <StatusRow depth={depth}>Main component {mainId} has no nodes that match the filters.</StatusRow>;
  return (
    <>
      {children.map(n => (
        <TreeRow key={n.nodeId} node={n} depth={depth} />
      ))}
      {more}
    </>
  );
}

interface PagedRowsProps {
  fileKey: string;
  scopeId?: string;
  filters: NodeFilters;
  colSpan: number;
}

/** The top level, one cursor page at a time; remounted (back to page 1) when the filters change. */
function PagedRows({ fileKey, scopeId, filters, colSpan }: PagedRowsProps) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const page = cursors.length;
  const query = useNodePage(fileKey, scopeId, filters, cursors[page - 1]);
  const under = nodePageParams(scopeId, filters).under as string | undefined;
  const nodes = query.data?.nodes ?? [];
  const root = page === 1 ? nodes.find(n => n.nodeId === under) : undefined;
  const rest = nodes.filter(n => n.nodeId !== under);
  const depth = under && page > 1 ? 1 : 0;
  const nextCursor = query.data?.nextCursor ?? null;

  let body: ReactNode;
  if (query.isPending) body = <StatusRow>Loading nodes…</StatusRow>;
  else if (query.isError) body = <StatusRow>Couldn’t load nodes: {errorText(query.error)}</StatusRow>;
  else if (!nodes.length) body = <StatusRow>No nodes match the filters.</StatusRow>;
  else if (root) body = <TreeRow node={root} depth={0} preloaded={rest} defaultExpanded />;
  else body = rest.map(n => <TreeRow key={n.nodeId} node={n} depth={depth} />);

  const onPageChange = (next: number) => {
    if (next < page) setCursors(c => c.slice(0, Math.max(1, next)));
    else if (next > page && nextCursor) setCursors(c => [...c, nextCursor]);
  };

  return (
    <>
      <Table.Body aria-busy={query.isFetching || undefined}>{body}</Table.Body>
      <tfoot>
        <tr>
          <td colSpan={colSpan} className="p-0">
            <Pagination label="Node pages" page={page} onPageChange={onPageChange} hasNext={!!nextCursor} className="border-t-0" />
          </td>
        </tr>
      </tfoot>
    </>
  );
}

export interface NodeTableProps {
  fileKey: string;
  /** The scope (screen) the tree is rooted at: its node and direct children, then lazily deeper. */
  scopeId?: string;
  /** Controlled filters (the route keeps them in the URL). */
  filters: NodeFilters;
  onFiltersChange: (filters: NodeFilters) => void;
  /** A row was activated (click / Enter): open its drawer. */
  onOpenNode?: (nodeId: string) => void;
  /** The node whose drawer is open; its row shows selected. */
  selectedNodeId?: string | null;
  /** Shown beside the search field. */
  filtersAddon?: ReactNode;
  className?: string;
}

/**
 * Figma *Team View* content: the filter row and the Nodes table card — the scope's tree in
 * document order, expanded lazily, paged by cursor, and kept live from the file's event stream.
 */
export function NodeTable({ fileKey, scopeId, filters, onFiltersChange, onOpenNode, selectedNodeId, filtersAddon, className }: NodeTableProps) {
  const live = useNodeLiveUpdates(fileKey);
  const claimsQuery = useFileClaims(fileKey);
  const file = useFile(fileKey);
  const { scope, selected } = useScope(fileKey, scopeId);
  const now = useNow(30_000);
  const [columns, setColumns] = useState<ReadonlySet<NodeColumn>>(() => new Set(COLUMNS.map(c => c.id)));

  const claims = new Map((claimsQuery.data?.claims ?? []).flatMap(c => (c.claimId ? [[c.claimId, c] as const] : [])));
  const several = selected.length > 1 && selected.length === splitUnder(scopeId).length;
  const dirty = several ? selected.reduce((sum, s) => sum + (s.counts?.dirty ?? 0), 0) : (scope ?? file.data)?.counts?.dirty;
  const outlineHref = buildUrl('/v3/files/{fileKey}/nodes', { fileKey }, {
    under: scopeId,
    ...filterParams(filters),
    format: 'outline',
    expand: filters.expandInstances ? 'instances' : undefined,
  });
  const pageKey = JSON.stringify([fileKey, scopeId ?? null, filters]);
  const visible = COLUMNS.filter(c => columns.has(c.id));

  return (
    <div className={cx('flex flex-col gap-2xl', className)}>
      <NodeFiltersBar filters={filters} onFiltersChange={onFiltersChange} addon={filtersAddon} />
      <Card className="overflow-hidden">
        <Card.Header
          title="Nodes"
          badge={dirty !== undefined ? <Badge color="brand">{dirty} dirty</Badge> : undefined}
          description={`Document order · ${PAGE_SIZE} per page · updates live as agents claim and clear`}
          actions={
            <>
              <Button hierarchy="secondary" size="sm" href={outlineHref} target="_blank" rel="noreferrer">
                Outline
              </Button>
              <Menu
                label="Columns"
                trigger={
                  <Button hierarchy="secondary" size="sm">
                    Columns
                  </Button>
                }
                selectionMode="multiple"
                selectedKeys={columns}
                onSelectionChange={keys => setColumns(keys === 'all' ? new Set(COLUMNS.map(c => c.id)) : (new Set(keys) as Set<NodeColumn>))}
              >
                {COLUMNS.map(c => (
                  <Menu.Item key={c.id} id={c.id}>
                    {c.label}
                  </Menu.Item>
                ))}
              </Menu>
            </>
          }
        />
        <div className="overflow-x-auto">
          <Table aria-label="Nodes" aria-describedby={undefined}>
            <Table.Header>
              <Table.HeaderCell className="w-88">Node</Table.HeaderCell>
              {visible.map(c => (
                <Table.HeaderCell key={c.id} className={c.width}>
                  {c.label}
                </Table.HeaderCell>
              ))}
            </Table.Header>
            <RowContext value={{ fileKey, filters, columns, onOpenNode, selectedNodeId, live, claims, now }}>
              <PagedRows key={pageKey} fileKey={fileKey} scopeId={scopeId} filters={filters} colSpan={visible.length + 1} />
            </RowContext>
          </Table>
        </div>
      </Card>
    </div>
  );
}
