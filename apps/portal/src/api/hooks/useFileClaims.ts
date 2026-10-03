import { useQuery } from '@tanstack/react-query';
import { api, type ApiResponse } from '../client';

export type FileClaims = ApiResponse<'/v3/files/{fileKey}/claims'>;
export type FileClaim = NonNullable<FileClaims['claims']>[number];

export const fileClaimsQueryKey = (fileKey: string) => ['files', fileKey, 'claims'] as const;

/** `GET /v3/files/{fileKey}/claims`: the file's active claims. */
export function useFileClaims(fileKey: string) {
  return useQuery({
    queryKey: fileClaimsQueryKey(fileKey),
    queryFn: ({ signal }) => api.get('/v3/files/{fileKey}/claims', { path: { fileKey }, signal }),
    enabled: !!fileKey,
  });
}
