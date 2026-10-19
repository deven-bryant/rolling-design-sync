import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { NodeDrawer } from './NodeDrawer';
import { parseMasks } from './RenderCheckPanel';
import { acceptScreenshots, fileToBase64, formatBytes, SCREENSHOT_MAX_BYTES } from './screenshots';
import { breadcrumbs, FILE, mockApi, node, renderWithClient, treeRoutes, type Route } from './test-fixtures';
import type { SessionRole } from './types';

const att = (id: string, kind: string) => ({
  attachmentId: id,
  kind,
  contentType: 'image/png',
  size: 4096,
  width: 200,
  height: 100,
  url: `/v3/files/${FILE}/attachments/${id}`,
  thumbUrl: `/v3/files/${FILE}/attachments/${id}?size=thumb`,
});

const frame = node('1:9', { name: 'Work items', type: 'FRAME', state: 'clean' });
const screenState = {
  nodeId: '1:9',
  route: '/work',
  viewport: { width: 200, height: 100 },
  threshold: 1,
  masks: [{ x: 0, y: 0, width: 200, height: 10 }],
  status: 'mismatch',
  stale: false,
  score: 3.4,
  reference: att('ref', 'reference'),
  lastCheck: { checkId: 'k1', status: 'mismatch', score: 3.4 },
};
const check = {
  checkId: 'k1',
  nodeId: '1:9',
  status: 'mismatch',
  requestedAt: new Date(Date.now() - 7_200_000).toISOString(),
  submittedAt: new Date(Date.now() - 7_200_000).toISOString(),
  commitRef: '4b11b44aa9f0',
  source: 'ci-playwright',
  score: 3.4,
  threshold: 1,
  regions: [{ x: 20, y: 10, width: 100, height: 50, pixels: 500 }],
  reference: att('ref', 'reference'),
  built: att('built', 'built'),
  heatmap: att('heat', 'heatmap'),
};
const renderNote = { noteId: 'n1', body: 'Render check: 3.4% of pixels differ', author: 'rds', source: 'render_check', createdAt: new Date().toISOString() };

function routes({
  detail = {},
  screens = [screenState],
  settings = {},
}: { detail?: Record<string, unknown>; screens?: object[]; settings?: Record<string, unknown> } = {}): Route {
  return treeRoutes(call => {
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/nodes/1:9`) return { ...frame, screen: screenState, notes: [renderNote], ...detail };
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/nodes/1:3`) return { ...breadcrumbs, type: 'INSTANCE', changesKnown: true };
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/screens`) return { fileKey: FILE, screens };
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/checks/k1`) return { fileKey: FILE, check };
    if (call.method === 'POST' && call.path === `/v3/files/${FILE}/screens/1:9/checks`) return { fileKey: FILE, check: { checkId: 'k2', status: 'requested' } };
    if (call.method === 'PUT' && call.path === `/v3/files/${FILE}/screens/1:9`) return { fileKey: FILE, screen: { ...screenState, ...(call.body as object) } };
    if (call.method === 'POST' && call.path === `/v3/files/${FILE}/nodes/1:3/notes`) return { node: { nodeId: '1:3', state: 'dirty' } };
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}`) return { fileKey: FILE, settings: { storeImages: true, ...settings } };
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/events`) return { fileKey: FILE, events: [], nextAfter: 0 };
    return undefined;
  });
}

function renderDrawer(role: SessionRole, route = routes(), nodeId = '1:9') {
  const api = mockApi(route);
  const utils = renderWithClient(<NodeDrawer fileKey={FILE} nodeId={nodeId} onClose={vi.fn()} role={role} />);
  return { api, ...utils };
}

describe('render check section', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the last result: KV metadata, side-by-side images with regions, score and the heatmap', async () => {
    const user = userEvent.setup();
    renderDrawer('viewer');
    const dialog = within(await screen.findByRole('dialog'));
    const section = within(await dialog.findByRole('group', { name: /Render check/ }));
    expect(await section.findByText('4b11b44')).toBeTruthy();
    expect(section.getAllByRole('definition').map(d => d.textContent)).toEqual(['2 hours ago', '4b11b44', 'ci-playwright', '1%', '3.4%', '1']);
    expect(section.getByRole('heading', { name: 'Diff Status' })).toBeTruthy();
    expect(section.getByText('100 × 50 px at 20, 10')).toBeTruthy();
    const implemented = section.getByRole('button', { name: 'View Implemented' });
    expect(implemented.querySelector('img')?.getAttribute('src')).toBe(`/v3/files/${FILE}/attachments/built?size=thumb`);
    await user.click(section.getByRole('tab', { name: 'Heatmap' }));
    await user.click(section.getByRole('button', { name: 'View Heatmap' }));
    const lightbox = await screen.findByRole('dialog', { name: 'Heatmap' });
    expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(`/v3/files/${FILE}/attachments/heat`);
  });

  it('badges a render mismatch in the status row and on its note', async () => {
    renderDrawer('viewer');
    const dialog = within(await screen.findByRole('dialog'));
    const status = within(await dialog.findByRole('group', { name: 'Status' }));
    expect(status.getByText('Render mismatch')).toBeTruthy();
    expect(status.getByText('render')).toBeTruthy();
    expect(status.queryByText('note')).toBeNull();
    await userEvent.setup().click(dialog.getByRole('tab', { name: 'Change List' }));
    const note = within(await dialog.findByRole('listitem', { name: 'Note by rds' }));
    expect(note.getByText('Render mismatch')).toBeTruthy();
  });

  it('lets a viewer request a check but not change its settings', async () => {
    const user = userEvent.setup();
    const { api, container } = renderDrawer('viewer');
    const section = within(await screen.findByRole('group', { name: /Render check/ }));
    await section.findByText('4b11b44');
    expect(section.queryByRole('button', { name: 'Check settings' })).toBeNull();
    await user.click(section.getByRole('button', { name: 'Request check' }));
    await waitFor(() => expect(api.find('POST', `/v3/files/${FILE}/screens/1:9/checks`)).toHaveLength(1));
    await expectNoAxeViolations(container);
  });

  it('lets an agent change the route, viewport, theme, threshold and masks', async () => {
    const user = userEvent.setup();
    const { api } = renderDrawer('agent');
    const section = within(await screen.findByRole('group', { name: /Render check/ }));
    await user.click(await section.findByRole('button', { name: 'Check settings' }));
    const form = within(section.getByRole('form', { name: 'Check settings' }));
    expect((form.getByRole('textbox', { name: /Route/ }) as HTMLInputElement).value).toBe('/work');
    await user.type(form.getByRole('textbox', { name: 'Theme' }), 'dark');
    await user.clear(form.getByRole('textbox', { name: /Threshold/ }));
    await user.type(form.getByRole('textbox', { name: /Threshold/ }), '2');
    await user.click(form.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.find('PUT', `/v3/files/${FILE}/screens/1:9`)).toHaveLength(1));
    expect(api.find('PUT', `/v3/files/${FILE}/screens/1:9`)[0]?.body).toEqual({
      route: '/work',
      viewport: { width: 200, height: 100 },
      theme: 'dark',
      query: null,
      threshold: 2,
      masks: [{ x: 0, y: 0, width: 200, height: 10 }],
    });
  });

  it('validates the settings', async () => {
    const user = userEvent.setup();
    const { api } = renderDrawer('agent');
    const section = within(await screen.findByRole('group', { name: /Render check/ }));
    await user.click(await section.findByRole('button', { name: 'Check settings' }));
    const form = within(section.getByRole('form', { name: 'Check settings' }));
    await user.clear(form.getByRole('textbox', { name: /Route/ }));
    await user.type(form.getByRole('textbox', { name: 'Masks' }), '{Enter}oops');
    await user.click(form.getByRole('button', { name: 'Save settings' }));
    expect(form.getByText('Enter the built page’s path, e.g. /work.')).toBeTruthy();
    expect(form.getByText('One mask per line: x, y, width, height.')).toBeTruthy();
    expect(api.find('PUT', `/v3/files/${FILE}/screens/1:9`)).toHaveLength(0);
  });

  it('offers agents to set up a frame that isn’t a screen; viewers see nothing', async () => {
    const plain = routes({ detail: { screen: null, notes: [] }, screens: [] });
    renderDrawer('agent', plain);
    const section = within(await screen.findByRole('group', { name: /Render check/ }));
    expect(section.getByText('Not set up')).toBeTruthy();
    expect(section.getByRole('button', { name: 'Set up check' })).toBeTruthy();
    expect(section.queryByRole('button', { name: 'Request check' })).toBeNull();
  });

  it.each([
    ['requested', false, 'Requested', /Waiting for an agent/],
    ['building', false, 'Building', /still dirty/],
    ['passed', true, 'Stale', /older design/],
  ])('shows %s (stale %s) as %s', async (status, stale, label, message) => {
    renderDrawer(
      'viewer',
      routes({ detail: { screen: { status, stale, score: 0.2 }, notes: [] }, screens: [{ ...screenState, status, stale, lastCheck: null }] }),
    );
    const section = within(await screen.findByRole('group', { name: /Render check/ }));
    expect(section.getByText(label)).toBeTruthy();
    expect(await section.findByText(message)).toBeTruthy();
    if (status === 'requested') expect((section.getByRole('button', { name: 'Request check' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides on nodes that aren’t frames or screens', async () => {
    renderDrawer('agent', routes(), '1:3');
    await screen.findByRole('group', { name: 'Claim Holder' });
    expect(screen.queryByRole('group', { name: /Render check/ })).toBeNull();
  });
});

describe('note screenshots', () => {
  beforeEach(() => {
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const png = (name: string, size = 4) => new File([new Uint8Array(size)], name, { type: 'image/png' });

  async function openForm(settings = {}) {
    const user = userEvent.setup();
    const utils = renderDrawer('viewer', routes({ settings }), '1:3');
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(await dialog.findByRole('tab', { name: 'Change List' }));
    await user.click(await dialog.findByRole('button', { name: 'Add note' }));
    return { user, form: within(await dialog.findByRole('form', { name: 'Add change note' })), ...utils };
  }

  it('browses, pastes, previews, removes and uploads screenshots with the note', async () => {
    const { user, form, api, container } = await openForm();
    const input = form.getByRole('group', { name: 'Screenshots (optional)' }).querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, png('a.png'));
    fireEvent.paste(form.getByRole('textbox', { name: /Description/ }), { clipboardData: { files: [png('b.png')] } });
    const list = within(form.getByRole('list', { name: 'Attached screenshots' }));
    expect(list.getAllByRole('img').map(i => i.getAttribute('alt'))).toEqual(['a.png', 'b.png']);
    await user.click(list.getByRole('button', { name: 'Remove a.png' }));
    expect(list.getAllByRole('img').map(i => i.getAttribute('alt'))).toEqual(['b.png']);
    await expectNoAxeViolations(container);
    await user.type(form.getByRole('textbox', { name: /Description/ }), 'Spacing is off');
    await user.click(form.getByRole('button', { name: 'Add change note' }));
    await waitFor(() => expect(api.find('POST', `/v3/files/${FILE}/nodes/1:3/notes`)).toHaveLength(1));
    expect(api.find('POST', `/v3/files/${FILE}/nodes/1:3/notes`)[0]?.body).toEqual({
      body: 'Spacing is off',
      images: [{ data: 'AAAAAA==', name: 'b.png' }],
    });
  });

  it('refuses other types, big files and a fourth image', async () => {
    const { form } = await openForm();
    const box = form.getByRole('textbox', { name: /Description/ });
    fireEvent.paste(box, { clipboardData: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    expect(form.getByRole('alert').textContent).toBe('a.gif isn’t a PNG, JPG or WebP image.');
    fireEvent.paste(box, { clipboardData: { files: [png('1.png'), png('2.png'), png('3.png'), png('4.png')] } });
    expect(form.getByRole('alert').textContent).toBe('Attach at most 3 screenshots.');
    expect(within(form.getByRole('list', { name: 'Attached screenshots' })).getAllByRole('img')).toHaveLength(3);
    expect(form.queryByRole('button', { name: /Drop, paste/ })).toBeNull();
  });

  it('explains that screenshots are off when the file stores no images', async () => {
    const { form } = await openForm({ storeImages: false });
    await form.findByText('Screenshots are off for this file: its settings don’t store images.');
    expect(form.queryByRole('group', { name: 'Screenshots (optional)' })).toBeNull();
  });

  it('shows a note’s screenshots as thumbnails that open in a lightbox', async () => {
    const user = userEvent.setup();
    const shotNote = { noteId: 'n2', body: 'See screenshot', author: 'portal:ana', createdAt: new Date().toISOString(), attachments: [att('s1', 'screenshot')] };
    renderDrawer('viewer', routes({ detail: { notes: [shotNote] } }));
    await user.click(await screen.findByRole('tab', { name: 'Change List' }));
    const note = within(await screen.findByRole('listitem', { name: 'Note by ana' }));
    const thumb = note.getByRole('button', { name: 'View Screenshot 1' });
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(`/v3/files/${FILE}/attachments/s1?size=thumb`);
    await user.click(thumb);
    const lightbox = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(`/v3/files/${FILE}/attachments/s1`);
  });
});

describe('helpers', () => {
  it('parses masks', () => {
    expect(parseMasks('0, 0, 10, 20\n 5 5 1 1 ')).toEqual([
      { x: 0, y: 0, width: 10, height: 20 },
      { x: 5, y: 5, width: 1, height: 1 },
    ]);
    expect(parseMasks('')).toEqual([]);
    expect(parseMasks('1, 2, 3')).toBeNull();
  });

  it('validates and encodes screenshots', async () => {
    const big = new File([new Uint8Array(SCREENSHOT_MAX_BYTES + 1)], 'big.png', { type: 'image/png' });
    expect(acceptScreenshots([big], 0).error).toBe('big.png is over 5 MB (5 MB).');
    expect(formatBytes(4096)).toBe('4 KB');
    expect(await fileToBase64(new Blob(['hi']))).toBe('aGk=');
  });
});
