import { create } from 'zustand';

type ActivePanel = 'dashboard' | 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'agents' | 'cluster' | 'settings' | 'scratchpads' | 'analytics' | 'workspace';
export type SettingsTab = 'general' | 'appearance' | 'repositories' | 'pinned-icons' | 'worktree-actions' | 'agent-tokens';
export type AnalyticsTab = 'audit-trail' | 'statistics';

interface UIState {
  // Nav sidebar (left icon bar)
  navCollapsed: boolean;
  toggleNav: () => void;

  // Active panel selection
  activePanel: ActivePanel;
  setActivePanel: (panel: ActivePanel) => void;

  // Content panel (sessions list / settings)
  contentPanelWidth: number;
  setContentPanelWidth: (width: number) => void;

  // Settings tab selection
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;

  // Analytics tab selection
  analyticsTab: AnalyticsTab;
  setAnalyticsTab: (tab: AnalyticsTab) => void;

  // Alt key held state (for hotkey badge reveal)
  altHeld: boolean;
  setAltHeld: (held: boolean) => void;

  // Create session modal
  createModalOpen: boolean;
  createModalTicketContext: { ticketId: string; repo: string | null; prompt: string } | null;
  openCreateModal: () => void;
  openCreateModalForTicket: (ctx: { ticketId: string; repo: string | null; prompt: string }) => void;
  closeCreateModal: () => void;

  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  // Group collapse state
  collapsedGroups: Set<string>;
  toggleGroup: (groupId: string) => void;

  // Scratchpad panel
  scratchpadOpen: boolean;
  scratchpadRepoKey: string | null; // null = global, 'org/name' = per-repo
  toggleScratchpad: () => void;
  setScratchpadOpen: (open: boolean) => void;
  openScratchpadForRepo: (repoKey: string | null) => void;

  // Repository dashboard selection
  selectedRepoKey: string | null;
  selectRepo: (key: string | null) => void;

  // Content panel collapse
  contentPanelCollapsed: boolean;
  toggleContentPanel: () => void;

  // Last active session per worktree (key: "org/name:branch")
  lastActiveTabByWorktree: Record<string, string>;
  setLastActiveTab: (worktreeKey: string, sessionId: string) => void;

  // Ticket meta sidebar collapse
  ticketMetaSidebarCollapsed: boolean;
  toggleTicketMetaSidebar: () => void;

  // Last active session (global — for restoring when switching back to sessions panel)
  lastActiveSessionId: string | null;
  setLastActiveSession: (id: string) => void;

  // Floating session overlays (ordered — last = top z-index)
  floatingSessionIds: string[];
  focusedFloatingSessionId: string | null;
  addFloatingSession: (id: string) => void;
  removeFloatingSession: (id: string) => void;
  bringToFront: (id: string) => void;
  clearFloatingFocus: () => void;

  // Agent worktree view (ticket-based)
  selectedAgentWorktreeTicketId: string | null;
  setSelectedAgentWorktreeTicketId: (id: string | null) => void;

  // Workspace view (ticket-based)
  selectedWorkspaceTicketId: string | null;
  setSelectedWorkspaceTicketId: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  navCollapsed: true,
  contentPanelWidth: 320,
  activePanel: 'dashboard',
  settingsTab: 'general',
  analyticsTab: 'audit-trail',
  altHeld: false,
  createModalOpen: false,
  createModalTicketContext: null,
  commandPaletteOpen: false,
  collapsedGroups: new Set<string>(),
  scratchpadOpen: false,
  scratchpadRepoKey: null,
  contentPanelCollapsed: false,
  lastActiveTabByWorktree: {},
  ticketMetaSidebarCollapsed: false,
  lastActiveSessionId: null,
  floatingSessionIds: [],
  focusedFloatingSessionId: null,
  selectedAgentWorktreeTicketId: null,
  selectedWorkspaceTicketId: null,

  toggleScratchpad: () =>
    set((state) => ({
      scratchpadOpen: !state.scratchpadOpen,
      // When opening (was closed), reset to global
      scratchpadRepoKey: state.scratchpadOpen ? state.scratchpadRepoKey : null,
    })),

  setScratchpadOpen: (open) => set({ scratchpadOpen: open }),

  openScratchpadForRepo: (repoKey) =>
    set({ scratchpadRepoKey: repoKey, scratchpadOpen: true }),

  selectedRepoKey: null,

  toggleNav: () =>
    set((state) => ({ navCollapsed: !state.navCollapsed })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  setAltHeld: (held) => set({ altHeld: held }),

  setSettingsTab: (tab) => set({ settingsTab: tab }),

  setAnalyticsTab: (tab) => set({ analyticsTab: tab }),

  setContentPanelWidth: (width) => set({ contentPanelWidth: width }),

  openCreateModal: () => set({ createModalOpen: true }),

  openCreateModalForTicket: (ctx) => set({ createModalOpen: true, createModalTicketContext: ctx }),

  closeCreateModal: () => set({ createModalOpen: false, createModalTicketContext: null }),

  openCommandPalette: () => set({ commandPaletteOpen: true }),

  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  toggleGroup: (groupId) =>
    set((state) => {
      const next = new Set(state.collapsedGroups);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return { collapsedGroups: next };
    }),

  selectRepo: (key) => set({ selectedRepoKey: key }),

  toggleContentPanel: () =>
    set((state) => ({ contentPanelCollapsed: !state.contentPanelCollapsed })),

  toggleTicketMetaSidebar: () =>
    set((state) => ({ ticketMetaSidebarCollapsed: !state.ticketMetaSidebarCollapsed })),

  setLastActiveTab: (worktreeKey, sessionId) =>
    set((state) => ({ lastActiveTabByWorktree: { ...state.lastActiveTabByWorktree, [worktreeKey]: sessionId } })),

  setLastActiveSession: (id) => set({ lastActiveSessionId: id }),

  addFloatingSession: (id) =>
    set((state) => ({
      floatingSessionIds: [
        ...state.floatingSessionIds.filter((sid) => sid !== id),
        id,
      ],
      focusedFloatingSessionId: id,
    })),

  removeFloatingSession: (id) =>
    set((state) => {
      const remaining = state.floatingSessionIds.filter((sid) => sid !== id);
      return {
        floatingSessionIds: remaining,
        focusedFloatingSessionId:
          state.focusedFloatingSessionId === id
            ? (remaining.length > 0 ? remaining[remaining.length - 1] : null)
            : state.focusedFloatingSessionId,
      };
    }),

  bringToFront: (id) =>
    set((state) => ({
      floatingSessionIds: [
        ...state.floatingSessionIds.filter((sid) => sid !== id),
        id,
      ],
      focusedFloatingSessionId: id,
    })),

  clearFloatingFocus: () => set({ focusedFloatingSessionId: null }),

  setSelectedAgentWorktreeTicketId: (id) => set({ selectedAgentWorktreeTicketId: id }),

  setSelectedWorkspaceTicketId: (id) => set({ selectedWorkspaceTicketId: id }),
}));
