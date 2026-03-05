import { create } from 'zustand';
import type { RepositorySummary, RepositoryDashboardData, RepositoryWsMessage } from '@fleex/shared';
import * as api from '../services/api';

interface RepositoryDashboardState {
  summaries: Record<string, RepositorySummary>;
  dashboardData: RepositoryDashboardData | null;
  githubUser: string | null;
  refreshing: boolean;
  repoRefreshStates: Record<string, 'idle' | 'refreshing' | 'error'>;
  refreshIntervalMs: number;
  lastRefreshedAt: string | null;
  rateLimitWarning: { remaining: number; resetAt: string } | null;

  fetchSummaries: () => Promise<void>;
  fetchDashboard: (org: string, name: string) => Promise<void>;
  requestRefresh: (scope: 'all' | 'repo', org?: string, name?: string) => Promise<void>;
  setRefreshInterval: (ms: number) => void;
  handleWsMessage: (msg: RepositoryWsMessage) => void;
  setGithubUser: (user: string) => void;
}

export const useRepositoryDashboardStore = create<RepositoryDashboardState>((set, get) => ({
  summaries: {},
  dashboardData: null,
  githubUser: null,
  refreshing: false,
  repoRefreshStates: {},
  refreshIntervalMs: 0,
  lastRefreshedAt: null,
  rateLimitWarning: null,

  fetchSummaries: async () => {
    try {
      const data = await api.fetchRepositorySummaries();
      const summaries: Record<string, RepositorySummary> = {};
      for (const s of data) {
        summaries[`${s.org}/${s.name}`] = s;
      }
      set({ summaries });
    } catch {
      // ignore
    }
  },

  fetchDashboard: async (org, name) => {
    try {
      const data = await api.fetchRepositoryDashboard(org, name);
      set({
        dashboardData: data,
        githubUser: data.githubUser || get().githubUser,
      });
    } catch {
      // ignore
    }
  },

  requestRefresh: async (scope, org, name) => {
    set({ refreshing: true });
    try {
      await api.requestRepositoryRefresh(scope, org, name);
    } catch {
      // ignore
    }
  },

  setRefreshInterval: (ms) => {
    set({ refreshIntervalMs: ms });
    api.updateConfig({ repositoryRefreshIntervalMs: ms }).catch(() => {});
  },

  handleWsMessage: (msg) => {
    switch (msg.type) {
      case 'repo:summaries-updated': {
        const data = msg.data as RepositorySummary[];
        const summaries: Record<string, RepositorySummary> = {};
        for (const s of data) {
          summaries[`${s.org}/${s.name}`] = s;
        }
        set({ summaries, lastRefreshedAt: new Date().toISOString() });
        break;
      }
      case 'repo:dashboard-updated': {
        const data = msg.data as RepositoryDashboardData;
        const current = get().dashboardData;
        if (current && current.org === data.org && current.name === data.name) {
          set({ dashboardData: data });
        }
        break;
      }
      case 'repo:refresh-started':
        set({ refreshing: true });
        break;
      case 'repo:refresh-complete':
        set({ refreshing: false, lastRefreshedAt: new Date().toISOString() });
        break;
      case 'repo:rate-limit-warning': {
        const warning = msg.data as { remaining: number; resetAt: string };
        set({ rateLimitWarning: warning });
        break;
      }
    }
  },

  setGithubUser: (user) => set({ githubUser: user }),
}));
