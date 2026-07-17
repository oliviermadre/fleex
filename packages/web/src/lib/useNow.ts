import { useSyncExternalStore } from 'react';

/**
 * Shared 1-second clock for live duration labels (#400, pass 5).
 *
 * Every cockpit row shows "Running for 5m" / "idle for 3h" and must tick each
 * second without a page refresh. A per-badge setInterval would mean N timers
 * for N rows; this module keeps ONE interval alive while at least one
 * component subscribes, and tears it down when the last one unmounts.
 */
let now = Date.now();
let interval: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!interval) {
    now = Date.now();
    interval = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

/** Current epoch ms, re-rendering the caller every second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
