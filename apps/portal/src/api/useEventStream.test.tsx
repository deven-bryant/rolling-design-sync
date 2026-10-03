import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/fake-event-source';
import { openStreams, useEventStream, type StreamHandlers } from './useEventStream';

function Probe({ url, handlers, label = 'state' }: { url: string | null; handlers?: StreamHandlers; label?: string }) {
  const state = useEventStream(url, handlers);
  return <output aria-label={label}>{state}</output>;
}

const only = () => {
  expect(FakeEventSource.instances).toHaveLength(1);
  return FakeEventSource.instances[0] as FakeEventSource;
};

describe('useEventStream', () => {
  let client: QueryClient;
  const wrap = (ui: ReactNode) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;

  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    client = new QueryClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches events by type with parsed data', () => {
    const cleared = vi.fn();
    const claimed = vi.fn();
    render(wrap(<Probe url="/v3/events" handlers={{ 'nodes.cleared': cleared, 'claim.created': claimed }} />));
    const source = only();
    expect(source.url).toBe('/v3/events');
    act(() => source.emit('nodes.cleared', { fileKey: 'f', nodeIds: ['1:2'] }, '42'));
    expect(cleared).toHaveBeenCalledWith({ id: '42', type: 'nodes.cleared', data: { fileKey: 'f', nodeIds: ['1:2'] } });
    expect(claimed).not.toHaveBeenCalled();
  });

  it('exposes connecting → live → reconnecting → live → closed', () => {
    render(wrap(<Probe url="/v3/events" />));
    const source = only();
    const state = () => screen.getByLabelText('state').textContent;
    expect(state()).toBe('connecting');
    act(() => source.open());
    expect(state()).toBe('live');
    act(() => source.fail());
    expect(state()).toBe('reconnecting');
    act(() => source.open());
    expect(state()).toBe('live');
    act(() => source.fail({ closed: true }));
    expect(state()).toBe('closed');
  });

  it('refetches active queries on reset by default', () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(wrap(<Probe url="/v3/files/f/events" />));
    act(() => only().emit('reset', { fileKey: 'f', lastEventId: '7' }));
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
  });

  it('calls a reset handler instead when given', () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const reset = vi.fn();
    render(wrap(<Probe url="/v3/files/f/events" handlers={{ reset }} />));
    act(() => only().emit('reset', { fileKey: 'f' }));
    expect(reset).toHaveBeenCalledWith({ id: '1', type: 'reset', data: { fileKey: 'f' } });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('shares one EventSource per URL and closes it with the last subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender, unmount } = render(
      wrap(
        <>
          <Probe url="/v3/events" handlers={{ 'sync.completed': a }} label="a" />
          <Probe url="/v3/events" handlers={{ 'sync.completed': b }} label="b" />
        </>,
      ),
    );
    const source = only();
    act(() => source.open());
    expect(screen.getByLabelText('a').textContent).toBe('live');
    expect(screen.getByLabelText('b').textContent).toBe('live');
    act(() => source.emit('sync.completed', { fileKey: 'f' }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    rerender(wrap(<Probe url="/v3/events" handlers={{ 'sync.completed': a }} label="a" />));
    act(() => source.emit('sync.completed', { fileKey: 'f' }));
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(source.readyState).toBe(FakeEventSource.OPEN);

    unmount();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    expect(openStreams().size).toBe(0);
  });

  it('uses the latest handler without reconnecting', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(wrap(<Probe url="/v3/events" handlers={{ 'claim.created': first }} />));
    rerender(wrap(<Probe url="/v3/events" handlers={{ 'claim.created': second }} />));
    act(() => only().emit('claim.created', {}));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stays disconnected for a null URL', () => {
    render(wrap(<Probe url={null} />));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByLabelText('state').textContent).toBe('closed');
  });
});
