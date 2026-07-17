import type { TicketStatus } from '@fleex/shared';
import { TICKET_STATUS_LABELS, TICKET_STATUSES } from '@fleex/shared';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

/**
 * Status dot palette, mirrored from the kanban/dashboard NanoKanban swatches so
 * an inline status chip reads identically wherever it appears. Hex values (not
 * raw Tailwind palette classes) are used as inline `backgroundColor`, which is
 * allowed by `check-raw-palette.mjs` and follows the DashboardView precedent.
 */
export const STATUS_COLOR: Record<string, string> = {
  backlog: 'var(--theme-text-faint)',
  todo: '#fb923c',
  doing: '#60a5fa',
  reviewing: '#c084fc',
  done: '#4ade80',
  cancelled: 'rgb(248 113 113 / 0.7)',
};

interface Props {
  status: TicketStatus;
  onChange: (next: TicketStatus) => void;
  /** Rendered bigger inside the inspector header. */
  size?: 'sm' | 'md';
}

/**
 * Inline status chip with a click-to-change dropdown. One of the cockpit's
 * three inspector actions (change status), also used per-row in the list.
 * Stops click propagation so opening the menu never opens/steals the row's
 * inspector selection.
 */
export function StatusChipDropdown({ status, onChange, size = 'sm' }: Props) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
  });
  const color = STATUS_COLOR[status] ?? 'var(--theme-text-muted)';

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <span
        ref={refs.setReference}
        role="button"
        tabIndex={0}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--theme-bg-overlay)] font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]',
          size === 'md' ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]',
        )}
        {...getReferenceProps()}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        {TICKET_STATUS_LABELS[status] ?? status}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[130px] rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
          >
            {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => (
              <button
                key={s}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                  status === s && 'font-semibold text-[var(--theme-accent)]',
                )}
                onClick={() => {
                  if (status !== s) onChange(s);
                  setOpen(false);
                }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[s] }}
                />
                {TICKET_STATUS_LABELS[s] ?? s}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
