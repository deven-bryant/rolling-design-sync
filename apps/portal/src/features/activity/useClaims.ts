import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../api/client';
import { claimsQueryKey, type Claim } from '../../api/hooks/useClaims';
import { getSession } from '../../api/session';
import { useEventStream, type StreamHandlers } from '../../api/useEventStream';

export type { Claim };
export type ClaimNode = NonNullable<Claim['nodes']>[number];

export interface WorkerClaims {
  worker: string;
  /** The first claim label, e.g. `Agent session`. */
  label: string | null;
  /** Soonest expiry first. */
  claims: Claim[];
  nodeCount: number;
  /** The claims' named nodes (each claim's first 3 in document order), soonest claim first. */
  nodes: ClaimNode[];
  files: string[];
  /** `files` by name (the key when a file has none yet). */
  fileNames: string[];
}

const expiry = (claim: Claim) => (claim.expiresAt ? Date.parse(claim.expiresAt) : Infinity);

/** Active claims grouped by worker, the soonest lease first. */
export function groupByWorker(claims: Claim[]): WorkerClaims[] {
  const groups = new Map<string, WorkerClaims>();
  for (const claim of [...claims].sort((a, b) => expiry(a) - expiry(b))) {
    const worker = claim.worker ?? 'unknown';
    let group = groups.get(worker);
    if (!group) {
      group = { worker, label: null, claims: [], nodeCount: 0, nodes: [], files: [], fileNames: [] };
      groups.set(worker, group);
    }
    group.claims.push(claim);
    group.nodeCount += claim.nodeCount ?? claim.nodeIds?.length ?? 0;
    group.nodes.push(...(claim.nodes ?? []));
    group.label ??= claim.label ?? null;
    if (claim.fileKey && !group.files.includes(claim.fileKey)) {
      group.files.push(claim.fileKey);
      group.fileNames.push(claim.fileName ?? claim.fileKey);
    }
  }
  return [...groups.values()];
}

/** Refetches `GET /v3/claims` on every claim and clear event. */
export function useClaimsLive() {
  const queryClient = useQueryClient();
  const handlers = useMemo<StreamHandlers>(() => {
    const refetch = () => void queryClient.invalidateQueries({ queryKey: claimsQueryKey });
    return { 'claim.created': refetch, 'claim.renewed': refetch, 'claim.released': refetch, 'nodes.cleared': refetch };
  }, [queryClient]);
  useEventStream('/v3/events', handlers);
}

/** Whether the signed-in session may release claims (agent sessions only). */
export function useCanRelease(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => getSession(), retry: false });
  return session.data?.role === 'agent';
}

/** `DELETE /v3/files/{fileKey}/claims/{claimId}`. */
export function useReleaseClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (claim: Claim) =>
      api.delete('/v3/files/{fileKey}/claims/{claimId}', {
        path: { fileKey: claim.fileKey ?? '', claimId: claim.claimId ?? '' },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: claimsQueryKey }),
  });
}
