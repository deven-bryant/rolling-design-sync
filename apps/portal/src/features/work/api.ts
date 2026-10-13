import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, type ApiResponse } from '../../api/client';
import { fileClaimsQueryKey, type FileClaim } from '../../api/hooks/useFileClaims';
import { useEventStream, type StreamState } from '../../api/useEventStream';
import { searchParams } from '../nodes';

export type WorkGroup = 'component' | 'frame';
export type WorkPage = ApiResponse<'/v3/files/{fileKey}/work'>;
export type WorkItem = NonNullable<WorkPage['items']>[number];
export type { FileClaim };

export const WORK_PAGE_SIZE = 25;

export interface WorkQuery {
  fileKey: string;
  /** The scope (screen) node id; several comma-separated. */
  under?: string;
  group: WorkGroup;
  /** The node search, as on Nodes: a name, a node id (replaces `under`) or `key:value` pairs. */
  q?: string;
  /** `expand=instances` (default on): include the components the scope's instances use. */
  expandInstances?: boolean;
  pageSize?: number;
}

export const workKeys = {
  all: (fileKey: string) => ['files', fileKey, 'work'] as const,
  list: ({ fileKey, under, group, q, expandInstances = true, pageSize = WORK_PAGE_SIZE }: WorkQuery) =>
    [...workKeys.all(fileKey), { group, under: under ?? null, q: q ?? null, expandInstances, pageSize }] as const,
  claims: fileClaimsQueryKey,
};

/**
 * `GET /v3/files/{fileKey}/work?group=…&expand=instances&include=progress&under=…` (plus the node search), every state, one cursor page
 * at a time. `page` (1-based) comes from the caller; the pages before it are fetched in turn to reach its cursor.
 */
export function useWorkItems({ page, ...query }: WorkQuery & { page: number }) {
  const { fileKey, under, group, q, expandInstances = true, pageSize = WORK_PAGE_SIZE } = query;
  const result = useInfiniteQuery({
    queryKey: workKeys.list(query),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get('/v3/files/{fileKey}/work', {
        path: { fileKey },
        signal,
        query: {
          group,
          under,
          ...searchParams(q),
          expand: expandInstances ? 'instances' : undefined,
          include: 'progress',
          state: 'all',
          changes: 'names',
          limit: pageSize,
          cursor: pageParam,
        },
      }),
    getNextPageParam: last => last.nextCursor ?? null,
  });
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = result;
  const loaded = data?.pages.length ?? 0;
  const needsMore = loaded > 0 && loaded < page && hasNextPage;
  useEffect(() => {
    if (needsMore && !isFetchingNextPage) void fetchNextPage();
  }, [needsMore, isFetchingNextPage, fetchNextPage]);
  const current = data?.pages[page - 1];
  return {
    ...result,
    items: current?.items ?? [],
    /** Items across all pages. */
    total: data?.pages[0]?.total,
    pageCount:
      typeof data?.pages[0]?.total === 'number'
        ? Math.max(1, Math.ceil(data.pages[0].total / pageSize), page + (loaded > page || hasNextPage ? 1 : 0))
        : undefined,
    hasNext: loaded > page || hasNextPage,
    /** The requested page isn't here yet. */
    isPageLoading: !current && (result.isPending || needsMore || isFetchingNextPage),
  };
}

/** The claim holding any of the item's nodes. */
export function itemClaim(item: WorkItem, claims: readonly FileClaim[]): FileClaim | undefined {
  const ids = new Set(item.nodeIds ?? []);
  return claims.find(claim => claim.nodeIds?.some(id => ids.has(id)));
}

/** Keeps the file's work items and claims current from its event stream. */
export function useWorkLive(fileKey: string): StreamState {
  const queryClient = useQueryClient();
  const refresh = (queryKey: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  const work = () => refresh(workKeys.all(fileKey));
  const claims = () => refresh(workKeys.claims(fileKey));
  return useEventStream(fileKey ? `/v3/files/${encodeURIComponent(fileKey)}/events` : null, {
    'sync.completed': work,
    'note.added': work,
    'note.resolved': work,
    'note.dismissed': work,
    'nodes.cleared': () => {
      work();
      claims();
    },
    'node.blocked': work,
    'file.settings_changed': work,
    'node.unblocked': work,
    'claim.created': claims,
    'claim.renewed': claims,
    'claim.released': claims,
  });
}
