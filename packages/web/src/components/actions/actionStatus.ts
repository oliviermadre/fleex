import type { ActionStatus } from '@fleex/shared';
import { tintSolid, tintText } from '../../lib/tints';

export const STATUS_LABEL: Record<ActionStatus, string> = {
  ok: 'OK',
  warn: 'Warning',
  ko: 'KO',
  unknown: 'Unknown',
};

/** Solid dot colour per status — theme tints, never raw palette classes. */
export function statusDotClass(status: ActionStatus): string {
  switch (status) {
    case 'ok': return tintSolid('green');
    case 'warn': return tintSolid('yellow');
    case 'ko': return tintSolid('red');
    default: return 'bg-[var(--theme-text-muted)]';
  }
}

export function statusTextClass(status: ActionStatus): string {
  switch (status) {
    case 'ok': return tintText('green');
    case 'warn': return tintText('yellow');
    case 'ko': return tintText('red');
    default: return 'text-[var(--theme-text-muted)]';
  }
}

/** "40 s ago", "3 min ago" — coarse on purpose, it is a freshness hint. */
export function formatAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

export function runDuration(startedAt: string, finishedAt?: string): string {
  if (!finishedAt) return '';
  return `${((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000).toFixed(1)} s`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Shorten a numeric badge so it stays a corner tag, not a label: 4932 → "4.9k",
 * 5000 → "5k", 1250000 → "1.3M". Anything that is not a plain integer
 * ("✓", "2/2", "warn") is shown as the probe sent it.
 */
export function compactBadge(badge: string): string {
  const raw = badge.trim();
  if (!/^-?\d+$/.test(raw)) return raw;
  const n = Number(raw);
  const abs = Math.abs(n);
  const fmt = (v: number, unit: string) => `${(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString()}${unit}`;
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}${fmt(abs / 1_000_000, 'M')}`;
  if (abs >= 1_000) return `${n < 0 ? '-' : ''}${fmt(abs / 1_000, 'k')}`;
  return raw;
}
