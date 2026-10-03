/** `1 scope`, `4 scopes`. */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** A count as the design writes it: `3,553`. */
export const formatCount = (count: number): string => count.toLocaleString('en-US');

/** `clean / total` as a whole percentage, 0 for an empty item. */
export const percent = (clean: number, total: number): number => (total > 0 ? Math.round((Math.min(clean, total) / total) * 100) : 0);

/**
 * How long ago `iso` was: `12 min ago`, `2 days ago` (`long`, the Last sync column) or `1m ago`, `3d ago`
 * (`short`, after `claimed` in agent cells).
 */
export function timeAgo(iso: string, now: number = Date.now(), style: 'long' | 'short' = 'long'): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return style === 'short' ? `${minutes}m ago` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return style === 'short' ? `${hours}h ago` : `${plural(hours, 'hour')} ago`;
  const days = Math.floor(hours / 24);
  return style === 'short' ? `${days}d ago` : `${plural(days, 'day')} ago`;
}
