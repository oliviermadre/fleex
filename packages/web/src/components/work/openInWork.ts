/**
 * The single landing spot of every "open this session" action (a floating
 * terminal's title bar, a new task, the palette…), now that the Sessions view is
 * gone: the Work view, on the session's ticket, in full-center shell mode, with
 * the session in a pane and the keyboard in it.
 */
import type { SessionGroup } from '@fleex/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkStore } from '../../stores/workStore';

/** The ticket a session belongs to, via its worktree (Session carries no ticketId). */
export function ticketIdForSession(groups: readonly SessionGroup[], sessionId: string): string | null {
  for (const group of groups) {
    for (const wt of group.worktrees) {
      if (wt.sessions.some((s) => s.id === sessionId)) {
        return wt.ticketId ?? wt.agentWorktree?.ticketId ?? null;
      }
    }
  }
  return null;
}

/**
 * Open `sessionId` in the Work view. Returns false — and does nothing — when the
 * session has no ticket (system shell, bare worktree): the Work view is
 * ticket-centred, so the caller decides where such a session lives instead.
 */
export function openSessionInWork(sessionId: string): boolean {
  const ticketId = ticketIdForSession(useSessionStore.getState().sessionGroups, sessionId);
  if (!ticketId) return false;
  openTicketSessionInWork(ticketId, sessionId);
  return true;
}

/**
 * Same landing, when the caller already knows the ticket (a session just
 * created for it, which the session groups may not list yet — the pane shows it
 * as soon as they do).
 */
export function openTicketSessionInWork(ticketId: string, sessionId: string): void {
  useWorkStore.getState().openShellForTicket(ticketId, sessionId);
  // The pane now shows it: a floating copy would be a second tmux client on it.
  const ui = useUIStore.getState();
  ui.removeFloatingSession(sessionId);
  ui.setActivePanel('work');
}

/**
 * Open a ticket in the Work view on the center mode it was last left in, and
 * make sure the queue shows it even if its filters would hide it.
 */
export function openTicketInWork(ticketId: string): void {
  const work = useWorkStore.getState();
  work.openTicket(ticketId, work.modeByTicket[ticketId] ?? 'chat');
  useUIStore.getState().setActivePanel('work');
}
