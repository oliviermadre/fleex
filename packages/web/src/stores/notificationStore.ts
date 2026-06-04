import { create } from 'zustand';
import type { PulseNotification } from '../notifications/types';

/**
 * Fleex Pulse store — the single in-memory source of truth for both surfaces:
 * the persistent notification center (the bell) and the ephemeral toasts.
 *
 * Persistence is intentionally per-tab and in-memory only: a page reload starts
 * from a clean slate (V1 requirement). Deduplication is handled here via
 * `processedKeys` so hub re-broadcasts and "announce once" events never produce
 * duplicate entries.
 */

const MAX_NOTIFICATIONS = 50; // persistent list cap (newest kept)
const MAX_TOASTS = 4; // simultaneously visible toasts
const TOAST_DISMISS_MS = 6_000;
const MAX_PROCESSED_KEYS = 500; // dedup memory cap

interface NotificationState {
  /** Persistent center, newest first, capped at MAX_NOTIFICATIONS. */
  notifications: PulseNotification[];
  /** Currently visible ephemeral toasts (subset of recent pushes). */
  toasts: PulseNotification[];
  /** Whether the bell dropdown is open. */
  panelOpen: boolean;
  /** Count of notifications not yet seen — drives the bell badge. */
  unseenCount: number;
  /** Keys already turned into notifications (dedup). */
  processedKeys: Set<string>;

  /** Ingest a freshly built notification (deduped by id). */
  push: (n: PulseNotification) => void;
  /** Remove a toast (auto or manual). */
  dismissToast: (id: string) => void;
  /** Open the bell: reveals the list and marks everything as seen. */
  openPanel: () => void;
  /** Close the bell. */
  closePanel: () => void;
  /** Toggle the bell (opening also marks everything as seen). */
  togglePanel: () => void;
  /** Mark every notification as seen and reset the badge. */
  markAllSeen: () => void;
  /** Empty the persistent list and visible toasts (keeps dedup memory). */
  clear: () => void;
}

/** Recompute the unseen badge from the (already capped) list — keeps badge and
 *  list coherent even when an unseen entry is evicted by the cap. */
function countUnseen(notifications: PulseNotification[]): number {
  let n = 0;
  for (const item of notifications) if (!item.seen) n++;
  return n;
}

/** Keep at most MAX_PROCESSED_KEYS, dropping the oldest insertions first. */
function trimKeys(keys: Set<string>): Set<string> {
  if (keys.size <= MAX_PROCESSED_KEYS) return keys;
  return new Set([...keys].slice(-MAX_PROCESSED_KEYS));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  toasts: [],
  panelOpen: false,
  unseenCount: 0,
  processedKeys: new Set<string>(),

  push: (n) => {
    const { processedKeys, panelOpen } = get();
    if (processedKeys.has(n.id)) return; // dedup: identical event already handled

    // If the panel is open the user is actively looking — count it as seen so
    // the badge does not climb while the list is in view.
    const entry: PulseNotification = panelOpen ? { ...n, seen: true } : n;

    set((state) => {
      const keys = trimKeys(new Set(state.processedKeys).add(n.id));
      const notifications = [entry, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      const toasts = [entry, ...state.toasts].slice(0, MAX_TOASTS);
      return {
        processedKeys: keys,
        notifications,
        toasts,
        unseenCount: countUnseen(notifications),
      };
    });

    // Auto-dismiss the toast surface (the entry stays in the persistent list).
    setTimeout(() => get().dismissToast(n.id), TOAST_DISMISS_MS);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  openPanel: () => {
    set((state) => {
      const notifications = state.notifications.map((item) =>
        item.seen ? item : { ...item, seen: true },
      );
      return { panelOpen: true, notifications, unseenCount: 0 };
    });
  },

  closePanel: () => set({ panelOpen: false }),

  togglePanel: () => {
    if (get().panelOpen) {
      get().closePanel();
    } else {
      get().openPanel();
    }
  },

  markAllSeen: () => {
    set((state) => ({
      notifications: state.notifications.map((item) =>
        item.seen ? item : { ...item, seen: true },
      ),
      unseenCount: 0,
    }));
  },

  clear: () => set({ notifications: [], toasts: [], unseenCount: 0 }),
}));
