import type { ApiResponse } from '../../api/client';

export type ActivityEvent = NonNullable<ApiResponse<'/v3/events'>['events']>[number];

export const EVENT_TYPES = [
  'sync.completed',
  'nodes.cleared',
  'claim.created',
  'claim.renewed',
  'claim.released',
  'node.blocked',
  'node.unblocked',
] as const;

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** The node ids an event mentions (`data.nodeId` or `data.nodeIds`). */
export function eventNodeIds(event: ActivityEvent): string[] {
  const data = event.data ?? {};
  const one = str(data.nodeId);
  if (one) return [one];
  return Array.isArray(data.nodeIds) ? data.nodeIds.filter((id): id is string => typeof id === 'string') : [];
}

/** One line on what happened, from the event's ids, counts and labels. */
export function describeEvent(event: ActivityEvent): string {
  const data = event.data ?? {};
  switch (event.type) {
    case 'sync.completed': {
      const counts = (data.counts ?? {}) as Record<string, unknown>;
      const parts = [plural(num(counts.uploaded) ?? 0, 'node')];
      if (num(counts.changed) !== null) parts.push(`${num(counts.changed)} changed`);
      if (num(counts.deleted) !== null) parts.push(`${num(counts.deleted)} deleted`);
      return parts.join(', ');
    }
    case 'nodes.cleared': {
      const commit = str(data.commitRef);
      const nodes = plural(eventNodeIds(event).length, 'node');
      return commit ? `${nodes} at ${commit.slice(0, 7)}` : nodes;
    }
    case 'claim.created':
    case 'claim.renewed':
    case 'claim.released': {
      const nodes = plural(num(data.nodeCount) ?? eventNodeIds(event).length, 'node');
      const label = str(data.label);
      return label ? `${nodes} · ${label}` : nodes;
    }
    case 'node.blocked':
      return str(data.reason) ?? 'blocked';
    case 'node.unblocked':
      return data.auto === true ? 'unblocked by a sync' : 'unblocked';
    default:
      return '';
  }
}

/** Two-letter initials for an actor: `claude-local` → `CL`, `devin` → `DV`, `plugin` → `PL`. */
export function actorInitials(actor: string): string {
  const parts = actor.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const [first = '', second] = parts;
  if (second) return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase();
  const consonant = first.slice(1).match(/[^aeiou\d]/i)?.[0] ?? first[1] ?? '';
  return `${first[0] ?? '?'}${consonant}`.toUpperCase();
}
