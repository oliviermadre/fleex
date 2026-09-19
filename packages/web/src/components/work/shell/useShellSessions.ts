/**
 * The selected ticket's sessions (for the shell panes) plus the actions the tab
 * bar / panes need: open a new shell, kill one, rename one. Sessions come from the
 * global session store (populated by `useSessions` at the app root). Creating one
 * reuses the existing ticket-aware creator, which lazily materialises the worktree
 * and links the session to the ticket; the new session then arrives via the
 * `dashboard` WS refetch (kill/rename land the same way, with an optimistic remove
 * on kill so the pane lets go immediately).
 */
import { useCallback, useState } from 'react';
import type { Session } from '@fleex/shared';
import { useSessionStore } from '../../../stores/sessionStore';
import * as api from '../../../services/api';
import { sessionsForTicket } from './shellSessions';

export function useShellSessions(ticketId: string | null): {
  sessions: Session[];
  creating: boolean;
  /** Create a shell bound to the ticket; resolves to its new session id. */
  newShell: () => Promise<string | null>;
  killShell: (id: string) => Promise<void>;
  renameShell: (id: string, displayName: string) => Promise<void>;
} {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const removeSession = useSessionStore((s) => s.removeSession);
  const sessions = sessionsForTicket(sessionGroups, ticketId);
  const [creating, setCreating] = useState(false);

  const newShell = useCallback(async (): Promise<string | null> => {
    if (!ticketId || creating) return null;
    setCreating(true);
    try {
      const res = await api.openSessionFromTicket(ticketId);
      return res?.sessionId ?? null;
    } finally {
      setCreating(false);
    }
  }, [ticketId, creating]);

  const killShell = useCallback(
    async (id: string) => {
      await api.killSession(id);
      removeSession(id);
    },
    [removeSession],
  );

  const renameShell = useCallback(async (id: string, displayName: string) => {
    const trimmed = displayName.trim();
    if (trimmed) await api.renameSession(id, trimmed);
  }, []);

  return { sessions, creating, newShell, killShell, renameShell };
}
