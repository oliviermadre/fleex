/**
 * Compact age ("5s", "3m", "2h", "4d", "1w") with floor semantics.
 *
 * `now` is injectable so a live ticker (useNow, #400 pass 5) drives the label
 * off ITS clock — a tick and its rendered age can never disagree.
 */
export function formatAge(dateString: string, now: number = Date.now()): string {
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return '0s';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}
