import { create } from 'zustand';
import type { PullRequest } from '@fleex/shared';
import { fetchPullRequests } from '../services/api';
import { useSessionStore } from './sessionStore';

interface PullRequestState {
  /** pullsByRepo[org/name][headRefName] = PullRequest */
  pullsByRepo: Record<string, Record<string, PullRequest>>;
  fetchPullsForRepo: (org: string, name: string, force?: boolean) => Promise<void>;
  /** Flag a PR just merged from Fleex as merged now, under every casing of `repo`. */
  markMerged: (repo: string, number: number) => void;
  refreshAllPulls: () => Promise<void>;
}

/**
 * PRs merged from Fleex (`org/name#number`) that GitHub hasn't listed as merged yet:
 * the merged list comes from `gh pr list --search`, whose index lags the merge, so a
 * refetch right after it can miss the PR entirely. Keep the local merge until then.
 */
const pendingMerges = new Set<string>();

export const usePullRequestStore = create<PullRequestState>((set, get) => ({
  pullsByRepo: {},

  fetchPullsForRepo: async (org, name, force = false) => {
    try {
      const pulls = await fetchPullRequests(org, name, force);
      const byBranch: Record<string, PullRequest> = {};
      for (const pr of pulls) {
        byBranch[pr.headRefName] = pr;
      }
      const key = `${org}/${name}`;
      set((state) => {
        for (const [branch, pr] of Object.entries(state.pullsByRepo[key] ?? {})) {
          const id = `${key}#${pr.number}`;
          if (!pendingMerges.has(id)) continue;
          if (pulls.some((p) => p.number === pr.number && p.state === 'merged')) pendingMerges.delete(id);
          else byBranch[branch] = pr;
        }
        return { pullsByRepo: { ...state.pullsByRepo, [key]: byBranch } };
      });
    } catch {
      // ignore – stale data is fine
    }
  },

  markMerged: (repo, number) => {
    const mergedAt = new Date().toISOString();
    const pullsByRepo = { ...get().pullsByRepo };
    for (const [key, byBranch] of Object.entries(pullsByRepo)) {
      if (key.toLowerCase() !== repo.toLowerCase()) continue;
      const hit = Object.entries(byBranch).find(([, pr]) => pr.number === number);
      if (!hit) continue;
      pendingMerges.add(`${key}#${number}`);
      pullsByRepo[key] = { ...byBranch, [hit[0]]: { ...hit[1], state: 'merged', mergedAt } };
    }
    set({ pullsByRepo });
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
