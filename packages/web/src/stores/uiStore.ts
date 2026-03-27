import { create } from 'zustand';
import type { TicketDeliverable } from '@fleex/shared';

type ActivePanel = 'dashboard' | 'sessions' | 'repositories' | 'tickets' | 'claude-config' | 'agents' | 'cluster' | 'settings' | 'scratchpads' | 'analytics';
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

  // Unified floating panel z-order (sessions + deliverables share one stack)
  floatingPanelOrder: string[];  // ordered IDs — last = top z-index
  focusedFloatingPanelId: string | null;
  bringFloatingPanelToFront: (id: string) => void;
  clearFloatingPanelFocus: () => void;

  // Floating session overlays
  floatingSessionIds: string[];
  addFloatingSession: (id: string) => void;
  removeFloatingSession: (id: string) => void;
  /** @deprecated use bringFloatingPanelToFront */
  bringToFront: (id: string) => void;
  /** @deprecated use clearFloatingPanelFocus */
  clearFloatingFocus: () => void;

  // Deliverable zen overlay
  deliverableOverlay: TicketDeliverable | null;
  openDeliverableOverlay: (d: TicketDeliverable) => void;
  closeDeliverableOverlay: () => void;

  // Floating deliverables
  floatingDeliverableIds: string[];
  floatingDeliverables: Record<string, TicketDeliverable>;
  addFloatingDeliverable: (d: TicketDeliverable) => void;
  removeFloatingDeliverable: (id: string) => void;
  updateFloatingDeliverable: (d: TicketDeliverable) => void;
  /** @deprecated use bringFloatingPanelToFront */
  bringDeliverableToFront: (id: string) => void;
  /** @deprecated use clearFloatingPanelFocus */
  clearFloatingDeliverableFocus: () => void;

  // Agent worktree view (ticket-based)
  selectedAgentWorktreeTicketId: string | null;
  setSelectedAgentWorktreeTicketId: (id: string | null) => void;

  // Sidebar section collapse
  manualFlowCollapsed: boolean;
  toggleManualFlow: () => void;
  agenticFlowCollapsed: boolean;
  toggleAgenticFlow: () => void;
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
  floatingPanelOrder: [],
  focusedFloatingPanelId: null,
  floatingSessionIds: [],
  deliverableOverlay: null,
  floatingDeliverableIds: [],
  floatingDeliverables: {},
  selectedAgentWorktreeTicketId: null,
  manualFlowCollapsed: false,
  agenticFlowCollapsed: true,

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

  // Unified z-order actions
  bringFloatingPanelToFront: (id) =>
    set((state) => ({
      floatingPanelOrder: [
        ...state.floatingPanelOrder.filter((pid) => pid !== id),
        id,
      ],
      focusedFloatingPanelId: id,
    })),

  clearFloatingPanelFocus: () => set({ focusedFloatingPanelId: null }),

  // Session floating actions (also maintain unified order)
  addFloatingSession: (id) =>
    set((state) => ({
      floatingSessionIds: [
        ...state.floatingSessionIds.filter((sid) => sid !== id),
        id,
      ],
      floatingPanelOrder: [
        ...state.floatingPanelOrder.filter((pid) => pid !== id),
        id,
      ],
      focusedFloatingPanelId: id,
    })),

  removeFloatingSession: (id) =>
    set((state) => {
      const remaining = state.floatingSessionIds.filter((sid) => sid !== id);
      const newOrder = state.floatingPanelOrder.filter((pid) => pid !== id);
      return {
        floatingSessionIds: remaining,
        floatingPanelOrder: newOrder,
        focusedFloatingPanelId:
          state.focusedFloatingPanelId === id
            ? (newOrder.length > 0 ? newOrder[newOrder.length - 1] : null)
            : state.focusedFloatingPanelId,
      };
    }),

  bringToFront: (id) =>
    set((state) => ({
      floatingSessionIds: [
        ...state.floatingSessionIds.filter((sid) => sid !== id),
        id,
      ],
      floatingPanelOrder: [
        ...state.floatingPanelOrder.filter((pid) => pid !== id),
        id,
      ],
      focusedFloatingPanelId: id,
    })),

  clearFloatingFocus: () => set({ focusedFloatingPanelId: null }),

  openDeliverableOverlay: (d) => set({ deliverableOverlay: d }),
  closeDeliverableOverlay: () => set({ deliverableOverlay: null }),

  // Deliverable floating actions (also maintain unified order)
  addFloatingDeliverable: (d) =>
    set((state) => ({
      floatingDeliverableIds: [
        ...state.floatingDeliverableIds.filter((id) => id !== d.id),
        d.id,
      ],
      floatingDeliverables: { ...state.floatingDeliverables, [d.id]: d },
      floatingPanelOrder: [
        ...state.floatingPanelOrder.filter((pid) => pid !== d.id),
        d.id,
      ],
      focusedFloatingPanelId: d.id,
    })),

  removeFloatingDeliverable: (id) =>
    set((state) => {
      const remaining = state.floatingDeliverableIds.filter((sid) => sid !== id);
      const { [id]: _, ...rest } = state.floatingDeliverables;
      const newOrder = state.floatingPanelOrder.filter((pid) => pid !== id);
      return {
        floatingDeliverableIds: remaining,
        floatingDeliverables: rest,
        floatingPanelOrder: newOrder,
        focusedFloatingPanelId:
          state.focusedFloatingPanelId === id
            ? (newOrder.length > 0 ? newOrder[newOrder.length - 1] : null)
            : state.focusedFloatingPanelId,
      };
    }),

  updateFloatingDeliverable: (d) =>
    set((state) => {
      if (!state.floatingDeliverables[d.id]) return state;
      return { floatingDeliverables: { ...state.floatingDeliverables, [d.id]: d } };
    }),

  bringDeliverableToFront: (id) =>
    set((state) => ({
      floatingDeliverableIds: [
        ...state.floatingDeliverableIds.filter((sid) => sid !== id),
        id,
      ],
      floatingPanelOrder: [
        ...state.floatingPanelOrder.filter((pid) => pid !== id),
        id,
      ],
      focusedFloatingPanelId: id,
    })),

  clearFloatingDeliverableFocus: () => set({ focusedFloatingPanelId: null }),

  setSelectedAgentWorktreeTicketId: (id) => set({ selectedAgentWorktreeTicketId: id }),

  toggleManualFlow: () =>
    set((state) => ({ manualFlowCollapsed: !state.manualFlowCollapsed })),

  toggleAgenticFlow: () =>
    set((state) => ({ agenticFlowCollapsed: !state.agenticFlowCollapsed })),
}));
