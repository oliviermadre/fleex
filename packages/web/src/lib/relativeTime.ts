/**
 * Shared "time since" formatter used across the ticket, deliverable, dashboard
 * and assistant surfaces. Previously each surface hand-rolled the same ladder;
 * this centralizes the two dialects that actually shipped:
 *
 *  - `verbose` (default): "just now" / "5m ago" / "3h ago" / "2d ago"
 *  - `compact`: "0m" / "5m" / "3h" / "2d" (no "just now", no " ago" suffix)
 *
 * `maxUnit: 'month'` additionally rolls days ≥ 30 into "Nmo" (used by the
 * assistant sidebar). Behavior is intentionally byte-for-byte identical to the
 * inline helpers it replaces — do not "improve" the thresholds.
 */

export type RelativeTimeStyle = 'verbose' | 'compact';

export interface FormatRelativeTimeOptions {
  /** "just now"/" ago" wording (verbose) vs. bare units (compact). Default: 'verbose'. */
  style?: RelativeTimeStyle;
  /** Largest unit rendered. 'day' keeps counting days; 'month' rolls ≥30d into months. Default: 'day'. */
  maxUnit?: 'day' | 'month';
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;

export function formatRelativeTime(
  input: string | number | Date,
  options: RelativeTimeStyle | FormatRelativeTimeOptions = 'verbose',
): string {
  const opts = typeof options === 'string' ? { style: options } : options;
  const verbose = (opts.style ?? 'verbose') === 'verbose';
  const maxUnit = opts.maxUnit ?? 'day';
  const suffix = verbose ? ' ago' : '';

  const then = input instanceof Date ? input.getTime() : new Date(input).getTime();
  const minutes = Math.floor((Date.now() - then) / MS_PER_MINUTE);

  if (verbose && minutes < 1) return 'just now';
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m${suffix}`;

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h${suffix}`;

  const days = Math.floor(hours / HOURS_PER_DAY);
  if (maxUnit === 'month' && days >= DAYS_PER_MONTH) {
    return `${Math.floor(days / DAYS_PER_MONTH)}mo${suffix}`;
  }
  return `${days}d${suffix}`;
}
