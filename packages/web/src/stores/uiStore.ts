import { create } from 'zustand';

type ActivePanel = 'sessions' | 'repositories' | 'claude-config' | 'cluster' | 'rts' | 'settings';
export type SettingsTab = 'general' | 'appearance' | 'repositories' | 'pinned-icons' | 'worktree-actions';

/** Persisted office selection (subset of the full OfficeSelection in office/types.ts) */
type OfficeSelection =
  | { type: 'session'; sessionId: string }
  | { type: 'worktree'; repoKey: string; branch: string }
  | { type: 'repo'; repoKey: string }
  | { type: 'lobby' }
  | null;

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
  openCreateModal: () => void;
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
  toggleScratchpad: () => void;
  setScratchpadOpen: (open: boolean) => void;

  // Repository dashboard selection
  selectedRepoKey: string | null;
  selectRepo: (key: string | null) => void;

  // Office view selection
  officeSelection: OfficeSelection;
  setOfficeSelection: (selection: OfficeSelection) => void;
}

export const useUIStore = create<UIState>((set) => ({
  navCollapsed: true,
  contentPanelWidth: 320,
  activePanel: 'sessions',
  settingsTab: 'general',
  altHeld: false,
  createModalOpen: false,
  commandPaletteOpen: false,
  collapsedGroups: new Set<string>(),
  scratchpadOpen: false,
  officeSelection: null,

  toggleScratchpad: () =>
    set((state) => ({ scratchpadOpen: !state.scratchpadOpen })),

  setScratchpadOpen: (open) => set({ scratchpadOpen: open }),

  selectedRepoKey: null,

  toggleNav: () =>
    set((state) => ({ navCollapsed: !state.navCollapsed })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  setAltHeld: (held) => set({ altHeld: held }),

  setSettingsTab: (tab) => set({ settingsTab: tab }),

  setContentPanelWidth: (width) => set({ contentPanelWidth: width }),

  openCreateModal: () => set({ createModalOpen: true }),

  closeCreateModal: () => set({ createModalOpen: false }),

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

  setOfficeSelection: (selection) => set({ officeSelection: selection }),
}));
