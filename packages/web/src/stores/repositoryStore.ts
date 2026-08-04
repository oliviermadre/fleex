import { create } from 'zustand';
import type { Repository, Worktree } from '@fleex/shared';
import * as api from '../services/api';

interface RepositoryState {
  repositories: Repository[];
  branchesByRepo: Record<string, string[]>;
  worktreesByRepo: Record<string, Worktree[]>;
  setRepositories: (repos: Repository[]) => void;
  setBranches: (repoKey: string, branches: string[]) => void;
  setWorktrees: (repoKey: string, worktrees: Worktree[]) => void;
  fetchRepositories: () => Promise<void>;
  fetchBranches: (org: string, name: string) => Promise<void>;
  fetchWorktrees: (org: string, name: string) => Promise<void>;
}

function repoKey(org: string, name: string): string {
  return `${org}/${name}`;
}

/**
 * In-flight `GET /repositories` request, shared by concurrent callers.
 * That endpoint shells out to git once per repo, so opening/closing/reopening
 * the New Task modal must not stampede it.
 */
let inFlightFetch: Promise<void> | null = null;

export const useRepositoryStore = create<RepositoryState>((set) => ({
  repositories: [],
  branchesByRepo: {},
  worktreesByRepo: {},

  setRepositories: (repositories) => set({ repositories }),

  setBranches: (key, branches) =>
    set((state) => ({
      branchesByRepo: { ...state.branchesByRepo, [key]: branches },
    })),

  setWorktrees: (key, worktrees) =>
    set((state) => ({
      worktreesByRepo: { ...state.worktreesByRepo, [key]: worktrees },
    })),

  fetchRepositories: () => {
    if (inFlightFetch) return inFlightFetch;
    inFlightFetch = api
      .fetchRepositories()
      .then((repos) => { set({ repositories: repos }); })
      // Keep the last known list rather than blanking the pickers: callers
      // don't catch, and request() already raised a toast.
      .catch(() => {})
      .finally(() => { inFlightFetch = null; });
    return inFlightFetch;
  },

  fetchBranches: async (org, name) => {
    const branches = await api.fetchBranches(org, name);
    set((state) => ({
      branchesByRepo: { ...state.branchesByRepo, [repoKey(org, name)]: branches },
    }));
  },

  fetchWorktrees: async (org, name) => {
    const worktrees = await api.fetchWorktrees(org, name);
    set((state) => ({
      worktreesByRepo: { ...state.worktreesByRepo, [repoKey(org, name)]: worktrees },
    }));
  },
}));
