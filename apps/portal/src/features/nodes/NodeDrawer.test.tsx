import { QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { toastQueue, ToastRegion } from '../../components/Toast';
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
    expect(await claim.findByText('devin · claimed 2 min ago · lease expires in 15 min')).toBeTruthy();
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
    await dialog.findByText('devin · claimed 2 min ago · lease expires in 15 min');
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
    expect(await screen.findByText(/Not claimed/)).toBeTruthy();
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
    await screen.findByText('devin · claimed 2 min ago · lease expires in 15 min');
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
