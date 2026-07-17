import { create } from 'zustand';
import type { AgentActivityState } from '@fleex/shared';
import * as api from '../services/api';

/**
 * Optimistic-upgrade ranking. A single WS event may only ever *raise* a ticket's
 * perceived activity (idle → running → waiting) between authoritative reconciles;
 * it must never downgrade — that is the reconcile's job. Downgrading on a lone
 * event would flicker a pill off while work is still in flight.
 */
const RANK: Record<AgentActivityState, number> = { idle: 0, running: 1, waiting: 2 };

/**
 * Board-wide WS bursts fire many events at once. Coalesce the authoritative bulk
 * refetch so a burst issues one request instead of N.
 */
export const RECONCILE_DEBOUNCE_MS = 250;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;

interface TicketActivityState {
  /** Non-idle activity per ticket. Absence of a key ⇒ idle (no pill). */
  activityByTicket: Record<string, AgentActivityState>;
  /** Optional tooltip detail per ticket. */
  detailByTicket: Record<string, string>;
  /**
   * Last SDK activity per ticket — kept for idle tickets too (that is exactly
   * the state the cockpit's "idle since {{age}}" column needs, #400 pass 4).
   * Absence ⇒ the ticket never had an SDK session.
   */
  lastActivityAtByTicket: Record<string, string>;
  /**
   * Start of the CURRENT non-idle state per ticket — drives "Running for 5m" /
   * "Waiting for 2h" (#400, pass 5). Only kept for non-idle tickets; idle
   * durations come from lastActivityAtByTicket instead.
   */
  sinceByTicket: Record<string, string>;
  /** The currently-visible tickets; only these are tracked / reconciled. */
  trackedIds: string[];

  /** Authoritative bulk load for the given (visible) tickets. */
  loadActivity(ticketIds: string[]): Promise<void>;
  /** Read a ticket's activity (idle when untracked). */
  getActivity(ticketId: string): AgentActivityState;
  /** Optimistic instant-on: raise a tracked ticket's state (never lower it). */
  noteActivity(ticketId: string, activity: AgentActivityState, detail?: string): void;
  /** Debounced authoritative reconcile of all tracked tickets. */
  scheduleReconcile(): void;
}

export const useTicketActivityStore = create<TicketActivityState>((set, get) => ({
  activityByTicket: {},
  detailByTicket: {},
  lastActivityAtByTicket: {},
  sinceByTicket: {},
  trackedIds: [],

  loadActivity: async (ticketIds) => {
    if (!ticketIds.length) {
      set({
        trackedIds: [],
        activityByTicket: {},
        detailByTicket: {},
        lastActivityAtByTicket: {},
        sinceByTicket: {},
      });
      return;
    }
    set({ trackedIds: ticketIds });
    let items;
    try {
      items = await api.fetchTicketAgentActivity(ticketIds);
    } catch {
      return; // transient; the next reconcile retries. Keep the last good state.
    }
    // Rebuild the maps from scratch: the response is authoritative, so a ticket that
    // dropped back to idle simply won't appear and its stale pill is cleared.
    const activityByTicket: Record<string, AgentActivityState> = {};
    const detailByTicket: Record<string, string> = {};
    const lastActivityAtByTicket: Record<string, string> = {};
    const sinceByTicket: Record<string, string> = {};
    for (const it of items) {
      // lastActivityAt is kept for EVERY entry — idle included, since "idle
      // for {{age}}" is precisely about tickets with no current activity.
      if (it.lastActivityAt) lastActivityAtByTicket[it.ticketId] = it.lastActivityAt;
      if (it.activity === 'idle') continue;
      activityByTicket[it.ticketId] = it.activity;
      if (it.detail) detailByTicket[it.ticketId] = it.detail;
      // since only matters for the CURRENT non-idle state ("Running for 5m");
      // a ticket that dropped back to idle loses its stale since here.
      if (it.since) sinceByTicket[it.ticketId] = it.since;
    }
    set({ activityByTicket, detailByTicket, lastActivityAtByTicket, sinceByTicket });
  },

  getActivity: (ticketId) => get().activityByTicket[ticketId] ?? 'idle',

  noteActivity: (ticketId, activity, detail) => {
    if (!get().trackedIds.includes(ticketId)) return; // only visible tickets
    const current = get().activityByTicket[ticketId] ?? 'idle';
    if (RANK[activity] <= RANK[current]) return; // upgrade-only (since included)
    set((state) => ({
      activityByTicket: { ...state.activityByTicket, [ticketId]: activity },
      detailByTicket: detail
        ? { ...state.detailByTicket, [ticketId]: detail }
        : state.detailByTicket,
      // Optimistic stamp: the WS event means the state flipped "just now", so
      // now IS the state start until the reconcile lands the exact one.
      sinceByTicket: { ...state.sinceByTicket, [ticketId]: new Date().toISOString() },
    }));
  },

  scheduleReconcile: () => {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      const { trackedIds, loadActivity } = get();
      if (trackedIds.length) void loadActivity(trackedIds);
    }, RECONCILE_DEBOUNCE_MS);
  },
}));
