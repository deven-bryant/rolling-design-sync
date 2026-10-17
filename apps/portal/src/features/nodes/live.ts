import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEventStream, type StreamEvent, type StreamState } from '../../api/useEventStream';
import type { AgentSpriteState } from '../../components/domain/AgentSprite';
import { useFileClaims } from '../../api/hooks/useFileClaims';
import { cachedNodeIds, nodeKeys, patchNodes } from './queries';
import { refreshRenderChecks } from './renderChecks';
import type { FileClaim, FileClaims, NodeClaim } from './types';

interface Envelope<T> {
  actor?: string | null;
  data?: T;
  createdAt?: string;
}
interface ClaimData {
  claimId?: string;
  worker?: string;
  label?: string | null;
  expiresAt?: string;
  nodeIds?: string[];
  nodeCount?: number;
}
interface ClearedData {
  nodeIds?: string[];
  worker?: string;
  commitRef?: string | null;
}
interface BlockData {
  nodeId?: string;
  reason?: string | null;
  by?: string | null;
}

/** A stream message is the whole event (`{ type, actor, data, createdAt }`); this unwraps it. */
function unwrap<T>(event: StreamEvent): { data: T; actor: string | null; createdAt: string } {
  const envelope = (event.data ?? {}) as Envelope<T>;
  return { data: (envelope.data ?? {}) as T, actor: envelope.actor ?? null, createdAt: envelope.createdAt ?? new Date().toISOString() };
}

/** A sprite playing a one-shot state on a row; `poof` / `fade` outlive the claim they show. */
export interface SpriteOverride {
  state: AgentSpriteState;
  worker: string;
}

export interface NodeLiveUpdates {
  stream: StreamState;
  /** Rows whose `AgentSprite` is entering, poofing or fading, by node id. */
  sprites: Readonly<Record<string, SpriteOverride>>;
  /** Pass to `AgentCell.onSpriteAnimationEnd`: the row settles back to its claim (or none). */
  onSpriteEnd: (nodeId: string, state: AgentSpriteState) => void;
}

export const fileEventsUrl = (fileKey: string) => `/v3/files/${encodeURIComponent(fileKey)}/events`;

/**
 * Keeps a file's cached node pages, details and claims live from its event stream:
 * `sync.completed` and note events refetch, clears / blocks / claims patch rows in place, and claim
 * events (and lease expiry) drive the rows' `AgentSprite` states. `reset` refetches every
 * active query (the stream's default).
 */
export function useNodeLiveUpdates(fileKey: string): NodeLiveUpdates {
  const queryClient = useQueryClient();
  const claims = useFileClaims(fileKey);
  const [sprites, setSprites] = useState<Record<string, SpriteOverride>>({});

  const animate = useCallback(
    (ids: Iterable<string>, worker: string, state: AgentSpriteState) => {
      const shown = cachedNodeIds(queryClient, fileKey);
      const hit = [...new Set(ids)].filter(id => shown.has(id));
      if (!hit.length) return;
      setSprites(prev => {
        const next = { ...prev };
        for (const id of hit) next[id] = { state, worker };
        return next;
      });
    },
    [queryClient, fileKey],
  );

  const updateClaims = useCallback(
    (fn: (claims: FileClaim[]) => FileClaim[]) =>
      queryClient.setQueryData<FileClaims>(nodeKeys.claims(fileKey), data => data && { ...data, claims: fn(data.claims ?? []) }),
    [queryClient, fileKey],
  );

  const dropClaim = useCallback(
    (claimId: string, worker: string, nodeIds: readonly string[] = []) => {
      const holding = cachedNodeIds(queryClient, fileKey, n => n.claim?.claimId === claimId);
      animate([...holding, ...nodeIds], worker, 'fade');
      patchNodes(queryClient, fileKey, null, { claim: null }, n => n.claim?.claimId === claimId);
      updateClaims(list => list.filter(c => c.claimId !== claimId));
    },
    [queryClient, fileKey, animate, updateClaims],
  );

  const refreshHistory = () => void queryClient.invalidateQueries({ queryKey: nodeKeys.histories(fileKey) });

  const stream = useEventStream(fileKey ? fileEventsUrl(fileKey) : null, {
    'sync.completed': () => {
      void queryClient.invalidateQueries({ queryKey: nodeKeys.all(fileKey) });
      void queryClient.invalidateQueries({ queryKey: nodeKeys.claims(fileKey) });
      void queryClient.invalidateQueries({ queryKey: nodeKeys.file(fileKey) });
    },
    'nodes.cleared': event => {
      const { data, actor } = unwrap<ClearedData>(event);
      const ids = data.nodeIds ?? [];
      animate(ids, data.worker ?? actor ?? 'agent', 'poof');
      patchNodes(queryClient, fileKey, ids, { state: 'clean', changeType: null, changedProps: [], changes: {}, claim: null, blocked: null });
      void queryClient.invalidateQueries({ queryKey: nodeKeys.claims(fileKey) });
      refreshHistory();
    },
    'claim.created': event => {
      const { data, createdAt } = unwrap<ClaimData>(event);
      if (!data.claimId) return;
      const claim: NodeClaim = { claimId: data.claimId, worker: data.worker ?? '', label: data.label ?? null, expiresAt: data.expiresAt };
      const ids = data.nodeIds ?? [];
      patchNodes(queryClient, fileKey, ids, { claim });
      animate(ids, claim.worker ?? '', 'enter');
      updateClaims(list => [
        ...list.filter(c => c.claimId !== data.claimId),
        { claimId: data.claimId, worker: claim.worker, label: claim.label, expiresAt: data.expiresAt, createdAt, nodeCount: data.nodeCount ?? ids.length, nodeIds: ids },
      ]);
      refreshHistory();
    },
    'claim.renewed': event => {
      const { data } = unwrap<ClaimData>(event);
      if (!data.claimId) return;
      patchNodes(queryClient, fileKey, null, n => ({ claim: { ...n.claim, expiresAt: data.expiresAt } }), n => n.claim?.claimId === data.claimId);
      updateClaims(list => list.map(c => (c.claimId === data.claimId ? { ...c, expiresAt: data.expiresAt } : c)));
      refreshHistory();
    },
    'claim.released': event => {
      const { data, actor } = unwrap<ClaimData>(event);
      if (!data.claimId) return;
      dropClaim(data.claimId, data.worker ?? actor ?? '', data.nodeIds);
      refreshHistory();
    },
    'node.blocked': event => {
      const { data, actor, createdAt } = unwrap<BlockData>(event);
      if (!data.nodeId) return;
      patchNodes(queryClient, fileKey, [data.nodeId], { state: 'blocked', blocked: { reason: data.reason ?? null, by: data.by ?? actor, at: createdAt } });
      refreshHistory();
    },
    'node.unblocked': event => {
      const { data } = unwrap<BlockData>(event);
      if (!data.nodeId) return;
      patchNodes(queryClient, fileKey, [data.nodeId], n => ({
        state: n.changedProps?.length || n.changeType ? 'dirty' : 'clean',
        blocked: null,
      }));
      refreshHistory();
    },
    'note.added': () => void queryClient.invalidateQueries({ queryKey: nodeKeys.all(fileKey) }),
    'render_check.requested': () => refreshRenderChecks(queryClient, fileKey),
    'render_check.passed': () => refreshRenderChecks(queryClient, fileKey),
    'render_check.mismatch': () => refreshRenderChecks(queryClient, fileKey),
    'note.resolved': () => void queryClient.invalidateQueries({ queryKey: nodeKeys.all(fileKey) }),
    'note.dismissed': () => void queryClient.invalidateQueries({ queryKey: nodeKeys.all(fileKey) }),
  });

  useEffect(() => {
    const timers = (claims.data?.claims ?? []).flatMap(claim => {
      const { claimId, expiresAt } = claim;
      if (!claimId || !expiresAt) return [];
      const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
      return [setTimeout(() => dropClaim(claimId, claim.worker ?? '', claim.nodeIds), delay)];
    });
    return () => timers.forEach(clearTimeout);
  }, [claims.data, dropClaim]);

  const onSpriteEnd = useCallback((nodeId: string, state: AgentSpriteState) => {
    setSprites(prev => {
      if (prev[nodeId]?.state !== state) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  return { stream, sprites, onSpriteEnd };
}
