import { create } from 'zustand';
import type { PullRequest } from '@asm/shared';
import { fetchPullRequests } from '../services/api';
import { useSessionStore } from './sessionStore';

interface PullRequestState {
  /** pullsByRepo[org/name][headRefName] = PullRequest */
  pullsByRepo: Record<string, Record<string, PullRequest>>;
  fetchPullsForRepo: (org: string, name: string, force?: boolean) => Promise<void>;
  refreshAllPulls: () => Promise<void>;
}

export const usePullRequestStore = create<PullRequestState>((set, get) => ({
  pullsByRepo: {},

  fetchPullsForRepo: async (org, name, force = false) => {
    try {
      const pulls = await fetchPullRequests(org, name, force);
      const byBranch: Record<string, PullRequest> = {};
      for (const pr of pulls) {
        byBranch[pr.headRefName] = pr;
      }
      set((state) => ({
        pullsByRepo: {
          ...state.pullsByRepo,
          [`${org}/${name}`]: byBranch,
        },
      }));
    } catch {
      // ignore – stale data is fine
    }
  },

  refreshAllPulls: async () => {
    const { sessionGroups } = useSessionStore.getState();
    const seen = new Set<string>();
    const promises: Promise<void>[] = [];
    for (const group of sessionGroups) {
      if (!group.repositoryOrg || !group.repositoryName || group.repositoryOrg.startsWith('_')) continue;
      const key = `${group.repositoryOrg}/${group.repositoryName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      promises.push(get().fetchPullsForRepo(group.repositoryOrg, group.repositoryName, true));
    }
    await Promise.all(promises);
  },
}));
