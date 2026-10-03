import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSignInRedirect } from '../api/client';
import { FakeEventSource } from '../test/fake-event-source';
import { navItemOf } from './Layout';
import { routes } from './router';
import { readNodeFilters, readWorkState, writeNodeFilters, writeWorkState } from './urlState';

const FILE = 'AbC123';
const fetchMock = vi.fn<typeof fetch>();
const redirect = vi.fn<(next: string) => void>();
let restore: () => void;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const scope = {
  nodeId: '1:2',
  name: 'Team View',
  type: 'SECTION',
  figmaUrl: `https://www.figma.com/design/${FILE}?node-id=1-2`,
  lastSyncAt: minutesAgo(12),
  counts: { total: 281, dirty: 20, clean: 260, blocked: 1 },
};
const claim = {
  claimId: 'c1',
  fileKey: FILE,
  fileName: 'Sandbox',
  worker: 'devin',
  label: 'Agent session',
  nodeIds: ['1:5'],
  nodeCount: 1,
  createdAt: minutesAgo(2),
  expiresAt: inMinutes(14),
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function api(method: string, path: string): Response {
  const routes: Record<string, unknown> = {
    'GET /v3/session': { role: 'agent', label: 'devin', expiresAt: inMinutes(60) },
    'DELETE /v3/session': {},
    'GET /v3/status': { version: '0.10.0', events: 'listening', replayHours: 24 },
    'GET /v3/claims': { claims: [claim] },
    'GET /v3/files': { files: [{ fileKey: FILE, name: 'Sandbox', lastSyncAt: scope.lastSyncAt, counts: scope.counts }] },
    [`GET /v3/files/${FILE}`]: { fileKey: FILE, name: 'Sandbox', counts: scope.counts },
    [`GET /v3/files/${FILE}/scopes`]: { fileKey: FILE, scopes: [scope, { nodeId: '9:9', name: 'Old', deleted: true }] },
    [`GET /v3/files/${FILE}/claims`]: { fileKey: FILE, claims: [claim] },
    [`GET /v3/files/${FILE}/nodes`]: { nodes: [], nextCursor: null },
    [`GET /v3/files/${FILE}/nodes/1:5`]: { nodeId: '1:5', name: 'Page header', type: 'INSTANCE', state: 'dirty' },
    [`GET /v3/files/${FILE}/work`]: { items: [], total: 37, nextCursor: null },
    [`GET /v3/files/${FILE}/events`]: { fileKey: FILE, events: [] },
    'GET /v3/events': { events: [] },
    'GET /v3/tokens': { tokens: [] },
  };
  const body = routes[`${method} ${path}`];
  return body === undefined ? json({ type: 'about:blank', status: 404, code: 'not_found', title: 'Not found' }, 404) : json(body);
}

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const search = (router: ReturnType<typeof renderAt>) => new URLSearchParams(router.state.location.search);
const sidebar = () => within(screen.getByRole('navigation', { name: 'Main' }));

describe('routes', () => {
  beforeEach(() => {
    window.localStorage.clear();
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', fetchMock);
    restore = setSignInRedirect(redirect);
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      return api(init?.method ?? 'GET', decodeURIComponent(url.pathname));
    });
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    redirect.mockReset();
  });

  it.each([
    ['/files', 'Files'],
    [`/files/${FILE}/nodes?under=1:2`, 'Team View'],
    [`/files/${FILE}/work?under=1:2`, 'Team View'],
    [`/files/${FILE}/activity?under=1:2`, 'Team View'],
    [`/files/${FILE}/claims?under=1:2`, 'Team View'],
    [`/files/${FILE}/scopes?under=1:2`, 'Team View'],
    ['/activity', 'Activity'],
    ['/agents', 'Agents'],
    ['/connect', 'Connect'],
    ['/nope', 'Page not found'],
  ])('%s shows its page inside the shell', async (url, title) => {
    renderAt(url);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeDefined();
    expect(screen.getByText('Rolling Design Sync')).toBeDefined();
    expect(screen.getByRole('main').className.split(' ')).toEqual(expect.arrayContaining(['gap-4xl', 'px-6xl', 'py-3xl']));
  });

  it('composes each screen from its features', async () => {
    renderAt('/files');
    expect(await screen.findByText('Tracked files')).toBeDefined();
    expect(await screen.findByText('Sandbox')).toBeDefined();
  });

  it('shows the file header, scope meta and tabs on file screens', async () => {
    renderAt(`/files/${FILE}/scopes?under=1:2`);
    expect(await screen.findByText(/Section 1:2 · synced 12 min ago · 281 nodes, 37 components/)).toBeDefined();
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumbs' }));
    expect(crumbs.getByRole('link', { name: 'Files' }).getAttribute('href')).toBe('/files');
    expect(crumbs.getByText('Sandbox')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open in Figma' }).getAttribute('href')).toBe(scope.figmaUrl);
    expect(screen.getByRole('tab', { name: 'Scopes' }).getAttribute('aria-selected')).toBe('true');
    const table = within(await screen.findByRole('table', { name: 'Scopes' }));
    expect(table.getByText('Team View')).toBeDefined();
    expect(table.queryByText('Old')).toBeNull();
    expect(table.getByRole('link', { name: 'Nodes in Team View' }).getAttribute('href')).toBe(`/files/${FILE}/nodes?under=1%3A2`);
  });

  it('redirects the root to Files', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Files' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/files');
  });

  it('redirects a file to its first scope’s nodes', async () => {
    const router = renderAt(`/files/${FILE}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/files/${FILE}/nodes`));
    await waitFor(() => expect(search(router).get('under')).toBe('1:2'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Team View' })).toBeDefined();
  });

  it('sends a signed-out user to sign-in with the page to come back to', async () => {
    fetchMock.mockResolvedValue(json({ type: 'about:blank', status: 401, code: 'unauthorized', title: 'Sign in' }, 401));
    window.history.replaceState(null, '', '/ui/activity?paused=1');
    renderAt('/activity?paused=1');
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(redirect.mock.calls[0]?.[0]).toBe('/ui/activity?paused=1');
    window.history.replaceState(null, '', '/');
  });

  it('opens and closes the node drawer through ?node=', async () => {
    const router = renderAt(`/files/${FILE}/nodes?under=1:2&node=1:5&state=dirty`);
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('heading', { name: 'Page header' })).toBeDefined();
    await userEvent.setup().click(dialog.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(search(router).get('node')).toBeNull());
    expect(search(router).get('under')).toBe('1:2');
    expect(search(router).get('state')).toBe('dirty');
  });

  it('links API paths like the Outline export outside the router', async () => {
    renderAt(`/files/${FILE}/nodes?under=1:2`);
    const outline = await screen.findByRole('link', { name: 'Outline' });
    expect(outline.getAttribute('href')).toMatch(/^\/v3\/files\//);
  });

  it('switches file tabs through the URL, keeping the scope', async () => {
    const router = renderAt(`/files/${FILE}/nodes?under=1:2`);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Work items' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/files/${FILE}/work`));
    expect(search(router).get('under')).toBe('1:2');
  });

  it('keeps the work group in the URL and sends Flat list to Nodes', async () => {
    const router = renderAt(`/files/${FILE}/work?under=1:2&group=frame&page=3`);
    const user = userEvent.setup();
    const byComponent = await screen.findByRole('radio', { name: 'By component' });
    expect(screen.getByRole('radio', { name: 'By frame' }).getAttribute('aria-checked')).toBe('true');
    await user.click(byComponent);
    await waitFor(() => expect(search(router).get('group')).toBeNull());
    expect(search(router).get('page')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Flat list' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/files/${FILE}/nodes`));
    expect(search(router).get('under')).toBe('1:2');
  });

  it('marks the current sidebar item and sends Nodes and Work to the last file', async () => {
    renderAt('/activity');
    expect(await sidebar().findByRole('link', { name: 'Nodes' })).toBeDefined();
    expect(sidebar().getByRole('link', { name: 'Nodes' }).getAttribute('href')).toBe('/files');
    expect(sidebar().getByRole('link', { name: /Activity/ }).getAttribute('aria-current')).toBe('page');
    expect(await sidebar().findByLabelText('1 active agents')).toBeDefined();
    expect(sidebar().queryByText('Settings')).toBeNull();
    expect(sidebar().getByRole('link', { name: /Docs/ }).getAttribute('href')).toMatch(/github\.com\/.+\/docs$/);
  });

  it('remembers the last visited file', async () => {
    renderAt(`/files/${FILE}/work?under=1:2`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Team View' })).toBeDefined();
    expect(sidebar().getByRole('link', { name: 'Work' }).getAttribute('aria-current')).toBe('page');
    expect(window.localStorage.getItem('rds.portal.lastFile')).toBe(FILE);
    expect(sidebar().getByRole('link', { name: 'Nodes' }).getAttribute('href')).toBe(`/files/${FILE}/nodes`);
  });

  it('shows the server status and the session, and signs out', async () => {
    const router = renderAt('/files');
    const user = userEvent.setup();
    FakeEventSource.instances.find(s => s.url === '/v3/events')?.open();
    expect(await screen.findByText('API connected')).toBeDefined();
    expect(await screen.findByText(/v0\.10\.0 · live events on/)).toBeDefined();
    const aside = within(screen.getByRole('complementary'));
    expect(await aside.findByText('Agent')).toBeDefined();
    expect(aside.getByText('devin')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(fetchMock.mock.calls.some(([input, init]) => String(input) === '/v3/session' && init?.method === 'DELETE')).toBe(true);
  });
});

describe('URL state', () => {
  it('round-trips node filters and keeps other keys', () => {
    const params = writeNodeFilters(new URLSearchParams('under=1:2&node=1:5'), {
      q: 'button',
      state: 'dirty',
      changeType: 'added',
      category: 'color',
      type: 'FRAME',
      expandInstances: true,
    });
    expect(params.toString()).toBe('under=1%3A2&node=1%3A5&q=button&state=dirty&change=added&category=color&type=FRAME&expand=instances');
    expect(readNodeFilters(params)).toEqual({
      q: 'button',
      state: 'dirty',
      changeType: 'added',
      category: 'color',
      type: 'FRAME',
      expandInstances: true,
    });
    expect(writeNodeFilters(params, { state: 'all' }).toString()).toBe('under=1%3A2&node=1%3A5');
    expect(readNodeFilters(new URLSearchParams('state=bogus&category=nope'))).toEqual({});
  });

  it('round-trips the work group and page', () => {
    expect(readWorkState(new URLSearchParams())).toEqual({ group: 'component', page: 1 });
    const params = writeWorkState(new URLSearchParams('under=1:2'), { group: 'frame', page: 2 });
    expect(readWorkState(params)).toEqual({ group: 'frame', page: 2 });
    expect(writeWorkState(params, { group: 'component', page: 1 }).toString()).toBe('under=1%3A2');
    expect(readWorkState(new URLSearchParams('page=-4&group=x'))).toEqual({ group: 'component', page: 1 });
  });

  it('maps paths to sidebar items', () => {
    expect(navItemOf('/files')).toBe('files');
    expect(navItemOf(`/files/${FILE}/nodes`)).toBe('nodes');
    expect(navItemOf(`/files/${FILE}/work`)).toBe('work');
    expect(navItemOf(`/files/${FILE}/scopes`)).toBe('files');
    expect(navItemOf('/agents')).toBe('agents');
    expect(navItemOf('/nope')).toBeNull();
  });
});
