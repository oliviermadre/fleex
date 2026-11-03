import type { TicketComplexity } from '@fleex/shared';
import { complexityLabel } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

/** Field-style wording: `5 pts`, `∞ (too big, split it)`, or `Not estimated` for null. */
export function complexityDescription(c: TicketComplexity | null): string {
  if (c === null) return 'Not estimated';
  if (c === 'inf') return '∞ (too big, split it)';
  return `${c} pts`;
}

/**
 * How far round the dial a value sits (0..1). A hand-tuned curve, not the
 * scale index: small values stay small, 13 already reads as "big", 55 is
 * nearly full and ∞ is full.
 */
export const DIAL_FILL: Record<TicketComplexity, number> = {
  '0': 0,
  '0.5': 0.02,
  '1': 0.05,
  '2': 0.1,
  '3': 0.15,
  '5': 0.25,
  '8': 0.4,
  '13': 0.65,
  '21': 0.75,
  '34': 0.85,
  '55': 0.95,
  inf: 1,
};

/**
 * A small stopwatch showing a ticket's complexity points: a crown on top,
 * short inner ticks at 3 / 6 / 9, an arc that fills with the value's place on
 * the scale, and the value in the centre. `null` (not estimated) is a dashed,
 * empty dial with `–`, distinct from `0`; `∞` (must be split) is a full,
 * orange dial.
 */
export function ComplexityBadge({
  complexity,
  size = 'sm',
  className,
}: {
  complexity: TicketComplexity | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const label = complexityLabel(complexity);
  const px = size === 'md' ? 26 : 22;
  // Three characters (0.5) need a smaller font to stay inside the ticks.
  const font =
    complexity === 'inf'
      ? (size === 'md' ? 'text-[12px]' : 'text-[11px]')
      : label.length >= 3
        ? (size === 'md' ? 'text-[8px]' : 'text-[7px]')
        : label.length === 2
          ? (size === 'md' ? 'text-[9.5px]' : 'text-[8px]')
          : (size === 'md' ? 'text-[10.5px]' : 'text-[9px]');
  const fill = complexity === null ? 0 : DIAL_FILL[complexity];
  return (
    <span
      data-testid="complexity-badge"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center font-mono font-semibold leading-none',
        font,
        complexity === null
          ? 'text-[var(--theme-text-faint)]'
          : complexity === 'inf'
            ? tintText('orange')
            : 'text-[var(--theme-text-primary)]',
        className,
      )}
      style={{ width: px, height: px }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width={px} height={px} className="absolute inset-0" fill="none" stroke="currentColor" strokeLinecap="round">
        {/* Crown: what makes it read as a stopwatch rather than a target. */}
        <path d="M12 2.6v1.6M10.4 1.6h3.2" strokeWidth="1.5" opacity={complexity === null ? 0.6 : 0.75} />
        {/* Dial ring: faint track, then the filled arc from 12 o'clock. */}
        <circle cx="12" cy="13.5" r="9" strokeWidth="1.4" opacity={complexity === null ? 0.9 : 0.3} strokeDasharray={complexity === null ? '2.2 2' : undefined} />
        {fill > 0 && (
          <circle
            cx="12"
            cy="13.5"
            r="9"
            strokeWidth="1.6"
            pathLength={100}
            strokeDasharray={`${fill * 100} 100`}
            transform="rotate(-90 12 13.5)"
          />
        )}
        {complexity !== null && (
          <path d="M20.3 13.5h-0.9M12 21.8v-1.3M3.7 13.5h0.9" strokeWidth="1.2" opacity="0.55" />
        )}
      </svg>
      <span className="relative" style={{ marginTop: px * 0.1 }}>{label}</span>
    </span>
  );
}
