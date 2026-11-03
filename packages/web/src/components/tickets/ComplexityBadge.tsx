import type { TicketComplexity } from '@fleex/shared';
import { complexityLabel } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';

/** Field-style wording: `5 pts`, `∞ (too big, split it)`, or `Not estimated` for null. */
export function complexityDescription(c: TicketComplexity | null): string {
  if (c === null) return 'Not estimated';
  if (c === 'inf') return '∞ (too big, split it)';
  return `${c} pts`;
}

/**
 * Monospace pill showing a ticket's complexity points. `null` (not estimated)
 * renders a dashed `–`, distinct from `0`; `∞` (must be split) is tinted.
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
  return (
    <span
      data-testid="complexity-badge"
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded font-mono font-semibold leading-none',
        size === 'md' ? 'h-[21px] min-w-[26px] px-1.5 text-[11.5px]' : 'h-[18px] min-w-[22px] px-1 text-[10.5px]',
        complexity === null
          ? 'border border-dashed border-[var(--theme-border-input)] text-[var(--theme-text-faint)]'
          : complexity === 'inf'
            ? cn(tint('orange'), size === 'md' ? 'text-[13px]' : 'text-[12px]')
            : 'border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]',
        className,
      )}
    >
      {complexityLabel(complexity)}
    </span>
  );
}
