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
 * A small clock dial showing a ticket's complexity points: a ring with ticks at
 * 12 / 3 / 6 / 9 and the value in the centre. `null` (not estimated) is a
 * dashed ring with `–`, distinct from `0`; `∞` (must be split) is tinted.
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
      ? (size === 'md' ? 'text-[13px]' : 'text-[12px]')
      : label.length >= 3
        ? (size === 'md' ? 'text-[8.5px]' : 'text-[7.5px]')
        : (size === 'md' ? 'text-[11px]' : 'text-[9.5px]');
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
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={px}
        height={px}
        className={cn('absolute inset-0', complexity === 'inf' ? undefined : 'text-[var(--theme-text-muted)]')}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10.5" strokeWidth="1.25" strokeDasharray={complexity === null ? '2.2 2' : undefined} />
        {complexity !== null && (
          <path d="M12 1.5v2.2M22.5 12h-1.6M12 22.5v-2.2M1.5 12h1.6" strokeWidth="1.5" />
        )}
      </svg>
      <span className="relative">{label}</span>
    </span>
  );
}
