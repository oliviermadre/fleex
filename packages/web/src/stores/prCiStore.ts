import { create } from 'zustand';
import type { PrCiDetail, PrCiSummary, PrMergeMethod } from '@fleex/shared';
import { fetchPRCiDetail, fetchPRCiSummaries, mergePR } from '../services/api';

/** Poll cadence while at least one watched open PR has CI running. */
export const POLL_RUNNING_MS = 60_000;
/** Poll cadence otherwise. */
export const POLL_IDLE_MS = 5 * 60_000;
/** The server caps a summary request at this many refs. */
const MAX_REFS_PER_REQUEST = 200;

export interface PrCiDetailEntry {
  data?: PrCiDetail;
  loading: boolean;
  error?: string;
}

interface PrCiState {
  /** Keyed by lowercase "org/name#123". */
  summaries: Record<string, PrCiSummary>;
  /** Why the last summary fetch for a ref failed; cleared on the next success. */
  errors: Record<string, string>;
  details: Record<string, PrCiDetailEntry>;
  /** Ref-counted: every mounted chip watches its ref. Returns the unsubscribe. */
  subscribe: (refs: string[]) => () => void;
  /** Refetch summaries for `refs`, or for every watched open PR. */
  refresh: (refs?: string[]) => Promise<void>;
  loadDetail: (ref: string) => Promise<void>;
  /** Rejects with gh's message when GitHub refuses the merge. */
  merge: (ref: string, method: PrMergeMethod, headSha: string) => Promise<void>;
}

// Bookkeeping that never drives rendering stays outside the reactive state.
const subscribers = new Map<string, number>();
const pendingFirstFetch = new Set<string>();
let flushScheduled = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityListening = false;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export const usePrCiStore = create<PrCiState>((set, get) => {
  /** Watched refs worth polling: merged/closed PRs no longer change CI. */
  function pollableRefs(): string[] {
    const { summaries } = get();
    return [...subscribers.keys()].filter((ref) => {
      const state = summaries[ref]?.state;
      return state !== 'MERGED' && state !== 'CLOSED';
    });
  }

  function nextPollDelay(): number {
    const { summaries } = get();
    const anyRunning = pollableRefs().some((ref) => summaries[ref]?.ciStatus === 'running');
    return anyRunning ? POLL_RUNNING_MS : POLL_IDLE_MS;
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (subscribers.size === 0) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      // Hidden tab: stay quiet; the visibility listener refetches on return.
      if (isHidden()) return;
      void get().refresh().finally(schedulePoll);
    }, nextPollDelay());
  }

  function ensureVisibilityListener() {
    if (visibilityListening || typeof document === 'undefined') return;
    visibilityListening = true;
    document.addEventListener('visibilitychange', () => {
      if (isHidden()) {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
        return;
      }
      if (subscribers.size === 0) return;
      void get().refresh().finally(schedulePoll);
    });
  }

  function scheduleFirstFetch() {
    if (flushScheduled) return;
    flushScheduled = true;
    // Every chip mounting in the same tick lands in one request.
    setTimeout(() => {
      flushScheduled = false;
      const refs = [...pendingFirstFetch].filter((ref) => subscribers.has(ref));
      pendingFirstFetch.clear();
      // Re-arm afterwards: a PR found running shortens the cadence right away.
      if (refs.length > 0) void get().refresh(refs).finally(schedulePoll);
      else if (!pollTimer) schedulePoll();
    }, 0);
  }

  return {
    summaries: {},
    errors: {},
    details: {},

    subscribe: (refs) => {
      ensureVisibilityListener();
      const { summaries } = get();
      for (const ref of refs) {
        subscribers.set(ref, (subscribers.get(ref) ?? 0) + 1);
        if (!summaries[ref]) pendingFirstFetch.add(ref);
      }
      if (pendingFirstFetch.size > 0) scheduleFirstFetch();
      else if (!pollTimer) schedulePoll();

      return () => {
        for (const ref of refs) {
          const n = (subscribers.get(ref) ?? 0) - 1;
          if (n > 0) subscribers.set(ref, n);
          else subscribers.delete(ref);
        }
        if (subscribers.size === 0 && pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      };
    },

    refresh: async (refs) => {
      const wanted = [...new Set(refs ?? pollableRefs())];
      for (let i = 0; i < wanted.length; i += MAX_REFS_PER_REQUEST) {
        const batch = wanted.slice(i, i + MAX_REFS_PER_REQUEST);
        try {
          const result = await fetchPRCiSummaries(batch);
          set((s) => {
            const summaries = { ...s.summaries };
            const errors = { ...s.errors };
            for (const ref of batch) {
              if (result[ref]) {
                summaries[ref] = result[ref];
                delete errors[ref];
              } else if (!summaries[ref]) {
                errors[ref] = 'GitHub returned no data for this pull request';
              }
            }
            return { summaries, errors };
          });
        } catch (err) {
          const message = errorMessage(err);
          set((s) => {
            const errors = { ...s.errors };
            for (const ref of batch) errors[ref] = message;
            return { errors };
          });
        }
      }
    },

    loadDetail: async (ref) => {
      set((s) => ({ details: { ...s.details, [ref]: { ...s.details[ref], loading: true } } }));
      try {
        const data = await fetchPRCiDetail(ref);
        const { state, isDraft, ciStatus, counts } = data;
        set((s) => ({
          details: { ...s.details, [ref]: { data, loading: false } },
          // The detail is the freshest view of the PR: keep every chip in step.
          summaries: { ...s.summaries, [ref]: { ref, state, isDraft, ciStatus, counts } },
        }));
      } catch (err) {
        const error = errorMessage(err);
        set((s) => ({ details: { ...s.details, [ref]: { ...s.details[ref], loading: false, error } } }));
      }
    },

    merge: async (ref, method, headSha) => {
      await mergePR({ ref, method, headSha });
      set((s) => {
        const current = s.summaries[ref] ?? { ref, isDraft: false, ciStatus: 'none' as const, counts: {} };
        const details = { ...s.details };
        delete details[ref];
        // Optimistic: every chip for this PR turns purple before GitHub confirms.
        return { details, summaries: { ...s.summaries, [ref]: { ...current, state: 'MERGED' as const } } };
      });
      void get().refresh([ref]);
    },
  };
});

/** Test-only: forget every subscription, timer and cached value. */
export function resetPrCiStore() {
  subscribers.clear();
  pendingFirstFetch.clear();
  flushScheduled = false;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  usePrCiStore.setState({ summaries: {}, errors: {}, details: {} });
}
