import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type ApiResponse } from '../../api/client';
import type { paths } from '../../api/schema';
import type { RenderCheckStatus } from '../../components/domain/RenderCheck';
import { nodeKeys } from './queries';

export type ScreenState = NonNullable<ApiResponse<'/v3/files/{fileKey}/screens'>['screens']>[number];
export type RenderCheckDetail = NonNullable<ApiResponse<'/v3/files/{fileKey}/checks/{checkId}'>['check']>;
export type Attachment = NonNullable<RenderCheckDetail['built']>;
export type CheckTarget = NonNullable<ApiResponse<'/v3/files/{fileKey}/targets'>['targets']>[number];
export type TargetCheck = NonNullable<ApiResponse<'/v3/files/{fileKey}/targets/{nodeId}/checks'>['checks']>[number];
export type TargetChange = paths['/v3/files/{fileKey}/targets/{nodeId}']['patch']['requestBody']['content']['application/json'];
export type ScreenSettings = NonNullable<paths['/v3/files/{fileKey}/screens/{nodeId}']['put']['requestBody']>['content']['application/json'];

export const renderKeys = {
  all: (fileKey: string) => ['rds-render', fileKey] as const,
  screen: (fileKey: string, nodeId: string) => ['rds-render', fileKey, 'screen', nodeId] as const,
  check: (fileKey: string, checkId: string) => ['rds-render', fileKey, 'check', checkId] as const,
  targets: (fileKey: string) => ['rds-render', fileKey, 'targets'] as const,
  containing: (fileKey: string, nodeId: string) => ['rds-render', fileKey, 'containing', nodeId] as const,
  history: (fileKey: string, nodeId: string) => ['rds-render', fileKey, 'history', nodeId] as const,
};

/** A screen summary (a node's or work item's `screen`) as the badge status: `stale` wins over a result for an older design. */
export function renderStatus(screen: { status?: string; stale?: boolean } | null | undefined): RenderCheckStatus {
  if (!screen?.status) return 'not-set-up';
  if (screen.stale && screen.status !== 'building' && screen.status !== 'requested') return 'stale';
  return screen.status as RenderCheckStatus;
}

/** `3.4%` for a score (the % of pixels that differ). */
export const formatScore = (score: number | null | undefined) => (score == null ? '—' : `${Number(score.toFixed(2))}%`);

/** A frame's render-check settings and state; `null` when it isn't a screen. */
export function useScreen(fileKey: string, nodeId: string | null | undefined, { enabled = true } = {}) {
  return useQuery({
    queryKey: renderKeys.screen(fileKey, nodeId ?? ''),
    enabled: enabled && !!nodeId,
    queryFn: async ({ signal }) => {
      const data = await api.get('/v3/files/{fileKey}/screens', { path: { fileKey }, query: { under: nodeId! }, signal });
      return data.screens?.find(screen => screen.nodeId === nodeId) ?? null;
    },
  });
}

/** One render check with its score, regions and images. */
export function useRenderCheck(fileKey: string, checkId: string | null | undefined) {
  return useQuery({
    queryKey: renderKeys.check(fileKey, checkId ?? ''),
    enabled: !!checkId,
    queryFn: async ({ signal }) => {
      const data = await api.get('/v3/files/{fileKey}/checks/{checkId}', { path: { fileKey, checkId: checkId! }, signal });
      return data.check ?? null;
    },
  });
}

/** Refetches render-check state: the screens and checks, node details (their `screen`) and work items. */
export function refreshRenderChecks(queryClient: QueryClient, fileKey: string) {
  void queryClient.invalidateQueries({ queryKey: renderKeys.all(fileKey) });
  void queryClient.invalidateQueries({ queryKey: nodeKeys.all(fileKey) });
  void queryClient.invalidateQueries({ queryKey: ['files', fileKey, 'work'] });
}

/** Anyone signed in: asks the next agent pass to render a screen and submit it for comparison. */
export function useRequestCheck(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) => api.post('/v3/files/{fileKey}/screens/{nodeId}/checks', { path: { fileKey, nodeId } }),
    onSuccess: () => refreshRenderChecks(queryClient, fileKey),
  });
}

/** Agents: makes a frame a screen or changes its route, viewport, theme / query, threshold and masks. */
export function useConfigureScreen(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, settings }: { nodeId: string; settings: ScreenSettings }) =>
      api.put('/v3/files/{fileKey}/screens/{nodeId}', { path: { fileKey, nodeId }, body: settings }),
    onSuccess: () => refreshRenderChecks(queryClient, fileKey),
  });
}

/**
 * A check target as the badge status: `not-mapped` when nothing renders it (no gallery entry, no route), `stale` over
 * a result for an older design, else its `status`.
 */
export function targetStatus(target: Pick<CheckTarget, 'status' | 'stale' | 'notMapped'> | null | undefined): RenderCheckStatus {
  if (!target) return 'not-set-up';
  if (target.notMapped && target.status !== 'mismatch' && target.status !== 'passed') return 'not-mapped';
  return renderStatus(target);
}

/** Every check target in the file (manual and auto-detected), in check order. */
export function useTargets(fileKey: string, { enabled = true } = {}) {
  return useQuery({
    queryKey: renderKeys.targets(fileKey),
    enabled,
    queryFn: async ({ signal }) => (await api.get('/v3/files/{fileKey}/targets', { path: { fileKey }, signal })).targets ?? [],
  });
}

function containingQuery(fileKey: string, nodeId: string | null | undefined, enabled: boolean) {
  return {
    queryKey: renderKeys.containing(fileKey, nodeId ?? ''),
    enabled: enabled && !!nodeId,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      api.get('/v3/files/{fileKey}/targets', { path: { fileKey }, query: { containing: nodeId! }, signal }),
  };
}

type ContainingResponse = ApiResponse<'/v3/files/{fileKey}/targets'>;
const NO_TARGETS: CheckTarget[] = [];
const selectTargets = (data: ContainingResponse) => data.targets ?? NO_TARGETS;

/** The targets containing a node (itself included), each with its open render-check notes (`renderNotes`). */
export function useContainingTargets(fileKey: string, nodeId: string | null | undefined, { enabled = true } = {}) {
  return useQuery({ ...containingQuery(fileKey, nodeId, enabled), select: selectTargets });
}

/**
 * Whether a node is a slot component (a main component with a SLOT of its own, checked through what fills its slot),
 * from the response `useContainingTargets` fetched: call it alongside that hook, which keeps it current.
 */
export function useSlotComponent(fileKey: string, nodeId: string | null | undefined) {
  const client = useQueryClient();
  return client.getQueryData<ContainingResponse>(renderKeys.containing(fileKey, nodeId ?? ''))?.slotComponent === true;
}

/** A target's retained results, latest first (`checkRetention` of them plus its last pass). */
export function useTargetChecks(fileKey: string, nodeId: string | null | undefined, { enabled = true } = {}) {
  return useQuery({
    queryKey: renderKeys.history(fileKey, nodeId ?? ''),
    enabled: enabled && !!nodeId,
    queryFn: async ({ signal }) =>
      (await api.get('/v3/files/{fileKey}/targets/{nodeId}/checks', { path: { fileKey, nodeId: nodeId! }, signal })).checks ?? [],
  });
}

/** Agents: changes a target's route or excludes it from checks (kept across re-detection). */
export function useUpdateTarget(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, change }: { nodeId: string; change: TargetChange }) =>
      api.patch('/v3/files/{fileKey}/targets/{nodeId}', { path: { fileKey, nodeId }, body: change }),
    onSuccess: () => refreshRenderChecks(queryClient, fileKey),
  });
}

/** Agents: turns a section's render checks on or off (its `checks` switch). */
export function useScopeChecks(fileKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, checks }: { nodeId: string; checks: boolean }) =>
      api.patch('/v3/files/{fileKey}/scopes/{nodeId}', { path: { fileKey, nodeId }, body: { checks } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: nodeKeys.scopes(fileKey) });
      void queryClient.invalidateQueries({ queryKey: ['files', fileKey, 'scopes'] });
      refreshRenderChecks(queryClient, fileKey);
    },
  });
}
