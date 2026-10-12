import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toastQueue, ToastRegion } from '../../components/Toast';
import { expectNoAxeViolations } from '../../test/axe';
import { FILE, mockApi, renderWithClient, type Route } from '../nodes/test-fixtures';
import { FileSettingsDrawer, type FileSettingsDrawerProps } from '.';

const file = (track: boolean) => ({ fileKey: FILE, name: 'Rolling Design Sync — Portal', settings: { trackLibraryComponents: track }, counts: { total: 6, dirty: 2, clean: 4, blocked: 0 } });
const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } });

function routes({ track = true, links = false, patch }: { track?: boolean; links?: boolean; patch?: Route } = {}): Route {
  let current = track;
  return call => {
    if (call.path === '/v3/session') return { role: 'agent', label: 'devin' };
    if (call.path === '/v3/status') return { version: '0.13.1', libraryLinks: links };
    if (call.path === `/v3/files/${FILE}` && call.method === 'GET') return file(current);
    if (call.path === `/v3/files/${FILE}` && call.method === 'PATCH') {
      const custom = patch?.(call);
      if (custom !== undefined) return custom;
      current = (call.body as { settings: { trackLibraryComponents: boolean } }).settings.trackLibraryComponents;
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

describe('FileSettingsDrawer', () => {
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
});
