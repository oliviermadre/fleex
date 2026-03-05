import { useEffect } from 'react';
import type { DashboardMessage, SessionGroup, WorktreeSessionGroup } from '@fleex/shared';
import { useSessionStore } from '../stores/sessionStore';
import { dashboardWs } from '../services/websocket';
import * as api from '../services/api';

export function useSessions() {
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const setSessions = useSessionStore((s) => s.setSessions);
  const removeSession = useSessionStore((s) => s.removeSession);

  useEffect(() => {
    // Fetch initial data
    api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
    api.fetchSessions().then(setSessions).catch(() => {});

    // Subscribe to dashboard WebSocket updates (JSON text frames via separate WS)
    // The dashboard WS sends text JSON frames, not binary
    // We handle this by using a separate listener on the raw WebSocket
    const handleDashboardOpen = () => {
      // Re-fetch on reconnect
      api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
      api.fetchSessions().then(setSessions).catch(() => {});
    };

    const unsubOpen = dashboardWs.onOpen(handleDashboardOpen);

    // Dashboard WS sends JSON text frames. We need to handle them.
    // Since our WebSocketManager only handles binary, we'll poll via API
    // and use the WS for push notifications.
    // Actually, dashboard WS sends text frames - let's handle via onMessage
    const handleMessage = (data: ArrayBuffer) => {
      try {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text) as DashboardMessage;

        switch (msg.type) {
          case 'sessions:updated':
            setSessionGroups(msg.data);
            {
              const allSessions = msg.data.flatMap((g: SessionGroup) =>
                g.worktrees.flatMap((w: WorktreeSessionGroup) => w.sessions)
              );
              setSessions(allSessions);
            }
            break;
          case 'session:removed':
            removeSession(msg.data.sessionId);
            break;
        }
      } catch {
        // Not a valid JSON text frame, ignore
      }
    };

    const unsubMessage = dashboardWs.onMessage(handleMessage);

    return () => {
      unsubOpen();
      unsubMessage();
    };
  }, [setSessionGroups, setSessions, removeSession]);
}
