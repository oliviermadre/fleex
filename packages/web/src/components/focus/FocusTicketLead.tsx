import type { Ticket } from '@fleex/shared';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tintClasses } from '../../lib/tints';
import { getStatusBadgeClass } from '../../lib/statusColors';
import { useTicketStore } from '../../stores/ticketStore';
import { PriorityPickerPopover } from '../tickets/PriorityPickerPopover';
import { TypePickerPopover } from '../tickets/TypePickerPopover';

/** The ticket's status — its own column in Focus rows, so every row lines up. */
export function FocusStatusBadge({ ticket, className }: { ticket: Pick<Ticket, 'status'>; className?: string }) {
  return (
    <span className={cn('shrink-0 justify-self-start rounded-full px-1.5 text-[10.5px] font-medium', getStatusBadgeClass(ticket.status), className)}>
      {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
    </span>
  );
}

/**
 * Priority then type, before the ticket number — the same pickers as the Tasks
 * queue (SVG glyphs, editable in place). Clicks stay here, they don't open the row.
 */
export function FocusTicketLead({ ticket }: { ticket: Ticket }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <PriorityPickerPopover ticket={ticket} />
      <TypePickerPopover ticket={ticket} display="icon" />
    </span>
  );
}

/**
 * Favorite star after the title, as in the Tasks queue: always shown on a
 * favorite, otherwise only while the row (`group`) is hovered.
 */
export function FocusFavoriteStar({ ticket }: { ticket: Ticket }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void updateTicket(ticket.id, { favorite: !ticket.favorite });
      }}
      title={ticket.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      aria-label={ticket.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={cn(
        'shrink-0 rounded p-0.5 transition-colors',
        ticket.favorite
          ? tintClasses('yellow').solidText
          : cn('hidden group-hover:inline-flex text-[var(--theme-text-faint)]', tintClasses('yellow').hoverText),
      )}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill={ticket.favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden>
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
      </svg>
    </button>
  );
}
