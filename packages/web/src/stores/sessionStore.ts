import { create } from 'zustand';
import type { Session, SessionGroup, SessionStatus, WorktreeSessionGroup } from '@asm/shared';

interface SessionState {
  sessions: Session[];
  selectedSessionId: string | null;
  sessionGroups: SessionGroup[];
  setSessions: (sessions: Session[]) => void;
  setSessionGroups: (groups: SessionGroup[]) => void;
  selectSession: (id: string | null) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedSessionId: null,
  sessionGroups: [],

  setSessions: (sessions) => set({ sessions }),

  setSessionGroups: (groups) => set({ sessionGroups: groups }),

  selectSession: (id) => set({ selectedSessionId: id }),

  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),

  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);

      // Remove from sessionGroups, pruning empty worktrees and repo groups
      const sessionGroups = state.sessionGroups
        .map((group: SessionGroup) => ({
          ...group,
          worktrees: group.worktrees
            .map((wt: WorktreeSessionGroup) => ({
              ...wt,
              sessions: wt.sessions.filter((s: Session) => s.id !== id),
            }))
            .filter((wt: WorktreeSessionGroup) => wt.sessions.length > 0),
        }))
        .filter((group: SessionGroup) => group.worktrees.length > 0);

      // Auto-select next session if the killed one was selected
      let selectedSessionId = state.selectedSessionId;
      if (selectedSessionId === id) {
        // Try to find a session in the same worktree first
        const killedWorktree = state.sessionGroups
          .flatMap((g: SessionGroup) => g.worktrees)
          .find((wt: WorktreeSessionGroup) => wt.sessions.some((s: Session) => s.id === id));
        const siblingSession = killedWorktree?.sessions.find((s: Session) => s.id !== id);
        selectedSessionId = siblingSession?.id ?? sessions[0]?.id ?? null;
      }

      return { sessions, sessionGroups, selectedSessionId };
    }),

  updateSessionStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),
}));
