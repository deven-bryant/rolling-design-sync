import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeEventSource } from '../../test/fake-event-source';
import { EventFeed, groupByMinute } from './EventFeed';
import type { ActivityEvent } from './events';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const NOW = Date.parse('2026-10-01T12:00:30Z');
const ev = (id: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id,
  fileKey: 'FILE1',
  type: 'claim.created',
  actor: 'devin',
  data: { claimId: `c${id}`, nodeIds: ['1:2'], nodeCount: 1, label: `claim ${id}` },
  createdAt: new Date(NOW - (100 - id) * 60_000).toISOString(),
  ...over,
});

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

const items = () => within(screen.getByRole('list', { name: 'Events' })).getAllByRole('listitem');
const source = () => FakeEventSource.instances[0] as FakeEventSource;

describe('EventFeed', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('loads the newest events in one order=desc page and lists them newest first', async () => {
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input), 'http://localhost');
      expect(url.pathname).toBe('/v3/events');
      expect(url.searchParams.get('since')).toBe(new Date(NOW - 24 * 3_600_000).toISOString());
      expect(url.searchParams.get('order')).toBe('desc');
      expect(url.searchParams.has('after')).toBe(false);
      expect(url.searchParams.has('before')).toBe(false);
      return json({ events: [ev(3), ev(2), ev(1, { fileKey: 'FILE2', fileName: null })], nextBefore: 1 });
    });
    const { container } = render(wrap(<EventFeed max={10} pageSize={3} />));
    await screen.findByRole('list', { name: 'Events' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').searchParams.get('limit')).toBe('3');
    expect(items().map(li => li.textContent)).toEqual([
      expect.stringContaining('claim 3'),
      expect.stringContaining('claim 2'),
      expect.stringContaining('claim 1'),
    ]);
    expect(screen.getAllByRole('link', { name: 'FILE1' })[0]?.getAttribute('href')).toBe('/files/FILE1/nodes');
    expect(screen.getByRole('link', { name: 'FILE2' }).getAttribute('href')).toBe('/files/FILE2/nodes');
    await expectNoAxeViolations(container);
  });

  it('names files from the JSON page, for streamed events too', async () => {
    fetchMock.mockResolvedValue(json({ events: [ev(1, { fileName: 'Checkout' })], nextBefore: 1 }));
    render(wrap(<EventFeed />));
    await screen.findByRole('list', { name: 'Events' });
    act(() => source().emit('claim.created', ev(2, { actor: 'cursor-ui' }), '2'));
    const links = screen.getAllByRole('link', { name: 'Checkout' });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/files/FILE1/nodes');
    expect(screen.queryByRole('link', { name: 'FILE1' })).toBeNull();
  });

  it('shows a note.added event’s note text, read from the node’s notes', async () => {
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/v3/files/FILE1/nodes/120%3A34609/notes') {
        expect(url.searchParams.get('status')).toBe('all');
        return json({ notes: [{ noteId: 'n1', body: 'Page number should be the number alone.', author: 'portal:viewer', status: 'resolved' }] });
      }
      return json({
        events: [
          ev(2, { type: 'note.added', actor: 'portal:viewer', data: { nodeId: '120:34609', noteId: 'n1', author: 'portal:viewer' } }),
          ev(1, { type: 'note.added', actor: 'portal:viewer', data: { nodeId: '120:34609', noteId: 'gone', author: 'portal:viewer' } }),
        ],
        nextBefore: 1,
      });
    });
    render(wrap(<EventFeed onOpenNode={() => {}} />));
    expect(await screen.findByText('Page number should be the number alone.')).toBeTruthy();
    expect(screen.getAllByText('Page number should be the number alone.')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/notes'))).toHaveLength(1);
  });

  it('asks for 500 events a page by default', async () => {
    fetchMock.mockResolvedValue(json({ events: [ev(1)], nextBefore: 1 }));
    render(wrap(<EventFeed />));
    await screen.findByRole('list', { name: 'Events' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').searchParams.get('limit')).toBe('500');
  });

  it('reads one file’s log and stream when given fileKey', async () => {
    fetchMock.mockResolvedValue(json({ fileKey: 'F/2', events: [ev(1, { fileKey: 'F/2' })], nextBefore: 1 }));
    render(wrap(<EventFeed fileKey="F/2" />));
    await screen.findByRole('list', { name: 'Events' });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').pathname).toBe('/v3/files/F%2F2/events');
    expect(source().url).toBe('/v3/files/F%2F2/events');
    expect(screen.queryByRole('link', { name: 'F/2' })).toBeNull();
  });

  it('puts streamed events on top and drops duplicates of the JSON page', async () => {
    fetchMock.mockResolvedValue(json({ events: [ev(1)], nextBefore: 1 }));
    render(wrap(<EventFeed />));
    await screen.findByRole('list', { name: 'Events' });
    expect(source().url).toBe('/v3/events');
    act(() => source().open());
    expect(screen.getByText('live')).toBeDefined();

    act(() => {
      source().emit('claim.created', ev(1), '1');
      source().emit('nodes.cleared', ev(2, { type: 'nodes.cleared', actor: 'cursor-ui', data: { nodeIds: ['3:4', '5:6'], commitRef: 'abcdef1234' } }), '2');
    });
    expect(items()).toHaveLength(2);
    expect(items()[0]?.textContent).toContain('nodes.cleared — 2 nodes at abcdef1');
    expect(items()[0]?.textContent).toContain('cursor-ui');
  });

  it('buffers events while paused, counts them, and shows them on resume', async () => {
    fetchMock.mockResolvedValue(json({ events: [ev(1)], nextBefore: 1 }));
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(wrap(<EventFeed />));
    await screen.findByRole('list', { name: 'Events' });

    await user.click(screen.getByRole('button', { name: 'Pause live' }));
    expect(screen.getByText('paused')).toBeDefined();
    act(() => {
      source().emit('claim.created', ev(2, { actor: 'claude-local' }), '2');
      source().emit('claim.created', ev(3, { actor: 'plugin' }), '3');
    });
    expect(items()).toHaveLength(1);
    expect(screen.getByRole('button', { name: '2 new' })).toBeDefined();

    act(() => source().emit('claim.created', ev(4, { actor: 'devin' }), '4'));
    await user.click(screen.getByRole('button', { name: '3 new' }));
    expect(items()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /new$/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause live' })).toBeDefined();
  });

  it('follows a controlled paused prop and calls onPausedChange', async () => {
    fetchMock.mockResolvedValue(json({ events: [], nextBefore: 0 }));
    const onPausedChange = vi.fn();
    const { rerender } = render(wrap(<EventFeed paused pauseControl={false} onPausedChange={onPausedChange} />));
    await screen.findByText(/No events yet/);
    act(() => source().emit('sync.completed', ev(5, { type: 'sync.completed', actor: 'plugin', data: { counts: { uploaded: 12, changed: 3, deleted: 0 } } }), '5'));
    expect(screen.queryByRole('list', { name: 'Events' })).toBeNull();
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole('button', { name: '1 new' }));
    expect(onPausedChange).toHaveBeenCalledWith(false);
    rerender(wrap(<EventFeed paused={false} pauseControl={false} onPausedChange={onPausedChange} />));
    expect(items()[0]?.textContent).toContain('sync.completed — 12 nodes, 3 changed, 0 deleted');
  });

  it('opens the nodes an event mentions', async () => {
    fetchMock.mockResolvedValue(
      json({ events: [ev(1, { type: 'nodes.cleared', data: { nodeIds: ['1:1', '1:2', '1:3', '1:4'] } })], nextBefore: 1 }),
    );
    const onOpenNode = vi.fn();
    render(wrap(<EventFeed onOpenNode={onOpenNode} />));
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(await screen.findByRole('button', { name: 'Open node 1:2' }));
    expect(onOpenNode).toHaveBeenCalledWith('FILE1', '1:2');
    expect(screen.queryByRole('button', { name: 'Open node 1:4' })).toBeNull();
    expect(screen.getByText('+1')).toBeDefined();
  });
});

describe('groupByMinute', () => {
  it('groups consecutive events by the same actor within one minute', () => {
    const at = (s: string) => `2026-10-01T12:${s}Z`;
    const groups = groupByMinute([
      ev(5, { actor: 'devin', createdAt: at('05:50') }),
      ev(4, { actor: 'devin', createdAt: at('05:01') }),
      ev(3, { actor: 'plugin', createdAt: at('05:00') }),
      ev(2, { actor: 'plugin', createdAt: at('04:59') }),
      ev(1, { actor: null, createdAt: at('04:10') }),
    ]);
    expect(groups.map(g => [g.actor, g.events.map(e => e.id)])).toEqual([
      ['devin', [5, 4]],
      ['plugin', [3]],
      ['plugin', [2]],
      ['system', [1]],
    ]);
  });
});
