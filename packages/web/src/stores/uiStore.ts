import { create } from 'zustand';
import type { TicketDeliverable } from '@fleex/shared';

type ActivePanel = 'repositories' | 'tickets' | 'claude-config' | 'agents' | 'cluster' | 'settings' | 'scratchpads' | 'analytics' | 'execution-log' | 'documents' | 'assistant' | 'routines' | 'work' | 'focus';
export type SettingsTab = 'general' | 'appearance' | 'actions' | 'agent-tokens' | 'deliverable-types' | 'memory' | 'connectors';
/** Settings › Actions: which scope's list, and which action's detail (`'new'` = unsaved draft). */
export type ActionsScope = 'pinned' | 'ticket';
export interface ActionsRoute {
  scope: ActionsScope;
  id: string | null;
}
export type AnalyticsTab = 'audit-trail' | 'statistics';

/**
 * A screen with unsaved work (Settings › Actions detail) registers a leave
 * guard. Every navigation through this store (panel, Settings tab, Actions
 * route) — and the router on Back/Forward — then asks it first: the guard gets
 * a `proceed` callback to call once the user chose Save or Discard, or drops it
 * to stay. Kept outside the store state: it is a callback, not something to render.
 */
export type LeaveGuard = (proceed: () => void) => void;
let leaveGuard: LeaveGuard | null = null;
let leaveGuardPaused = 0;

/** Register the guard; returns the unregister function (for an effect cleanup). */
export function setLeaveGuard(guard: LeaveGuard): () => void {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = null;
  };
}

export function isLeaveGuarded(): boolean {
  return leaveGuard !== null && leaveGuardPaused === 0;
}

/** Suspend the guard until the returned `resume` is called (the router's URL → store sync). */
export function pauseLeaveGuard(): () => void {
  leaveGuardPaused++;
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    leaveGuardPaused--;
  };
}

/** Run a navigation the user already approved (or that must not ask: save, delete, discard). */
export function withoutLeaveGuard(navigate: () => void): void {
  const resume = pauseLeaveGuard();
  try {
    navigate();
  } finally {
    resume();
  }
}

/** Navigate now, or hand the navigation to the guard. */
export function requestLeave(navigate: () => void): void {
  if (!isLeaveGuarded()) {
    navigate();
    return;
  }
  leaveGuard!(() => withoutLeaveGuard(navigate));
}

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

  // Settings › Actions sub-route (list vs detail)
  actionsRoute: ActionsRoute;
  setActionsRoute: (route: ActionsRoute) => void;
  /** Jump to Settings › Actions, on a scope list or straight into one action's detail. */
  openActionSettings: (scope: ActionsScope, id?: string | null) => void;

  // Analytics tab selection
  analyticsTab: AnalyticsTab;
  setAnalyticsTab: (tab: AnalyticsTab) => void;

  // Alt key held state (for hotkey badge reveal)
  altHeld: boolean;
  setAltHeld: (held: boolean) => void;

  // Create task modal
  createModalOpen: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;

  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  /**
   * The question being asked of memory, or null when the answer modal is closed.
   * The question is the state: it is what the modal is opened *with*, and reopening
   * with a different one has to re-run rather than show the previous answer.
   */
  askMemoryQuestion: string | null;
  openAskMemory: (question: string) => void;
  closeAskMemory: () => void;

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

  // Ticket meta sidebar collapse
  ticketMetaSidebarCollapsed: boolean;
  toggleTicketMetaSidebar: () => void;

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
}

export const useUIStore = create<UIState>((set, get) => ({
  navCollapsed: true,
  contentPanelWidth: 320,
  activePanel: 'tickets',
  settingsTab: 'general',
  actionsRoute: { scope: 'pinned', id: null },
  analyticsTab: 'audit-trail',
  altHeld: false,
  createModalOpen: false,
  commandPaletteOpen: false,
  askMemoryQuestion: null,
  collapsedGroups: new Set<string>(),
  scratchpadOpen: false,
  scratchpadRepoKey: null,
  contentPanelCollapsed: false,
  ticketMetaSidebarCollapsed: false,
  floatingPanelOrder: [],
  focusedFloatingPanelId: null,
  floatingSessionIds: [],
  deliverableOverlay: null,
  floatingDeliverableIds: [],
  floatingDeliverables: {},

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

  setActivePanel: (panel) => {
    if (panel === get().activePanel) return;
    requestLeave(() => set({ activePanel: panel }));
  },

  setAltHeld: (held) => set({ altHeld: held }),

  setSettingsTab: (tab) => {
    if (tab === get().settingsTab) return;
    requestLeave(() => set({ settingsTab: tab }));
  },

  setActionsRoute: (route) => {
    const current = get().actionsRoute;
    if (route.scope === current.scope && route.id === current.id) return;
    requestLeave(() => set({ actionsRoute: route }));
  },

  openActionSettings: (scope, id = null) => {
    const s = get();
    if (s.activePanel === 'settings' && s.settingsTab === 'actions' && s.actionsRoute.scope === scope && s.actionsRoute.id === id) return;
    requestLeave(() => set({ activePanel: 'settings', settingsTab: 'actions', actionsRoute: { scope, id } }));
  },

  setAnalyticsTab: (tab) => set({ analyticsTab: tab }),

  setContentPanelWidth: (width) => set({ contentPanelWidth: width }),

  openCreateModal: () => set({ createModalOpen: true }),

  closeCreateModal: () => set({ createModalOpen: false }),

  openCommandPalette: () => set({ commandPaletteOpen: true }),

  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  openAskMemory: (question) => set({ askMemoryQuestion: question, commandPaletteOpen: false }),

  closeAskMemory: () => set({ askMemoryQuestion: null }),

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
}));
