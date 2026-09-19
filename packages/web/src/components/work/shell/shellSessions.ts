/**
 * Derives the ordered list of sessions bound to a ticket from the session groups
 * — the only place the ticket↔worktree link lives (`Session` itself carries no
 * ticketId). Mirrors the derivation `useWorkQueue` already uses for its counts.
 * Kept pure so the shell surface can resolve per-pane bindings against it.
 */
import type { Session, SessionGroup } from '@fleex/shared';

/** Sessions attached to `ticketId` across all worktrees, oldest first (stable). */
export function sessionsForTicket(groups: readonly SessionGroup[], ticketId: string | null): Session[] {
  if (!ticketId) return [];
  const out: Session[] = [];
  for (const group of groups) {
    for (const wt of group.worktrees) {
      const wtTicketId = wt.ticketId ?? wt.agentWorktree?.ticketId;
      if (wtTicketId !== ticketId) continue;
      out.push(...wt.sessions);
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
