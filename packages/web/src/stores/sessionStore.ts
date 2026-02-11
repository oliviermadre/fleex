import { create } from 'zustand';
import type { Session, SessionGroup, SessionStatus, WorktreeSessionGroup } from '@asm/shared';

interface SessionState {
  sessions: Session[];
  selectedSessionId: string | null;
  splitSessionId: string | null;
  focusedPane: 'primary' | 'split';
  sessionGroups: SessionGroup[];
  selectedGroupId: string | null;
  activeGroupCellIndex: number | null;
  setSessions: (sessions: Session[]) => void;
  setSessionGroups: (groups: SessionGroup[]) => void;
  selectSession: (id: string | null) => void;
  openSplit: (id: string) => void;
  closeSplit: () => void;
  setFocusedPane: (pane: 'primary' | 'split') => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  selectGroup: (id: string | null) => void;
  setActiveGroupCellIndex: (index: number | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedSessionId: null,
  splitSessionId: null,
  focusedPane: 'primary',
  sessionGroups: [],
  selectedGroupId: null,
  activeGroupCellIndex: null,

  setSessions: (sessions) => set({ sessions }),

  setSessionGroups: (groups) => set({ sessionGroups: groups }),

  selectSession: (id) => set({ selectedSessionId: id, splitSessionId: null, focusedPane: 'primary', selectedGroupId: null, activeGroupCellIndex: null }),

  openSplit: (id) =>
    set((state) => {
      // No-op if same as primary or no primary selected
      if (!state.selectedSessionId || id === state.selectedSessionId) return state;
      return { splitSessionId: id, focusedPane: 'split' };
    }),

  closeSplit: () => set({ splitSessionId: null, focusedPane: 'primary' }),

  setFocusedPane: (pane) => set({ focusedPane: pane }),

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

      // Handle split session removal
      let splitSessionId = state.splitSessionId;
      let focusedPane = state.focusedPane;
      if (splitSessionId === id) {
        splitSessionId = null;
        focusedPane = 'primary';
      }

      // Auto-select next session if the killed one was selected
      let selectedSessionId = state.selectedSessionId;
      if (selectedSessionId === id) {
        // If we had a split, promote the split session to primary
        if (splitSessionId) {
          selectedSessionId = splitSessionId;
          splitSessionId = null;
          focusedPane = 'primary';
        } else {
          // Try to find a session in the same worktree first
          const killedWorktree = state.sessionGroups
            .flatMap((g: SessionGroup) => g.worktrees)
            .find((wt: WorktreeSessionGroup) => wt.sessions.some((s: Session) => s.id === id));
          const siblingSession = killedWorktree?.sessions.find((s: Session) => s.id !== id);
          selectedSessionId = siblingSession?.id ?? sessions[0]?.id ?? null;
        }
      }

      return { sessions, sessionGroups, selectedSessionId, splitSessionId, focusedPane };
    }),

  updateSessionStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),

  selectGroup: (id) => set({
    selectedGroupId: id,
    selectedSessionId: null,
    splitSessionId: null,
    focusedPane: 'primary',
    activeGroupCellIndex: null,
  }),

  setActiveGroupCellIndex: (index) => set({ activeGroupCellIndex: index }),
}));
