import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { FileClaim, NodeItem } from './types';

export const FILE = 'FILEKEY';
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

export function node(nodeId: string, extra: Partial<NodeItem> = {}): NodeItem {
  return {
    nodeId,
    name: nodeId,
    type: 'FRAME',
    parentId: null,
    isInstance: false,
    mainComponentId: null,
    state: 'clean',
    changeType: null,
    changedProps: [],
    claim: null,
    blocked: null,
    descendants: { total: 0, dirty: 0, blocked: 0 },
    figmaUrl: `https://www.figma.com/design/${FILE}/Design?node-id=${nodeId.replace(':', '-')}`,
    ...extra,
  };
}

export const claimC1: FileClaim = {
  claimId: 'c1',
  worker: 'devin',
  label: null,
  createdAt: minutes(-2),
  expiresAt: minutes(15),
  nodeCount: 3,
  nodeIds: ['1:3', '1:30', '1:31'],
};

export const scope = node('1:1', { name: 'Team View', descendants: { total: 6, dirty: 2, blocked: 1 } });
export const pageHeader = node('1:2', {
  name: 'Page header',
  type: 'INSTANCE',
  isInstance: true,
  mainComponentId: '1:50',
  state: 'dirty',
  changeType: 'added',
  changedProps: ['fills', 'itemSpacing', 'width'],
  descendants: { total: 1, dirty: 0, blocked: 0 },
});
export const breadcrumbs = node('1:3', {
  name: 'Breadcrumbs',
  state: 'dirty',
  changeType: 'modified',
  changedProps: ['itemSpacing'],
  changes: {
    itemSpacing: {
      built: { token: 'Spacing/spacing-md', value: 12 },
      now: { token: 'Spacing/spacing-lg', value: 16 },
      category: 'layout',
    },
  },
  claim: { claimId: 'c1', worker: 'devin', label: null, expiresAt: claimC1.expiresAt },
});
export const divider = node('1:4', {
  name: 'Divider',
  state: 'blocked',
  changeType: 'modified',
  changedProps: ['strokes'],
  blocked: { reason: 'Needs a border token', by: 'agent-c', at: minutes(-60) },
});
export const logo = node('1:20', { name: 'Logo', type: 'VECTOR' });
export const mainComponent = node('1:50', { name: 'Style=Simple', type: 'COMPONENT', descendants: { total: 1, dirty: 0, blocked: 0 } });
export const mainChild = node('1:51', { name: 'Inner breadcrumbs' });

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}
export type Route = (call: Call) => unknown;

const page = (nodes: NodeItem[], nextCursor: string | null = null) => ({ fileKey: FILE, nodes, nextCursor, total: nodes.length });

/** The Team View tree: `1:1` → Page header (instance of `1:50`), Breadcrumbs; page 2 holds Divider. */
export function treeRoutes(extra?: Route): Route {
  return call => {
    const custom = extra?.(call);
    if (custom !== undefined) return custom;
    const { method, path, query } = call;
    if (method === 'GET' && path === '/v3/session') return { role: 'agent', label: 'devin', expiresAt: minutes(60) };
    if (path === `/v3/files/${FILE}`) return { fileKey: FILE, name: 'Design', counts: { total: 6, dirty: 2, clean: 2, blocked: 1 } };
    if (path === `/v3/files/${FILE}/scopes`) return { fileKey: FILE, scopes: [{ nodeId: '1:1', name: 'Team View', counts: { dirty: 281 } }] };
    if (path === `/v3/files/${FILE}/claims`) return { fileKey: FILE, claims: [claimC1] };
    if (path === `/v3/files/${FILE}/nodes`) {
      const under = query.get('under');
      if (under === '1:1') return query.get('cursor') === 'cur2' ? page([divider]) : page([scope, pageHeader, breadcrumbs], 'cur2');
      if (under === '1:2') return page([pageHeader, logo]);
      if (under === '1:50') return page([mainComponent, mainChild]);
      return page([]);
    }
    return undefined;
  };
}

/** Stubs `fetch` with `route`; an unrouted call answers 404. */
export function mockApi(route: Route) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://portal.test');
    const call: Call = {
      method: init?.method ?? 'GET',
      path: decodeURIComponent(url.pathname),
      query: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const result = route(call);
    if (result instanceof Response) return result;
    if (result === undefined) {
      const problem = { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found', detail: `No mock for ${call.method} ${call.path}` };
      return new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, find: (method: string, path: string) => calls.filter(c => c.method === method && c.path === path) };
}

export function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}
