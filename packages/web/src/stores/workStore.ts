import { create } from 'zustand';
import type { TicketType, TicketPriority } from '@fleex/shared';

/**
 * Client-only UI state for the Work view. The ticket is the source of truth for
 * everything real (comments, worktrees, sessions, PR…) — this store holds only
 * which task is selected and how the screen is arranged, persisted under a single
 * `fleex_work` localStorage key (handoff non-negotiable #3). Nothing here is
 * server state.
 */

export type WorkView = 'task' | 'new';
export type RightPanel = 'context' | 'thread' | 'diff' | 'code' | 'deliv' | null;
export type ThreadTab = 'conv' | 'stream';
/** Shell pane arrangement — mirrors the prototype's layout presets. */
export type ShellLayout = '1' | 'cols' | 'rows' | 'three' | 'grid';
/** New tasks can be any ticket type (the picker mirrors Context's). */
export type DraftType = TicketType;
/** How the queue groups its rows. 'activity' is the handoff default. */
export type QueueGroupBy = 'activity' | 'repo' | 'type' | 'priority' | 'board' | 'status';

export interface WorkDraft {
  text: string;
  repoKeys: string[];
  boardId: string | null;
  type: DraftType;
  priority: TicketPriority;
}

export interface WorkState {
  selectedTicketId: string | null;
  view: WorkView;
  /** Board ids to filter the queue by; empty = all boards. */
  boardFilters: string[];
  /** Priority values to filter by; empty = all priorities. */
  priorityFilters: string[];
  /** Ticket statuses shown in the queue; defaults to doing + reviewing. */
  statusFilters: string[];
  /** How the queue is grouped. */
  groupBy: QueueGroupBy;
  /** When true, only favorited tasks show. */
  favoriteOnly: boolean;
  /** Free-text search over task titles. */
  search: string;
  rightPanel: RightPanel;
  selectedThreadId: string | null;
  threadTab: ThreadTab;
  shellOpen: boolean;
  shellMode: boolean;
  shellLayout: ShellLayout;
  /** Explicit session id shown in each pane slot; null = auto-fill (see panesModel). */
  shellPaneIds: (string | null)[];
  /** Height in px of the bottom shell drawer, user-resizable. */
  shellHeight: number;
  /** Width in px of the right tool window (Context / Delivs), user-resizable. */
  rightPanelWidth: number;
  /** Width in px of the left queue, user-resizable. */
  queueWidth: number;
  /** Whether the left queue is collapsed to a thin rail. */
  queueCollapsed: boolean;
  draft: WorkDraft;

  // ── actions ──
  selectTicket: (id: string | null) => void;
  setView: (view: WorkView) => void;
  setBoardFilters: (boards: string[]) => void;
  setPriorityFilters: (priorities: string[]) => void;
  setStatusFilters: (statuses: string[]) => void;
  setGroupBy: (groupBy: QueueGroupBy) => void;
  setFavoriteOnly: (on: boolean) => void;
  setSearch: (q: string) => void;
  setRightPanelWidth: (width: number) => void;
  setQueueWidth: (width: number) => void;
  toggleQueueCollapsed: () => void;
  /** Open a right panel, or toggle it closed when it's already the active one. */
  toggleRightPanel: (panel: Exclude<RightPanel, null>) => void;
  setRightPanel: (panel: RightPanel) => void;
  setSelectedThread: (id: string | null) => void;
  setThreadTab: (tab: ThreadTab) => void;
  setShellOpen: (open: boolean) => void;
  setShellMode: (mode: boolean) => void;
  setShellLayout: (layout: ShellLayout) => void;
  /** Pin a session to a pane slot (removing it from any other slot); null clears. */
  bindShellPane: (index: number, id: string | null) => void;
  setShellHeight: (height: number) => void;
  updateDraft: (patch: Partial<WorkDraft>) => void;
  resetDraft: () => void;
}

const STORAGE_KEY = 'fleex_work';

const EMPTY_DRAFT: WorkDraft = { text: '', repoKeys: [], boardId: null, type: 'build', priority: 'none' };

/** The subset of state we persist — everything except the action functions. */
type PersistedWork = Pick<
  WorkState,
  | 'selectedTicketId'
  | 'view'
  | 'boardFilters'
  | 'priorityFilters'
  | 'statusFilters'
  | 'groupBy'
  | 'favoriteOnly'
  | 'search'
  | 'rightPanel'
  | 'selectedThreadId'
  | 'threadTab'
  | 'shellOpen'
  | 'shellMode'
  | 'shellLayout'
  | 'shellPaneIds'
  | 'shellHeight'
  | 'rightPanelWidth'
  | 'queueWidth'
  | 'queueCollapsed'
  | 'draft'
>;

/** Clamp the right panel to a sane range so a drag can't hide or engulf it. */
export const RIGHT_PANEL_MIN = 260;
export const RIGHT_PANEL_MAX = 560;
const clampRightPanel = (w: number) => Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, Math.round(w)));

/** Clamp the left queue width. */
export const QUEUE_MIN = 240;
export const QUEUE_MAX = 480;
const clampQueue = (w: number) => Math.min(QUEUE_MAX, Math.max(QUEUE_MIN, Math.round(w)));

/** Clamp the bottom shell drawer height. */
export const SHELL_MIN_HEIGHT = 120;
export const SHELL_MAX_HEIGHT = 720;
const clampShellHeight = (h: number) =>
  Math.min(SHELL_MAX_HEIGHT, Math.max(SHELL_MIN_HEIGHT, Math.round(h)));

const DEFAULTS: PersistedWork = {
  selectedTicketId: null,
  view: 'task',
  boardFilters: [],
  priorityFilters: [],
  statusFilters: ['doing', 'reviewing'],
  groupBy: 'activity',
  favoriteOnly: false,
  search: '',
  rightPanel: 'context',
  selectedThreadId: null,
  threadTab: 'conv',
  shellOpen: false,
  shellMode: false,
  shellLayout: '1',
  shellPaneIds: [],
  shellHeight: 240,
  rightPanelWidth: 296,
  queueWidth: 300,
  queueCollapsed: false,
  draft: EMPTY_DRAFT,
};

function load(): PersistedWork {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedWork>;
    // Merge over defaults so a stored blob from an older shape stays valid.
    return { ...DEFAULTS, ...parsed, draft: { ...EMPTY_DRAFT, ...(parsed.draft ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

export const useWorkStore = create<WorkState>((set, get) => {
  function persist(): void {
    if (typeof localStorage === 'undefined') return;
    const s = get();
    const snapshot: PersistedWork = {
      selectedTicketId: s.selectedTicketId,
      view: s.view,
      boardFilters: s.boardFilters,
      priorityFilters: s.priorityFilters,
      statusFilters: s.statusFilters,
      groupBy: s.groupBy,
      favoriteOnly: s.favoriteOnly,
      search: s.search,
      rightPanel: s.rightPanel,
      selectedThreadId: s.selectedThreadId,
      threadTab: s.threadTab,
      shellOpen: s.shellOpen,
      shellMode: s.shellMode,
      shellLayout: s.shellLayout,
      shellPaneIds: s.shellPaneIds,
      shellHeight: s.shellHeight,
      rightPanelWidth: s.rightPanelWidth,
      queueWidth: s.queueWidth,
      queueCollapsed: s.queueCollapsed,
      draft: s.draft,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore quota / privacy mode */
    }
  }

  /** Apply a state patch, then persist. */
  function commit(patch: Partial<WorkState>): void {
    set(patch);
    persist();
  }

  return {
    ...load(),

    selectTicket: (id) => commit({ selectedTicketId: id, view: 'task' }),
    setView: (view) => commit({ view }),
    setBoardFilters: (boardFilters) => commit({ boardFilters }),
    setPriorityFilters: (priorityFilters) => commit({ priorityFilters }),
    setStatusFilters: (statusFilters) => commit({ statusFilters }),
    setGroupBy: (groupBy) => commit({ groupBy }),
    setFavoriteOnly: (favoriteOnly) => commit({ favoriteOnly }),
    setSearch: (search) => commit({ search }),
    setRightPanelWidth: (width) => commit({ rightPanelWidth: clampRightPanel(width) }),
    setQueueWidth: (width) => commit({ queueWidth: clampQueue(width) }),
    toggleQueueCollapsed: () => commit({ queueCollapsed: !get().queueCollapsed }),
    toggleRightPanel: (panel) =>
      commit({ rightPanel: get().rightPanel === panel ? null : panel }),
    setRightPanel: (rightPanel) => commit({ rightPanel }),
    setSelectedThread: (selectedThreadId) => commit({ selectedThreadId }),
    setThreadTab: (threadTab) => commit({ threadTab }),
    setShellOpen: (shellOpen) => commit({ shellOpen }),
    setShellMode: (shellMode) => commit({ shellMode }),
    setShellLayout: (shellLayout) => commit({ shellLayout }),
    setShellHeight: (height) => commit({ shellHeight: clampShellHeight(height) }),
    bindShellPane: (index, id) => {
      const ids = [...get().shellPaneIds];
      while (ids.length <= index) ids.push(null);
      // A session lives in one pane only — clear it from any other slot first.
      if (id) for (let i = 0; i < ids.length; i++) if (ids[i] === id && i !== index) ids[i] = null;
      ids[index] = id;
      commit({ shellPaneIds: ids });
    },
    updateDraft: (patch) => commit({ draft: { ...get().draft, ...patch } }),
    resetDraft: () => commit({ draft: EMPTY_DRAFT }),
  };
});
