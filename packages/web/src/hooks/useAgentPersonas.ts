import { useEffect } from 'react';
import { WS_PERSONA_PATH } from '@asm/shared';
import type { PersonaWsMessage } from '@asm/shared';
import { personaWs } from '../services/websocket';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { WS_BASE_URL } from '../lib/constants';

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
    personaWs.connect(`${WS_BASE_URL}${WS_PERSONA_PATH}`);

    const unsub = personaWs.onMessage((buf) => {
      try {
        const text = new TextDecoder().decode(buf);
        const msg = JSON.parse(text) as PersonaWsMessage;
        handleWsMessage(msg);
      } catch {
        // ignore non-JSON messages
      }
    });

    const unsubOpen = personaWs.onOpen(() => {
      refreshAllStatuses();
    });

    return () => {
      unsub();
      unsubOpen();
      personaWs.disconnect();
    };
  }, [handleWsMessage, refreshAllStatuses]);
}
