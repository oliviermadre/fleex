/**
 * Ticket-scoped status picker matching the Kanban's colour language: a trigger
 * chip showing the current status (coloured dot + label) that opens a popover of
 * all statuses. The app ships no status popover (only the NanoKanban strip), so
 * this mirrors the TypePickerPopover pattern with statusColors.
 */
import type { Ticket, TicketStatus } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { useTicketStore } from '../../../stores/ticketStore';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { STATUS_COLORS } from '../../../lib/statusColors';

const STATUSES: TicketStatus[] = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'];

export function WorkStatusPicker({ ticket }: { ticket: Ticket }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();
  const color = STATUS_COLORS[ticket.status];

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        title="Click to change status"
        className={cn(
          'inline-flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--theme-bg-hover)]',
          color?.text,
        )}
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', color?.bar)} />
        <span className="truncate">{TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}</span>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[160px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={(e) => {
                  e.stopPropagation();
                  updateTicket(ticket.id, { status: s });
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--theme-bg-hover)]',
                  s === ticket.status ? 'bg-[var(--theme-bg-hover)]' : '',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_COLORS[s]?.bar)} />
                <span className={cn('text-xs font-medium', STATUS_COLORS[s]?.text)}>
                  {TICKET_STATUS_LABELS[s] ?? s}
                </span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
