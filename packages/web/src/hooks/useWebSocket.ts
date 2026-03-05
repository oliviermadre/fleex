import { useEffect } from 'react';
import { WS_TERMINAL_PATH, WS_DASHBOARD_PATH, WS_REPOSITORY_PATH, WS_TICKET_PATH, WS_AGENT_EVENTS_PATH } from '@fleex/shared';
import { terminalWs, dashboardWs, repositoryWs, ticketWs, agentEventWs } from '../services/websocket';
import { useAgentEventStore } from '../stores/agentEventStore';
import { WS_BASE_URL } from '../lib/constants';

export function useWebSocket() {
  const handleAgentEvent = useAgentEventStore((s) => s.handleWsEvent);
  const resubscribeAll = useAgentEventStore((s) => s.resubscribeAll);

  useEffect(() => {
    terminalWs.connect(`${WS_BASE_URL}${WS_TERMINAL_PATH}`);
    dashboardWs.connect(`${WS_BASE_URL}${WS_DASHBOARD_PATH}`);
    repositoryWs.connect(`${WS_BASE_URL}${WS_REPOSITORY_PATH}`);
    ticketWs.connect(`${WS_BASE_URL}${WS_TICKET_PATH}`);
    agentEventWs.connect(`${WS_BASE_URL}${WS_AGENT_EVENTS_PATH}`);

    const unsubAgent = agentEventWs.onMessage((buf) => {
      try {
        const text = new TextDecoder().decode(buf);
        const msg = JSON.parse(text) as { type: string; data: unknown };
        handleAgentEvent(msg);
      } catch {
        // ignore non-JSON messages
      }
    });

    const unsubOpen = agentEventWs.onOpen(() => {
      resubscribeAll();
    });

    return () => {
      terminalWs.disconnect();
      dashboardWs.disconnect();
      repositoryWs.disconnect();
      ticketWs.disconnect();
      unsubAgent();
      unsubOpen();
      agentEventWs.disconnect();
    };
  }, [handleAgentEvent, resubscribeAll]);
}
