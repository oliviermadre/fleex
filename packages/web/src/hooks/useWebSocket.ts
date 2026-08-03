import { useEffect } from 'react';

import { WS_PATH } from '@fleex/shared';

import { WS_BASE_URL } from '../lib/constants';
import { appWs } from '../services/websocket';
import { useAgentEventStore } from '../stores/agentEventStore';

export function useWebSocket() {
  const handleAgentEvent = useAgentEventStore((s) => s.handleWsEvent);
  const resubscribeAll = useAgentEventStore((s) => s.resubscribeAll);

  useEffect(() => {
    appWs.connect(`${WS_BASE_URL}${WS_PATH}`);

    const unsubAgent = appWs.onChannel('agent-events', (msg) => {
      handleAgentEvent(msg);
    });

    const unsubOpen = appWs.onOpen(() => {
      resubscribeAll();
    });

    return () => {
      unsubAgent();
      unsubOpen();
      appWs.disconnect();
    };
  }, [handleAgentEvent, resubscribeAll]);
}
