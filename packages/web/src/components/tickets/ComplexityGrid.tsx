import { useRef } from 'react';
import type { TicketComplexity } from '@fleex/shared';
import { TICKET_COMPLEXITIES, complexityLabel } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';
import { ComplexityBadge } from './ComplexityBadge';

const COLUMNS = 4;
/** Index of the "Not estimated" row, after the 12 scale cells. */
const UNESTIMATED = TICKET_COMPLEXITIES.length;

/**
 * The complexity menu body: a 4×3 grid of the scale, then a "Not estimated"
 * row. Shared by the ticket picker and the new-task draft picker.
 *
 * Keyboard: arrows move focus within the grid (Down from the last row lands on
 * "Not estimated"), Enter/Space picks the focused cell (native button),
 * Backspace/Delete clears the estimate. Escape is handled by `usePopover`.
 * Mount it inside a `FloatingFocusManager` with
 * `initialFocus={complexityInitialFocus(value)}`: the 13 buttons are the only
 * tabbables, in order, so that index lands on the current value.
 */
export function ComplexityGrid({
  value,
  onPick,
  cellRefs,
}: {
  value: TicketComplexity | null;
  onPick: (c: TicketComplexity | null) => void;
  cellRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
}) {
  const focusCell = (i: number) => cellRefs.current[i]?.focus();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      onPick(null);
      return;
    }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    e.stopPropagation();
    const current = cellRefs.current.findIndex((el) => el === document.activeElement);
    const i = current === -1 ? 0 : current;
    if (i === UNESTIMATED) {
      if (e.key === 'ArrowUp') focusCell(UNESTIMATED - COLUMNS);
      return;
    }
    if (e.key === 'ArrowRight') focusCell(Math.min(UNESTIMATED - 1, i + 1));
    else if (e.key === 'ArrowLeft') focusCell(Math.max(0, i - 1));
    else if (e.key === 'ArrowDown') focusCell(i + COLUMNS >= UNESTIMATED ? UNESTIMATED : i + COLUMNS);
    else if (e.key === 'ArrowUp' && i - COLUMNS >= 0) focusCell(i - COLUMNS);
  };

  const pick = (c: TicketComplexity | null) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onPick(c);
  };

  return (
    <div role="menu" aria-label="Complexity" onKeyDown={onKeyDown} className="w-[184px] p-2">
      <div className="flex justify-between px-0.5 pb-1.5 text-[10.5px] uppercase tracking-wide text-[var(--theme-text-muted)]">
        <span>Complexity</span>
        <span className="normal-case">{value === null ? 'not estimated' : value === 'inf' ? '∞' : `${value} pts`}</span>
      </div>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Complexity points">
        {TICKET_COMPLEXITIES.map((c, i) => (
          <button
            key={c}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={c === value}
            aria-label={c === 'inf' ? 'Infinity, too big: split it' : `${c} points`}
            onClick={pick(c)}
            className={cn(
              'h-[30px] rounded-md border font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-text-primary)]',
              c === value
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
                : 'border-[var(--theme-border)] bg-[var(--theme-bg-base)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-primary)]',
              c === 'inf' && cn('text-[15px]', c !== value && tintText('orange')),
            )}
          >
            {complexityLabel(c)}
          </button>
        ))}
      </div>
      <button
        ref={(el) => {
          cellRefs.current[UNESTIMATED] = el;
        }}
        type="button"
        role="menuitemradio"
        aria-checked={value === null}
        onClick={pick(null)}
        className={cn(
          'mt-1.5 flex w-full items-center gap-2 rounded-md border border-dashed border-[var(--theme-border-input)] px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-text-primary)]',
          value === null
            ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
            : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]',
        )}
      >
        <ComplexityBadge complexity={null} />
        Not estimated
        <kbd className="ml-auto font-mono text-[10px] text-[var(--theme-text-faint)]">⌫</kbd>
      </button>
    </div>
  );
}

/** Tabbable index to focus when the grid opens: the current value, or "Not estimated". */
export function complexityInitialFocus(value: TicketComplexity | null): number {
  return value === null ? UNESTIMATED : TICKET_COMPLEXITIES.indexOf(value);
}

export function useComplexityCellRefs() {
  return useRef<(HTMLButtonElement | null)[]>([]);
}
