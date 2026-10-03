import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type ApiResponse } from '../../api/client';
import { useEventStream, type StreamHandlers, type StreamState } from '../../api/useEventStream';

export type ServerStatusData = ApiResponse<'/v3/status'>;

/** For the sidebar dot: `live` (status read, stream open), `connecting`, `degraded` (stream retrying), `offline`. */
export type ServerHealth = 'live' | 'connecting' | 'degraded' | 'offline';

export interface ServerStatus {
  status: ServerStatusData | undefined;
  error: Error | null;
  isLoading: boolean;
  /** The `/v3/events` stream's connection state. */
  stream: StreamState;
  health: ServerHealth;
}

export const statusQueryKey = ['status'] as const;

export function serverHealth(stream: StreamState, ok: boolean, failed: boolean): ServerHealth {
  if (failed || stream === 'closed') return 'offline';
  if (stream === 'reconnecting') return 'degraded';
  return stream === 'live' && ok ? 'live' : 'connecting';
}

/** `GET /v3/status` plus the event stream's state; a new sync refreshes the plugin's last-seen time. */
export function useServerStatus(): ServerStatus {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: statusQueryKey, queryFn: ({ signal }) => api.get('/v3/status', { signal }) });
  const handlers = useMemo<StreamHandlers>(
    () => ({ 'sync.completed': () => void queryClient.invalidateQueries({ queryKey: statusQueryKey }) }),
    [queryClient],
  );
  const stream = useEventStream('/v3/events', handlers);
  return {
    status: query.data,
    error: query.error,
    isLoading: query.isPending,
    stream,
    health: serverHealth(stream, query.isSuccess, query.isError),
  };
}
