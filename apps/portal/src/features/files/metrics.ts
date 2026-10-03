import type { ApiEvent, Claim, TrackedFile } from './api';

export interface FilesMetricValues {
  /** Sum of the files' dirty counts. */
  dirty: number;
  /** Active claims. */
  claims: number;
  /** Distinct workers holding them. */
  workers: number;
}

export function filesMetrics(files: readonly TrackedFile[], claims: readonly Claim[]): FilesMetricValues {
  return {
    dirty: files.reduce((sum, file) => sum + (file.counts?.dirty ?? 0), 0),
    claims: claims.length,
    workers: new Set(claims.map(claim => claim.worker).filter(Boolean)).size,
  };
}

/** Nodes cleared by `nodes.cleared` events: the summed `data.nodeIds`. */
export function clearedNodeCount(events: readonly ApiEvent[]): number {
  return events.reduce((sum, event) => {
    const ids = event.data?.nodeIds;
    return sum + (Array.isArray(ids) ? ids.length : 0);
  }, 0);
}

/** The workers with claims on a file, in claim order (soonest expiry first), each with its first claim. */
export function fileAgents(claims: readonly Claim[], fileKey: string): Claim[] {
  const seen = new Set<string>();
  return claims.filter(claim => {
    if (claim.fileKey !== fileKey || !claim.worker || seen.has(claim.worker)) return false;
    seen.add(claim.worker);
    return true;
  });
}
