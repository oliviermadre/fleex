import type { Ticket } from '@fleex/shared';
import { complexityProgress } from '@fleex/shared';
import { tintText } from '../../lib/tints';

/**
 * "3 / 14 pts done + ∞ · 2 not estimated" under an epic's progress bar.
 * Cancelled tickets are out of the total; ∞ and unestimated tickets are shown
 * apart, never folded into a number. Renders nothing for an empty epic.
 */
export function EpicComplexitySummary({ tickets }: { tickets: Pick<Ticket, 'status' | 'complexity'>[] }) {
  const { done, total } = complexityProgress(tickets);
  if (total.estimated === 0 && total.unestimated === 0) return null;

  return (
    <p data-testid="epic-complexity-summary" className="mt-1.5 text-xs text-[var(--theme-text-secondary)]">
      <span className="font-mono font-semibold text-[var(--theme-text-primary)]">{done.points}</span>
      {' / '}
      <span className="font-mono font-semibold text-[var(--theme-text-primary)]">{total.points}</span>
      {' pts done'}
      {total.infinite > 0 && <span className={`font-mono ${tintText('orange')}`}> + ∞</span>}
      {total.unestimated > 0 && ` · ${total.unestimated} not estimated`}
    </p>
  );
}
