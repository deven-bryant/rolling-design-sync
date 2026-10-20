import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../../test/fake-event-source';
import { NodeTable, type NodeTableProps } from './NodeTable';
import { claimC1, FILE, logo, mockApi, node, pageHeader, renderWithClient, scope, treeRoutes, type Route } from './test-fixtures';

const pagePath = `/v3/files/${FILE}/nodes`;

function renderTable(props: Partial<NodeTableProps> = {}, routes: Route = treeRoutes()) {
  const api = mockApi(routes);
  const onFiltersChange = vi.fn();
  const onOpenNode = vi.fn();
  const utils = renderWithClient(
    <NodeTable fileKey={FILE} scopeId="1:1" filters={{}} onFiltersChange={onFiltersChange} onOpenNode={onOpenNode} {...props} />,
  );
  return { api, onFiltersChange, onOpenNode, ...utils };
}

const rowIds = () => [...document.querySelectorAll('tr[data-node-id]')].map(r => r.getAttribute('data-node-id'));
const row = (nodeId: string) => {
  const el = document.querySelector<HTMLElement>(`tr[data-node-id="${nodeId}"]`);
  if (!el) throw new Error(`No row for ${nodeId}`);
  return el;
};
const sprite = (nodeId: string) => row(nodeId).querySelector('[data-state]')?.getAttribute('data-state');
const indent = (nodeId: string) => row(nodeId).querySelector<HTMLElement>('[data-slot="indent"]')?.style.width;
const stream = () => {
  const source = FakeEventSource.instances.find(s => s.url === `/v3/files/${FILE}/events`);
  if (!source) throw new Error('No file stream');
  return source;
};
const emit = (type: string, data: unknown, actor = 'devin') =>
  act(() => stream().emit(type, { id: 1, fileKey: FILE, type, actor, data, createdAt: new Date().toISOString() }));

describe('NodeTable', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the first page in document order with counts, changes and agents', async () => {
    const { api } = renderTable();
    await screen.findByText('Breadcrumbs');
    expect(rowIds()).toEqual(['1:1', '1:2', '1:3']);
    const [call] = api.find('GET', pagePath);
    expect(Object.fromEntries(call?.query ?? [])).toEqual({
      under: '1:1',
      depth: '1',
      include: 'counts',
      sort: 'document',
      limit: '25',
      state: 'all',
    });
    expect(await screen.findByText('281 dirty')).toBeTruthy();
    expect(indent('1:1')).toBe('calc(var(--spacing-2xl) * 0)');
    expect(indent('1:3')).toBe('calc(var(--spacing-2xl) * 1)');
    const crumbs = within(row('1:3'));
    expect(crumbs.getByText('FRAME · 1:3')).toBeTruthy();
    expect(crumbs.getByText('Dirty')).toBeTruthy();
    expect(crumbs.getByText('Modified')).toBeTruthy();
    expect(crumbs.getByText('layout')).toBeTruthy();
    expect(crumbs.getByText('itemSpacing')).toBeTruthy();
    expect(crumbs.getByText('spacing-md → spacing-lg')).toBeTruthy();
    expect(crumbs.getByText('devin')).toBeTruthy();
    expect(await crumbs.findByText('claimed 2m ago')).toBeTruthy();
    const header = within(row('1:2'));
    expect(header.getByText('INSTANCE · 1:2 → 1:50')).toBeTruthy();
    expect(header.getByText('3 properties')).toBeTruthy();
    expect(header.getByText('new since last clear')).toBeTruthy();
    expect(header.getByText('unclaimed')).toBeTruthy();
  });

  it('badges library nodes', async () => {
    const lib = node('9:1', { name: 'Lib button', type: 'COMPONENT', library: { key: 'LIBKEY', resolved: false }, figmaUrl: null });
    renderTable({}, treeRoutes(call => (call.path === pagePath && call.query.get('under') === '1:1' ? { fileKey: FILE, nodes: [scope, lib], nextCursor: null } : undefined)));
    await waitFor(() => expect(row('9:1')).toBeDefined());
    expect(within(row('9:1')).getByText('Library').className).toContain('bg-utility-gray-50');
    expect(within(row('1:1')).queryByText('Library')).toBeNull();
  });

  it('loads a row’s children when it expands', async () => {
    const user = userEvent.setup();
    const { api, onOpenNode } = renderTable();
    await user.click(await screen.findByRole('button', { name: 'Expand Page header' }));
    await screen.findByText('Logo');
    expect(rowIds()).toEqual(['1:1', '1:2', '1:20', '1:3']);
    expect(indent('1:20')).toBe('calc(var(--spacing-2xl) * 2)');
    const child = api.find('GET', pagePath).find(c => c.query.get('under') === '1:2');
    expect(child?.query.get('depth')).toBe('1');
    expect(child?.query.get('include')).toBe('counts');
    expect(child?.query.get('sort')).toBe('document');
    expect(onOpenNode).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Collapse Page header' }));
    expect(rowIds()).toEqual(['1:1', '1:2', '1:3']);
  });

  it('expands an instance into its main component with Expand instances on', async () => {
    const user = userEvent.setup();
    const { api } = renderTable({ filters: { expandInstances: true } });
    await user.click(await screen.findByRole('button', { name: 'Expand Page header' }));
    await screen.findByText('Style=Simple');
    expect(rowIds()).toEqual(['1:1', '1:2', '1:50', '1:51', '1:3']);
    expect(within(row('1:50')).getByText('COMPONENT · 1:50 · via 1:2')).toBeTruthy();
    const unders = api.find('GET', pagePath).map(c => c.query.get('under'));
    expect(unders).toContain('1:50');
    expect(unders).not.toContain('1:2');
    expect(api.find('GET', pagePath).every(c => !c.query.has('expand'))).toBe(true);
  });

  describe('keeps rows open across filter changes', () => {
    const deepRoutes = () =>
      treeRoutes(({ path, query }) => {
        if (path !== pagePath) return undefined;
        const under = query.get('under');
        if (under === '1:2') return { fileKey: FILE, nodes: [pageHeader, { ...logo, descendants: { total: 1, dirty: 0, blocked: 0 } }], nextCursor: null };
        if (under === '1:20') return { fileKey: FILE, nodes: [logo, logoMark], nextCursor: null };
        return undefined;
      });
    const logoMark = node('1:21', { name: 'Logo mark', type: 'VECTOR' });
    const table = (props: Partial<NodeTableProps>) => (
      <NodeTable fileKey={FILE} scopeId="1:1" filters={{}} onFiltersChange={vi.fn()} {...props} />
    );
    const expanded = (name: string) => screen.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) }).getAttribute('aria-expanded');

    async function openTwoLevels() {
      const user = userEvent.setup();
      mockApi(deepRoutes());
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
      const utils = render(<QueryClientProvider client={client}>{table({})}</QueryClientProvider>);
      const rerender = (props: Partial<NodeTableProps>) => utils.rerender(<QueryClientProvider client={client}>{table(props)}</QueryClientProvider>);
      await user.click(await screen.findByRole('button', { name: 'Expand Page header' }));
      await user.click(await screen.findByRole('button', { name: 'Expand Logo' }));
      await screen.findByText('Logo mark');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:20', '1:21', '1:3']);
      return { user, rerender };
    }

    it('across Expand instances on and off', async () => {
      const { rerender } = await openTwoLevels();
      rerender({ filters: { expandInstances: true } });
      await screen.findByText('Style=Simple');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:50', '1:51', '1:3']);
      expect(expanded('Page header')).toBe('true');
      rerender({ filters: {} });
      await screen.findByText('Logo mark');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:20', '1:21', '1:3']);
      expect([expanded('Page header'), expanded('Logo')]).toEqual(['true', 'true']);
    });

    it('across the state, change, category, type and search filters', async () => {
      const { rerender } = await openTwoLevels();
      rerender({ filters: { state: 'dirty', changeType: 'modified', category: 'color', type: 'FRAME', q: 'Logo' } });
      await screen.findByText('Logo mark');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:20', '1:21', '1:3']);
    });

    it('across pages', async () => {
      const { user } = await openTwoLevels();
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await screen.findByText('Divider');
      await user.click(screen.getByRole('button', { name: /Previous/ }));
      await screen.findByText('Logo mark');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:20', '1:21', '1:3']);
    });

    it('until the scope changes', async () => {
      const { rerender } = await openTwoLevels();
      rerender({ scopeId: '1:9' });
      await screen.findByText('No nodes match the filters.');
      rerender({ scopeId: '1:1' });
      await screen.findByText('Breadcrumbs');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:3']);
      expect(expanded('Page header')).toBe('false');
    });

    it('keeps an auto-expanded row the user collapsed collapsed', async () => {
      const { user, rerender } = await openTwoLevels();
      await user.click(screen.getByRole('button', { name: 'Collapse Team View' }));
      expect(rowIds()).toEqual(['1:1']);
      rerender({ filters: { expandInstances: true } });
      await waitFor(() => expect(expanded('Team View')).toBe('false'));
      expect(rowIds()).toEqual(['1:1']);
      await user.click(screen.getByRole('button', { name: 'Expand Team View' }));
      await screen.findByText('Style=Simple');
      await user.click(screen.getByRole('button', { name: 'Collapse Style=Simple' }));
      expect(rowIds()).toEqual(['1:1', '1:2', '1:50', '1:3']);
      rerender({ filters: { expandInstances: true, state: 'dirty' } });
      await screen.findByText('Style=Simple');
      expect(expanded('Style=Simple')).toBe('false');
      expect(rowIds()).toEqual(['1:1', '1:2', '1:50', '1:3']);
    });
  });

  it('sends the filters with every page request', async () => {
    const { api } = renderTable({
      filters: { q: 'Button', state: 'dirty', changeType: 'modified', category: 'color', type: 'FRAME' },
    });
    await waitFor(() => expect(api.find('GET', pagePath)).toHaveLength(1));
    const query = api.find('GET', pagePath)[0]?.query;
    expect(query?.get('state')).toBe('dirty');
    expect(query?.get('changeType')).toBe('modified');
    expect(query?.get('category')).toBe('color');
    expect(query?.get('type')).toBe('FRAME');
    expect(query?.get('name')).toBe('*Button*');
  });

  it('reports filter changes from the filter row', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderTable({ filters: { state: 'all' } });
    await user.click(screen.getByRole('button', { name: /State/ }));
    await user.click(await screen.findByRole('option', { name: /Dirty/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ state: 'dirty' });
    await user.click(screen.getByRole('switch', { name: 'Expand instances' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ state: 'all', expandInstances: true });
    await user.type(screen.getByRole('searchbox', { name: 'Search nodes' }), 'Bread');
    await waitFor(() => expect(onFiltersChange).toHaveBeenLastCalledWith({ state: 'all', q: 'Bread' }));
  });

  it('pages by cursor', async () => {
    const user = userEvent.setup();
    const { api } = renderTable();
    await screen.findByText('Breadcrumbs');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText('Divider');
    expect(rowIds()).toEqual(['1:4']);
    expect(api.find('GET', pagePath).at(-1)?.query.get('cursor')).toBe('cur2');
    expect(within(row('1:4')).getByText('blocked: Needs a border token')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Previous/ }));
    await screen.findByText('Breadcrumbs');
    expect(rowIds()).toEqual(['1:1', '1:2', '1:3']);
  });

  it('numbers the pages from the total and jumps to a later page by walking the cursors', async () => {
    const user = userEvent.setup();
    const pageOf = (cursor: string | null) => {
      if (cursor === 'cur3') return { fileKey: FILE, nodes: [node('1:7', { name: 'Footer', parentId: '1:1' })], nextCursor: null, total: 51 };
      if (cursor === 'cur2') return { fileKey: FILE, nodes: [node('1:6', { name: 'Body', parentId: '1:1' })], nextCursor: 'cur3', total: 51 };
      return { fileKey: FILE, nodes: [scope, pageHeader], nextCursor: 'cur2', total: 51 };
    };
    const { api } = renderTable({}, treeRoutes(call => (call.path === pagePath && call.query.get('under') === '1:1' ? pageOf(call.query.get('cursor')) : undefined)));
    const nav = within(await screen.findByRole('navigation', { name: 'Node pages' }));
    expect((await nav.findByRole('button', { name: 'Page 1' })).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('button', { name: 'Page 3' })).toBeTruthy();
    await user.click(nav.getByRole('button', { name: 'Page 3' }));
    await screen.findByText('Footer');
    expect(rowIds()).toEqual(['1:7']);
    expect(api.find('GET', pagePath).filter(c => c.query.get('under') === '1:1').map(c => c.query.get('cursor'))).toEqual([null, 'cur2', 'cur3']);
    expect(nav.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBe('page');
    await user.click(nav.getByRole('button', { name: 'Page 1' }));
    await screen.findByText('Page header');
    expect(nav.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens a node when its row is activated', async () => {
    const user = userEvent.setup();
    const { onOpenNode } = renderTable({ selectedNodeId: '1:2' });
    await user.click(await screen.findByText('Breadcrumbs'));
    expect(onOpenNode).toHaveBeenCalledWith('1:3');
    expect(row('1:2').getAttribute('aria-selected')).toBe('true');
  });

  it('patches rows in place for blocks, unblocks and clears', async () => {
    const { api } = renderTable();
    await screen.findByText('Breadcrumbs');
    const fetches = api.calls.length;
    emit('node.blocked', { nodeId: '1:3', reason: 'Waiting on tokens', by: 'agent-c' }, 'agent-c');
    await waitFor(() => expect(within(row('1:3')).getByText('Blocked')).toBeTruthy());
    emit('node.unblocked', { nodeId: '1:3', reason: 'Waiting on tokens', by: 'agent-c' }, 'agent-c');
    await waitFor(() => expect(within(row('1:3')).getByText('Dirty')).toBeTruthy());
    emit('nodes.cleared', { nodeIds: ['1:3'], commitRef: 'abc1234', worker: 'devin' });
    await waitFor(() => expect(within(row('1:3')).getByText('Clean')).toBeTruthy());
    expect(sprite('1:3')).toBe('poof');
    await waitFor(() => expect(within(row('1:3')).getByText('unclaimed')).toBeTruthy());
    expect(api.calls.slice(fetches).filter(c => c.path === pagePath)).toHaveLength(0);
  });

  it('drives agent sprites from claims: enter on create, fade on release', async () => {
    renderTable();
    await screen.findByText('Breadcrumbs');
    expect(sprite('1:3')).toBe('idle');
    emit('claim.created', { claimId: 'c2', worker: 'agent-c', label: null, expiresAt: claimC1.expiresAt, nodeIds: ['1:2'], nodeCount: 1 }, 'agent-c');
    await waitFor(() => expect(within(row('1:2')).getByText('agent-c')).toBeTruthy());
    expect(sprite('1:2')).toBe('enter');
    await waitFor(() => expect(sprite('1:2')).toBe('idle'));
    emit('claim.released', { claimId: 'c1', worker: 'devin', nodeIds: ['1:3'], nodeCount: 3 });
    expect(sprite('1:3')).toBe('fade');
    await waitFor(() => expect(within(row('1:3')).getByText('unclaimed')).toBeTruthy());
  });

  it('fades a claim when its lease expires', async () => {
    const soon = new Date(Date.now() + 150).toISOString();
    renderTable(
      {},
      treeRoutes(({ path }) => (path === `/v3/files/${FILE}/claims` ? { fileKey: FILE, claims: [{ ...claimC1, expiresAt: soon }] } : undefined)),
    );
    await screen.findByText('Breadcrumbs');
    await waitFor(() => expect(sprite('1:3')).toBe('fade'));
    await waitFor(() => expect(within(row('1:3')).getByText('unclaimed')).toBeTruthy());
  });

  it('refetches visible pages on sync.completed and on reset', async () => {
    const { api } = renderTable();
    await screen.findByText('Breadcrumbs');
    const pages = () => api.find('GET', pagePath).length;
    expect(pages()).toBe(1);
    emit('sync.completed', { scopeId: '1:1' }, 'plugin');
    await waitFor(() => expect(pages()).toBe(2));
    act(() => stream().emit('reset', { fileKey: FILE, lastEventId: 9 }));
    await waitFor(() => expect(pages()).toBe(3));
  });
});

describe('NodeTable notes', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('filters to Requested nodes', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderTable({ filters: { state: 'all' } });
    await user.click(screen.getByRole('button', { name: /Change/ }));
    await user.click(await screen.findByRole('option', { name: /Requested/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ state: 'all', changeType: 'requested' });
  });

  it('shows each row’s scope in the Scope column, after Node', async () => {
    renderTable();
    await screen.findByText('Breadcrumbs');
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers.slice(0, 3)).toEqual(['Node', 'Scope', 'State']);
    expect(within(row('1:3')).getByText('Team View')).toBeTruthy();
  });

  it('nests each selected scope’s children under it and names their scope', async () => {
    const other = node('2:1', { name: 'Screens', type: 'SECTION' });
    const nodes = [scope, node('1:5', { name: 'KV Badge', parentId: '1:1' }), other, node('2:5', { name: 'Portal', parentId: '2:1' })];
    renderTable(
      { scopeId: '1:1,2:1' },
      treeRoutes(call => {
        if (call.path === `/v3/files/${FILE}/scopes`)
          return { fileKey: FILE, scopes: [{ nodeId: '1:1', name: 'Team View', counts: { dirty: 1 } }, { nodeId: '2:1', name: 'Screens', counts: { dirty: 1 } }] };
        if (call.path === pagePath && call.query.get('under') === '1:1,2:1') return { fileKey: FILE, nodes, nextCursor: null, total: 4 };
        return undefined;
      }),
    );
    await screen.findByText('KV Badge');
    expect(rowIds()).toEqual(['1:1', '1:5', '2:1', '2:5']);
    expect(indent('1:5')).toBe('calc(var(--spacing-2xl) * 1)');
    expect(indent('2:5')).toBe('calc(var(--spacing-2xl) * 1)');
    expect(within(row('1:5')).getByText('Team View')).toBeTruthy();
    expect(within(row('2:5')).getByText('Screens')).toBeTruthy();
  });

  it('shows a file icon in the Notes column for nodes with open notes', async () => {
    const base = treeRoutes();
    const routes: Route = call => {
      const r = base(call) as { nodes?: { nodeId: string }[] } | undefined;
      if (call.method === 'GET' && call.path === pagePath && r?.nodes)
        return { ...r, nodes: r.nodes.map(n => (n.nodeId === '1:3' ? { ...n, notes: [{ noteId: 'n1', body: 'x', status: 'open' }] } : n)) };
      return r;
    };
    renderTable({}, routes);
    await screen.findByText('Breadcrumbs');
    expect(screen.getByRole('columnheader', { name: 'Notes' })).toBeTruthy();
    expect(within(row('1:3')).getByRole('img', { name: '1 open note' })).toBeTruthy();
    expect(within(row('1:2')).queryByRole('img', { name: /open note/ })).toBeNull();
  });

  it('shows render-check status in the Check column, before Notes; In mismatch on attributed nodes; — elsewhere', async () => {
    const base = treeRoutes();
    const routes: Route = call => {
      if (call.method === 'GET' && call.path === `/v3/files/${FILE}/targets`)
        return { fileKey: FILE, targets: [{ nodeId: '1:2', name: 'Page header', status: 'waiting', notMapped: false }] };
      const r = base(call) as { nodes?: { nodeId: string }[] } | undefined;
      if (call.method === 'GET' && call.path === pagePath && r?.nodes)
        return { ...r, nodes: r.nodes.map(n => (n.nodeId === '1:3' ? { ...n, notes: [{ noteId: 'n1', body: 'x', status: 'open', source: 'render_check' }] } : n)) };
      return r;
    };
    renderTable({}, routes);
    await screen.findByText('Breadcrumbs');
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers.slice(-2)).toEqual(['Check', 'Notes']);
    const checkCell = (id: string) => [...row(id).querySelectorAll('td')].at(-2)!;
    expect(await within(row('1:2')).findByText('Waiting')).toBeTruthy();
    expect(within(checkCell('1:3')).getByText('In mismatch')).toBeTruthy();
    expect(checkCell('1:1').textContent).toBe('—');
  });
});
