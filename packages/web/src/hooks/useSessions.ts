import { useEffect } from 'react';

import type { DashboardMessage, SessionGroup, WorktreeSessionGroup } from '@fleex/shared';

import * as api from '../services/api';
import { appWs } from '../services/websocket';
import { useSessionStore } from '../stores/sessionStore';

export function useSessions() {
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const setSessions = useSessionStore((s) => s.setSessions);
  const removeSession = useSessionStore((s) => s.removeSession);

  useEffect(() => {
    // Fetch initial data
    api
      .fetchSessionGroups()
      .then(setSessionGroups)
      .catch(() => {});
    api
      .fetchSessions()
      .then(setSessions)
      .catch(() => {});

    const handleDashboardOpen = () => {
      api
        .fetchSessionGroups()
        .then(setSessionGroups)
        .catch(() => {});
      api
        .fetchSessions()
        .then(setSessions)
        .catch(() => {});
    };

    const unsubOpen = appWs.onOpen(handleDashboardOpen);

    const unsubChannel = appWs.onChannel('dashboard', (msg) => {
      const dashMsg = msg as DashboardMessage;
      switch (dashMsg.type) {
        case 'sessions:updated':
          setSessionGroups(dashMsg.data);
          {
            const allSessions = dashMsg.data.flatMap((g: SessionGroup) =>
              g.worktrees.flatMap((w: WorktreeSessionGroup) => w.sessions),
            );
            setSessions(allSessions);
          }
          break;
        case 'session:removed':
          removeSession(dashMsg.data.sessionId);
          break;
      }
    });

    return () => {
      unsubOpen();
      unsubChannel();
    };
  }, [setSessionGroups, setSessions, removeSession]);
}
