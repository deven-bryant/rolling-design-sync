import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeEventSource } from '../../test/fake-event-source';
import { itemClaim, itemProgress, nodesSummary, WorkGroupSwitch, WorkTable, type FileClaim, type WorkGroup, type WorkItem } from '.';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const FILE = 'AbCdEf123456GhIjKl7890';
const SCOPE = '1:95540';
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const component = (key: string, name: string, extra: Partial<WorkItem>): WorkItem => ({
  key,
  name,
  type: 'COMPONENT',
  nodeCount: 1,
  categories: [],
  changedProps: [],
  placements: 1,
  placementsInScope: 1,
  nodeIds: [key],
  progress: { total: 1, clean: 0 },
  ...extra,
});

interface Db {
  byComponent: WorkItem[];
  byFrame: WorkItem[];
  claims: FileClaim[];
}

const seed = (): Db => ({
  byComponent: [
    component('1:36604', 'Table cell', {
      type: 'COMPONENT_SET',
      placements: 60,
      placementsInScope: 60,
      categories: ['layout', 'content'],
      nodeIds: ['1:36604', '1:36605'],
      progress: { total: 30, clean: 3 },
    }),
    component('1:24667', 'Pagination', { categories: ['layout'], progress: { total: 11, clean: 11 } }),
    component('1:5970', 'Checkbox', {
      type: 'COMPONENT_SET',
      placements: 11,
      placementsInScope: 11,
      categories: ['layout', 'typography', 'color'],
      progress: { total: 4, clean: 2 },
    }),
  ],
  byFrame: [component('25:1975', 'Page header', { type: 'INSTANCE', placements: null, placementsInScope: null, progress: { total: 8, clean: 6 } })],
  claims: [{ claimId: 'c1', worker: 'devin', createdAt: minutesAgo(1), nodeIds: ['1:36605'], nodeCount: 1 }],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('features/work', () => {
  let db: Db;
  let client: QueryClient;
  const fetchMock = vi.fn<typeof fetch>();
  const workCalls = () =>
    fetchMock.mock.calls
      .map(([input]) => new URL(String(input), 'http://portal.test'))
      .filter(url => url.pathname === `/v3/files/${FILE}/work`);
  const stream = () => {
    const source = FakeEventSource.instances.find(s => s.url === `/v3/files/${FILE}/events`);
    if (!source) throw new Error('no file stream');
    return source;
  };

  function Screen({ onGroup, onFlat, onOpen }: { onGroup?: (g: WorkGroup) => void; onFlat?: () => void; onOpen?: (key: string) => void }) {
    const [group, setGroup] = useState<WorkGroup>('component');
    const [page, setPage] = useState(1);
    return (
      <>
        <WorkGroupSwitch
          group={group}
          onGroupChange={next => {
            onGroup?.(next);
            setGroup(next);
            setPage(1);
          }}
          onShowFlatList={() => onFlat?.()}
        />
        <WorkTable
          fileKey={FILE}
          under={SCOPE}
          scopeName="Team View"
          group={group}
          page={page}
          onPageChange={setPage}
          onOpenComponent={key => onOpen?.(key)}
          pageSize={2}
        />
      </>
    );
  }

  const renderScreen = (props: Parameters<typeof Screen>[0] = {}) =>
    render(
      <QueryClientProvider client={client}>
        <Screen {...props} />
      </QueryClientProvider>,
    );
  const row = (name: string) => screen.getByRole('row', { name });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', fetchMock);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    db = seed();
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input), 'http://portal.test');
      if (url.pathname === `/v3/files/${FILE}/claims`) return json({ fileKey: FILE, claims: db.claims });
      if (url.pathname === `/v3/files/${FILE}/work`) {
        const group = url.searchParams.get('group') === 'frame' ? 'frame' : 'component';
        const all = group === 'frame' ? db.byFrame : db.byComponent;
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const start = Number((url.searchParams.get('cursor') ?? 'c0').slice(1));
        const end = start + limit;
        return json({ fileKey: FILE, group, items: all.slice(start, end), nextCursor: end < all.length ? `c${end}` : null, total: all.length });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('summarises nodes, progress and claims per item', () => {
    const [tableCell, pagination, checkbox] = db.byComponent as [WorkItem, WorkItem, WorkItem];
    expect(nodesSummary(tableCell)).toEqual({ text: '27 dirty', supporting: 'of 30 nodes' });
    expect(nodesSummary(pagination)).toEqual({ text: 'Done', supporting: '11 nodes cleared' });
    expect([tableCell, pagination, checkbox].map(itemProgress)).toEqual([10, 100, 50]);
    expect(itemClaim(tableCell, db.claims)?.worker).toBe('devin');
    expect(itemClaim(checkbox, db.claims)).toBeUndefined();
  });

  it('requests the scope’s work items with instances and progress, and renders the rows', async () => {
    const { container } = renderScreen();
    await waitFor(() => expect(row('Table cell')).toBeDefined());
    const [first] = workCalls();
    expect(Object.fromEntries(first?.searchParams ?? [])).toMatchObject({
      group: 'component',
      expand: 'instances',
      include: 'progress',
      under: SCOPE,
      state: 'all',
      limit: '2',
    });
    expect(first?.searchParams.has('cursor')).toBe(false);
    expect(screen.getByText('3 components')).toBeDefined();
    expect(screen.getByText('Components Team View uses. Build leaves first, then the composites that contain them.')).toBeDefined();
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Component', 'Placements', 'Nodes', 'Categories', 'Progress', 'Agent']);

    const tableCell = within(row('Table cell'));
    expect(tableCell.getByText('COMPONENT_SET · 1:36604')).toBeDefined();
    expect(tableCell.getByText('60 in this screen')).toBeDefined();
    expect(tableCell.getByText('60 in file')).toBeDefined();
    expect(tableCell.getByText('27 dirty')).toBeDefined();
    expect(tableCell.getByText('of 30 nodes')).toBeDefined();
    expect(tableCell.getByText('layout')).toBeDefined();
    expect(tableCell.getByText('content')).toBeDefined();
    expect(tableCell.getByRole('progressbar', { name: 'Table cell progress' }).getAttribute('aria-valuenow')).toBe('10');
    await waitFor(() => expect(tableCell.getByText('devin')).toBeDefined());
    expect(tableCell.getByText('claimed 1m ago')).toBeDefined();

    const pagination = within(row('Pagination'));
    expect(pagination.getByText('Done')).toBeDefined();
    expect(pagination.getByText('11 nodes cleared')).toBeDefined();
    expect(pagination.getByRole('progressbar', { name: 'Pagination progress' }).getAttribute('aria-valuenow')).toBe('100');
    expect(pagination.getByText('unclaimed')).toBeDefined();

    await expectNoAxeViolations(container);
  });

  it('opens a component on row activation', async () => {
    const onOpen = vi.fn();
    renderScreen({ onOpen });
    await waitFor(() => expect(row('Table cell')).toBeDefined());
    fireEvent.click(within(row('Table cell')).getByText('Table cell'));
    expect(onOpen).toHaveBeenLastCalledWith('1:36604');
    fireEvent.keyDown(row('Pagination'), { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith('1:24667');
  });

  it('switches the group, which changes the query; Flat list hands off', async () => {
    const user = userEvent.setup();
    const onGroup = vi.fn();
    const onFlat = vi.fn();
    renderScreen({ onGroup, onFlat });
    await waitFor(() => expect(row('Table cell')).toBeDefined());
    expect(screen.getByRole('radio', { name: 'By component' }).getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('radio', { name: 'By frame' }));
    expect(onGroup).toHaveBeenCalledWith('frame');
    await waitFor(() => expect(row('Page header')).toBeDefined());
    expect(workCalls().at(-1)?.searchParams.get('group')).toBe('frame');
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Frame', 'Nodes', 'Categories', 'Progress', 'Agent']);
    expect(screen.getByText('1 frame')).toBeDefined();
    expect(within(row('Page header')).getByText('2 dirty')).toBeDefined();

    await user.click(screen.getByRole('radio', { name: 'Flat list' }));
    expect(onFlat).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'By frame' }).getAttribute('aria-checked')).toBe('true');
  });

  it('pages with the cursor', async () => {
    renderScreen();
    await waitFor(() => expect(row('Table cell')).toBeDefined());
    const nav = within(screen.getByRole('navigation', { name: 'Work items pages' }));
    expect(nav.getByText('Page 1')).toBeDefined();

    fireEvent.click(nav.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(row('Checkbox')).toBeDefined());
    expect(screen.queryByRole('row', { name: 'Table cell' })).toBeNull();
    expect(workCalls().at(-1)?.searchParams.get('cursor')).toBe('c2');
    expect(within(row('Checkbox')).getByText('50%')).toBeDefined();
    expect(nav.getByText('Page 2')).toBeDefined();
    expect((nav.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);

    const before = workCalls().length;
    fireEvent.click(nav.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(row('Table cell')).toBeDefined());
    expect(workCalls()).toHaveLength(before);
  });

  it('starts from a later page by walking the cursors', async () => {
    render(
      <QueryClientProvider client={client}>
        <WorkTable fileKey={FILE} under={SCOPE} group="component" page={2} onPageChange={() => {}} onOpenComponent={() => {}} pageSize={2} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(row('Checkbox')).toBeDefined());
    expect(workCalls().map(u => u.searchParams.get('cursor'))).toEqual([null, 'c2']);
  });

  it('refreshes progress and agents from the file stream', async () => {
    renderScreen();
    await waitFor(() => expect(within(row('Table cell')).getByText('devin')).toBeDefined());
    expect(FakeEventSource.instances.map(s => s.url)).toEqual([`/v3/files/${FILE}/events`]);

    db.byComponent = db.byComponent.map(item => (item.key === '1:36604' ? { ...item, progress: { total: 30, clean: 15 } } : item));
    db.claims = [];
    act(() => stream().emit('nodes.cleared', { fileKey: FILE, type: 'nodes.cleared', data: { nodeIds: ['1:36605'] } }));
    await waitFor(() =>
      expect(within(row('Table cell')).getByRole('progressbar', { name: 'Table cell progress' }).getAttribute('aria-valuenow')).toBe('50'),
    );
    expect(within(row('Table cell')).getByText('15 dirty')).toBeDefined();
    await waitFor(() => expect(within(row('Table cell')).getByText('unclaimed')).toBeDefined());

    db.claims = [{ claimId: 'c2', worker: 'claude-local', createdAt: minutesAgo(0), nodeIds: ['1:24667'], nodeCount: 1 }];
    act(() => stream().emit('claim.created', { fileKey: FILE, type: 'claim.created', data: {} }));
    await waitFor(() => expect(within(row('Pagination')).getByText('claude-local')).toBeDefined());

    db.byComponent = db.byComponent.map(item => (item.key === '1:24667' ? { ...item, progress: { total: 12, clean: 11 } } : item));
    act(() => stream().emit('sync.completed', { fileKey: FILE, type: 'sync.completed', data: {} }));
    await waitFor(() => expect(within(row('Pagination')).getByText('1 dirty')).toBeDefined());
  });
});
