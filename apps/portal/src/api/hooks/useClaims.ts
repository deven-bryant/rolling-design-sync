import { useQuery } from '@tanstack/react-query';
import { api, type ApiResponse } from '../client';

export type Claim = NonNullable<ApiResponse<'/v3/claims'>['claims']>[number];

export const claimsQueryKey = ['claims'] as const;

/** `GET /v3/claims`: every file's active claims. */
export function useClaims() {
  return useQuery({
    queryKey: claimsQueryKey,
    queryFn: ({ signal }) => api.get('/v3/claims', { signal }),
    select: data => data.claims ?? [],
  });
}
