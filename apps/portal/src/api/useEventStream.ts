import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/** `connecting` until the first open; `reconnecting` while the browser retries; `closed` when it gave up (e.g. 401). */
export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'closed';

/** One server-sent event: `event` is the type, `data` the parsed JSON. */
export interface StreamEvent<T = unknown> {
  id: string;
  type: string;
  data: T;
}

export type StreamHandlers = Record<string, (event: StreamEvent) => void>;

type Listener = (event: StreamEvent) => void;

interface Stream {
  source: EventSource;
  state: StreamState;
  refs: number;
  listeners: Map<string, Set<Listener>>;
  subscribed: Set<string>;
  stateSubscribers: Set<() => void>;
}

const streams = new Map<string, Stream>();

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function setState(stream: Stream, state: StreamState): void {
  if (stream.state === state) return;
  stream.state = state;
  for (const notify of stream.stateSubscribers) notify();
}

function open(url: string): Stream {
  const existing = streams.get(url);
  if (existing) return existing;
  const source = new EventSource(url);
  const stream: Stream = {
    source,
    state: 'connecting',
    refs: 0,
    listeners: new Map(),
    subscribed: new Set(),
    stateSubscribers: new Set(),
  };
  source.onopen = () => setState(stream, 'live');
  source.onerror = () => setState(stream, source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
  streams.set(url, stream);
  return stream;
}

function listen(stream: Stream, type: string, listener: Listener): () => void {
  let set = stream.listeners.get(type);
  if (!set) {
    set = new Set();
    stream.listeners.set(type, set);
  }
  set.add(listener);
  if (!stream.subscribed.has(type)) {
    stream.subscribed.add(type);
    stream.source.addEventListener(type, message => {
      const event = message as MessageEvent<string>;
      const parsed: StreamEvent = { id: event.lastEventId, type, data: parse(event.data) };
      for (const fn of [...(stream.listeners.get(type) ?? [])]) fn(parsed);
    });
  }
  return () => set.delete(listener);
}

function retain(url: string): Stream {
  const stream = open(url);
  stream.refs += 1;
  return stream;
}

function release(url: string): void {
  const stream = streams.get(url);
  if (!stream) return;
  stream.refs -= 1;
  if (stream.refs <= 0) {
    stream.source.close();
    streams.delete(url);
  }
}

/**
 * Subscribes to a v3 event stream (`/v3/events` or `/v3/files/{fileKey}/events`). Every hook on the
 * same URL shares one `EventSource`; the browser reconnects with `Last-Event-ID` by itself.
 * `handlers` are keyed by event type; `reset` (the replay window was exceeded) refetches the
 * active queries unless a `reset` handler is given. Pass `null` to stay disconnected.
 */
export function useEventStream(url: string | null, handlers: StreamHandlers = {}): StreamState {
  const queryClient = useQueryClient();
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const types = Object.keys(handlers).filter(t => t !== 'reset').sort().join('\n');

  useEffect(() => {
    if (!url) return undefined;
    const stream = retain(url);
    const unlisten = [
      ...(types ? types.split('\n') : []).map(type => listen(stream, type, e => handlersRef.current[type]?.(e))),
      listen(stream, 'reset', e => {
        const onReset = handlersRef.current.reset;
        if (onReset) onReset(e);
        else void queryClient.invalidateQueries({ refetchType: 'active' });
      }),
    ];
    return () => {
      for (const fn of unlisten) fn();
      release(url);
    };
  }, [url, types, queryClient]);

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!url) return () => {};
      const stream = retain(url);
      stream.stateSubscribers.add(notify);
      return () => {
        stream.stateSubscribers.delete(notify);
        release(url);
      };
    },
    [url],
  );

  return useSyncExternalStore(subscribe, () => (url ? (streams.get(url)?.state ?? 'connecting') : 'closed'));
}

/** For tests: the open streams by URL. */
export const openStreams = (): ReadonlyMap<string, { readonly state: StreamState; readonly refs: number }> => streams;
