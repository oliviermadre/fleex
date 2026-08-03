import { useEffect } from 'react';

import type { TicketWsMessage, TicketGroupWsMessage } from '@fleex/shared';

import { appWs } from '../services/websocket';
import { useTicketGroupStore } from '../stores/ticketGroupStore';
import { useTicketStore } from '../stores/ticketStore';

export function useTickets() {
  const fetchBoards = useTicketStore((s) => s.fetchBoards);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);
  const handleWsMessage = useTicketStore((s) => s.handleWsMessage);
  const handleGroupWsMessage = useTicketGroupStore((s) => s.handleWsMessage);
  const fetchGroups = useTicketGroupStore((s) => s.fetchGroups);

  // Fetch boards, tickets, and groups on mount
  useEffect(() => {
    fetchBoards();
    fetchTickets();
    fetchGroups();
  }, [fetchBoards, fetchTickets, fetchGroups]);

  // Handle WebSocket messages
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (msg) => {
      const wsMsg = msg as TicketWsMessage | TicketGroupWsMessage;
      // Route ticket group messages to the group store
      if (wsMsg.type.startsWith('ticketGroup:') || wsMsg.type.startsWith('ticketRelationship:')) {
        handleGroupWsMessage(wsMsg as TicketGroupWsMessage);
      } else {
        handleWsMessage(wsMsg as TicketWsMessage);
      }
    });
    return unsub;
  }, [handleWsMessage, handleGroupWsMessage]);
}
