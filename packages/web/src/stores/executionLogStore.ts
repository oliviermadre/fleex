import { create } from 'zustand';
import type { ExecutionLogEntry, AgentEvent } from '@fleex/shared';
import * as api from '../services/api';
import { appWs } from '../services/websocket';

export type ExecutionTypeFilter = 'all' | 'agent' | 'panel' | 'skill';

interface ExecutionLogState {
  // Data
  liveEntries: ExecutionLogEntry[];
  historyEntries: ExecutionLogEntry[];
  liveCount: number;
  historyCount: number;
  total: number;

  // Filters
  typeFilter: ExecutionTypeFilter;
  searchQuery: string;

  // Loading
  loaded: boolean;
  loading: boolean;

  // Actions
  load: () => Promise<void>;
  setTypeFilter: (filter: ExecutionTypeFilter) => void;
  setSearchQuery: (query: string) => void;
  handleWsEvent: (msg: { type: string; data: unknown }) => void;
  subscribeAll: () => void;
  unsubscribeAll: () => void;
}

export const useExecutionLogStore = create<ExecutionLogState>((set, get) => ({
  liveEntries: [],
  historyEntries: [],
  liveCount: 0,
  historyCount: 0,
  total: 0,
  typeFilter: 'all',
  searchQuery: '',
  loaded: false,
  loading: false,

  load: async () => {
    const { typeFilter, searchQuery } = get();
    set({ loading: true });
    try {
      const res = await api.fetchAllExecutions({
        type: typeFilter === 'all' ? undefined : typeFilter,
        q: searchQuery || undefined,
        limit: 100,
      });

      const live = res.entries.filter((e) => e.status === 'running');
      const history = res.entries.filter((e) => e.status !== 'running');

      set({
        liveEntries: live,
        historyEntries: history,
        liveCount: res.liveCount,
        historyCount: res.historyCount,
        total: res.total,
        loaded: true,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to load execution log:', err);
      set({ loading: false });
    }
  },

  setTypeFilter: (filter) => {
    set({ typeFilter: filter });
    get().load();
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  handleWsEvent: (msg) => {
    if (msg.type !== 'agent_event:delta') return;
    const event = msg.data as AgentEvent;

    if (event.eventType === 'execution_start') {
      // A new execution started — reload to get enriched data
      get().load();
    }

    if (event.eventType === 'execution_end') {
      const eventData = event.data as { status?: string } | undefined;
      const finalStatus =
        eventData?.status === 'completed' ||
        eventData?.status === 'failed' ||
        eventData?.status === 'interrupted'
          ? eventData.status
          : 'completed';

      set((state) => {
        // Find in live entries and move to history
        const liveIdx = state.liveEntries.findIndex(
          (e) => e.id === event.executionId,
        );
        if (liveIdx === -1) return state;

        const entry = state.liveEntries[liveIdx]!;
        const completedAt = event.createdAt;
        const durationMs = completedAt
          ? new Date(completedAt).getTime() - new Date(entry.startedAt).getTime()
          : entry.durationMs ?? null;

        const updated: ExecutionLogEntry = {
          ...entry,
          status: finalStatus as ExecutionLogEntry['status'],
          completedAt,
          durationMs,
        };

        const newLive = state.liveEntries.filter(
          (_, i) => i !== liveIdx,
        );
        const newHistory = [updated, ...state.historyEntries];

        return {
          liveEntries: newLive,
          historyEntries: newHistory,
          liveCount: newLive.length,
          historyCount: newHistory.length,
        };
      });

      // Background reload to get full server-side enriched data (tokens, cost, model, etc.)
      setTimeout(() => { get().load(); }, 1500);
    }
  },

  subscribeAll: () => {
    appWs.sendChannel('agent-events', {
      action: 'subscribe',
      allExecutions: true,
    });
  },

  unsubscribeAll: () => {
    appWs.sendChannel('agent-events', {
      action: 'unsubscribe',
      allExecutions: true,
    });
  },
}));
