import { useEffect } from 'react';
import { appWs } from '../services/websocket';
import { useTicketActivityStore } from '../stores/ticketActivityStore';

/**
 * Every WS event on the board-wide `tickets` channel that can change a ticket's
 * agentic activity. All of these are broadcast to every client (no per-ticket
 * subscription), which is what lets the pill update board-wide without any ticket
 * being open (spec AC5).
 */
const RECONCILE_TYPES = new Set<string>([
  'mention:created',
  'mention:acknowledged',
  'mention:resolved',
  'mention:updated',
  'mention:waiting_for_info',
  'mention:deleted',
  'mention:execution_failed',
  'workflow:run_created',
  'workflow:step_started',
  'workflow:step_completed',
  'workflow:step_cancelled',
  'workflow:needs_review',
  'workflow:run_completed',
  'workflow:run_failed',
  'workflow:run_cancelled',
  // SDK execution lifecycle, mirrored onto this channel by the server. This is
  // the only signal a skill / panel / direct launch produces — without it the
  // cockpit activity column stays idle until the view remounts.
  'execution:started',
  'execution:ended',
]);

/** Events whose meaning is unambiguous enough to flip the pill on instantly. */
const OPTIMISTIC_WAITING = new Set<string>(['mention:waiting_for_info', 'workflow:needs_review']);
const OPTIMISTIC_RUNNING = new Set<string>([
  'workflow:run_created',
  'workflow:step_started',
  'execution:started',
]);

/**
 * Drives the Kanban activity pill in real time (#381). Mounted once (alongside
 * useWebSocket) so it works board-wide regardless of which ticket is open.
 *
 * Strategy: optimistic instant-on for the events we can trust, then a debounced
 * authoritative reconcile (bulk fetch) that is the single source of truth — it
 * fills in plain-agent "running" (whose execution start is not on this channel)
 * and clears anything that has finished.
 */
export function useTicketActivity() {
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (msg) => {
      const type = msg.type;
      if (!RECONCILE_TYPES.has(type)) return;

      const store = useTicketActivityStore.getState();
      const ticketId = (msg.data as { ticketId?: string } | null)?.ticketId;
      if (ticketId) {
        if (OPTIMISTIC_WAITING.has(type)) store.noteActivity(ticketId, 'waiting');
        else if (OPTIMISTIC_RUNNING.has(type)) store.noteActivity(ticketId, 'running');
      }
      store.scheduleReconcile();
    });
    return unsub;
  }, []);
}
