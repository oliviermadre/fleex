import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  createModalOpen: boolean;
  settingsModalOpen: boolean;
  collapsedGroups: Set<string>;
  toggleSidebar: () => void;
  expandSidebar: () => void;
  collapseSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
  toggleGroup: (groupId: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  sidebarWidth: 280,
  createModalOpen: false,
  settingsModalOpen: false,
  collapsedGroups: new Set<string>(),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  expandSidebar: () => set({ sidebarCollapsed: false }),

  collapseSidebar: () => set({ sidebarCollapsed: true }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  openCreateModal: () => set({ createModalOpen: true }),

  closeCreateModal: () => set({ createModalOpen: false }),

  openSettingsModal: () => set({ settingsModalOpen: true }),

  closeSettingsModal: () => set({ settingsModalOpen: false }),

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
