import { create } from 'zustand';
import type { PullRequest } from '@asm/shared';
import { fetchPullRequests } from '../services/api';

interface PullRequestState {
  /** pullsByRepo[org/name][headRefName] = PullRequest */
  pullsByRepo: Record<string, Record<string, PullRequest>>;
  fetchPullsForRepo: (org: string, name: string) => Promise<void>;
}

export const usePullRequestStore = create<PullRequestState>((set) => ({
  pullsByRepo: {},

  fetchPullsForRepo: async (org, name) => {
    try {
      const pulls = await fetchPullRequests(org, name);
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
}));
