import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { FakeEventSource } from '../../test/fake-event-source';
import { categoriesOf, categoryOf } from './categories';
import { isTokenNodeId, nodePrompt, tokenMeta, tokenModeChanges, tokenValueView } from './format';
import { NodeDrawer } from './NodeDrawer';
import { NodeTable } from './NodeTable';
import {
  BG_ACTIVE,
  BG_HOVER,
  bgActive,
  bgHover,
  COLLECTION,
  collection,
  FILE,
  GRAY_800,
  gray800,
  mockApi,
  radius,
  RADIUS,
  renderWithClient,
  tokensRoot,
  treeRoutes,
  type Route,
} from './test-fixtures';

const pagePath = `/v3/files/${FILE}/nodes`;

const tokenRoutes: Route = treeRoutes(call => {
  if (call.path === `/v3/files/${FILE}/scopes`) {
    return { fileKey: FILE, scopes: [{ nodeId: 'tokens', name: 'Design tokens', type: 'TOKENS', figmaUrl: null, counts: { dirty: 3 } }] };
  }
  if (call.path === pagePath) {
    const under = call.query.get('under');
    if (under === 'tokens') return { fileKey: FILE, nodes: [tokensRoot, collection], nextCursor: null, total: 2 };
    if (under === COLLECTION) return { fileKey: FILE, nodes: [collection, bgActive, bgHover, radius], nextCursor: null, total: 4 };
  }
  if (call.path === `${pagePath}/${BG_ACTIVE}`) return { ...bgActive, changesKnown: true, usage: { layers: 214 } };
  if (call.path === `${pagePath}/${BG_HOVER}`) return { ...bgHover, changesKnown: true, usage: { layers: 1 } };
  if (call.path === `${pagePath}/${GRAY_800}`) return { ...gray800, changesKnown: true, usage: { layers: 0 } };
  if (call.path === `/v3/files/${FILE}/events`) return { fileKey: FILE, events: [], nextAfter: 0 };
  return undefined;
});

const row = (nodeId: string) => {
  const el = document.querySelector<HTMLElement>(`tr[data-node-id="${nodeId}"]`);
  if (!el) throw new Error(`No row for ${nodeId}`);
  return el;
};

describe('design tokens: format', () => {
  it('recognises token node ids', () => {
    expect([isTokenNodeId('tokens'), isTokenNodeId(COLLECTION), isTokenNodeId(BG_ACTIVE), isTokenNodeId('1:2'), isTokenNodeId(null)]).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('categorizes mode values as token and descriptions as content, like the API', () => {
    expect(categoryOf('value:Dark')).toBe('token');
    expect(categoryOf('description')).toBe('content');
    expect(categoriesOf(['value:Dark', 'codeSyntax', 'name'])).toEqual(['structure', 'token', 'other']);
  });

  it('describes tokens by type, resolved type and code name, and collections by their modes', () => {
    expect(tokenMeta(bgActive)).toBe('VARIABLE · COLOR · --color-bg-active');
    expect(tokenMeta(bgHover)).toBe('VARIABLE · COLOR');
    expect(tokenMeta(radius)).toBe('VARIABLE · FLOAT');
    expect(tokenMeta(collection)).toBe('VARIABLE_COLLECTION · 2 modes');
    expect(tokenMeta(tokensRoot)).toBe('TOKENS');
  });

  it('shows colors with a swatch, numbers plainly and aliases by the target’s short name', () => {
    expect(tokenValueView('#2b3033')).toEqual({ text: '#2b3033', swatch: '#2b3033' });
    expect(tokenValueView('#2b303380')).toEqual({ text: '#2b303380', swatch: '#2b303380' });
    expect(tokenValueView(1.23456)).toEqual({ text: '1.2346' });
    expect(tokenValueView(true)).toEqual({ text: 'true' });
    expect(tokenValueView('Inter')).toEqual({ text: 'Inter' });
    expect(tokenValueView({ alias: GRAY_800, name: 'Colors/gray-800' })).toEqual({ text: 'gray-800', alias: GRAY_800, aliasName: 'Colors/gray-800' });
  });

  it('lists the changed modes in changedProps order', () => {
    expect(tokenModeChanges(radius).map(m => [m.mode, m.built, m.now])).toEqual([
      ['Comfy', 12, 10],
      ['Compact', 4, 6],
      ['Default', 6, 8],
    ]);
  });

  it('builds a token prompt that updates the code variable per changed mode', () => {
    const prompt = nodePrompt({ fileKey: 'KEY', nodeId: BG_ACTIVE, name: 'Colors/Background/bg-active', codeSyntax: '--color-bg-active' });
    expect(prompt).toContain(`Update the design token "Colors/Background/bg-active" (${BG_ACTIVE}) in file KEY`);
    expect(prompt).toContain('3. Update the code variable --color-bg-active (its codeSyntax) for each changed mode (value:<Mode>) and commit.');
    expect(prompt).toContain(`clear ${BG_ACTIVE}=<contentHash>`);
    const unnamed = nodePrompt({ fileKey: 'KEY', nodeId: BG_HOVER, name: 'Colors/Background/bg-hover' });
    expect(unnamed).toContain('Update the code variable named after the token (Colors/Background/bg-hover) for each changed mode');
    expect(nodePrompt({ fileKey: 'KEY', nodeId: '1:3' })).toContain('3. Implement the changes and commit them.');
  });
});

describe('design tokens: node tree', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists collections then tokens, asking for attrs, with token meta and mode changes with swatches', async () => {
    const user = userEvent.setup();
    const api = mockApi(tokenRoutes);
    const { container } = renderWithClient(<NodeTable fileKey={FILE} scopeId="tokens" filters={{}} onFiltersChange={vi.fn()} />);
    await waitFor(() => expect(row(COLLECTION)).toBeDefined());
    expect(within(row(COLLECTION)).getByText('VARIABLE_COLLECTION · 2 modes')).toBeTruthy();
    expect(api.find('GET', pagePath)[0]?.query.get('fields')).toContain('attrs');
    await user.click(within(row(COLLECTION)).getByRole('button', { name: 'Expand Semantic' }));
    await waitFor(() => expect(row(BG_ACTIVE)).toBeDefined());
    expect(api.find('GET', pagePath).find(c => c.query.get('under') === COLLECTION)?.query.get('fields')).toContain('attrs');

    const active = within(row(BG_ACTIVE));
    expect(active.getByText('Colors/Background/bg-active')).toBeTruthy();
    expect(active.getByText('VARIABLE · COLOR · --color-bg-active')).toBeTruthy();
    expect(active.getByText('Dirty')).toBeTruthy();
    expect(active.getByText('Modified')).toBeTruthy();
    expect(active.getByText('token')).toBeTruthy();
    expect(active.getByText('Dark')).toBeTruthy();
    const swatches = [...row(BG_ACTIVE).querySelectorAll<HTMLElement>('[data-slot="swatch"]')].map(s => s.style.backgroundColor);
    expect(swatches).toEqual(['rgb(32, 37, 39)', 'rgb(43, 48, 51)']);
    expect(active.getByText('#202527')).toBeTruthy();
    expect(active.getByText('#2b3033')).toBeTruthy();

    const hover = within(row(BG_HOVER));
    expect(hover.getByText('gray-800').closest('[title]')?.getAttribute('title')).toBe('Colors/gray-800');
    expect(row(BG_HOVER).querySelectorAll('[data-slot="swatch"]')).toHaveLength(1);

    const sizes = within(row(RADIUS));
    expect(sizes.getByText('Comfy')).toBeTruthy();
    expect(sizes.getByText('Compact')).toBeTruthy();
    expect(sizes.queryByText('Default')).toBeNull();
    expect(sizes.getByText('+1 modes')).toBeTruthy();
    expect(row(RADIUS).querySelector('[data-slot="swatch"]')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('keeps layer listings compact', async () => {
    const api = mockApi(treeRoutes());
    renderWithClient(<NodeTable fileKey={FILE} scopeId="1:1" filters={{}} onFiltersChange={vi.fn()} />);
    await screen.findByText('Breadcrumbs');
    expect(api.find('GET', pagePath)[0]?.query.has('fields')).toBe(false);
  });
});

describe('design tokens: node drawer', () => {
  afterEach(() => vi.unstubAllGlobals());

  const renderDrawer = (nodeId: string, onOpenNode = vi.fn()) => {
    mockApi(tokenRoutes);
    return { onOpenNode, ...renderWithClient(<NodeDrawer fileKey={FILE} nodeId={nodeId} onClose={vi.fn()} onOpenNode={onOpenNode} role="agent" />) };
  };

  it('shows the Token badge, meta, usage, and a change list row per mode with swatches; no Open in Figma', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderDrawer(BG_ACTIVE);
    const dialog = within(await screen.findByRole('dialog'));
    const heading = await dialog.findByRole('heading', { name: /Colors\/Background\/bg-active/ });
    expect(within(heading).getByText('Token').className).toContain('bg-utility-gray-50');
    expect(dialog.getByText('VARIABLE · COLOR · --color-bg-active')).toBeTruthy();
    expect(dialog.getByText('Used by 214 layers')).toBeTruthy();
    expect(within(dialog.getByRole('group', { name: 'Status' })).getByText('token')).toBeTruthy();
    await user.click(dialog.getByRole('tab', { name: 'Change List' }));
    const table = dialog.getByRole('table', { name: 'Change list' });
    const [, first] = within(table).getAllByRole('row') as HTMLElement[];
    expect(within(first!).getAllByRole('cell').map(c => c.textContent)).toEqual(['value:Dark', '#202527', '#2b3033']);
    expect([...first!.querySelectorAll<HTMLElement>('[data-slot="swatch"]')].map(s => s.style.backgroundColor)).toEqual([
      'rgb(32, 37, 39)',
      'rgb(43, 48, 51)',
    ]);
    expect(dialog.queryByRole('link', { name: 'Open in Figma' })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Change list actions' })).toBeNull();
    expect(dialog.getByRole('button', { name: 'Copy node prompt' })).toBeTruthy();
    await expectNoAxeViolations(baseElement);
  });

  it('links an alias to the token it points at', async () => {
    const user = userEvent.setup();
    const { onOpenNode } = renderDrawer(BG_HOVER);
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Used by 1 layer')).toBeTruthy();
    await user.click(dialog.getByRole('tab', { name: 'Change List' }));
    const link = dialog.getByRole('button', { name: 'Open token Colors/gray-800' });
    expect(link.textContent).toBe('gray-800');
    expect(dialog.getByText('Colors/gray-800')).toBeTruthy();
    await user.click(link);
    expect(onOpenNode).toHaveBeenCalledWith(GRAY_800);
  });

  it('copies a prompt that updates the code variable from codeSyntax', async () => {
    const user = userEvent.setup();
    renderDrawer(BG_ACTIVE);
    await user.click(await screen.findByRole('button', { name: 'Copy node prompt' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    const text = await navigator.clipboard.readText();
    expect(text).toContain('Update the code variable --color-bg-active (its codeSyntax) for each changed mode');
  });

  it('renders the token drawer under the dark theme with no axe violations', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      const { baseElement } = renderDrawer(BG_ACTIVE);
      await within(await screen.findByRole('dialog')).findByText('Used by 214 layers');
      await expectNoAxeViolations(baseElement);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });
});
