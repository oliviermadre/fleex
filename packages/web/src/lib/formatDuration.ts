/** Compact duration between two ISO timestamps, e.g. "12s" or "3m 05s". Null when either is unreadable or they are in the wrong order. */
export function formatDuration(startedAt: string, completedAt: string): string | null {
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
