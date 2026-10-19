import { create } from 'zustand';
import type { Release } from '@fleex/shared';
import * as api from '../services/api';

/**
 * Illustrated release notes (`GET /api/releases`, docs/releases.md) and the
 * last release the user has seen. Loaded by the nav (always mounted) so the
 * « Nouveau » badge is right on every page.
 *
 * `lastSeen` is purely local (localStorage), like the version banner's dismissal.
 */
export const LAST_SEEN_RELEASE_KEY = 'fleex-last-seen-release';

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

interface ReleaseStore {
  releases: Release[];
  /** Newest release number, null when there is none. */
  current: number | null;
  /** True once a load succeeded. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  lastSeen: number | null;

  load: () => Promise<void>;
  /** The user opened /releases: the newest one is now seen. */
  markSeen: () => void;
}

export const useReleaseStore = create<ReleaseStore>((set, get) => ({
  releases: [],
  current: null,
  loaded: false,
  loading: false,
  error: null,
  lastSeen: readNumber(LAST_SEEN_RELEASE_KEY),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const { current, releases } = await api.fetchReleases();
      set({ current, releases, loaded: true, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  markSeen: () => {
    const { current, lastSeen } = get();
    if (current === null || (lastSeen !== null && lastSeen >= current)) return;
    try {
      localStorage.setItem(LAST_SEEN_RELEASE_KEY, String(current));
    } catch {
      // private mode: the badge just comes back next visit
    }
    set({ lastSeen: current });
  },
}));

/** A release newer than the last one the user opened exists. */
export function hasUnseenRelease(current: number | null, lastSeen: number | null): boolean {
  return current !== null && current > (lastSeen ?? 0);
}

export function useHasUnseenRelease(): boolean {
  return useReleaseStore((s) => hasUnseenRelease(s.current, s.lastSeen));
}
