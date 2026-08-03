import { create } from 'zustand';

import type { DashboardData } from '@fleex/shared';

import { fetchDashboard } from '../services/api';

import { useTicketStore } from './ticketStore';

const SYNC_INTERVAL_KEY = 'fleex-dashboard-sync-interval';

function loadSyncInterval(): number {
  const raw = localStorage.getItem(SYNC_INTERVAL_KEY);
  if (!raw) return 0;
  const ms = parseInt(raw, 10);
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

interface DashboardState {
  data: DashboardData | null;
  lastFetchedAt: Date | null;
  loading: boolean;
  refreshing: boolean;
  autoSyncIntervalMs: number;

  fetch: () => Promise<void>;
  setAutoSyncInterval: (ms: number) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  data: null,
  lastFetchedAt: null,
  loading: false,
  refreshing: false,
  autoSyncIntervalMs: loadSyncInterval(),

  fetch: async () => {
    const isFirstLoad = get().data === null;
    if (isFirstLoad) set({ loading: true });
    else set({ refreshing: true });

    try {
      const result = await fetchDashboard();
      set({ data: result, lastFetchedAt: new Date() });

      // Seed ticket store so inline updates are reflected live
      if (useTicketStore.getState().tickets.length === 0 && result.activeTickets.length > 0) {
        useTicketStore.setState({ tickets: result.activeTickets });
      }
    } catch {
      // toast handled by api layer
    } finally {
      set({ loading: false, refreshing: false });
    }
  },

  setAutoSyncInterval: (ms) => {
    set({ autoSyncIntervalMs: ms });
    localStorage.setItem(SYNC_INTERVAL_KEY, String(ms));
  },
}));
