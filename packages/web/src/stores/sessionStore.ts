import { create } from 'zustand';
import type { Session, SessionGroup, SessionStatus } from '@asm/shared';

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
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
    })),

  updateSessionStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),
}));
