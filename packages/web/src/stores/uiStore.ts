import { create } from 'zustand';

type ActivePanel = 'sessions' | 'settings';
export type SettingsTab = 'general' | 'repositories' | 'pinned-icons';

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

  // Create session modal
  createModalOpen: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;

  // Group collapse state
  collapsedGroups: Set<string>;
  toggleGroup: (groupId: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  navCollapsed: true,
  contentPanelWidth: 320,
  activePanel: 'sessions',
  settingsTab: 'general',
  createModalOpen: false,
  collapsedGroups: new Set<string>(),

  toggleNav: () =>
    set((state) => ({ navCollapsed: !state.navCollapsed })),

  setActivePanel: (panel) => set({ activePanel: panel }),

  setSettingsTab: (tab) => set({ settingsTab: tab }),

  setContentPanelWidth: (width) => set({ contentPanelWidth: width }),

  openCreateModal: () => set({ createModalOpen: true }),

  closeCreateModal: () => set({ createModalOpen: false }),

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
}));
