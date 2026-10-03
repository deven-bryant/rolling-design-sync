import { describe, expect, it } from 'vitest';
import { actorInitials, describeEvent, eventNodeIds } from './events';
import { leaseLeft, relativeTime } from './time';

describe('activity formatting', () => {
  it('describes each event type from its ids, counts and labels', () => {
    expect(describeEvent({ type: 'sync.completed', data: { counts: { uploaded: 1, changed: 0, deleted: 2 } } })).toBe(
      '1 node, 0 changed, 2 deleted',
    );
    expect(describeEvent({ type: 'claim.released', data: { nodeCount: 4, label: 'Page header' } })).toBe('4 nodes · Page header');
    expect(describeEvent({ type: 'node.blocked', data: { nodeId: '1:2', reason: 'needs icons' } })).toBe('needs icons');
    expect(describeEvent({ type: 'node.unblocked', data: { nodeId: '1:2', auto: true } })).toBe('unblocked by a sync');
    expect(eventNodeIds({ data: { nodeId: '1:2' } })).toEqual(['1:2']);
    expect(eventNodeIds({ data: { nodeIds: ['1:2', 3] } })).toEqual(['1:2']);
  });

  it('makes two-letter initials', () => {
    expect(['devin', 'claude-local', 'plugin', 'cursor-ui', 'x'].map(actorInitials)).toEqual(['DV', 'CL', 'PL', 'CU', 'X']);
  });

  it('formats relative times and leases', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect([ago(10_000), ago(12 * 60_000), ago(3 * 3_600_000), ago(2 * 86_400_000)].map(t => relativeTime(t, now))).toEqual([
      'Just now',
      '12 min ago',
      '3 h ago',
      '2 days ago',
    ]);
    expect(relativeTime(null, now)).toBe('—');
    expect([now + 14 * 60_000 + 5_000, now + 42_000, now].map(t => leaseLeft(new Date(t).toISOString(), now))).toEqual([
      '14 min left',
      '42 s left',
      'expired',
    ]);
  });
});
