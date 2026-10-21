import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toastQueue, ToastRegion } from '../../components/Toast';
import { expectNoAxeViolations } from '../../test/axe';
import { FILE, mockApi, renderWithClient, type Route } from '../nodes/test-fixtures';
import { FileSettingsDrawer, type FileSettingsDrawerProps } from '.';

const file = (settings: Record<string, unknown>) => ({ fileKey: FILE, name: 'Rolling Design Sync — Portal', settings, counts: { total: 6, dirty: 2, clean: 4, blocked: 0 } });
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } });

function routes({
  track = true,
  links = false,
  patch,
  settings = {},
}: { track?: boolean; links?: boolean; patch?: Route; settings?: Record<string, unknown> } = {}): Route {
  let current: Record<string, unknown> = { trackLibraryComponents: track, ...settings };
  let scopes = [
    { nodeId: '1:1', name: 'Screens', checks: true },
    { nodeId: '2:1', name: 'Components', checks: false },
    { nodeId: 'tokens', name: 'Tokens', checks: false },
  ];
  return call => {
    if (call.path === `/v3/files/${FILE}/scopes`) return { fileKey: FILE, scopes };
    if (call.method === 'PATCH' && call.path.startsWith(`/v3/files/${FILE}/scopes/`)) {
      const id = call.path.split('/').pop();
      scopes = scopes.map(s => (s.nodeId === id ? { ...s, ...(call.body as object) } : s));
      return { fileKey: FILE, scope: scopes.find(s => s.nodeId === id) };
    }
    if (call.path === '/v3/session') return { role: 'agent', label: 'devin' };
    if (call.path === '/v3/status') return { version: '0.13.1', libraryLinks: links };
    if (call.path === `/v3/files/${FILE}` && call.method === 'GET') return file(current);
    if (call.path === `/v3/files/${FILE}` && call.method === 'PATCH') {
      const custom = patch?.(call);
      if (custom !== undefined) return custom;
      current = { ...current, ...(call.body as { settings: Record<string, unknown> }).settings };
      return file(current);
    }
    return undefined;
  };
}

function renderDrawer(props: Partial<FileSettingsDrawerProps> = {}, route: Route = routes()) {
  const api = mockApi(route);
  const onOpenChange = vi.fn();
  const utils = renderWithClient(
    <>
      <FileSettingsDrawer fileKey={FILE} isOpen onOpenChange={onOpenChange} role="agent" {...props} />
      <ToastRegion />
    </>,
  );
  return { api, onOpenChange, ...utils };
}

const hangFetch = (match: (url: URL) => boolean) => {
  const mocked = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    match(new URL(String(input), 'http://portal.test')) ? new Promise<Response>(() => {}) : mocked(input, init),
  );
};

describe('FileSettingsDrawer', () => {
  it('shows the shared spinner while the file settings load', async () => {
    mockApi(routes());
    hangFetch(url => url.pathname === `/v3/files/${FILE}`);
    renderWithClient(<FileSettingsDrawer fileKey={FILE} isOpen onOpenChange={vi.fn()} role="agent" />);
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Loading file settings…')).toBeTruthy();
    expect(dialog.getAllByRole('status').length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const toast of toastQueue.visibleToasts) act(() => toastQueue.close(toast.key));
    vi.unstubAllGlobals();
  });

  it('shows the file’s settings and library links state', async () => {
    renderDrawer();
    const dialog = within(await screen.findByRole('dialog', { name: 'File settings' }));
    expect(dialog.getByRole('heading', { name: 'File settings' })).toBeTruthy();
    expect(await dialog.findByText('Rolling Design Sync — Portal')).toBeTruthy();
    expect(dialog.getByRole('heading', { name: 'Library components' })).toBeTruthy();
    const toggle = dialog.getByRole('switch', { name: /Track library components/ }) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.checked).toBe(true);
    expect(dialog.getByText(/instances stay tracked either way/)).toBeTruthy();
    expect(await dialog.findByText('Links to library files: off (set RDS_FIGMA_TOKEN on the server)')).toBeTruthy();
    await expectNoAxeViolations(document.body);
  });

  it('agent: toggling PATCHes the file, refetches and shows a toast', async () => {
    const user = userEvent.setup();
    const { api, client } = renderDrawer({}, routes({ links: true }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const dialog = within(await screen.findByRole('dialog', { name: 'File settings' }));
    expect(await dialog.findByText('Links to library files: on')).toBeTruthy();
    const toggle = dialog.getByRole('switch', { name: /Track library components/ }) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', `/v3/files/${FILE}`)).toHaveLength(1));
    expect(api.find('PATCH', `/v3/files/${FILE}`)[0]?.body).toEqual({ settings: { trackLibraryComponents: false } });
    expect(within(await screen.findByRole('region', { name: 'Notifications' })).getByText('Library components are no longer tracked')).toBeTruthy();
    await waitFor(() => expect(toggle.checked).toBe(false));
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["files"]', `["files","${FILE}"]`, `["rds-nodes","${FILE}"]`, `["rds-file","${FILE}"]`, '["insights","trends"]']));
  });

  it('reverts the toggle with the error message when the change fails', async () => {
    const user = userEvent.setup();
    renderDrawer({}, routes({ patch: () => problem(403, 'wrong_token_class', 'Agent tokens only.') }));
    const dialog = within(await screen.findByRole('dialog', { name: 'File settings' }));
    const toggle = dialog.getByRole('switch', { name: /Track library components/ }) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    await user.click(toggle);
    expect((await dialog.findByRole('alert')).textContent).toBe('Agent tokens only.');
    await waitFor(() => expect(toggle.checked).toBe(true));
  });

  it('viewer: the toggle is disabled with a hint', async () => {
    const { api } = renderDrawer({ role: 'viewer' });
    const dialog = within(await screen.findByRole('dialog', { name: 'File settings' }));
    expect(dialog.getByText('Sign in with an agent token to change file settings.')).toBeTruthy();
    await dialog.findByText('Rolling Design Sync — Portal');
    expect((dialog.getByRole('switch', { name: /Track library components/ }) as HTMLInputElement).disabled).toBe(true);
    expect(api.find('PATCH', `/v3/files/${FILE}`)).toHaveLength(0);
    await expectNoAxeViolations(document.body);
  });

  it('render checks: auto-detect and one checks toggle per section (not tokens)', async () => {
    const user = userEvent.setup();
    const { api } = renderDrawer();
    const dialog = within(await screen.findByRole('dialog', { name: 'File settings' }));
    const auto = (await dialog.findByRole('switch', { name: /Auto-detect check targets/ })) as HTMLInputElement;
    await waitFor(() => expect(auto.disabled).toBe(false));
    expect(auto.checked).toBe(true);
    const sections = within(await dialog.findByRole('group', { name: 'Sections' }));
    expect(sections.getAllByRole('switch').map(s => (s as HTMLInputElement).checked)).toEqual([true, false]);
    await user.click(sections.getByRole('switch', { name: /Components/ }));
    await waitFor(() => expect(api.find('PATCH', `/v3/files/${FILE}/scopes/2:1`)[0]?.body).toEqual({ checks: true }));
    expect(await screen.findByText('Checking Components')).toBeTruthy();
    await user.click(auto);
    await waitFor(() => expect(api.find('PATCH', `/v3/files/${FILE}`)[0]?.body).toEqual({ settings: { autoTargets: false } }));
    await waitFor(() => expect((sections.getByRole('switch', { name: /Screens/ }) as HTMLInputElement).disabled).toBe(true));
  });

  it('saves variant mappings, theme, gallery and retention together', async () => {
    const user = userEvent.setup();
    const { api } = renderDrawer(
      {},
      routes({ settings: { variantMappings: { 'Color Mode': { as: 'theme', values: { Light: 'light', Dark: 'dark' } } }, themeMode: 'color-scheme', checkRetention: 5 } }),
    );
    const form = within(await screen.findByRole('form', { name: 'Render check settings' }));
    expect((form.getByRole('textbox', { name: 'Property' }) as HTMLInputElement).value).toBe('Color Mode');
    expect((form.getByRole('textbox', { name: /^Values/ }) as HTMLInputElement).value).toBe('Light=light, Dark=dark');
    await user.click(form.getByRole('button', { name: 'Add mapping' }));
    const second = within(form.getByRole('listitem', { name: 'Mapping 2' }));
    await user.type(second.getByRole('textbox', { name: 'Property' }), 'Density');
    await user.click(second.getByRole('button', { name: /As/ }));
    await user.click(await screen.findByRole('option', { name: 'Query' }));
    await user.type(second.getByRole('textbox', { name: /Query key/ }), 'd');
    await user.type(second.getByRole('textbox', { name: /^Values/ }), 'Compact=c');
    await user.click(form.getByRole('button', { name: /Theme mode/ }));
    await user.click(await screen.findByRole('option', { name: 'Query parameter' }));
    const retention = form.getByRole('textbox', { name: /Results kept per target/ });
    await user.clear(retention);
    await user.type(retention, '0');
    await user.type(form.getByRole('textbox', { name: /Gallery URL template/ }), '/gallery?figma={{set}');
    await user.click(form.getByRole('button', { name: 'Save check settings' }));
    expect(form.getByText('Enter a whole number from 1 to 100.')).toBeTruthy();
    expect(api.find('PATCH', `/v3/files/${FILE}`)).toHaveLength(0);
    await user.clear(retention);
    await user.type(retention, '8');
    await user.click(form.getByRole('button', { name: 'Save check settings' }));
    await waitFor(() =>
      expect(api.find('PATCH', `/v3/files/${FILE}`)[0]?.body).toEqual({
        settings: {
          variantMappings: { 'Color Mode': { as: 'theme', values: { Light: 'light', Dark: 'dark' } }, Density: { as: 'query', key: 'd', values: { Compact: 'c' } } },
          themeMode: 'query',
          themeKey: 'theme',
          gallery: { urlTemplate: '/gallery?figma={set}', storybookUrl: null },
          checkRetention: 8,
        },
      }),
    );
    expect(await screen.findByText('Check settings saved')).toBeTruthy();
  });

  it('viewer: render-check settings are read-only', async () => {
    renderDrawer({ role: 'viewer' });
    const dialog = within(await screen.findByRole('dialog', { name: 'File settings' }));
    const form = within(await dialog.findByRole('form', { name: 'Render check settings' }));
    expect((dialog.getByRole('switch', { name: /Auto-detect check targets/ }) as HTMLInputElement).disabled).toBe(true);
    const sections = within(await dialog.findByRole('group', { name: 'Sections' }));
    for (const s of sections.getAllByRole('switch')) expect((s as HTMLInputElement).disabled).toBe(true);
    expect((form.getByRole('textbox', { name: /Results kept per target/ }) as HTMLInputElement).disabled).toBe(true);
    expect(form.queryByRole('button', { name: 'Save check settings' })).toBeNull();
    expect(form.queryByRole('button', { name: 'Add mapping' })).toBeNull();
    await expectNoAxeViolations(screen.getByRole('dialog'));
  });
});
