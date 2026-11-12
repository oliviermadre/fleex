/**
 * The two answers to a mode request of the assistant (`request_mode`), for the
 * surfaces that show the card outside the Tasks view (Focus popup, mobile).
 * Granting is the human's real action — it patches the ticket's execution mode —
 * and the assistant is then told, so it relaunches the agent in the thread.
 */
import { useCallback } from 'react';
import * as api from '../../../services/api';
import type { ModeRequest } from '../selectors';
import { postHumanMessage } from './postHumanMessage';

export function useModeRequestActions(ticketId: string, conversationMode: string) {
  const grantMode = useCallback(
    async (r: ModeRequest) => {
      await api.updateTicketExecutionConfig(ticketId, { conversationMode: r.mode });
      await postHumanMessage(ticketId, `Mode ${r.mode} accordé aux agents — continue.`);
    },
    [ticketId],
  );
  const declineMode = useCallback(
    async (_r: ModeRequest) => {
      await postHumanMessage(ticketId, `Non, les agents restent en mode ${conversationMode}. Fais avec, ou dis-moi ce qui bloque.`);
    },
    [ticketId, conversationMode],
  );
  return { grantMode, declineMode };
}
