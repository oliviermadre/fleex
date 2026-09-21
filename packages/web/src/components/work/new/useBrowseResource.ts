import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A tiny stale-while-revalidate store for the browse pickers, kept at module
 * level so it outlives the screens: New Task prefetches the inbox when it opens,
 * and by the time a picker mounts the rows are already in memory.
 *
 * It mirrors the server's contract. The server answers instantly from its cache
 * and says `stale: true` when a refresh is running behind that answer — so a
 * stale answer is followed by a few short polls to pick the fresh rows up.
 */

interface Entry<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** When `data` was received. */
  readonly at: number;
}

const EMPTY: Entry<never> = { data: null, error: null, loading: false, at: 0 };

/** Below this age a mount reuses the rows without asking the server again. */
const FRESH_MS = 30_000;
const STALE_POLL_MS = 2_500;
const MAX_STALE_POLLS = 3;

const entries = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish<T>(key: string, patch: Partial<Entry<T>>) {
  entries.set(key, { ...((entries.get(key) as Entry<T> | undefined) ?? EMPTY), ...patch });
  listeners.get(key)?.forEach((notify) => notify());
}

function load<T extends { stale: boolean }>(key: string, fetcher: () => Promise<T>, polls = 0): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;

  clearTimeout(timers.get(key));
  publish<T>(key, { loading: true, error: null });
  // `inflight` is cleared BEFORE subscribers are told the outcome: whoever reacts
  // to "it failed" by retrying must start a new request, not be handed this one.
  const started = fetcher().then(
    (data) => {
      inflight.delete(key);
      publish<T>(key, { data, loading: false, at: Date.now() });
      if (data.stale && polls < MAX_STALE_POLLS) {
        timers.set(key, setTimeout(() => void load(key, fetcher, polls + 1), STALE_POLL_MS));
      }
    },
    (err: unknown) => {
      inflight.delete(key);
      // Keep whatever rows we had: old data beats an error page.
      publish<T>(key, { loading: false, error: err instanceof Error ? err.message : 'Failed to load' });
    },
  );
  inflight.set(key, started);
  return started;
}

/** Warm a resource ahead of the screen that will show it. Never throws. */
export function prefetchBrowseResource<T extends { stale: boolean }>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const entry = entries.get(key);
  if (entry?.data && Date.now() - entry.at < FRESH_MS) return Promise.resolve();
  return load(key, fetcher);
}

export function useBrowseResource<T extends { stale: boolean }>(key: string | null, fetcher: () => Promise<T>) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!key) return () => {};
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(notify);
      return () => set.delete(notify);
    },
    [key],
  );
  const entry = useSyncExternalStore(subscribe, () => (key ? ((entries.get(key) as Entry<T> | undefined) ?? EMPTY) : EMPTY));

  // Once per mount/key — never from a state change, so a failure cannot loop.
  useEffect(() => {
    if (key) void prefetchBrowseResource(key, () => fetcherRef.current());
  }, [key]);

  const retry = useCallback(() => (key ? load(key, () => fetcherRef.current()) : Promise.resolve()), [key]);

  return { data: entry.data as T | null, error: entry.error, loading: entry.loading, retry };
}

/** Test seam. */
export function resetBrowseResources() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  entries.clear();
  inflight.clear();
  listeners.clear();
}
