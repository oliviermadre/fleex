import { useEffect } from 'react';
import type { TicketWsMessage } from '@fleex/shared';
import { appWs } from '../services/websocket';
import { useTicketStore } from '../stores/ticketStore';

export function useTickets() {
  const fetchBoards = useTicketStore((s) => s.fetchBoards);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const handleWsMessage = useTicketStore((s) => s.handleWsMessage);

  // Fetch boards on mount
  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  // Fetch tickets when board changes (null = all boards)
  useEffect(() => {
    fetchTickets(selectedBoardId ?? undefined);
  }, [selectedBoardId, fetchTickets]);

  // Handle WebSocket messages
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (msg) => {
      handleWsMessage(msg as TicketWsMessage);
    });
    return unsub;
  }, [handleWsMessage]);
}
