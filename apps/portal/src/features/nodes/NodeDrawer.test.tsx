import { QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { toastQueue, ToastRegion } from '../../components/Toast';
import { expectNoAxeViolations } from '../../test/axe';
import { LIBRARY_LINKS_OFF, NodeDrawer, type NodeDrawerProps } from './NodeDrawer';
import { breadcrumbs, claimC1, divider, FILE, mockApi, node, renderWithClient, treeRoutes, type Route } from './test-fixtures';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const detail = {
  ...breadcrumbs,
  changesKnown: true,
  history: { implementedCommit: '3f2a9c1e5d7b', implementedAt: daysAgo(2) },
};
const events = [
  {
    id: 7,
    fileKey: FILE,
    type: 'claim.created',
    actor: 'devin',
    data: { claimId: 'c1', nodeCount: 3, expiresAt: claimC1.expiresAt, nodeIds: claimC1.nodeIds },
    createdAt: claimC1.createdAt,
  },
];

function drawerRoutes(extra?: Route): Route {
  return treeRoutes(call => {
    const custom = extra?.(call);
    if (custom !== undefined) return custom;
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/nodes/1:3`) return detail;
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/nodes/1:4`) return divider;
    if (call.method === 'GET' && call.path === `/v3/files/${FILE}/events`) return { fileKey: FILE, events, nextAfter: 7 };
    return undefined;
  });
}

function renderDrawer(props: Partial<NodeDrawerProps> = {}, routes = drawerRoutes()) {
  const api = mockApi(routes);
  const onClose = vi.fn();
  const utils = renderWithClient(<NodeDrawer fileKey={FILE} nodeId="1:3" onClose={onClose} role="agent" {...props} />);
  return { api, onClose, ...utils };
}

function renderWithToasts(props: Partial<NodeDrawerProps> = {}, routes = drawerRoutes()) {
  const api = mockApi(routes);
  const utils = renderWithClient(
    <>
      <NodeDrawer fileKey={FILE} nodeId="1:3" onClose={vi.fn()} role="agent" {...props} />
      <ToastRegion />
    </>,
  );
  return { api, ...utils };
}

describe('NodeDrawer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the node’s status, claim and Change List from changes=diff', async () => {
    const { api } = renderDrawer();
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByRole('heading', { name: 'Breadcrumbs' })).toBeTruthy();
    expect(dialog.getByText('FRAME · 1:3')).toBeTruthy();
    const status = within(dialog.getByRole('group', { name: 'Status' }));
    expect(status.getByText('Dirty')).toBeTruthy();
    expect(status.getByText('Modified')).toBeTruthy();
    expect(status.getByText('layout')).toBeTruthy();
    expect(dialog.getByRole('tab', { name: 'Change History' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.setup().click(dialog.getByRole('tab', { name: 'Change List' }));
    expect(dialog.getByText(/Since it was last cleared at 3f2a9c1 \(2 days ago\)/)).toBeTruthy();
    const row = within(dialog.getByRole('table', { name: 'Change list' })).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['itemSpacing', 'spacing-md12', 'spacing-lg16']);
    const claim = within(dialog.getByRole('group', { name: 'Claim Holder' }));
    expect(await claim.findByText('2 min ago')).toBeTruthy();
    expect(claim.getAllByRole('definition').map(d => d.textContent)).toEqual(['devin', '2 min ago', 'in 15 min']);
    expect(claim.getByText('covers 2 other nodes too')).toBeTruthy();
    expect(dialog.getByRole('link', { name: 'Open in Figma' }).getAttribute('href')).toBe(breadcrumbs.figmaUrl);
    expect(api.find('GET', `/v3/files/${FILE}/nodes/1:3`)[0]?.query.get('changes')).toBe('diff');
  });

  it('switches to Change History: the node’s events, newest first (order=desc), keeping the actions', async () => {
    const user = userEvent.setup();
    const older = { id: 3, fileKey: FILE, type: 'node.unblocked', actor: 'cursor', data: {}, createdAt: daysAgo(3) };
    const { api } = renderDrawer(
      {},
      drawerRoutes(call =>
        call.method === 'GET' && call.path === `/v3/files/${FILE}/events` ? { fileKey: FILE, events: [...events, older], nextAfter: 7 } : undefined,
      ),
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect((await dialog.findByRole('tab', { name: 'Change History' })).getAttribute('aria-selected')).toBe('true');
    const feed = within(dialog.getByRole('list', { name: 'Change history' }));
    expect(feed.getAllByRole('listitem').map(i => i.textContent)).toEqual([
      expect.stringContaining('Claimed this node with 2 others (lease 17 min).'),
      expect.stringContaining('Unblocked it.'),
    ]);
    expect(dialog.queryByRole('table')).toBeNull();
    const query = api.find('GET', `/v3/files/${FILE}/events`)[0]?.query;
    expect(query?.get('nodeId')).toBe('1:3');
    expect(query?.get('order')).toBe('desc');
    expect(dialog.getByRole('button', { name: 'Release claim' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Block…' })).toBeTruthy();
    await user.click(dialog.getByRole('tab', { name: 'Change List' }));
    expect(dialog.getByRole('table', { name: 'Change list' })).toBeTruthy();
    expect(dialog.getByRole('heading', { name: 'Breadcrumbs' })).toBeTruthy();
  });

  it('opens at 583px on Change History, widens for Change List and narrows again', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const dialog = await screen.findByRole('dialog');
    const classes = () => dialog.parentElement?.getAttribute('class')?.split(' ') ?? [];
    expect(classes()).toEqual(expect.arrayContaining(['w-145.75', 'max-w-full']));
    await user.click(await within(dialog).findByRole('tab', { name: 'Change List' }));
    expect(classes()).toEqual(expect.arrayContaining(['w-275', 'max-w-full']));
    expect(classes()).not.toContain('w-145.75');
    await user.click(within(dialog).getByRole('tab', { name: 'Change History' }));
    expect(classes()).toContain('w-145.75');
  });

  it('opens each node on Change History', async () => {
    const user = userEvent.setup();
    const { client, rerender } = renderDrawer();
    await user.click(await screen.findByRole('tab', { name: 'Change List' }));
    rerender(
      <QueryClientProvider client={client}>
        <NodeDrawer fileKey={FILE} nodeId="1:4" onClose={() => {}} role="agent" />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('tab', { name: 'Change History' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('dialog').parentElement?.getAttribute('class')?.split(' ')).toContain('w-145.75');
  });

  it('shows viewers the same content without claim or block actions', async () => {
    renderDrawer({ role: 'viewer' });
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByText('in 15 min');
    expect(dialog.queryByRole('button', { name: 'Release claim' })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Block…' })).toBeNull();
    expect(dialog.getByRole('button', { name: 'Copy node prompt' })).toBeTruthy();
    expect(dialog.getByRole('link', { name: 'Open in Figma' })).toBeTruthy();
  });

  it('takes the role from the session when none is given', async () => {
    renderDrawer({ role: undefined });
    expect(await screen.findByRole('button', { name: 'Release claim' })).toBeTruthy();
  });

  it('confirms before releasing a claim that covers other nodes', async () => {
    const user = userEvent.setup();
    const { api } = renderDrawer(
      {},
      drawerRoutes(call => (call.method === 'DELETE' ? { fileKey: FILE, claimId: 'c1', released: 3 } : undefined)),
    );
    await screen.findByText(/covers 2 other nodes too/);
    await user.click(screen.getByRole('button', { name: 'Release claim' }));
    const confirm = within(screen.getByRole('alertdialog', { name: 'Release the whole claim?' }));
    expect(confirm.getByText(/also covers 2 other nodes/)).toBeTruthy();
    expect(api.find('DELETE', `/v3/files/${FILE}/claims/c1`)).toHaveLength(0);
    await user.click(confirm.getByRole('button', { name: 'Release 3 nodes' }));
    await waitFor(() => expect(api.find('DELETE', `/v3/files/${FILE}/claims/c1`)).toHaveLength(1));
    expect(await screen.findByText(/^Unclaimed/)).toBeTruthy();
  });

  it('releases a single-node claim without confirming', async () => {
    const user = userEvent.setup();
    const { api } = renderDrawer(
      {},
      drawerRoutes(call => {
        if (call.method === 'DELETE') return { fileKey: FILE, claimId: 'c1', released: 1 };
        if (call.path === `/v3/files/${FILE}/claims`) return { fileKey: FILE, claims: [{ ...claimC1, nodeCount: 1, nodeIds: ['1:3'] }] };
        return undefined;
      }),
    );
    await screen.findByText('in 15 min');
    await user.click(screen.getByRole('button', { name: 'Release claim' }));
    await waitFor(() => expect(api.find('DELETE', `/v3/files/${FILE}/claims/c1`)).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('requires a 1–500 character reason to block', async () => {
    const user = userEvent.setup();
    const blockPath = `/v3/files/${FILE}/nodes/1:3/block`;
    const { api } = renderDrawer(
      {},
      drawerRoutes(call =>
        call.method === 'POST' && call.path === blockPath
          ? { fileKey: FILE, node: { ...breadcrumbs, state: 'blocked', blocked: { reason: 'Waiting on a token', by: 'devin', at: new Date().toISOString() } } }
          : undefined,
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Block…' }));
    await user.click(screen.getByRole('button', { name: 'Block node' }));
    expect(screen.getByText('Enter why this node can’t be implemented.')).toBeTruthy();
    const reason = screen.getByRole('textbox', { name: /Reason/ });
    await user.click(reason);
    await user.paste('x'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Block node' }));
    expect(screen.getByText(/Keep the reason to 500 characters/)).toBeTruthy();
    expect(api.find('POST', blockPath)).toHaveLength(0);
    await user.clear(reason);
    await user.type(reason, 'Waiting on a token');
    await user.click(screen.getByRole('button', { name: 'Block node' }));
    await waitFor(() => expect(api.find('POST', blockPath)).toHaveLength(1));
    expect(api.find('POST', blockPath)[0]?.body).toEqual({ reason: 'Waiting on a token' });
    expect(await screen.findByRole('button', { name: 'Unblock' })).toBeTruthy();
    expect(screen.getByText(/Blocked by devin/)).toBeTruthy();
  });

  it('unblocks a blocked node', async () => {
    const user = userEvent.setup();
    const unblockPath = `/v3/files/${FILE}/nodes/1:4/unblock`;
    const { api } = renderDrawer(
      { nodeId: '1:4' },
      drawerRoutes(call =>
        call.method === 'POST' && call.path === unblockPath ? { fileKey: FILE, node: { ...divider, state: 'dirty', blocked: null } } : undefined,
      ),
    );
    expect(await screen.findByText(/Blocked by agent-c/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(api.find('POST', unblockPath)).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Block…' })).toBeTruthy();
  });

  it('copies a node prompt with the file key, node id and CLI / MCP calls', async () => {
    const user = userEvent.setup();
    renderDrawer({ role: 'viewer' });
    await user.click(await screen.findByRole('button', { name: 'Copy node prompt' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    const text = await navigator.clipboard.readText();
    expect(text).toContain(FILE);
    expect(text).toContain('1:3');
    expect(text).toContain('node scripts/rds-agent.js');
    expect(text).toContain('get_node');
  });

  describe('removed and library nodes', () => {
    const removedRoot = node('12:345', { name: 'Files', state: 'dirty', changeType: 'deleted', changedProps: ['childOrder'] });
    const libUnresolved = node('9:1', { name: 'Lib button', type: 'COMPONENT', library: { key: 'LIBKEY123', resolved: false }, figmaUrl: null });
    const libResolved = node('9:5', {
      name: 'Lib card',
      type: 'COMPONENT',
      library: { key: 'LIBKEY5', fileKey: 'LIBFILE', resolved: true },
      figmaUrl: 'https://www.figma.com/design/LIBFILE/Library?node-id=7-7',
    });
    const removal = {
      name: 'Files',
      uses: [
        { componentId: '1:10', name: 'Button', livePlacements: 4, placementsRemoved: 2 },
        { componentId: '1:11', name: 'Pricing card', livePlacements: 0, placementsRemoved: 1 },
      ],
      warnings: [{ code: 'main_removed_with_live_placements' as const, componentId: '1:11', livePlacements: 2 }],
    };
    const routes = (libraryLinks: boolean) =>
      drawerRoutes(call => {
        if (call.path === '/v3/status') return { version: '0.13.1', libraryLinks };
        for (const n of [removedRoot, libUnresolved, libResolved]) if (call.path === `/v3/files/${FILE}/nodes/${n.nodeId}`) return n;
        return undefined;
      });

    afterEach(() => {
      for (const toast of toastQueue.visibleToasts) act(() => toastQueue.close(toast.key));
    });

    it('shows the Removal panel above the change list and copies the removal prompt', async () => {
      const user = userEvent.setup();
      renderDrawer({ nodeId: '12:345', removal }, routes(false));
      const dialog = within(await screen.findByRole('dialog'));
      const panel = within(await dialog.findByRole('group', { name: 'Removed from the design' }));
      expect(panel.getByText('Remove the code that rendered “Files”. Keep components that are still used.')).toBeTruthy();
      const items = within(panel.getByRole('list', { name: 'Components it used' })).getAllByRole('listitem');
      expect(items.map(li => li.textContent)).toEqual(['Pricing cardnone leftLikely unused', 'Button4 placements leftKeep']);
      expect(panel.getByText('“Pricing card” was deleted from the design but 2 instances still use it.')).toBeTruthy();
      const order = dialog.getByRole('group', { name: 'Removed from the design' }).compareDocumentPosition(dialog.getByRole('tablist'));
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await user.click(panel.getByRole('button', { name: 'Copy removal prompt' }));
      expect(await panel.findByRole('button', { name: 'Copied' })).toBeTruthy();
      const text = await navigator.clipboard.readText();
      expect(text).toContain(`The Figma design "Files" (12:345) in file ${FILE} was deleted; remove the code that rendered it.`);
      expect(text).toContain('Keep the components it used that are still placed elsewhere: "Button" (4 placements left).');
      expect(text).toContain('Consider removing the components nothing uses any more: "Pricing card".');
      expect(text).toContain('"Pricing card": its main component was removed with the design, but 2 instances still use it — keep its code.');
      expect(text).toContain(`clear_nodes { "fileKey": "${FILE}", "items": [{ "nodeId": "12:345", "contentHash": "<contentHash>", "subtree": true }], "commitRef": "<sha>" }`);
      expect(text).toContain('node scripts/rds-agent.js nodes show 12:345');
      expect(text).toContain('"subtree": true');
    });

    it('has no Removal panel without a removed item', async () => {
      renderDrawer({ nodeId: '12:345' }, routes(false));
      const dialog = within(await screen.findByRole('dialog'));
      expect(await dialog.findByRole('heading', { name: 'Files' })).toBeTruthy();
      expect(dialog.queryByRole('group', { name: 'Removed from the design' })).toBeNull();
    });

    it('badges a library node and offers its component key instead of a broken link, with a toast', async () => {
      const user = userEvent.setup();
      const { api } = renderWithToasts({ nodeId: '9:1', role: 'viewer' }, routes(false));
      const dialog = within(await screen.findByRole('dialog'));
      await waitFor(() => expect(api.find('GET', '/v3/status')).toHaveLength(1));
      const heading = await dialog.findByRole('heading', { name: /Lib button/ });
      expect(within(heading).getByText('Library').className).toContain('bg-utility-gray-50');
      expect(dialog.queryByRole('link', { name: 'Open in Figma' })).toBeNull();
      const copy = dialog.getByRole('button', { name: 'Copy component key' });
      expect(copy.className).toContain('ring-primary');
      await user.click(heading);
      await act(() => user.hover(copy));
      expect((await screen.findByRole('tooltip', { hidden: true }, { timeout: 2000 })).textContent).toBe(LIBRARY_LINKS_OFF);
      await user.click(copy);
      expect(await navigator.clipboard.readText()).toBe('LIBKEY123');
      expect(within(await screen.findByRole('region', { name: 'Notifications' })).getByText('Component key copied')).toBeTruthy();
    });

    it('has no tooltip on Copy component key while library links are on', async () => {
      const user = userEvent.setup();
      const { api } = renderDrawer({ nodeId: '9:1' }, routes(true));
      const dialog = within(await screen.findByRole('dialog'));
      const copy = await dialog.findByRole('button', { name: 'Copy component key' });
      await waitFor(() => expect(api.find('GET', '/v3/status')).toHaveLength(1));
      await user.click(dialog.getByRole('heading', { name: /Lib button/ }));
      await act(() => user.hover(copy));
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('opens a resolved library node in its library file', async () => {
      renderDrawer({ nodeId: '9:5' }, routes(true));
      const dialog = within(await screen.findByRole('dialog'));
      const open = await dialog.findByRole('link', { name: 'Open in Figma' });
      expect(open.getAttribute('href')).toBe(libResolved.figmaUrl);
      expect(dialog.queryByRole('button', { name: 'Copy component key' })).toBeNull();
      expect(dialog.getByText('Library')).toBeTruthy();
    });
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing without a node', () => {
    renderDrawer({ nodeId: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('NodeDrawer notes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => toastQueue.clear());
  });

  const mine = { noteId: 'n1', body: 'The divider should be 2px.', author: 'portal:devin', createdAt: new Date(Date.now() - 120_000).toISOString() };
  const theirs = { noteId: 'n2', body: 'Wrong gap.', author: 'portal:alex', createdAt: new Date(Date.now() - 120_000).toISOString() };
  const requested = { ...detail, state: 'dirty', changeType: 'requested', changedProps: [], changes: {}, notes: [mine, theirs] };
  const noted = (n: object) => (call: { method: string; path: string }) => (call.method === 'GET' && call.path === `/v3/files/${FILE}/nodes/1:3` ? n : undefined);

  const openList = async () => {
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.setup().click(await dialog.findByRole('tab', { name: 'Change List' }));
    return dialog;
  };

  it('adds a note from the Add Change view: validation, counter, toast, back to the list', async () => {
    const added = { ...detail, state: 'dirty', changeType: 'requested', notes: [mine] };
    const { api } = renderWithToasts(
      { role: 'viewer' },
      drawerRoutes(call =>
        call.method === 'POST' && call.path === `/v3/files/${FILE}/nodes/1:3/notes` ? { fileKey: FILE, note: { ...mine, status: 'open' }, node: added } : undefined,
      ),
    );
    const dialog = await openList();
    const user = userEvent.setup();
    await user.click(dialog.getByRole('button', { name: 'Add change note' }));
    await user.click(dialog.getByRole('button', { name: 'Add Change Note' }));
    expect(dialog.getByText('Describe what doesn’t match the design.')).toBeTruthy();
    expect(api.find('POST', `/v3/files/${FILE}/nodes/1:3/notes`)).toHaveLength(0);
    await user.type(dialog.getByRole('textbox', { name: /Description/ }), 'The divider should be 2px.');
    expect(dialog.getByText('26/4000')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Add Change Note' }));
    expect(await screen.findByText('Note added — the node needs a change')).toBeTruthy();
    expect(api.find('POST', `/v3/files/${FILE}/nodes/1:3/notes`)[0]?.body).toEqual({ body: 'The divider should be 2px.' });
    expect(await dialog.findByRole('table', { name: 'Change list' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Add change note' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('rejects a note over 4000 characters', async () => {
    renderDrawer({ role: 'viewer' });
    const dialog = await openList();
    const user = userEvent.setup();
    await user.click(dialog.getByRole('button', { name: 'Add change note' }));
    const box = dialog.getByRole('textbox', { name: /Description/ });
    await user.click(box);
    await user.paste('x'.repeat(4001));
    await user.click(dialog.getByRole('button', { name: 'Add Change Note' }));
    expect(dialog.getByText('Keep the note to 4000 characters (4001 now).')).toBeTruthy();
  });

  it('shows a requested node’s open notes instead of “no changes”, with Requested and note badges', async () => {
    renderDrawer({}, drawerRoutes(noted(requested)));
    const dialog = await openList();
    const notes = within(dialog.getByRole('region', { name: 'Open notes' }));
    const first = within(notes.getByRole('listitem', { name: 'Note by devin' }));
    expect(first.getByText('The divider should be 2px.')).toBeTruthy();
    expect(first.getByText('2 min ago')).toBeTruthy();
    expect(dialog.queryByText('Nothing changed since it was last cleared.')).toBeNull();
    const status = within(dialog.getByRole('group', { name: 'Status' }));
    expect(status.getByText('Requested')).toBeTruthy();
    expect(status.getByText('note')).toBeTruthy();
  });

  it('gives the author Edit / Delete / Dismiss, an agent Dismiss only on others’ notes', async () => {
    renderDrawer({}, drawerRoutes(noted(requested)));
    const dialog = await openList();
    const first = within(dialog.getByRole('listitem', { name: 'Note by devin' }));
    const second = within(dialog.getByRole('listitem', { name: 'Note by alex' }));
    expect(await first.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(first.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(first.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(second.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(second.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(second.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('a viewer can add notes but not dismiss others’ (and keeps no agent actions)', async () => {
    renderDrawer({ role: 'viewer' }, drawerRoutes(noted(requested)));
    const dialog = await openList();
    expect(dialog.getByRole('button', { name: 'Add change note' })).toBeTruthy();
    const second = within(dialog.getByRole('listitem', { name: 'Note by alex' }));
    expect(second.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Block…' })).toBeNull();
  });

  it('edits, deletes and (after confirming) dismisses notes', async () => {
    const { api } = renderWithToasts(
      {},
      drawerRoutes(call => {
        if (call.path === `/v3/files/${FILE}/notes/n1` && (call.method === 'PATCH' || call.method === 'DELETE')) return { fileKey: FILE, note: mine };
        if (call.method === 'POST' && call.path === `/v3/files/${FILE}/notes/n2/dismiss`) return { fileKey: FILE, note: theirs };
        return noted(requested)(call);
      }),
    );
    const dialog = await openList();
    const user = userEvent.setup();
    const first = () => within(dialog.getByRole('listitem', { name: 'Note by devin' }));
    await user.click(await first().findByRole('button', { name: 'Edit' }));
    const box = first().getByRole('textbox', { name: 'Edit note' });
    await user.clear(box);
    await user.type(box, 'The divider should be 3px.');
    await user.click(first().getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.find('PATCH', `/v3/files/${FILE}/notes/n1`)[0]?.body).toEqual({ body: 'The divider should be 3px.' }));
    expect(await screen.findByText('Note updated')).toBeTruthy();

    await user.click(first().getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', `/v3/files/${FILE}/notes/n1`)).toHaveLength(1));

    const second = within(dialog.getByRole('listitem', { name: 'Note by alex' }));
    await user.click(second.getByRole('button', { name: 'Dismiss' }));
    const confirm = within(second.getByRole('alertdialog', { name: 'Dismiss this note?' }));
    expect(api.find('POST', `/v3/files/${FILE}/notes/n2/dismiss`)).toHaveLength(0);
    await user.click(confirm.getByRole('button', { name: 'Dismiss note' }));
    await waitFor(() => expect(api.find('POST', `/v3/files/${FILE}/notes/n2/dismiss`)).toHaveLength(1));
    expect(await screen.findByText('Note dismissed')).toBeTruthy();
  });

  it('lists note added / resolved / dismissed in the history', async () => {
    const noteEvents = [
      { id: 12, fileKey: FILE, type: 'note.dismissed', actor: 'devin', data: { nodeId: '1:3', noteId: 'n2', reason: 'Matches now' }, createdAt: claimC1.createdAt },
      { id: 11, fileKey: FILE, type: 'note.resolved', actor: 'devin', data: { nodeId: '1:3', noteId: 'n1', commitRef: 'abcdef1234567' }, createdAt: claimC1.createdAt },
      { id: 10, fileKey: FILE, type: 'note.added', actor: 'portal:alex', data: { nodeId: '1:3', noteId: 'n1' }, createdAt: claimC1.createdAt },
    ];
    renderDrawer({}, drawerRoutes(call => (call.method === 'GET' && call.path === `/v3/files/${FILE}/events` ? { fileKey: FILE, events: noteEvents } : undefined)));
    const feed = within(await screen.findByRole('dialog'));
    expect(await feed.findByText('Added a note: the built node doesn’t match the design.')).toBeTruthy();
    expect(feed.getByText('Resolved a note by clearing it at abcdef1.')).toBeTruthy();
    expect(feed.getByText('Dismissed a note: Matches now')).toBeTruthy();
  });

  it('has no axe violations with notes and in Add Change', async () => {
    renderDrawer({}, drawerRoutes(noted(requested)));
    const dialog = await openList();
    await dialog.findByRole('button', { name: 'Edit' });
    const el = await screen.findByRole('dialog');
    await expectNoAxeViolations(el);
    await userEvent.setup().click(dialog.getByRole('button', { name: 'Add change note' }));
    await expectNoAxeViolations(el);
  });
});
