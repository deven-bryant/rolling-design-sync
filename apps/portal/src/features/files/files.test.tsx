import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PORTAL_DESIGN_FILE } from '../../figma-file';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeEventSource } from '../../test/fake-event-source';
import { fileAgents, FilesMetrics, filesMetrics, FilesTable, percent, timeAgo, type Claim, type TrackedFile } from '.';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

interface Db {
  files: TrackedFile[];
  scopes: Record<string, { nodeId: string; name: string; deleted?: boolean }[]>;
  claims: Claim[];
  cleared: { id: number; type: 'nodes.cleared'; data: { nodeIds: string[] } }[];
  clients: Record<string, string>;
  trends: { complete: boolean; total: { cleared: number; clearedPrevious: number; clearedChangePct: number | null; dirtied: number; netDirty: number } };
}

const seed = (): Db => ({
  files: [
    { fileKey: 'AbCdEf123456GhIjKl7890', name: 'Sandbox', lastSyncAt: minutesAgo(12), counts: { total: 293, dirty: 281, clean: 12, blocked: 0 } },
    { fileKey: 'ZyXwVu987654TsRqPo3210', name: 'Client CRM', lastSyncAt: minutesAgo(2 * 24 * 60), counts: { total: 100, dirty: 3, clean: 97, blocked: 0 } },
    { fileKey: PORTAL_DESIGN_FILE, name: 'Rolling Design Sync — Portal', lastSyncAt: null, counts: { total: 0, dirty: 0, clean: 0, blocked: 0 } },
  ],
  scopes: {
    AbCdEf123456GhIjKl7890: [{ nodeId: '1:95540', name: 'Team View' }],
    'ZyXwVu987654TsRqPo3210': [
      { nodeId: '1:1', name: 'Pipelines' },
      { nodeId: '1:9', name: 'Old', deleted: true },
      { nodeId: '1:2', name: 'Frame 216' },
      { nodeId: '1:3', name: 'Deals' },
      { nodeId: '1:4', name: 'Contacts' },
    ],
    [PORTAL_DESIGN_FILE]: [],
  },
  claims: [
    { claimId: 'c1', worker: 'claude-local', fileKey: 'AbCdEf123456GhIjKl7890', createdAt: minutesAgo(2), nodeIds: ['1:2'], nodeCount: 1 },
    { claimId: 'c2', worker: 'devin', fileKey: 'AbCdEf123456GhIjKl7890', createdAt: minutesAgo(1), nodeIds: ['1:3'], nodeCount: 1 },
    { claimId: 'c3', worker: 'claude-local', fileKey: 'AbCdEf123456GhIjKl7890', createdAt: minutesAgo(1), nodeIds: ['1:4'], nodeCount: 1 },
  ],
  cleared: [
    { id: 1, type: 'nodes.cleared', data: { nodeIds: ['1:1', '1:2', '1:3'] } },
    { id: 2, type: 'nodes.cleared', data: { nodeIds: ['1:4'] } },
  ],
  clients: { AbCdEf123456GhIjKl7890: 'plugin/0.10.0', 'ZyXwVu987654TsRqPo3210': 'plugin/0.9.0' },
  trends: { complete: true, total: { cleared: 42, clearedPrevious: 30, clearedChangePct: 40, dirtied: 73, netDirty: 31 } },
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('features/files', () => {
  let db: Db;
  let client: QueryClient;
  const fetchMock = vi.fn<typeof fetch>();
  const calls = (path: string) =>
    fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://portal.test')).filter(url => url.pathname === path);
  const wrap = (ui: ReactNode) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  const stream = () => {
    const source = FakeEventSource.instances.find(s => s.url === '/v3/events');
    if (!source) throw new Error('no /v3/events stream');
    return source;
  };

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
      const scopes = /^\/v3\/files\/([^/]+)\/scopes$/.exec(url.pathname);
      if (url.pathname === '/v3/files') return json({ files: db.files });
      if (scopes?.[1]) return json({ fileKey: scopes[1], scopes: db.scopes[decodeURIComponent(scopes[1])] ?? [] });
      if (url.pathname === '/v3/claims') return json({ claims: db.claims });
      if (url.pathname === '/v3/insights/trends') return json({ windowDays: 7, retentionDays: 30, files: [], ...db.trends });
      if (url.pathname === '/v3/events' && url.searchParams.get('types') === 'nodes.cleared') {
        const after = Number(url.searchParams.get('after') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const events = db.cleared.filter(e => e.id > after).slice(0, limit);
        return json({ events, nextAfter: events.at(-1)?.id ?? after });
      }
      if (url.pathname === '/v3/events' && url.searchParams.get('types') === 'sync.completed') {
        const fileKey = url.searchParams.get('fileKey') ?? '';
        const client = db.clients[fileKey];
        return json({ events: client ? [{ id: 9, type: 'sync.completed', fileKey, data: { client } }] : [], nextAfter: 9 });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  describe('metrics math', () => {
    it('sums dirty counts, counts claims and distinct workers', () => {
      expect(filesMetrics(db.files, db.claims)).toEqual({ dirty: 284, claims: 3, workers: 2 });
      expect(filesMetrics([], [])).toEqual({ dirty: 0, claims: 0, workers: 0 });
    });

    it('lists a file’s agents once each, in claim order', () => {
      expect(fileAgents(db.claims, 'AbCdEf123456GhIjKl7890').map(c => c.claimId)).toEqual(['c1', 'c2']);
      expect(fileAgents(db.claims, PORTAL_DESIGN_FILE)).toEqual([]);
    });

    it('rounds progress and formats ages', () => {
      expect(percent(12, 293)).toBe(4);
      expect(percent(97, 100)).toBe(97);
      expect(percent(0, 0)).toBe(0);
      expect(timeAgo(minutesAgo(12), NOW)).toBe('12 min ago');
      expect(timeAgo(minutesAgo(2 * 24 * 60), NOW)).toBe('2 days ago');
      expect(timeAgo(minutesAgo(90), NOW)).toBe('1 hour ago');
      expect(timeAgo(minutesAgo(1), NOW, 'short')).toBe('1m ago');
      expect(timeAgo(new Date(NOW).toISOString(), NOW)).toBe('just now');
    });
  });

  describe('FilesMetrics', () => {
    const metric = (heading: string) => screen.getByRole('heading', { name: heading }).parentElement as HTMLElement;

    it('shows dirty nodes, nodes cleared this week and active claims, in that order', async () => {
      wrap(<FilesMetrics />);
      await waitFor(() => expect(within(metric('Dirty nodes')).getByText('284')).toBeDefined());
      await waitFor(() => expect(within(metric('Active claims')).getByText('3')).toBeDefined());
      expect(within(metric('Active claims')).getByText('2 agents')).toBeDefined();
      await waitFor(() => expect(within(metric('Cleared this week')).getByText('42')).toBeDefined());
      expect(within(metric('Cleared this week')).getByText('+40%')).toBeDefined();
      expect(within(metric('Dirty nodes')).getByText('+31')).toBeDefined();
      expect(within(metric('Dirty nodes')).getByRole('img', { name: 'Net change this week' })).toBeDefined();
      expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Dirty nodes', 'Cleared this week', 'Active claims']);
      expect(calls('/v3/insights/trends')).toHaveLength(1);
      expect(calls('/v3/events').filter(u => u.searchParams.get('types') === 'nodes.cleared')).toEqual([]);
    });

    it('signs falling trends', async () => {
      db.trends = { complete: true, total: { cleared: 9, clearedPrevious: 12, clearedChangePct: -25, dirtied: 0, netDirty: -12 } };
      wrap(<FilesMetrics />);
      await waitFor(() => expect(within(metric('Cleared this week')).getByText('-25%')).toBeDefined());
      expect(within(metric('Dirty nodes')).getByText('-12')).toBeDefined();
    });

    it('shows no change chip when last week cleared nothing or nothing moved', async () => {
      db.trends = { complete: true, total: { cleared: 5, clearedPrevious: 0, clearedChangePct: null, dirtied: 5, netDirty: 0 } };
      wrap(<FilesMetrics />);
      await waitFor(() => expect(within(metric('Cleared this week')).getByText('5')).toBeDefined());
      expect(within(metric('Cleared this week')).queryByText(/%$/)).toBeNull();
      expect(within(metric('Dirty nodes')).queryByRole('img')).toBeNull();
    });

    it('hides every trend chip while the event log holds less than two weeks', async () => {
      db.trends = { complete: false, total: { cleared: 7, clearedPrevious: 0, clearedChangePct: 100, dirtied: 40, netDirty: 33 } };
      wrap(<FilesMetrics />);
      await waitFor(() => expect(within(metric('Cleared this week')).getByText('7')).toBeDefined());
      expect(within(metric('Cleared this week')).queryByText('+100%')).toBeNull();
      expect(within(metric('Dirty nodes')).queryByText('+33')).toBeNull();
    });

    it('refreshes counts from live events', async () => {
      wrap(<FilesMetrics />);
      await waitFor(() => expect(within(metric('Active claims')).getByText('3')).toBeDefined());

      db.files = db.files.map(f => (f.name === 'Sandbox' ? { ...f, counts: { ...f.counts, dirty: 271 } } : f));
      act(() => stream().emit('nodes.cleared', { fileKey: 'AbCdEf123456GhIjKl7890', type: 'nodes.cleared', data: { nodeIds: [] } }));
      await waitFor(() => expect(within(metric('Dirty nodes')).getByText('274')).toBeDefined());

      db.claims = db.claims.filter(c => c.worker !== 'devin');
      act(() => stream().emit('claim.released', { fileKey: 'AbCdEf123456GhIjKl7890', type: 'claim.released', data: {} }));
      await waitFor(() => expect(within(metric('Active claims')).getByText('2')).toBeDefined());
      expect(within(metric('Active claims')).getByText('1 agent')).toBeDefined();
    });
  });

  describe('FilesTable', () => {
    const renderTable = () => {
      const onOpenFile = vi.fn();
      const onOpenConnect = vi.fn();
      const view = wrap(<FilesTable onOpenFile={onOpenFile} onOpenConnect={onOpenConnect} />);
      return { onOpenFile, onOpenConnect, view };
    };
    const row = (name: string) => screen.getByRole('row', { name });

    it('renders a row per file with scopes, dirty, implemented, last sync and agents', async () => {
      const { view } = renderTable();
      expect(screen.getByRole('heading', { name: 'Tracked files' })).toBeDefined();
      await waitFor(() => expect(screen.getByText('3 files')).toBeDefined());
      expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['File', 'Scopes', 'Dirty', 'Implemented', 'Last sync', 'Agents']);

      const sandbox = within(row('Sandbox'));
      expect(sandbox.getByText('AbCdEf123456GhIjKl7890')).toBeDefined();
      await waitFor(() => expect(sandbox.getByText('1 scope')).toBeDefined());
      expect(sandbox.getByText('Team View')).toBeDefined();
      expect(sandbox.getByText('281').className).toContain('bg-utility-warning-50');
      expect(sandbox.getByRole('progressbar', { name: 'Sandbox implemented' }).getAttribute('aria-valuenow')).toBe('4');
      expect(sandbox.getByText('12 min ago')).toBeDefined();
      await waitFor(() => expect(sandbox.getByText('plugin/0.10.0')).toBeDefined());
      await waitFor(() => expect(sandbox.getByText('claude-local')).toBeDefined());
      expect(sandbox.getByText('+1 agent')).toBeDefined();

      const crm = within(row('Client CRM'));
      await waitFor(() => expect(crm.getByText('4 scopes')).toBeDefined());
      expect(crm.getByText('Pipelines, Frame 216, +2')).toBeDefined();
      expect(crm.getByRole('progressbar', { name: 'Client CRM implemented' }).getAttribute('aria-valuenow')).toBe('97');
      expect(crm.getByText('2 days ago')).toBeDefined();
      expect(crm.getByText('no claims')).toBeDefined();

      await expectNoAxeViolations(view.container);
    });

    it('shows the empty state for a file without scopes, linking to Connect', async () => {
      const { onOpenFile, onOpenConnect } = renderTable();
      await waitFor(() => expect(within(row('Rolling Design Sync — Portal')).getByText('No scopes yet')).toBeDefined());
      const portal = within(row('Rolling Design Sync — Portal'));
      expect(portal.getByText('0').className).toContain('bg-utility-gray-50');
      expect(portal.getByRole('progressbar', { name: 'Rolling Design Sync — Portal implemented' }).getAttribute('aria-valuenow')).toBe('0');
      expect(portal.getByText('Never')).toBeDefined();
      fireEvent.click(portal.getByRole('button', { name: 'Run the plugin on a frame' }));
      expect(onOpenConnect).toHaveBeenCalledTimes(1);
      expect(onOpenFile).not.toHaveBeenCalled();
    });

    it('opens a file on row click or Enter', async () => {
      const { onOpenFile } = renderTable();
      await waitFor(() => expect(row('Sandbox')).toBeDefined());
      fireEvent.click(within(row('Sandbox')).getByText('Sandbox'));
      expect(onOpenFile).toHaveBeenLastCalledWith('AbCdEf123456GhIjKl7890');
      fireEvent.keyDown(row('Client CRM'), { key: 'Enter' });
      expect(onOpenFile).toHaveBeenLastCalledWith('ZyXwVu987654TsRqPo3210');
    });

    it('updates rows from sync.completed and claim events', async () => {
      renderTable();
      await waitFor(() => expect(within(row('Rolling Design Sync — Portal')).getByText('No scopes yet')).toBeDefined());
      expect(FakeEventSource.instances).toHaveLength(1);

      db.files = db.files.map(f =>
        f.name === 'Rolling Design Sync — Portal' ? { ...f, lastSyncAt: minutesAgo(0), counts: { total: 40, dirty: 30, clean: 10, blocked: 0 } } : f,
      );
      db.scopes[PORTAL_DESIGN_FILE] = [{ nodeId: '33:3540', name: 'Section 1' }];
      db.clients[PORTAL_DESIGN_FILE] = 'plugin/0.10.1';
      act(() => stream().emit('sync.completed', { fileKey: PORTAL_DESIGN_FILE, type: 'sync.completed', data: { client: 'plugin/0.10.1' } }));
      const portal = within(row('Rolling Design Sync — Portal'));
      await waitFor(() => expect(portal.getByText('Section 1')).toBeDefined());
      await waitFor(() => expect(portal.getByText('30')).toBeDefined());
      expect(portal.getByRole('progressbar', { name: 'Rolling Design Sync — Portal implemented' }).getAttribute('aria-valuenow')).toBe('25');
      await waitFor(() => expect(portal.getByText('plugin/0.10.1')).toBeDefined());
      expect(calls('/v3/files/ZyXwVu987654TsRqPo3210/scopes')).toHaveLength(1);

      db.claims = [...db.claims, { claimId: 'c4', worker: 'devin', fileKey: PORTAL_DESIGN_FILE, createdAt: minutesAgo(0), nodeIds: ['33:1'], nodeCount: 1 }];
      act(() => stream().emit('claim.created', { fileKey: PORTAL_DESIGN_FILE, type: 'claim.created', data: {} }));
      await waitFor(() => expect(portal.getByText('devin')).toBeDefined());
      expect(portal.getByText('claimed just now')).toBeDefined();
    });
  });
});
