import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fileClaimsQueryKey } from '../../api/hooks/useFileClaims';
import { useStatus } from '../../api/hooks/useStatus';
import { getSession } from '../../api/session';
import type { FileClaims, NodeDetail, NodeFilters, NodeItem, NodeLike, NodePage, SessionRole } from './types';
import { isTokenNodeId } from './format';

/** Rows per top-level page (the design's "25 per page"). */
export const PAGE_SIZE = 25;
/** Rows fetched per child page of an expanded row. */
export const CHILD_PAGE_SIZE = 100;
/** Events read for a node's history (the API pages oldest first). */
export const HISTORY_LIMIT = 1000;

export const nodeKeys = {
  all: (fileKey: string) => ['rds-nodes', fileKey] as const,
  pages: (fileKey: string) => ['rds-nodes', fileKey, 'page'] as const,
  page: (fileKey: string, params: NodeListParams) => ['rds-nodes', fileKey, 'page', params] as const,
  children: (fileKey: string) => ['rds-nodes', fileKey, 'children'] as const,
  childPages: (fileKey: string, params: NodeListParams) => ['rds-nodes', fileKey, 'children', params] as const,
  details: (fileKey: string) => ['rds-nodes', fileKey, 'detail'] as const,
  detail: (fileKey: string, nodeId: string) => ['rds-nodes', fileKey, 'detail', nodeId] as const,
  histories: (fileKey: string) => ['rds-nodes', fileKey, 'history'] as const,
  history: (fileKey: string, nodeId: string) => ['rds-nodes', fileKey, 'history', nodeId] as const,
  claims: fileClaimsQueryKey,
  file: (fileKey: string) => ['rds-file', fileKey] as const,
  scopes: (fileKey: string) => ['rds-file', fileKey, 'scopes'] as const,
};

export type NodeListParams = Record<string, string | number | undefined>;

const NODE_ID = /^\d+[:-]\d+(?:;\d+[:-]\d+)*$/;
const KEY_VALUE = /\b[A-Za-z]+:\S/;

/** The search box as listing parameters: `key:value` → `q`, a node id → `under`, text → a `name` glob. */
export function searchParams(search: string | undefined): NodeListParams {
  const text = search?.trim();
  if (!text) return {};
  if (NODE_ID.test(text)) return { under: text.replace(/-/g, ':') };
  if (KEY_VALUE.test(text)) return { q: text };
  return { name: `*${text}*` };
}

/** The filter parameters every node page sends (`search` only applies to the top level). */
export function filterParams(filters: NodeFilters, { search = true } = {}): NodeListParams {
  return {
    state: filters.state ?? 'all',
    changeType: filters.changeType,
    category: filters.category,
    type: filters.type,
    ...(search ? searchParams(filters.q) : {}),
  };
}

/** A compact listing's fields plus `attrs`: token rows show their resolved type and code name. */
export const TOKEN_FIELDS =
  'nodeId,name,type,parentId,isInstance,mainComponentId,component,state,changeType,changedProps,changes,changesKnown,contentHash,figmaUrl,library,claim,blocked,notes,attrs';

/** `fields` for a level under the design-tokens scope (`tokens`, `tokens:<collectionKey>`). */
const tokenFields = (under: string | number | undefined) =>
  typeof under === 'string' && splitUnder(under).some(isTokenNodeId) ? { fields: TOKEN_FIELDS } : {};

/** A tree level: `under` and its direct children, in document order, with subtree counts. */
export function nodePageParams(under: string | undefined, filters: NodeFilters, cursor?: string): NodeListParams {
  const params: NodeListParams = { under, ...filterParams(filters) };
  return {
    ...params,
    ...tokenFields(params.under),
    depth: params.under ? 1 : undefined,
    include: 'counts',
    sort: 'document',
    limit: PAGE_SIZE,
    cursor,
  };
}

function childParams(under: string, filters: NodeFilters): NodeListParams {
  return { under, ...tokenFields(under), depth: 1, include: 'counts', sort: 'document', limit: CHILD_PAGE_SIZE, ...filterParams(filters, { search: false }) };
}

const clean = (params: NodeListParams) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>;

export const listNodes = (fileKey: string, params: NodeListParams, signal?: AbortSignal) =>
  api.get('/v3/files/{fileKey}/nodes', { path: { fileKey }, query: clean(params), signal });

/** The file's header data: name, last sync and counts. */
export function useFile(fileKey: string) {
  return useQuery({
    queryKey: nodeKeys.file(fileKey),
    queryFn: ({ signal }) => api.get('/v3/files/{fileKey}', { path: { fileKey }, signal }),
    enabled: !!fileKey,
  });
}

/** `under` as node ids (`a,b` → `['a', 'b']`), in order, blanks and repeats dropped. */
export function splitUnder(under: string | null | undefined): string[] {
  return [...new Set((under ?? '').split(',').map(id => id.trim()).filter(Boolean))];
}

/**
 * The scope a tree is rooted at (name, last sync, counts), from the file's synced scopes; `scopeId` may list
 * several (`a,b`): `scope` is then unset and `selected` holds each one found, in that order.
 */
export function useScope(fileKey: string, scopeId: string | undefined) {
  const scopes = useQuery({
    queryKey: nodeKeys.scopes(fileKey),
    queryFn: ({ signal }) => api.get('/v3/files/{fileKey}/scopes', { path: { fileKey }, signal }),
    enabled: !!fileKey,
  });
  const ids = splitUnder(scopeId);
  const selected = ids.flatMap(id => scopes.data?.scopes?.filter(s => s.nodeId === id) ?? []);
  const scope = ids.length === 1 ? selected[0] : undefined;
  return { ...scopes, scope, selected };
}

/** One top-level page of the tree. */
export function useNodePage(fileKey: string, under: string | undefined, filters: NodeFilters, cursor?: string) {
  const params = nodePageParams(under, filters, cursor);
  return useQuery({
    queryKey: nodeKeys.page(fileKey, params),
    queryFn: ({ signal }) => listNodes(fileKey, params, signal),
    enabled: !!fileKey,
    placeholderData: previous => previous,
  });
}

/**
 * The direct children of an expanded row, page by page; the row itself is left out. Expanding an
 * instance's main component lists the component (`under` includes it) and its children.
 */
export function useChildNodes(fileKey: string, under: string, filters: NodeFilters, { enabled = true } = {}) {
  const params = childParams(under, filters);
  return useInfiniteQuery({
    queryKey: nodeKeys.childPages(fileKey, params),
    queryFn: ({ signal, pageParam }) => listNodes(fileKey, { ...params, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: NodePage) => last.nextCursor ?? undefined,
    enabled: enabled && !!fileKey,
  });
}

/** One node in full, with its property diff. */
export function useNodeDetail(fileKey: string, nodeId: string | null | undefined) {
  return useQuery({
    queryKey: nodeKeys.detail(fileKey, nodeId ?? ''),
    queryFn: ({ signal }) =>
      api.get('/v3/files/{fileKey}/nodes/{nodeId}', { path: { fileKey, nodeId: nodeId ?? '' }, query: { changes: 'diff' }, signal }),
    enabled: !!fileKey && !!nodeId,
  });
}

/** A node's history: the file's events that touched it, newest first. */
export function useNodeHistory(fileKey: string, nodeId: string | null | undefined) {
  return useQuery({
    queryKey: nodeKeys.history(fileKey, nodeId ?? ''),
    queryFn: ({ signal }) =>
      api.get('/v3/files/{fileKey}/events', { path: { fileKey }, query: { nodeId: nodeId ?? '', limit: HISTORY_LIMIT, order: 'desc' }, signal }),
    enabled: !!fileKey && !!nodeId,
  });
}

/** `/v3/status` `libraryLinks`: library nodes can link to their library file (the server has RDS_FIGMA_TOKEN). */
export function useLibraryLinks(): boolean | undefined {
  return useStatus().data?.libraryLinks;
}

/** The signed-in session's role; `viewer` until it is known. */
export function useSessionRole(): SessionRole {
  const session = useQuery({ queryKey: ['session'], queryFn: () => getSession(), retry: false });
  return session.data?.role === 'agent' ? 'agent' : 'viewer';
}

/** The author name the API records for the signed-in session's notes (`portal:<label>`); undefined until known. */
export function useSessionAuthor(): string | undefined {
  const session = useQuery({ queryKey: ['session'], queryFn: () => getSession(), retry: false });
  return session.data?.label ? `portal:${session.data.label}` : undefined;
}

type NodePatch = Partial<NodeItem> | ((node: NodeLike) => Partial<NodeItem>);

const patchOne = <N extends NodeLike>(node: N, ids: ReadonlySet<string> | null, patch: NodePatch, match?: (node: NodeLike) => boolean): N => {
  if (ids && !ids.has(node.nodeId ?? '')) return node;
  if (match && !match(node)) return node;
  return { ...node, ...(typeof patch === 'function' ? patch(node) : patch) } as N;
};

const patchPage = (page: NodePage | undefined, ids: ReadonlySet<string> | null, patch: NodePatch, match?: (node: NodeLike) => boolean) =>
  page && { ...page, nodes: page.nodes?.map(n => patchOne(n, ids, patch, match)) };

/**
 * Patches nodes in place in every cached page, child page and detail of a file: by id, or (`ids`
 * null) every node `match` accepts.
 */
export function patchNodes(
  queryClient: QueryClient,
  fileKey: string,
  ids: readonly string[] | null,
  patch: NodePatch,
  match?: (node: NodeLike) => boolean,
): void {
  const set = ids && new Set(ids);
  queryClient.setQueriesData<NodePage>({ queryKey: nodeKeys.pages(fileKey) }, page => patchPage(page, set, patch, match));
  queryClient.setQueriesData<{ pages: NodePage[]; pageParams: unknown[] }>({ queryKey: nodeKeys.children(fileKey) }, data =>
    data && { ...data, pages: data.pages.map(p => patchPage(p, set, patch, match) as NodePage) },
  );
  queryClient.setQueriesData<NodeDetail>({ queryKey: nodeKeys.details(fileKey) }, node => node && patchOne(node, set, patch, match));
}

/** The ids of every node a cached page or child page of the file holds. */
export function cachedNodeIds(queryClient: QueryClient, fileKey: string, match: (node: NodeLike) => boolean = () => true): Set<string> {
  const ids = new Set<string>();
  const add = (n: NodeItem) => {
    if (n.nodeId && match(n)) ids.add(n.nodeId);
  };
  for (const [, page] of queryClient.getQueriesData<NodePage>({ queryKey: nodeKeys.pages(fileKey) })) page?.nodes?.forEach(add);
  for (const [, data] of queryClient.getQueriesData<{ pages: NodePage[] }>({ queryKey: nodeKeys.children(fileKey) })) {
    data?.pages.forEach(p => p.nodes?.forEach(add));
  }
  return ids;
}

/** Applies a node a write returned to every cached copy of it. */
function storeNode(queryClient: QueryClient, fileKey: string, node: NodeItem | undefined) {
  if (!node?.nodeId) return;
  const { claim, blocked, state } = node;
  patchNodes(queryClient, fileKey, [node.nodeId], { claim, blocked, state });
}

/** Agent: releases a claim (every node it covers). */
export function useReleaseClaim(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (claimId: string) => api.delete('/v3/files/{fileKey}/claims/{claimId}', { path: { fileKey, claimId } }),
    onSuccess: (_data, claimId) => {
      patchNodes(queryClient, fileKey, null, { claim: null }, n => n.claim?.claimId === claimId);
      queryClient.setQueryData<FileClaims>(nodeKeys.claims(fileKey), data =>
        data && { ...data, claims: data.claims?.filter(c => c.claimId !== claimId) },
      );
      void queryClient.invalidateQueries({ queryKey: nodeKeys.claims(fileKey) });
      void queryClient.invalidateQueries({ queryKey: nodeKeys.histories(fileKey) });
    },
  });
}

/** Agent: blocks a node with a reason (1–500 characters). */
export function useBlockNode(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, reason }: { nodeId: string; reason: string }) =>
      api.post('/v3/files/{fileKey}/nodes/{nodeId}/block', { path: { fileKey, nodeId }, body: { reason } }),
    onSuccess: data => {
      storeNode(queryClient, fileKey, data.node);
      void queryClient.invalidateQueries({ queryKey: nodeKeys.histories(fileKey) });
    },
  });
}

/** Agent: unblocks a node. */
export function useUnblockNode(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) => api.post('/v3/files/{fileKey}/nodes/{nodeId}/unblock', { path: { fileKey, nodeId } }),
    onSuccess: data => {
      storeNode(queryClient, fileKey, data.node);
      void queryClient.invalidateQueries({ queryKey: nodeKeys.histories(fileKey) });
    },
  });
}

/** A note's body length bounds (the API's). */
export const NOTE_MAX = 4000;

/** After a note write: refetch the file's nodes (state, change type, notes), work items and histories. */
function refreshAfterNote(queryClient: QueryClient, fileKey: string) {
  void queryClient.invalidateQueries({ queryKey: nodeKeys.all(fileKey) });
  void queryClient.invalidateQueries({ queryKey: ['files', fileKey, 'work'] });
}

/** Anyone signed in (viewers too): notes that the built node doesn't match the design; the node turns dirty. */
export function useAddNote(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, body }: { nodeId: string; body: string }) =>
      api.post('/v3/files/{fileKey}/nodes/{nodeId}/notes', { path: { fileKey, nodeId }, body: { body } }),
    onSuccess: data => {
      const { nodeId, state, changeType, notes } = data.node ?? {};
      if (nodeId) patchNodes(queryClient, fileKey, [nodeId], { state, changeType, notes });
      refreshAfterNote(queryClient, fileKey);
    },
  });
}

/** The author: rewrites an open note. */
export function useEditNote(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      api.patch('/v3/files/{fileKey}/notes/{noteId}', { path: { fileKey, noteId }, body: { body } }),
    onSuccess: () => refreshAfterNote(queryClient, fileKey),
  });
}

/** The author: deletes an open note. */
export function useDeleteNote(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.delete('/v3/files/{fileKey}/notes/{noteId}', { path: { fileKey, noteId } }),
    onSuccess: () => refreshAfterNote(queryClient, fileKey),
  });
}

/** The author or an agent: dismisses an open note; the node goes back to its design-only state. */
export function useDismissNote(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.post('/v3/files/{fileKey}/notes/{noteId}/dismiss', { path: { fileKey, noteId }, body: {} }),
    onSuccess: () => refreshAfterNote(queryClient, fileKey),
  });
}
