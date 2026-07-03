import type { Ticket, TicketPriority } from '@fleex/shared';
import { PriorityIndicator } from './PriorityIndicator';
import { useTicketStore } from '../../stores/ticketStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

const PRIORITIES: TicketPriority[] = ['high', 'medium', 'low', 'none'];

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function PriorityPickerPopover({ ticket }: { ticket: Ticket }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();

  return (
    <>
      <button
        ref={refs.setReference}
        className="cursor-pointer rounded p-0.5 transition-opacity hover:opacity-70 focus:outline-none"
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        title={`Priority: ${PRIORITY_LABELS[ticket.priority]} — click to change`}
      >
        <PriorityIndicator priority={ticket.priority} size="md" />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[110px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {PRIORITIES.map((p) => (
              <button
                key={p}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                  p === ticket.priority
                    ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-secondary)]',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  updateTicket(ticket.id, { priority: p });
                  setOpen(false);
                }}
              >
                <PriorityIndicator priority={p} size="sm" />
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
