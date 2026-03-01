import { create } from 'zustand';

type ActivePanel = 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'cluster' | 'settings' | 'scratchpads';
export type SettingsTab = 'general' | 'appearance' | 'repositories' | 'pinned-icons' | 'worktree-actions' | 'agent-tokens' | 'gateways';

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

  // Floating session overlay
  floatingSessionId: string | null;
  setFloatingSession: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  navCollapsed: true,
  contentPanelWidth: 320,
  activePanel: 'sessions',
  settingsTab: 'general',
  altHeld: false,
  createModalOpen: false,
  createModalTicketContext: null,
  commandPaletteOpen: false,
  collapsedGroups: new Set<string>(),
  scratchpadOpen: false,
  scratchpadRepoKey: null,
  contentPanelCollapsed: false,
  lastActiveTabByWorktree: {},
  floatingSessionId: null,

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

  setLastActiveTab: (worktreeKey, sessionId) =>
    set((state) => ({ lastActiveTabByWorktree: { ...state.lastActiveTabByWorktree, [worktreeKey]: sessionId } })),

  setFloatingSession: (id) => set({ floatingSessionId: id }),
}));
