import { create } from 'zustand';
import type { Session, SessionGroup, SessionStatus, WorktreeSessionGroup } from '@fleex/shared';
import { KILL_GRACE_MS, ADD_GRACE_MS } from '@fleex/shared';
import { useUIStore } from './uiStore';

/** IDs of recently killed sessions — filtered out of broadcast updates to prevent flicker */
const recentlyKilled = new Map<string, number>();

/** Recently added sessions — preserved across broadcast updates to prevent flash */
const recentlyAdded = new Map<string, { ts: number; session: Session }>();

function pruneKilled(): void {
  const now = Date.now();
  for (const [id, ts] of recentlyKilled) {
    if (now - ts > KILL_GRACE_MS) recentlyKilled.delete(id);
  }
}

function filterKilledSessions(groups: SessionGroup[]): SessionGroup[] {
  if (recentlyKilled.size === 0) return groups;
  pruneKilled();
  if (recentlyKilled.size === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      worktrees: g.worktrees
        .map((wt: WorktreeSessionGroup) => ({
          ...wt,
          sessions: wt.sessions.filter((s: Session) => !recentlyKilled.has(s.id)),
        }))
        .filter((wt: WorktreeSessionGroup) => wt.sessions.length > 0 || wt.agentWorktree),
    }))
    .filter((g) => g.worktrees.length > 0);
}

function filterKilledFromList(sessions: Session[]): Session[] {
  if (recentlyKilled.size === 0) return sessions;
  pruneKilled();
  return sessions.filter((s) => !recentlyKilled.has(s.id));
}

function pruneAdded(): void {
  const now = Date.now();
  for (const [id, entry] of recentlyAdded) {
    if (now - entry.ts > ADD_GRACE_MS) recentlyAdded.delete(id);
  }
}

/** Ensure recently-added sessions aren't dropped by stale broadcast data */
function preserveRecentlyAdded(sessions: Session[]): Session[] {
  if (recentlyAdded.size === 0) return sessions;
  pruneAdded();
  if (recentlyAdded.size === 0) return sessions;
  const ids = new Set(sessions.map((s) => s.id));
  const missing: Session[] = [];
  for (const [id, entry] of recentlyAdded) {
    if (!ids.has(id)) missing.push(entry.session);
  }
  return missing.length > 0 ? [...sessions, ...missing] : sessions;
}

interface SessionState {
  sessions: Session[];
  /** Ticket-based selection: 'system' for shells, ticket UUID for tickets */
  selectedTicketId: string | null;
  /** Active tab within the selected ticket: 's:sessionId' or 'e:executionId' */
  selectedTabKey: string | null;
  /** @deprecated — kept for backward compat during migration. Derived from selectedTabKey. */
  selectedSessionId: string | null;
  splitSessionId: string | null;
  focusedPane: 'primary' | 'split';
  sessionGroups: SessionGroup[];
  selectedGroupId: string | null;
  activeGroupCellIndex: number | null;
  /**
   * Why the session list is empty, when it is empty because loading failed.
   * `null` means "no known failure" — an empty list is then genuinely empty.
   * Without this the sidebar renders the same way in both cases, which is the
   * silent failure this ticket is about.
   */
  sessionsLoadError: string | null;
  setSessions: (sessions: Session[]) => void;
  setSessionGroups: (groups: SessionGroup[]) => void;
  selectTicketTab: (ticketId: string | null, tabKey?: string | null) => void;
  /** @deprecated — use selectTicketTab */
  selectSession: (id: string | null) => void;
  openSplit: (id: string) => void;
  closeSplit: () => void;
  setFocusedPane: (pane: 'primary' | 'split') => void;
  addSession: (session: Session) => void;
  /** Add session to both sessions list and sessionGroups (optimistic, avoids race with WS broadcasts) */
  addSessionToGroup: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  selectGroup: (id: string | null) => void;
  setActiveGroupCellIndex: (index: number | null) => void;
  setSessionsLoadError: (message: string | null) => void;
}

/** Extract sessionId from a tab key like 's:uuid' */
function tabKeyToSessionId(tabKey: string | null): string | null {
  if (!tabKey) return null;
  return tabKey.startsWith('s:') ? tabKey.slice(2) : null;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedTicketId: null,
  selectedTabKey: null,
  selectedSessionId: null,
  splitSessionId: null,
  focusedPane: 'primary',
  sessionGroups: [],
  selectedGroupId: null,
  activeGroupCellIndex: null,
  sessionsLoadError: null,

  setSessions: (sessions) => set({ sessions: preserveRecentlyAdded(filterKilledFromList(sessions)) }),

  setSessionGroups: (groups) => set({ sessionGroups: filterKilledSessions(groups) }),

  selectTicketTab: (ticketId, tabKey) => {
    const tk = tabKey ?? null;
    set({
      selectedTicketId: ticketId,
      selectedTabKey: tk,
      selectedSessionId: tabKeyToSessionId(tk),
      splitSessionId: null,
      focusedPane: 'primary',
      selectedGroupId: null,
      activeGroupCellIndex: null,
    });
  },

  selectSession: (id) => {
    // Legacy compat — derive selectedSessionId
    set({ selectedSessionId: id, selectedTabKey: id ? `s:${id}` : null, splitSessionId: null, focusedPane: 'primary', selectedGroupId: null, activeGroupCellIndex: null });
  },

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

  addSessionToGroup: (session) =>
    set((state) => {
      // Track as recently added to protect from stale WS broadcasts
      recentlyAdded.set(session.id, { ts: Date.now(), session });

      // Add to flat sessions list (skip if already present)
      const sessions = state.sessions.some((s) => s.id === session.id)
        ? state.sessions
        : [...state.sessions, session];

      // Inject into the correct worktree within sessionGroups
      const targetOrg = session.repositoryOrg ?? '_ungrouped';
      const targetName = session.repositoryName ?? '_ungrouped';
      const targetBranch = session.worktreeBranch ?? '_default';

      let injected = false;
      const sessionGroups = state.sessionGroups.map((group) => {
        if (group.repositoryOrg !== targetOrg || group.repositoryName !== targetName) return group;
        return {
          ...group,
          worktrees: group.worktrees.map((wt: WorktreeSessionGroup) => {
            if (wt.branch !== targetBranch) return wt;
            // Skip if session already in this worktree
            if (wt.sessions.some((s: Session) => s.id === session.id)) {
              injected = true;
              return wt;
            }
            injected = true;
            return { ...wt, sessions: [...wt.sessions, session] };
          }),
        };
      });

      // If no matching group/worktree found, the background fetch will pick it up
      return { sessions, sessionGroups: injected ? sessionGroups : state.sessionGroups };
    }),

  removeSession: (id) =>
    set((state) => {
      recentlyKilled.set(id, Date.now());
      const sessions = state.sessions.filter((s) => s.id !== id);

      // Remove from sessionGroups, pruning empty worktrees (but keep agent worktrees) and repo groups
      const sessionGroups = state.sessionGroups
        .map((group: SessionGroup) => ({
          ...group,
          worktrees: group.worktrees
            .map((wt: WorktreeSessionGroup) => ({
              ...wt,
              sessions: wt.sessions.filter((s: Session) => s.id !== id),
            }))
            .filter((wt: WorktreeSessionGroup) => wt.sessions.length > 0 || wt.agentWorktree),
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

  setSessionsLoadError: (message) => set({ sessionsLoadError: message }),
}));
