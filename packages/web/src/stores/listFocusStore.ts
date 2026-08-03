import { create } from 'zustand';

import type { TicketPriority, TicketStatus, TicketType } from '@fleex/shared';

/**
 * List/Focus cockpit UI state (view #400).
 *
 * Owns ONLY view-local concerns: which ticket the inspector is focused on, the
 * order snapshot that keeps ↑/↓ navigation stable while the inspector is open
 * (spec D3), the per-group collapse state, and the scope filters. All ticket
 * data, agent activity, unread badges and PR states are read from their existing
 * stores — this store never duplicates them.
 */

export type InspectorFocus = 'comments' | 'deliverables' | null;

/** A frozen group as captured when the inspector opens (order + membership). */
export interface ListFocusGroupSnapshot {
  key: string;
  label: string;
  ticketIds: string[];
}

/**
 * Every filter is multi-select with "empty = all" semantics — except
 * `statuses` (empty = nothing: it *scopes* which groups render) and the
 * `favoritesOnly` flag (pass 4, remark 1).
 */
export interface ListFocusFilters {
  /** Empty = all boards. */
  boardIds: string[];
  /** Status groups to render. */
  statuses: TicketStatus[];
  favoritesOnly: boolean;
  /** Empty = all types. */
  types: TicketType[];
  /** Empty = all priorities. */
  priorities: TicketPriority[];
  /** Case-insensitive substring match on the title; blank = no filter. */
  titleQuery: string;
}

/** Constat: 10 doing + 6 reviewing → default scope (spec D5). */
export const DEFAULT_LIST_FOCUS_STATUSES: TicketStatus[] = ['doing', 'reviewing'];

const COLLAPSED_KEY = 'fleex:listFocusCollapsedGroups';

function loadCollapsed(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore corrupt / unavailable storage */
  }
  return new Set();
}

function persistCollapsed(groups: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...groups]));
  } catch {
    /* ignore quota / privacy mode */
  }
}

function flatten(groups: ListFocusGroupSnapshot[]): string[] {
  return groups.flatMap((g) => g.ticketIds);
}

interface ListFocusState {
  /** The ticket the inspector is focused on (null = inspector closed). */
  selectedTicketId: string | null;
  /** Which inspector section to emphasise when opening (from a badge click). */
  inspectorFocus: InspectorFocus;
  /** Order snapshot frozen at open time so ↑/↓ never jump under the cursor (D3). */
  frozenGroups: ListFocusGroupSnapshot[] | null;
  /** Collapsed group keys (persisted). */
  collapsedGroups: Set<string>;
  filters: ListFocusFilters;

  /** Open the inspector on a ticket, snapshotting the current order (D3). */
  open: (ticketId: string, groups: ListFocusGroupSnapshot[], focus?: InspectorFocus) => void;
  /** Change the focused ticket without re-snapshotting the order. */
  select: (ticketId: string, focus?: InspectorFocus) => void;
  /** Close the inspector and release the frozen order. */
  close: () => void;
  /**
   * Replace the frozen snapshot while the inspector is open. D3's freeze only
   * shields against AMBIENT reordering (activity/recency churn); an explicit
   * filter change is user intent and must apply immediately (review remark 4).
   */
  refreeze: (groups: ListFocusGroupSnapshot[]) => void;
  /** Move the selection ↑/↓ within the frozen order. */
  selectRelative: (delta: 1 | -1) => void;
  toggleGroup: (key: string) => void;
  setFilters: (partial: Partial<ListFocusFilters>) => void;
}

export const useListFocusStore = create<ListFocusState>((set, get) => ({
  selectedTicketId: null,
  inspectorFocus: null,
  frozenGroups: null,
  collapsedGroups: loadCollapsed(),
  filters: {
    boardIds: [],
    statuses: DEFAULT_LIST_FOCUS_STATUSES,
    favoritesOnly: false,
    types: [],
    priorities: [],
    titleQuery: '',
  },

  open: (ticketId, groups, focus = null) => {
    // Snapshot the order only when opening from a closed state: clicking another
    // row while the inspector is already open must not reshuffle the frozen list.
    const existing = get().frozenGroups;
    set({
      selectedTicketId: ticketId,
      inspectorFocus: focus,
      frozenGroups: existing ?? groups,
    });
  },

  select: (ticketId, focus = null) => set({ selectedTicketId: ticketId, inspectorFocus: focus }),

  close: () => set({ selectedTicketId: null, inspectorFocus: null, frozenGroups: null }),

  refreeze: (groups) => set((s) => (s.selectedTicketId ? { frozenGroups: groups } : {})),

  selectRelative: (delta) => {
    const { frozenGroups, selectedTicketId } = get();
    if (!frozenGroups || !selectedTicketId) return;
    const order = flatten(frozenGroups);
    const idx = order.indexOf(selectedTicketId);
    if (idx === -1) return;
    const next = order[idx + delta];
    if (next) set({ selectedTicketId: next, inspectorFocus: null });
  },

  toggleGroup: (key) =>
    set((s) => {
      const next = new Set(s.collapsedGroups);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistCollapsed(next);
      return { collapsedGroups: next };
    }),

  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
}));
