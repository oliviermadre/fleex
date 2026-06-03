import { create } from 'zustand';
import type { DomainEventLog } from '@fleex/shared';
import * as api from '../services/api';
import { PAGE_SIZE_AUDIT_TRAIL } from '../lib/constants';

interface AuditTrailState {
  events: DomainEventLog[];
  loading: boolean;
  hasMore: boolean;
  filters: {
    eventType: string;
    instanceId: string;
    since: string;
  };
  fetch: () => Promise<void>;
  fetchMore: () => Promise<void>;
  setFilter: (key: keyof AuditTrailState['filters'], value: string) => void;
}

export const useAuditTrailStore = create<AuditTrailState>((set, get) => ({
  events: [],
  loading: false,
  hasMore: true,
  filters: {
    eventType: '',
    instanceId: '',
    since: '',
  },

  fetch: async () => {
    set({ loading: true });
    try {
      const { filters } = get();
      const events = await api.fetchEvents({
        limit: PAGE_SIZE_AUDIT_TRAIL,
        eventType: filters.eventType || undefined,
        instanceId: filters.instanceId || undefined,
        since: filters.since || undefined,
      });
      set({ events, hasMore: events.length >= PAGE_SIZE_AUDIT_TRAIL, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchMore: async () => {
    const { events, loading, hasMore, filters } = get();
    if (loading || !hasMore || events.length === 0) return;
    set({ loading: true });
    try {
      const lastEvent = events[events.length - 1]!;
      const more = await api.fetchEvents({
        limit: PAGE_SIZE_AUDIT_TRAIL,
        before: lastEvent.id,
        eventType: filters.eventType || undefined,
        instanceId: filters.instanceId || undefined,
        since: filters.since || undefined,
      });
      set({
        events: [...events, ...more],
        hasMore: more.length >= PAGE_SIZE_AUDIT_TRAIL,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  setFilter: (key, value) => {
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    }));
    // Re-fetch with new filters
    get().fetch();
  },
}));
