import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeEventSource } from '../../test/fake-event-source';
import { ClaimsPanel } from './ClaimsPanel';
import { groupByWorker, type Claim } from './useClaims';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const NOW = Date.parse('2026-10-01T12:00:00Z');
const claim = (id: string, over: Partial<Claim> = {}): Claim => ({
  claimId: id,
  fileKey: 'FILE1',
  worker: 'devin',
  label: 'Agent session',
  nodeIds: ['1:2'],
  nodeCount: 1,
  createdAt: new Date(NOW - 120_000).toISOString(),
  expiresAt: new Date(NOW + 14 * 60_000).toISOString(),
  ...over,
});

const node = (nodeId: string, name: string, type = 'FRAME') => ({ nodeId, name, type });
const CLAIMS = [
  claim('c1', {
    nodeIds: ['1:2', '1:3', '1:4'],
    nodeCount: 3,
    nodes: [node('1:3', 'Row'), node('1:2', 'Cell'), node('1:4', 'Footer')],
    expiresAt: new Date(NOW + 20 * 60_000).toISOString(),
  }),
  claim('c2', { fileKey: 'FILE2', fileName: 'Checkout', nodes: [node('1:2', 'Table')], expiresAt: new Date(NOW + 90_000).toISOString() }),
  claim('c3', {
    worker: 'claude-local',
    label: 'Claude Code',
    fileName: 'Orders',
    nodeCount: 2,
    nodeIds: ['5:6', '5:7'],
    nodes: [node('5:7', 'Page header'), node('5:6', 'Title', 'TEXT')],
  }),
];

function serve(role: 'viewer' | 'agent', claims: Claim[] = CLAIMS) {
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/v3/session') return json({ role, label: 'me', expiresAt: '2026-10-02T00:00:00Z' });
    if (path === '/v3/claims' && (init?.method ?? 'GET') === 'GET') return json({ claims });
    if (init?.method === 'DELETE') return json({ claimId: 'c2', worker: 'devin', label: null, released: ['1:2'] });
    throw new Error(`unexpected ${path}`);
  });
}

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClaimsPanel />
    </QueryClientProvider>,
  );

const rows = () => within(screen.getByRole('table', { name: 'Agents' })).getAllByRole('row').slice(1);

describe('ClaimsPanel', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('groups claims by worker with node and file names and the soonest lease', async () => {
    serve('viewer');
    const { container } = renderPanel();
    await screen.findByRole('table', { name: 'Agents' });
    expect(screen.getByText('2 active')).toBeDefined();
    const [devin, claude] = rows();
    expect(devin?.textContent).toContain('devin');
    expect(devin?.textContent).toContain('Agent session');
    expect(devin?.textContent).toContain('4 nodes');
    expect(devin?.textContent).toContain('Table, +3 · Checkout, +1');
    expect(devin?.textContent).toContain('1 min left');
    expect(devin?.textContent).toContain('claimed 2 min ago');
    expect(claude?.textContent).toContain('2 nodes');
    expect(claude?.textContent).toContain('Page header, +1 · Orders');
    expect(claude?.textContent).toContain('14 min left');
    await expectNoAxeViolations(container);
  });

  it('counts the lease down live', async () => {
    serve('viewer');
    renderPanel();
    await screen.findByRole('table', { name: 'Agents' });
    expect(rows()[0]?.textContent).toContain('1 min left');
    act(() => vi.advanceTimersByTime(31_000));
    expect(rows()[0]?.textContent).toContain('59 s left');
    act(() => vi.advanceTimersByTime(59_000));
    // c2 expired: claude-local's lease is now the soonest, and devin holds only c1.
    const [claude, devin] = rows();
    expect(claude?.textContent).toContain('12 min left');
    expect(devin?.textContent).toContain('3 nodes');
    expect(devin?.textContent).toContain('Row, +2 · FILE1');
    expect(devin?.textContent).toContain('18 min left');
  });

  it('is read only for viewer sessions', async () => {
    serve('viewer');
    renderPanel();
    await screen.findByRole('table', { name: 'Agents' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/v3/session'))).toBe(true));
    expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull();
  });

  it('lets agent sessions release each claim', async () => {
    serve('agent');
    renderPanel();
    const release = await screen.findByRole('button', { name: 'Release Agent session (1 node)' });
    expect(screen.getAllByRole('button', { name: /^Release/ })).toHaveLength(3);
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(release);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(String(del?.[0])).toBe('/v3/files/FILE2/claims/c2');
  });

  it('refetches on claim events', async () => {
    serve('viewer');
    renderPanel();
    await screen.findByRole('table', { name: 'Agents' });
    serve('viewer', [claim('c9', { worker: 'cursor-ui', label: 'Cursor' })]);
    act(() => FakeEventSource.instances[0]?.emit('claim.created', { id: 9, type: 'claim.created' }, '9'));
    expect(await screen.findByText('cursor-ui')).toBeDefined();
    expect(screen.getByText('1 active')).toBeDefined();
    expect(rows()[0]?.textContent).toContain('1 node');
    expect(rows()[0]?.textContent).not.toContain('+');
  });

  it('shows only the file when a claim holds no nodes, and node ids when unnamed', async () => {
    serve('viewer', [
      claim('c1', { nodeCount: 0, nodeIds: [], nodes: [], fileName: 'Checkout' }),
      claim('c2', { worker: 'cursor-ui', nodes: [{ nodeId: '1:2', name: null, type: null }] }),
    ]);
    renderPanel();
    await screen.findByRole('table', { name: 'Agents' });
    const [devin, cursor] = rows();
    expect(devin?.textContent).toContain('0 nodes');
    expect(devin?.textContent).toContain('Checkout');
    expect(devin?.textContent).not.toContain(' · ');
    expect(cursor?.textContent).toContain('1:2 · FILE1');
  });
});

describe('groupByWorker', () => {
  it('orders workers and their claims by soonest expiry', () => {
    const groups = groupByWorker(CLAIMS);
    expect(groups.map(g => [g.worker, g.claims.map(c => c.claimId), g.nodeCount, g.files, g.fileNames])).toEqual([
      ['devin', ['c2', 'c1'], 4, ['FILE2', 'FILE1'], ['Checkout', 'FILE1']],
      ['claude-local', ['c3'], 2, ['FILE1'], ['Orders']],
    ]);
    expect(groups[0]?.nodes.map(n => n.name)).toEqual(['Table', 'Row', 'Cell', 'Footer']);
  });
});
