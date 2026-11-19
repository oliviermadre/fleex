/** How the Factory writes money and time: short, and readable at a glance on the floor. */

export function money(usd: number): string {
  if (!usd) return '$0';
  if (usd < 0.01) return '<$0.01';
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-US')}`;
}

/** 42s · 7m · 1h 05m · 3d 4h */
export function span(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Milliseconds between an ISO date and `now` (also ISO), never negative. */
export function since(iso: string, now: string): number {
  const a = new Date(iso).getTime(), b = new Date(now).getTime();
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, b - a);
}
