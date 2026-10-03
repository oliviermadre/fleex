import { create } from 'zustand';
import type { TicketType, TicketPriority, TicketLink, ImportSourceId } from '@fleex/shared';
import { EMPTY_DRAFT, migrateDraft } from '../components/work/new/draftMigration';
import { paneCount } from '../components/work/shell/shellLayout';

/**
 * Client-only UI state for the Work view. The ticket is the source of truth for
 * everything real (comments, worktrees, sessions, PR…) — this store holds only
 * which task is selected and how the screen is arranged, persisted under a single
 * `fleex_work` localStorage key (handoff non-negotiable #3). Nothing here is
 * server state.
 */

export type WorkView = 'task' | 'new';
export type RightPanel = 'context' | 'thread' | 'diff' | 'code' | 'deliv' | 'scratch' | 'browser' | null;
/** A remembered `browser` panel means nothing outside the desktop shell. */
export function effectiveRightPanel(panel: RightPanel, desktop: boolean): RightPanel {
  return panel === 'browser' && !desktop ? null : panel;
}
export type ThreadTab = 'conv' | 'stream';
/** Shell pane arrangement — mirrors the prototype's layout presets. */
export type ShellLayout = '1' | 'cols' | 'rows' | 'three' | 'grid';
/** What the center shows for a ticket. Chat = none of the takeover flags. */
export type WorkMode = 'chat' | 'code' | 'shell' | 'workflow';
/** New tasks can be any ticket type (the picker mirrors Context's). */
export type DraftType = TicketType;
/** How the queue groups its rows. 'activity' is the handoff default. */
export type QueueGroupBy = 'activity' | 'repo' | 'type' | 'priority' | 'board' | 'status';
/** Event categories the Timeline can hide (the spine — runs, steps — never is). */
export type TimelineFilterKey = 'status' | 'cli' | 'pr' | 'deliverables' | 'comments';
export type TimelineFilters = Record<TimelineFilterKey, boolean>;

/**
 * The recognized source an import prefilled the draft from. Kept on the draft so
 * the composer can show the source chip and `Start` can attach the source link.
 */
export interface DraftSource {
  readonly sourceId: ImportSourceId;
  readonly ref: string;
  readonly url: string;
  readonly label: string;
  /** The source link(s) to create with the ticket (never the repository link). */
  readonly links: Omit<TicketLink, 'id' | 'createdAt'>[];
  readonly tags: string[];
  /** PR-only: drives the composer's "branch on top / work directly" control. */
  readonly pr?: {
    readonly repoKey: string;
    readonly headRefName: string;
    readonly isCrossRepository: boolean;
  };
  /** Set when the source's repo isn't configured in Fleex, so no repo was attached. */
  readonly repoWarning?: string;
}

export interface WorkDraft {
  /** The ticket title — chosen explicitly now, no longer derived from the text. */
  title: string;
  /** The ticket description. */
  text: string;
  /** Which screen of the new-task flow the draft is on. `resolving` is never persisted. */
  stage: 'entry' | 'compose';
  /** Set when the draft was prefilled from an imported source; null otherwise. */
  source: DraftSource | null;
  repoKeys: string[];
  /** Chosen base branch per selected repo key; absent or '' = the repo's default branch. */
  repoBaseBranches: Record<string, string>;
  /** Repos to check out directly on an existing branch (exclusive with a base). */
  repoCheckoutRefs: Record<string, string>;
  /** Epics (of the draft's board) the new ticket joins. */
  epicIds: string[];
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
  /**
   * Active scratchpad tab per ticket ('__global__' or 'org/name'), so the Notes
   * panel reopens on the tab you last used for that ticket. Resolved against the
   * ticket's live repo tabs, falling back to Global when the tab no longer exists.
   */
  activeScratchTabByTicket: Record<string, string>;
  selectedThreadId: string | null;
  threadTab: ThreadTab;
  shellOpen: boolean;
  shellMode: boolean;
  /** When true, the center is the full Code editor (tree + tabs + Monaco). */
  codeMode: boolean;
  /** When true, the center is the ticket's Workflow DAG / run view. */
  workflowMode: boolean;
  /** Center mode remembered per ticket; absent = chat. */
  modeByTicket: Record<string, WorkMode>;
  /** The ticket the shellMode / codeMode / workflowMode flags currently belong to. */
  modeTicketId: string | null;
  /** Shell split preset per ticket; absent = a single pane. */
  shellLayoutByTicket: Record<string, ShellLayout>;
  /** Session id pinned to each pane slot, per ticket; null = empty pane (see panesModel). */
  shellPaneIdsByTicket: Record<string, (string | null)[]>;
  /** Height in px of the bottom shell drawer, user-resizable. */
  shellHeight: number;
  /**
   * Bottom Timeline drawer. Only one bottom panel at a time: opening it closes
   * the shell drawer and vice-versa (`shellOpen && timelineOpen` never holds).
   */
  timelineOpen: boolean;
  /** Height in px of the Timeline drawer, user-resizable. */
  timelineHeight: number;
  /** Which event categories the Timeline shows. */
  timelineFilters: TimelineFilters;
  /** Width in px of the right tool window (Context / Delivs), user-resizable. */
  rightPanelWidth: number;
  /** Width in px of the left queue, user-resizable. */
  queueWidth: number;
  /** Whether the left queue is collapsed to a thin rail. */
  queueCollapsed: boolean;
  draft: WorkDraft;
  /**
   * A ticket we navigated to on purpose (deep link, "open this session") that
   * must stay the one shown even if the queue filters hide it. useWorkQueue
   * relaxes the filters once the ticket is loaded, then clears this. Not persisted.
   */
  revealTicketId: string | null;
  /** A session whose shell pane should take the keyboard when it mounts. Not persisted. */
  shellFocusRequest: string | null;

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
  /** Remember which scratchpad tab is active for a ticket. */
  setActiveScratchTab: (ticketId: string, tabKey: string) => void;
  setSelectedThread: (id: string | null) => void;
  setThreadTab: (tab: ThreadTab) => void;
  setShellOpen: (open: boolean) => void;
  setShellMode: (mode: boolean) => void;
  setCodeMode: (mode: boolean) => void;
  setWorkflowMode: (mode: boolean) => void;
  /** Switch the center to one mode, remembered for the ticket it belongs to. */
  setMode: (mode: WorkMode) => void;
  /** Apply the ticket's remembered center mode (chat when none) and track it. */
  restoreTicketMode: (ticketId: string) => void;
  setShellLayout: (ticketId: string, layout: ShellLayout) => void;
  /** Pin a session to one of the ticket's pane slots (removing it from its other slots); null clears. */
  bindShellPane: (ticketId: string, index: number, id: string | null) => void;
  /**
   * Select a ticket AND set its center mode in one commit (URL → store). Going
   * through selectTicket + setMode would write the mode onto the previous ticket
   * (commitMode targets modeTicketId), then restoreTicketMode would overwrite it.
   */
  openTicket: (ticketId: string, mode: WorkMode) => void;
  /**
   * Open a ticket in shell mode with `sessionId` bound to a pane (the one already
   * showing it, else the first empty one, else the first) and ask that pane to
   * take the keyboard. The landing spot of every "open this session" action.
   */
  openShellForTicket: (ticketId: string, sessionId: string) => void;
  /** Apply the filter patch that reveals the pending ticket, and clear the request. */
  settleReveal: (patch: Partial<Pick<WorkState, QueueFilterKey>> | null) => void;
  clearShellFocusRequest: () => void;
  /** Drop everything remembered for a ticket (after it's deleted). */
  forgetTicket: (ticketId: string) => void;
  setShellHeight: (height: number) => void;
  /** Open/close the Timeline drawer — opening it closes the shell drawer. */
  setTimelineOpen: (open: boolean) => void;
  setTimelineHeight: (height: number) => void;
  toggleTimelineFilter: (key: TimelineFilterKey) => void;
  updateDraft: (patch: Partial<WorkDraft>) => void;
  /** Clear the draft after a task is created — keeping its board (default: the draft's) for the next one. */
  resetDraft: (boardId?: string | null) => void;
}

const STORAGE_KEY = 'fleex_work';

/** The queue filters a hidden ticket can be excluded by. */
export type QueueFilterKey = 'boardFilters' | 'statusFilters' | 'priorityFilters' | 'favoriteOnly' | 'search';

/** The fields of a ticket the queue filters look at. */
export interface RevealableTicket {
  readonly boardId: string;
  readonly status: string;
  readonly priority: string;
  readonly favorite: boolean;
  readonly title: string;
}

/**
 * The smallest filter change that lets `ticket` into the queue, or null when it
 * already passes (mirrors useWorkQueue's filtering). Each filter that excludes it
 * is widened just enough — the ticket's status is added to the status filter
 * rather than wiping it — so the user's other choices survive.
 */
export function filtersRevealing(
  s: Pick<WorkState, QueueFilterKey>,
  ticket: RevealableTicket,
): Partial<Pick<WorkState, QueueFilterKey>> | null {
  const patch: Partial<Pick<WorkState, QueueFilterKey>> = {};
  if (s.statusFilters.length > 0 && !s.statusFilters.includes(ticket.status)) {
    patch.statusFilters = [...s.statusFilters, ticket.status];
  }
  if (s.boardFilters.length > 0 && !s.boardFilters.includes(ticket.boardId)) patch.boardFilters = [];
  if (s.priorityFilters.length > 0 && !s.priorityFilters.includes(ticket.priority)) patch.priorityFilters = [];
  if (s.favoriteOnly && !ticket.favorite) patch.favoriteOnly = false;
  const q = s.search.trim().toLowerCase();
  if (q && !ticket.title.toLowerCase().includes(q)) patch.search = '';
  return Object.keys(patch).length > 0 ? patch : null;
}

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
  | 'activeScratchTabByTicket'
  | 'selectedThreadId'
  | 'threadTab'
  | 'shellOpen'
  | 'shellMode'
  | 'codeMode'
  | 'workflowMode'
  | 'modeByTicket'
  | 'modeTicketId'
  | 'shellLayoutByTicket'
  | 'shellPaneIdsByTicket'
  | 'shellHeight'
  | 'timelineOpen'
  | 'timelineHeight'
  | 'timelineFilters'
  | 'rightPanelWidth'
  | 'queueWidth'
  | 'queueCollapsed'
  | 'draft'
>;

/**
 * Clamp the right panel to a sane range so a drag can't hide or engulf it. The
 * max is generous because the Diff / Code panels want real width for big PRs;
 * the drag is also runtime-capped to the viewport so it can't exceed the window.
 */
export const RIGHT_PANEL_MIN = 260;
export const RIGHT_PANEL_MAX = 1200;
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

/** Clamp the bottom Timeline drawer height — the frieze itself is ~196px tall. */
export const TIMELINE_MIN_HEIGHT = 160;
export const TIMELINE_MAX_HEIGHT = 360;
const clampTimelineHeight = (h: number) =>
  Math.min(TIMELINE_MAX_HEIGHT, Math.max(TIMELINE_MIN_HEIGHT, Math.round(h)));

const DEFAULT_TIMELINE_FILTERS: TimelineFilters = {
  status: true, cli: true, pr: true, deliverables: true, comments: true,
};

type ModeFlags = Pick<WorkState, 'shellMode' | 'codeMode' | 'workflowMode'>;

function modeOf(flags: ModeFlags): WorkMode {
  return flags.codeMode ? 'code' : flags.shellMode ? 'shell' : flags.workflowMode ? 'workflow' : 'chat';
}

function modeFlags(mode: WorkMode): ModeFlags {
  return { shellMode: mode === 'shell', codeMode: mode === 'code', workflowMode: mode === 'workflow' };
}

/** A copy of a per-ticket map without that ticket. */
function withoutTicket<T>(map: Record<string, T>, ticketId: string): Record<string, T> {
  const next = { ...map };
  delete next[ticketId];
  return next;
}

const NO_PANE_BINDINGS: (string | null)[] = [];

/** Selector: the ticket's shell split preset (a single pane until chosen). */
export const selectShellLayout =
  (ticketId: string) =>
  (s: WorkState): ShellLayout =>
    s.shellLayoutByTicket[ticketId] ?? '1';

/** Selector: the ticket's pane bindings (a stable empty array until one is set). */
export const selectShellPaneIds =
  (ticketId: string) =>
  (s: WorkState): (string | null)[] =>
    s.shellPaneIdsByTicket[ticketId] ?? NO_PANE_BINDINGS;

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
  activeScratchTabByTicket: {},
  selectedThreadId: null,
  threadTab: 'conv',
  shellOpen: false,
  shellMode: false,
  codeMode: false,
  workflowMode: false,
  modeByTicket: {},
  modeTicketId: null,
  shellLayoutByTicket: {},
  shellPaneIdsByTicket: {},
  shellHeight: 240,
  timelineOpen: false,
  timelineHeight: 212,
  timelineFilters: DEFAULT_TIMELINE_FILTERS,
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
    // Merge over defaults so a stored blob from an older shape stays valid, and
    // migrate the draft (old blobs had no explicit title/stage — see migrateDraft).
    const merged = { ...DEFAULTS, ...parsed, draft: migrateDraft(parsed.draft) };
    return {
      ...merged,
      // One bottom panel at a time: a blob holding both open keeps the shell.
      timelineOpen: merged.timelineOpen === true && !merged.shellOpen,
      timelineHeight: clampTimelineHeight(Number(merged.timelineHeight) || DEFAULTS.timelineHeight),
      timelineFilters: { ...DEFAULT_TIMELINE_FILTERS, ...(parsed.timelineFilters ?? {}) },
    };
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
      activeScratchTabByTicket: s.activeScratchTabByTicket,
      selectedThreadId: s.selectedThreadId,
      threadTab: s.threadTab,
      shellOpen: s.shellOpen,
      shellMode: s.shellMode,
      codeMode: s.codeMode,
      workflowMode: s.workflowMode,
      modeByTicket: s.modeByTicket,
      modeTicketId: s.modeTicketId,
      shellLayoutByTicket: s.shellLayoutByTicket,
      shellPaneIdsByTicket: s.shellPaneIdsByTicket,
      shellHeight: s.shellHeight,
      timelineOpen: s.timelineOpen,
      timelineHeight: s.timelineHeight,
      timelineFilters: s.timelineFilters,
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

  /** Apply a center-mode change and remember the result for the ticket it belongs to. */
  function commitMode(patch: Partial<ModeFlags>): void {
    const s = get();
    const ticketId = s.modeTicketId;
    if (!ticketId) {
      commit(patch);
      return;
    }
    const mode = modeOf({ ...s, ...patch });
    const modeByTicket = mode === 'chat'
      ? withoutTicket(s.modeByTicket, ticketId)
      : { ...s.modeByTicket, [ticketId]: mode };
    commit({ ...patch, modeByTicket });
  }

  /** The commit that selects a ticket with a given center mode (see openTicket). */
  function ticketModePatch(ticketId: string, mode: WorkMode): Partial<WorkState> {
    const s = get();
    return {
      selectedTicketId: ticketId,
      view: 'task',
      modeTicketId: ticketId,
      ...modeFlags(mode),
      modeByTicket: mode === 'chat'
        ? withoutTicket(s.modeByTicket, ticketId)
        : { ...s.modeByTicket, [ticketId]: mode },
    };
  }

  return {
    ...load(),
    revealTicketId: null,
    shellFocusRequest: null,

    // A hand-picked selection supersedes any pending reveal.
    selectTicket: (id) => commit({ selectedTicketId: id, view: 'task', revealTicketId: null }),
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
    setActiveScratchTab: (ticketId, tabKey) =>
      commit({ activeScratchTabByTicket: { ...get().activeScratchTabByTicket, [ticketId]: tabKey } }),
    setSelectedThread: (selectedThreadId) => commit({ selectedThreadId }),
    setThreadTab: (threadTab) => commit({ threadTab }),
    // The shell drawer and the Timeline share the bottom slot: opening one closes the other.
    setShellOpen: (shellOpen) => commit({ shellOpen, ...(shellOpen ? { timelineOpen: false } : {}) }),
    setTimelineOpen: (timelineOpen) => commit({ timelineOpen, ...(timelineOpen ? { shellOpen: false } : {}) }),
    setTimelineHeight: (height) => commit({ timelineHeight: clampTimelineHeight(height) }),
    toggleTimelineFilter: (key) =>
      commit({ timelineFilters: { ...get().timelineFilters, [key]: !get().timelineFilters[key] } }),
    // Shell mode and Code mode both take over the center — entering one exits the other.
    setShellMode: (shellMode) => commitMode({ shellMode, ...(shellMode ? { codeMode: false, workflowMode: false } : {}) }),
    setCodeMode: (codeMode) => commitMode({ codeMode, ...(codeMode ? { shellMode: false, workflowMode: false } : {}) }),
    setWorkflowMode: (workflowMode) => commitMode({ workflowMode, ...(workflowMode ? { shellMode: false, codeMode: false } : {}) }),
    setMode: (mode) => commitMode(modeFlags(mode)),
    restoreTicketMode: (ticketId) =>
      commit({ modeTicketId: ticketId, ...modeFlags(get().modeByTicket[ticketId] ?? 'chat') }),
    setShellLayout: (ticketId, layout) =>
      commit({ shellLayoutByTicket: { ...get().shellLayoutByTicket, [ticketId]: layout } }),
    setShellHeight: (height) => commit({ shellHeight: clampShellHeight(height) }),
    bindShellPane: (ticketId, index, id) => {
      const ids = [...(get().shellPaneIdsByTicket[ticketId] ?? [])];
      while (ids.length <= index) ids.push(null);
      // A session lives in one pane only — clear it from any other slot first.
      if (id) for (let i = 0; i < ids.length; i++) if (ids[i] === id && i !== index) ids[i] = null;
      ids[index] = id;
      commit({ shellPaneIdsByTicket: { ...get().shellPaneIdsByTicket, [ticketId]: ids } });
    },
    openTicket: (ticketId, mode) => commit({ ...ticketModePatch(ticketId, mode), revealTicketId: ticketId }),
    openShellForTicket: (ticketId, sessionId) => {
      const s = get();
      const ids = [...(s.shellPaneIdsByTicket[ticketId] ?? [])];
      const count = paneCount(s.shellLayoutByTicket[ticketId] ?? '1');
      while (ids.length < count) ids.push(null);
      let idx = ids.indexOf(sessionId);
      if (idx < 0 || idx >= count) idx = ids.slice(0, count).indexOf(null);
      if (idx < 0) idx = 0;
      // A session lives in one pane only.
      for (let i = 0; i < ids.length; i++) if (ids[i] === sessionId) ids[i] = null;
      ids[idx] = sessionId;
      commit({
        ...ticketModePatch(ticketId, 'shell'),
        shellPaneIdsByTicket: { ...s.shellPaneIdsByTicket, [ticketId]: ids },
        revealTicketId: ticketId,
        shellFocusRequest: sessionId,
      });
    },
    settleReveal: (patch) => commit({ ...(patch ?? {}), revealTicketId: null }),
    clearShellFocusRequest: () => set({ shellFocusRequest: null }),
    forgetTicket: (ticketId) => {
      const s = get();
      commit({
        modeByTicket: withoutTicket(s.modeByTicket, ticketId),
        shellLayoutByTicket: withoutTicket(s.shellLayoutByTicket, ticketId),
        shellPaneIdsByTicket: withoutTicket(s.shellPaneIdsByTicket, ticketId),
        activeScratchTabByTicket: withoutTicket(s.activeScratchTabByTicket, ticketId),
        ...(s.modeTicketId === ticketId ? { modeTicketId: null } : {}),
      });
    },
    updateDraft: (patch) => commit({ draft: { ...get().draft, ...patch } }),
    resetDraft: (boardId = get().draft.boardId) => commit({ draft: { ...EMPTY_DRAFT, boardId } }),
  };
});

/** The right panel to actually show: a remembered `browser` is nothing outside the desktop shell. */
export function useEffectiveRightPanel(): RightPanel {
  return effectiveRightPanel(useWorkStore((s) => s.rightPanel), typeof window !== 'undefined' && !!window.fleexDesktop);
}
