import { useQuery } from '@tanstack/react-query';
import { api, type ApiResponse } from '../client';

export type ServerStatusData = ApiResponse<'/v3/status'>;

export const statusQueryKey = ['status'] as const;

/** `GET /v3/status`: version, store, events, plugin last seen, `libraryLinks`. */
export function useStatus() {
  return useQuery({ queryKey: statusQueryKey, queryFn: ({ signal }) => api.get('/v3/status', { signal }) });
}
