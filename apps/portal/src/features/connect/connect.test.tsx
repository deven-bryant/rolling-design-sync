import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeEventSource } from '../../test/fake-event-source';
import { AgentSetup } from './AgentSetup';
import { AGENT_HOSTS, agentSetupSnippets, TOKEN_PLACEHOLDER } from './snippets';
import { StatusMetrics } from './StatusMetrics';
import { TokensTable } from './TokensTable';
import { serverHealth, useServerStatus } from './useServerStatus';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-01T12:00:00Z');

const STATUS = {
  version: '0.10.1',
  storage: 'postgres',
  events: 'listening',
  replayHours: 24,
  plugin: { lastSyncAt: new Date(NOW - 12 * 60_000).toISOString(), client: 'plugin/0.10.0' },
};

const TOKENS = [
  { class: 'plugin', label: 'Figma plugin', lastUsedAt: new Date(NOW - 12 * 60_000).toISOString() },
  { class: 'agent', label: 'devin', lastUsedAt: new Date(NOW - 30_000).toISOString() },
  { class: 'agent', label: 'claude-local', lastUsedAt: null },
  { class: 'viewer', label: 'design team', lastUsedAt: new Date(NOW - 2 * 86_400_000).toISOString() },
];

function serve() {
  fetchMock.mockImplementation(async input => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/v3/status') return json(STATUS);
    if (path === '/v3/tokens') return json(TOKENS);
    throw new Error(`unexpected ${path}`);
  });
}

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  serve();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('useServerStatus', () => {
  function Probe() {
    const { status, stream, health } = useServerStatus();
    return <output aria-label="status">{`${status?.version ?? '-'} ${stream} ${health}`}</output>;
  }

  it('reports the status and the event stream state', async () => {
    render(wrap(<Probe />));
    const out = () => screen.getByLabelText('status').textContent;
    expect(out()).toBe('- connecting connecting');
    act(() => FakeEventSource.instances[0]?.open());
    await vi.waitFor(() => expect(out()).toBe('0.10.1 live live'));
    act(() => FakeEventSource.instances[0]?.fail());
    expect(out()).toBe('0.10.1 reconnecting degraded');
    act(() => FakeEventSource.instances[0]?.fail({ closed: true }));
    expect(out()).toBe('0.10.1 closed offline');
  });

  it('re-reads status after a sync', async () => {
    render(wrap(<Probe />));
    await vi.waitFor(() => expect(screen.getByLabelText('status').textContent).toContain('0.10.1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => FakeEventSource.instances[0]?.emit('sync.completed', { id: 1 }, '1'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('derives health', () => {
    expect(serverHealth('live', false, true)).toBe('offline');
    expect(serverHealth('connecting', true, false)).toBe('connecting');
  });
});

describe('StatusMetrics', () => {
  it('shows the server version, event delivery and plugin last seen', async () => {
    const { container } = render(wrap(<StatusMetrics />));
    expect(await screen.findByText('v0.10.1')).toBeDefined();
    expect(screen.getByText('healthy')).toBeDefined();
    expect(screen.getByText('LISTEN/NOTIFY')).toBeDefined();
    expect(screen.getByText('0.10.0')).toBeDefined();
    expect(screen.getByText('synced 12 min ago')).toBeDefined();
    act(() => FakeEventSource.instances[0]?.open());
    expect(screen.getByText('Live')).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('says polling when the server polls for events', async () => {
    fetchMock.mockResolvedValue(json({ ...STATUS, events: 'polling', plugin: { lastSyncAt: null, client: null } }));
    render(wrap(<StatusMetrics />));
    expect(await screen.findByText('polling')).toBeDefined();
    expect(screen.getByText('no sync yet')).toBeDefined();
  });
});

describe('AgentSetup', () => {
  it('gives every host a snippet with this server’s origin and only the token placeholder', () => {
    const snippets = agentSetupSnippets('https://rds.example.com', 'FILE1');
    for (const host of AGENT_HOSTS) {
      const code = snippets[host.id];
      expect(code).toContain('https://rds.example.com');
      expect(code).toContain(TOKEN_PLACEHOLDER);
      for (const [, value] of code.matchAll(/RDS_AGENT_TOKEN["']?\s*[:=]\s*["']?([^"'\s\\,]+[^"'\\,\n]*)/g))
        expect(value?.trim()).toBe(TOKEN_PLACEHOLDER);
    }
    expect(snippets['claude-code']).toContain('claude mcp add rds --scope user --transport stdio');
    expect(snippets['claude-code']).toContain('--env RDS_FILE_KEY=FILE1');
    expect(JSON.parse(snippets.cursor).mcpServers.rds.env).toEqual({
      RDS_API_BASE_URL: 'https://rds.example.com',
      RDS_AGENT_TOKEN: TOKEN_PLACEHOLDER,
      RDS_FILE_KEY: 'FILE1',
    });
    expect(snippets.cli).toContain('node scripts/rds-agent.js');
  });

  it('renders host tabs pointed at the current origin, never a token', async () => {
    const { container } = render(<AgentSetup />);
    const user = userEvent.setup({ advanceTimers: () => {} });
    const tabs = within(screen.getByRole('tablist', { name: 'Agent host' })).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Claude Code', 'Cursor', 'Devin', 'CLI']);
    for (const name of ['Claude Code', 'Cursor', 'Devin', 'CLI']) {
      await user.click(screen.getByRole('tab', { name }));
      const panel = screen.getByRole('tabpanel');
      expect(panel.textContent).toContain(window.location.origin);
      expect(panel.textContent).not.toContain('/ui');
      expect(panel.textContent).toContain(TOKEN_PLACEHOLDER);
    }
    await expectNoAxeViolations(container);
  });
});

describe('TokensTable', () => {
  it('lists classes, labels, what each class can do and last use', async () => {
    const { container } = render(wrap(<TokensTable />));
    const table = await screen.findByRole('table', { name: 'Tokens' });
    expect(screen.getByText('3 classes')).toBeDefined();
    const rows = within(table).getAllByRole('row').slice(1).map(r => r.textContent);
    expect(rows).toEqual([
      'PluginFigma pluginRDS_PLUGIN_TOKENS #1Upload syncshashes, sync, exists12 min ago',
      'AgentdevinRDS_AGENT_TOKENS #1Read, claim, clear, blockevery v3 agent routeJust now',
      'Agentclaude-localRDS_AGENT_TOKENS #2Read, claim, clear, blockevery v3 agent routeNever',
      'Viewerdesign teamRDS_VIEWER_TOKENS #1Read onlyevery v3 GET, events2 days ago',
    ]);
    await expectNoAxeViolations(container);
  });
});
