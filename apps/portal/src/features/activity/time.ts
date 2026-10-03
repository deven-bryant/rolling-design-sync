const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `Just now`, `12 min ago`, `3 h ago`, `2 days ago`. */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const diff = Math.max(0, now - Date.parse(iso));
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  const days = Math.floor(diff / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** What is left of a lease: `14 min left`, `42 s left`, `expired`. */
export function leaseLeft(expiresAt: string, now: number): string {
  const seconds = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `${seconds} s left`;
  return `${Math.floor(seconds / 60)} min left`;
}

/** The start of the minute `iso` falls in, as a timestamp. */
export function minuteOf(iso: string): number {
  return Math.floor(Date.parse(iso) / MINUTE) * MINUTE;
}
