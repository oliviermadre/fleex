import { useEffect } from 'react';
import type { DashboardMessage, SessionGroup, WorktreeSessionGroup } from '@fleex/shared';
import { useSessionStore } from '../stores/sessionStore';
import { appWs } from '../services/websocket';
import * as api from '../services/api';
import { NetworkError } from '../services/api';

/**
 * Loads groups + sessions and records the outcome in the store.
 *
 * Exported so the sidebar's error banner can retry in place: the previous
 * `.catch(() => {})` left the user with an empty sidebar, no explanation and
 * no way back short of reloading the page.
 */
export async function loadSessions(): Promise<void> {
  const { setSessionGroups, setSessions, setSessionsLoadError } = useSessionStore.getState();
  try {
    const [groups, sessions] = await Promise.all([api.fetchSessionGroups(), api.fetchSessions()]);
    setSessionGroups(groups);
    setSessions(sessions);
    setSessionsLoadError(null);
  } catch (error) {
    // A NetworkError already carries a message written for humans; anything
    // else is an HTTP failure whose detail went out as a toast from `request()`.
    setSessionsLoadError(
      error instanceof NetworkError ? error.message : 'Could not load sessions',
    );
  }
}

export function useSessions() {
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const setSessions = useSessionStore((s) => s.setSessions);
  const removeSession = useSessionStore((s) => s.removeSession);

  useEffect(() => {
    // Fetch initial data
    void loadSessions();

    // On WS reconnect: also the recovery path, so it must clear a stale error.
    const unsubOpen = appWs.onOpen(() => void loadSessions());

    const unsubChannel = appWs.onChannel('dashboard', (msg) => {
      const dashMsg = msg as DashboardMessage;
      switch (dashMsg.type) {
        case 'sessions:updated':
          setSessionGroups(dashMsg.data);
          {
            const allSessions = dashMsg.data.flatMap((g: SessionGroup) =>
              g.worktrees.flatMap((w: WorktreeSessionGroup) => w.sessions)
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
