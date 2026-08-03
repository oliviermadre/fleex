import { useEffect } from 'react';

import type { PersonaWsMessage } from '@fleex/shared';

import { appWs } from '../services/websocket';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';

export function useAgentPersonas() {
  const loadPersonas = useAgentPersonaStore((s) => s.loadPersonas);
  const refreshAllStatuses = useAgentPersonaStore((s) => s.refreshAllStatuses);
  const handleWsMessage = useAgentPersonaStore((s) => s.handleWsMessage);

  useEffect(() => {
    loadPersonas().then(() => {
      useAgentPersonaStore.getState().refreshAllStatuses();
    });
  }, [loadPersonas]);

  useEffect(() => {
    const unsub = appWs.onChannel('personas', (msg) => {
      handleWsMessage(msg as PersonaWsMessage);
    });

    const unsubOpen = appWs.onOpen(() => {
      refreshAllStatuses();
    });

    return () => {
      unsub();
      unsubOpen();
    };
  }, [handleWsMessage, refreshAllStatuses]);
}
