import { create } from 'zustand';

import type {
  RepositorySummary,
  RepositoryDashboardData,
  RepositoryWsMessage,
  RepositoryStats,
} from '@fleex/shared';

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
  repoStats: Record<string, RepositoryStats>;

  fetchSummaries: () => Promise<void>;
  fetchDashboard: (org: string, name: string) => Promise<void>;
  requestRefresh: (scope: 'all' | 'repo', org?: string, name?: string) => Promise<void>;
  setRefreshInterval: (ms: number) => void;
  handleWsMessage: (msg: RepositoryWsMessage) => void;
  setGithubUser: (user: string) => void;
  fetchRepoStats: (org: string, name: string) => Promise<void>;
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
  repoStats: {},

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
        // A collection refresh also refreshed the open dashboard's cache — pull
        // its detailed data (issues/PRs) so the main panel stays reactive.
        const open = get().dashboardData;
        if (open) get().fetchDashboard(open.org, open.name);
        break;
      }
      case 'repo:summary-updated': {
        // Item refresh: merge the single repo into the list, leaving every other
        // repo untouched. Never replace the whole map here.
        const s = msg.data as RepositorySummary;
        set((state) => ({
          summaries: { ...state.summaries, [`${s.org}/${s.name}`]: s },
          lastRefreshedAt: new Date().toISOString(),
        }));
        // If the refreshed repo is the one open in the main panel, reload its
        // detailed data so a just-created issue/PR appears without a tab switch.
        const current = get().dashboardData;
        if (current && current.org === s.org && current.name === s.name) {
          get().fetchDashboard(s.org, s.name);
        }
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

  fetchRepoStats: async (org, name) => {
    try {
      const stats = await api.fetchRepositoryStats(org, name);
      set((s) => ({ repoStats: { ...s.repoStats, [`${org}/${name}`]: stats } }));
    } catch {
      // ignore — the cost card renders $0 without stats
    }
  },
}));
