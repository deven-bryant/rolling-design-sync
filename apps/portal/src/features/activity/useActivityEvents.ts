import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useEventStream, type StreamHandlers, type StreamState } from '../../api/useEventStream';
import { EVENT_TYPES, type ActivityEvent } from './events';

export interface ActivityEventsOptions {
  /** One file's events; all files when omitted. */
  fileKey?: string;
  /** Hold incoming events back (counted in `buffered`) until false again. */
  paused?: boolean;
  /** JSON page size (the API caps it at 1000). */
  pageSize?: number;
  /** How far back the initial page reaches, in hours. */
  sinceHours?: number;
  /** Most events kept, newest first. */
  max?: number;
}

export interface ActivityEvents {
  /** Newest first. */
  events: ActivityEvent[];
  /** Events that arrived while paused. */
  buffered: number;
  isLoading: boolean;
  error: Error | null;
  stream: StreamState;
}

export const eventsStreamUrl = (fileKey?: string) =>
  fileKey ? `/v3/files/${encodeURIComponent(fileKey)}/events` : '/v3/events';

/** The newest page of the log since `since`, newest first. */
async function fetchLatest(fileKey: string | undefined, since: string, pageSize: number, signal: AbortSignal) {
  const query = { order: 'desc' as const, limit: pageSize, since };
  const page = fileKey
    ? await api.get('/v3/files/{fileKey}/events', { path: { fileKey }, query, signal })
    : await api.get('/v3/events', { query, signal });
  return page.events ?? [];
}

const byIdDesc = (a: ActivityEvent, b: ActivityEvent) => (b.id ?? 0) - (a.id ?? 0);

/** The newest JSON page of the event log, then the live stream on top, newest first. */
export function useActivityEvents({
  fileKey,
  paused = false,
  pageSize = 500,
  sinceHours = 24,
  max = 200,
}: ActivityEventsOptions = {}): ActivityEvents {
  const queryClient = useQueryClient();
  const [since] = useState(() => new Date(Date.now() - sinceHours * 3_600_000).toISOString());
  const queryKey = ['events', fileKey ?? null, since, pageSize];
  const initial = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchLatest(fileKey, since, pageSize, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [incoming, setIncoming] = useState<ActivityEvent[]>([]);
  const [frozen, setFrozen] = useState<number | null>(paused ? 0 : null);
  const [wasPaused, setWasPaused] = useState(paused);
  if (paused !== wasPaused) {
    setWasPaused(paused);
    setFrozen(paused ? incoming.length : null);
  }

  const key = fileKey ?? null;
  const [streamKey, setStreamKey] = useState(key);
  if (streamKey !== key) {
    setStreamKey(key);
    setIncoming([]);
  }

  const handlers = useMemo<StreamHandlers>(() => {
    const append: StreamHandlers[string] = ({ data }) => {
      const event = data as ActivityEvent;
      setIncoming(list => [...list, fileKey && !event.fileKey ? { ...event, fileKey } : event]);
    };
    return {
      ...Object.fromEntries(EVENT_TYPES.map(type => [type, append])),
      reset: () => {
        setIncoming([]);
        void queryClient.invalidateQueries({ queryKey: ['events'] });
      },
    };
  }, [fileKey, queryClient]);
  const stream = useEventStream(eventsStreamUrl(fileKey), handlers);

  const shown = frozen === null ? incoming : incoming.slice(0, frozen);
  const events = useMemo(() => {
    const seen = new Set<number>();
    const merged: ActivityEvent[] = [];
    for (const event of [...shown].reverse().concat(initial.data ?? [])) {
      if (event.id !== undefined) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
      }
      merged.push(event);
    }
    return merged.sort(byIdDesc).slice(0, max);
  }, [shown, initial.data, max]);

  return {
    events,
    buffered: incoming.length - shown.length,
    isLoading: initial.isPending,
    error: initial.error,
    stream,
  };
}
