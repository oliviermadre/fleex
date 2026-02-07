import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  createModalOpen: boolean;
  collapsedGroups: Set<string>;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  toggleGroup: (groupId: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  sidebarWidth: 280,
  createModalOpen: false,
  collapsedGroups: new Set<string>(),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

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
