import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiResponse } from '../../api/client';
import { claimsQueryKey, type Claim } from '../../api/hooks/useClaims';
import { useNow } from '../../api/hooks/useNow';
import { useEventStream, type StreamEvent, type StreamState } from '../../api/useEventStream';
import { clearedNodeCount } from './metrics';

export type TrackedFile = NonNullable<ApiResponse<'/v3/files'>['files']>[number];
export type FileScope = NonNullable<ApiResponse<'/v3/files/{fileKey}/scopes'>['scopes']>[number];
export type { Claim };
export type ApiEvent = NonNullable<ApiResponse<'/v3/events'>['events']>[number];

const EVENT_PAGE = 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const filesKeys = {
  list: ['files'] as const,
  scopes: (fileKey: string) => ['files', fileKey, 'scopes'] as const,
  lastSync: (fileKey: string) => ['files', fileKey, 'last-sync'] as const,
  claims: claimsQueryKey,
  cleared: ['events', 'nodes.cleared'] as const,
};

/** `GET /v3/files`: every tracked file with its counts. */
export function useFiles() {
  return useQuery({
    queryKey: filesKeys.list,
    queryFn: ({ signal }) => api.get('/v3/files', { signal }),
    select: data => data.files ?? [],
  });
}

/** `GET /v3/files/{fileKey}/scopes`: the file's synced scopes, deleted ones left out. */
export function useFileScopes(fileKey: string) {
  return useQuery({
    queryKey: filesKeys.scopes(fileKey),
    queryFn: ({ signal }) => api.get('/v3/files/{fileKey}/scopes', { path: { fileKey }, signal }),
    select: data => (data.scopes ?? []).filter(scope => !scope.deleted),
  });
}

/** The start of the last seven days, on the hour so the query key holds still between renders. */
export const weekAgo = (now: number = Date.now()): string => new Date(Math.floor((now - WEEK_MS) / HOUR_MS) * HOUR_MS).toISOString();

/** Nodes cleared in the last seven days: `GET /v3/events?types=nodes.cleared&since=`, every page, summed `nodeIds`. */
export function useClearedThisWeek(since?: string) {
  const now = useNow();
  const from = since ?? weekAgo(now);
  return useQuery({
    queryKey: [...filesKeys.cleared, from],
    queryFn: async ({ signal }) => {
      let after = 0;
      let count = 0;
      for (;;) {
        const page = await api.get('/v3/events', { signal, query: { types: 'nodes.cleared', since: from, after, limit: EVENT_PAGE } });
        const events = page.events ?? [];
        count += clearedNodeCount(events);
        if (events.length < EVENT_PAGE || page.nextAfter === undefined || page.nextAfter <= after) return count;
        after = page.nextAfter;
      }
    },
  });
}

/** The client (`plugin/0.10.0`) of the file's newest `sync.completed`, the one at `lastSyncAt`. */
export function useLastSyncClient(fileKey: string, lastSyncAt: string | null | undefined) {
  return useQuery({
    queryKey: [...filesKeys.lastSync(fileKey), lastSyncAt],
    enabled: Boolean(lastSyncAt),
    queryFn: async ({ signal }) => {
      const page = await api.get('/v3/events', {
        signal,
        query: { types: 'sync.completed', fileKey, since: lastSyncAt, limit: EVENT_PAGE },
      });
      const client = page.events?.at(-1)?.data?.client;
      return typeof client === 'string' ? client : null;
    },
  });
}

/** The `fileKey` of a stream event (its data is the event JSON). */
export function eventFileKey(event: StreamEvent): string | null {
  const { data } = event;
  return typeof data === 'object' && data !== null && 'fileKey' in data && typeof data.fileKey === 'string' ? data.fileKey : null;
}

/**
 * Keeps the Files queries current from the `/v3/events` stream: `sync.completed` refetches the file list and
 * that file's scopes and last sync, `nodes.cleared` the counts and the cleared total, `claim.*` the claims.
 * Hooks sharing the stream don't cancel each other's refetches.
 */
export function useFilesLive(): StreamState {
  const queryClient = useQueryClient();
  const refresh = (queryKey: readonly unknown[], exact = false) =>
    void queryClient.invalidateQueries({ queryKey, exact }, { cancelRefetch: false });
  const claims = () => refresh(filesKeys.claims, true);
  return useEventStream('/v3/events', {
    'sync.completed': event => {
      refresh(filesKeys.list, true);
      const fileKey = eventFileKey(event);
      if (fileKey) {
        refresh(filesKeys.scopes(fileKey));
        refresh(filesKeys.lastSync(fileKey));
      }
    },
    'nodes.cleared': () => {
      refresh(filesKeys.list, true);
      refresh(filesKeys.cleared);
    },
    'claim.created': claims,
    'claim.renewed': claims,
    'claim.released': claims,
  });
}
