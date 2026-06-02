import { TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { getStatusBadgeClass } from '../../lib/statusColors';
import { useTicketStore } from '../../stores/ticketStore';

export function TicketDetailHeader({ ticket }: { ticket: Ticket }) {
  const selectTicket = useTicketStore((s) => s.selectTicket);

  return (
    <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
      <button
        className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => selectTicket(null)}
        title="Back to board"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="10,4 6,8 10,12" />
        </svg>
      </button>

      <span className="text-xs font-medium text-[var(--theme-text-muted)]">
        #{ticket.displayId}
      </span>

      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getStatusBadgeClass(ticket.status) || 'text-[var(--theme-text-secondary)] bg-[var(--theme-bg-overlay)]')}>
        {TICKET_STATUS_LABELS[ticket.status]}
      </span>

      <span className="flex-1 truncate text-sm font-medium text-[var(--theme-text-primary)]">
        {ticket.title}
      </span>
    </div>
  );
}
