import type { TicketTab } from '../stores/ticketStore';

/**
 * Build an in-app deep link to a ticket detail view.
 *
 * The board slug `all` always resolves (it maps to "all boards", board = null
 * in `parseUrl`) and still opens the ticket, so it is a safe fallback whenever
 * the ticket's board is unknown client-side. When the board IS known we use it
 * so the back navigation lands on the right board.
 *
 * Mirrors the format produced by `storeToUrl` in router/RouterSync.tsx:
 *   /tickets/board/{boardSlug}/ticket/{ticketId}[/{tab}]
 * (the `description` tab is the default and is omitted, matching storeToUrl).
 */
export function ticketLink(ticketId: string, tab?: TicketTab, boardId?: string | null): string {
  const boardSlug = boardId ?? 'all';
  const base = `/tickets/board/${boardSlug}/ticket/${ticketId}`;
  return tab && tab !== 'description' ? `${base}/${tab}` : base;
}
