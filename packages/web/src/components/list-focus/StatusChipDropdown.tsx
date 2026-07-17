import type { TicketStatus } from '@fleex/shared';
import { TICKET_STATUS_LABELS, TICKET_STATUSES } from '@fleex/shared';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { STATUS_COLORS } from '../../lib/statusColors';

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

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

/**
 * Inline status chip with a click-to-change dropdown. One of the cockpit's
 * three inspector actions (change status). The trigger is a status-tinted pill
 * (bg / border / text from the shared STATUS_COLORS tint map) with a colored dot
 * and a chevron — so it reads as "the current status, click to change" at a
 * glance. Stops click propagation so opening the menu never opens/steals the
 * row's inspector selection.
 */
export function StatusChipDropdown({ status, onChange, size = 'sm' }: Props) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
  });
  const tint = STATUS_COLORS[status] ?? STATUS_COLORS.backlog!;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <span
        ref={refs.setReference}
        role="button"
        tabIndex={0}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-md border font-medium transition-colors',
          tint.bg,
          tint.border,
          tint.text,
          tint.hoverBg,
          size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]',
        )}
        {...getReferenceProps()}
      >
        <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', tint.bar)} />
        {TICKET_STATUS_LABELS[status] ?? status}
        <ChevronDownIcon />
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
