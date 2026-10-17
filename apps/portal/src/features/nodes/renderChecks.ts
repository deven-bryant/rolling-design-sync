import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type ApiResponse } from '../../api/client';
import type { paths } from '../../api/schema';
import type { RenderCheckStatus } from '../../components/domain/RenderCheck';
import { nodeKeys } from './queries';

export type ScreenState = NonNullable<ApiResponse<'/v3/files/{fileKey}/screens'>['screens']>[number];
export type RenderCheckDetail = NonNullable<ApiResponse<'/v3/files/{fileKey}/checks/{checkId}'>['check']>;
export type Attachment = NonNullable<RenderCheckDetail['built']>;
export type ScreenSettings = NonNullable<paths['/v3/files/{fileKey}/screens/{nodeId}']['put']['requestBody']>['content']['application/json'];

export const renderKeys = {
  all: (fileKey: string) => ['rds-render', fileKey] as const,
  screen: (fileKey: string, nodeId: string) => ['rds-render', fileKey, 'screen', nodeId] as const,
  check: (fileKey: string, checkId: string) => ['rds-render', fileKey, 'check', checkId] as const,
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
