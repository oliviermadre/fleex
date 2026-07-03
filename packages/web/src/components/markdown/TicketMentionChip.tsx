import type { Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';

/**
 * Resolve a ticket reference the same way the backend does: a purely numeric ref
 * is a `displayId`, anything else is a UUID `id`. Mirrors the resolver at
 * `tickets.routes.ts` (`GET /api/tickets/:id`).
 */
function resolveTicket(tickets: Ticket[], idRef: string): Ticket | null {
  if (/^\d+$/.test(idRef)) {
    const did = Number.parseInt(idRef, 10);
    return tickets.find((t) => t.displayId === did) ?? null;
  }
  return tickets.find((t) => t.id === idRef) ?? null;
}

/**
 * Inline chip for a `@ticket:<id>` mention. Rendered by every Markdown surface
 * (comments, description, scratchpad, deliverables) via the `#fleex-ticket:` href.
 *
 * The reference is resolved reactively from the live ticket store — so a chip
 * fills in as soon as the ticket list loads — and clicking navigates to the
 * referenced ticket. A reference the store doesn't know about degrades to plain
 * text (`@ticket:<id>`) rather than a dead chip.
 */
export function TicketMentionChip({ idRef }: { idRef: string }) {
  // Select the ticket object (stable reference) so we never return a fresh
  // object from the selector and loop renders — same pattern as NotificationCard.
  const ticket = useTicketStore((s) => resolveTicket(s.tickets, idRef));

  if (!ticket) {
    return <span>@ticket:{idRef}</span>;
  }

  const openTicket = () => {
    useUIStore.getState().setActivePanel('tickets');
    useTicketStore.getState().selectTicket(ticket.id);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openTicket();
      }}
      title={`#${ticket.displayId} · ${ticket.title}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm bg-[var(--theme-accent)]/12 px-1 py-px align-baseline text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-accent)]/25"
    >
      <span className="shrink-0 font-mono text-[0.85em] font-semibold">#{ticket.displayId}</span>
      <span className="truncate">{ticket.title}</span>
    </button>
  );
}
