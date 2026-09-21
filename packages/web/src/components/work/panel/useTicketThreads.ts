/**
 * Live threads for the Work view. `useTicketThreads` loads the selected
 * ticket's threads; `useOpenThreads` (called once, in WorkView) loads every
 * open thread so queue rows and the tool strip can label tickets that are in a
 * thread. Both merge `thread:*` WS messages from the `tickets` channel.
 */
import { useEffect } from 'react';
import type { AgentThread, TicketWsMessage } from '@fleex/shared';
import { appWs } from '../../../services/websocket';
import { useThreadStore } from '../../../stores/threadStore';

const EMPTY: AgentThread[] = [];

function useThreadWs(): void {
  const applyWsMessage = useThreadStore((s) => s.applyWsMessage);
  useEffect(() => {
    return appWs.onChannel('tickets', (raw) => {
      try {
        applyWsMessage(raw as TicketWsMessage);
      } catch {
        /* ignore malformed frames */
      }
    });
  }, [applyWsMessage]);
}

export function useTicketThreads(ticketId: string | null): AgentThread[] {
  const loadForTicket = useThreadStore((s) => s.loadForTicket);
  const threads = useThreadStore((s) => (ticketId ? s.threadsByTicket[ticketId] : undefined));
  useThreadWs();
  useEffect(() => {
    if (ticketId) void loadForTicket(ticketId).catch(() => {});
  }, [ticketId, loadForTicket]);
  return threads ?? EMPTY;
}

export function useOpenThreads(): void {
  const loadOpen = useThreadStore((s) => s.loadOpen);
  useThreadWs();
  useEffect(() => {
    void loadOpen().catch(() => {});
  }, [loadOpen]);
}
