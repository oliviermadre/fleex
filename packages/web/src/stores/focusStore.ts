import { create } from 'zustand';
import type { FocusItem } from '@fleex/shared';
import * as api from '../services/api';
import { useToastStore } from './toastStore';

/**
 * Focus — the human-attention queue (Doing/Reviewing tickets waiting on you).
 *
 * The list itself is server state (`GET /api/focus`, refetched on the `tickets`
 * WS channel by `useFocusFeed`). This store adds the client-only layer the page
 * needs to be fast without being reckless:
 *
 *  - an **undo window**: an action hides its row at once, but the API call only
 *    fires after `UNDO_MS`, so "Annuler" really undoes (a gate decision cannot be
 *    reverted server-side). Pending actions are flushed on `pagehide`;
 *  - **snooze** ("Plus tard"), keyed on the item's reason (`FocusItem.key`), so a
 *    snooze lapses by itself when the reason changes;
 *  - a **settled** set: once an action succeeded, its row stays hidden until a
 *    refetch confirms the server dropped it (no flash-back in between);
 *  - a small **local log** of handled items for the "réaction médiane" line.
 *    Per browser, kept 30 days — a hint, not analytics.
 */

export const UNDO_MS = 5000;
const RELOAD_DEBOUNCE_MS = 500;
/** Safety net: a settled key the server keeps returning reappears after this. */
const SETTLED_TTL_MS = 30_000;
const LOG_TTL_MS = 30 * 24 * 3600_000;

const SNOOZE_KEY = 'fleex_focus_snoozed';
const LOG_KEY = 'fleex_focus_log';
const PREFS_KEY = 'fleex_focus_prefs';

export interface FocusLogEntry {
  /** When the item was handled (ms). */
  at: number;
  /** How long it had been waiting (ms), when known. */
  waitedMs: number | null;
}

export interface FocusPrefs {
  /** Hide the stats line. */
  zen: boolean;
  /** After an action in the detail popup, open the next item. */
  chain: boolean;
  /** Include idle tickets (nobody asked anything) in the list. */
  showIdle: boolean;
}

interface PendingAction {
  label: string;
  timer: ReturnType<typeof setTimeout>;
  run: () => Promise<unknown>;
  item: FocusItem;
}

interface FocusState {
  items: FocusItem[];
  runningTicketIds: string[];
  loaded: boolean;
  /** Keys whose action is waiting out the undo window. */
  pending: Record<string, PendingAction>;
  /** Keys whose action succeeded, hidden until the server drops them (value = expiry ms). */
  settled: Record<string, number>;
  /** key → snoozed-until (ms). */
  snoozed: Record<string, number>;
  log: FocusLogEntry[];
  /** Times the list was emptied by an action (ms), for "vidée N fois". */
  clearedAt: number[];
  prefs: FocusPrefs;

  load(): Promise<void>;
  scheduleReload(): void;
  /**
   * Hide `item` now and run `action` once the undo window closes. `label` is the
   * toast text ("Gate résolue · #123").
   */
  commit(item: FocusItem, label: string, action: () => Promise<unknown>): void;
  undo(key: string): void;
  /** Fire every pending action now (page is going away). */
  flushPending(): void;
  snooze(key: string, untilMs: number): void;
  unsnoozeAll(): void;
  setPref<K extends keyof FocusPrefs>(key: K, value: FocusPrefs[K]): void;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — the feature degrades to in-memory */
  }
}

const DEFAULT_PREFS: FocusPrefs = { zen: false, chain: true, showIdle: true };

function loadPersisted() {
  const now = Date.now();
  const stored = readJson<{ log?: FocusLogEntry[]; clearedAt?: number[] }>(LOG_KEY, {});
  const snoozed = Object.fromEntries(
    Object.entries(readJson<Record<string, number>>(SNOOZE_KEY, {})).filter(([, until]) => until > now),
  );
  return {
    snoozed,
    log: (stored.log ?? []).filter((e) => now - e.at < LOG_TTL_MS),
    clearedAt: (stored.clearedAt ?? []).filter((t) => now - t < LOG_TTL_MS),
    prefs: readJson<FocusPrefs>(PREFS_KEY, DEFAULT_PREFS),
  };
}

/**
 * The rows to show: server items minus pending / settled / snoozed ones, and
 * minus idle tickets when the user turned them off. Pure so the nav badge and
 * the page count the same thing.
 */
export function visibleFocusItems(
  s: Pick<FocusState, 'items' | 'pending' | 'settled' | 'snoozed' | 'prefs'>,
  now: number,
): FocusItem[] {
  return s.items.filter(
    (i) =>
      !s.pending[i.key] &&
      !s.settled[i.key] &&
      !((s.snoozed[i.key] ?? 0) > now) &&
      (s.prefs.showIdle || i.kind !== 'idle'),
  );
}

/** Items currently snoozed (still reported by the server). */
export function snoozedFocusItems(s: Pick<FocusState, 'items' | 'snoozed'>, now: number): FocusItem[] {
  return s.items.filter((i) => (s.snoozed[i.key] ?? 0) > now);
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let again = false;

export const useFocusStore = create<FocusState>((set, get) => {
  const persistLog = () => writeJson(LOG_KEY, { log: get().log, clearedAt: get().clearedAt });

  const execute = (key: string) => {
    const p = get().pending[key];
    if (!p) return;
    clearTimeout(p.timer);
    set((s) => {
      const { [key]: _drop, ...pending } = s.pending;
      return { pending, settled: { ...s.settled, [key]: Date.now() + SETTLED_TTL_MS } };
    });
    p.run()
      .then(() => {
        const since = p.item.since ? Date.parse(p.item.since) : NaN;
        set((s) => ({ log: [...s.log, { at: Date.now(), waitedMs: Number.isFinite(since) ? Date.now() - since : null }] }));
        // This action emptied the list: that's the goal of the page, count it.
        if (visibleFocusItems(get(), Date.now()).length === 0 && Object.keys(get().pending).length === 0) {
          set((s) => ({ clearedAt: [...s.clearedAt, Date.now()] }));
        }
        persistLog();
      })
      .catch((err: unknown) => {
        // The API layer already toasted the server message; bring the row back.
        set((s) => {
          const { [key]: _drop, ...settled } = s.settled;
          return { settled };
        });
        if (!(err instanceof Error && err.message.startsWith('API error'))) {
          useToastStore.getState().addToast('error', `Action impossible : ${err instanceof Error ? err.message : String(err)}`);
        }
      })
      .finally(() => get().scheduleReload());
  };

  return {
    items: [],
    runningTicketIds: [],
    loaded: false,
    pending: {},
    settled: {},
    ...loadPersisted(),

    load: async () => {
      if (inflight) {
        again = true;
        return inflight;
      }
      inflight = (async () => {
        try {
          const res = await api.fetchFocus();
          const keys = new Set(res.items.map((i) => i.key));
          const now = Date.now();
          set((s) => ({
            items: res.items,
            runningTicketIds: res.runningTicketIds,
            loaded: true,
            // A settled key the server no longer reports is done; one it still
            // reports stays hidden until its TTL (the action may still be landing).
            settled: Object.fromEntries(Object.entries(s.settled).filter(([k, exp]) => keys.has(k) && exp > now)),
          }));
        } catch {
          set({ loaded: true }); // keep the last good list; the next event retries
        } finally {
          inflight = null;
          if (again) {
            again = false;
            void get().load();
          }
        }
      })();
      return inflight;
    },

    scheduleReload: () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void get().load();
      }, RELOAD_DEBOUNCE_MS);
    },

    commit: (item, label, action) => {
      if (get().pending[item.key]) return;
      const timer = setTimeout(() => execute(item.key), UNDO_MS);
      set((s) => ({ pending: { ...s.pending, [item.key]: { label, timer, run: action, item } } }));
    },

    undo: (key) => {
      const p = get().pending[key];
      if (!p) return;
      clearTimeout(p.timer);
      set((s) => {
        const { [key]: _drop, ...pending } = s.pending;
        return { pending };
      });
    },

    flushPending: () => {
      for (const key of Object.keys(get().pending)) execute(key);
    },

    snooze: (key, untilMs) => {
      set((s) => ({ snoozed: { ...s.snoozed, [key]: untilMs } }));
      writeJson(SNOOZE_KEY, get().snoozed);
    },

    unsnoozeAll: () => {
      set({ snoozed: {} });
      writeJson(SNOOZE_KEY, {});
    },

    setPref: (key, value) => {
      set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
      writeJson(PREFS_KEY, get().prefs);
    },
  };
});

// ── Stats helpers (pure) ──

const DAY_MS = 24 * 3600_000;

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface FocusStats {
  handledToday: number;
  /** Median wait of today's handled items, ms; null when none. */
  medianTodayMs: number | null;
  /** Median wait per day over the last 7 days, oldest first (null = no data that day). */
  medianByDayMs: (number | null)[];
  /** Times the list was emptied in the last 7 days. */
  clearedThisWeek: number;
}

export function focusStats(log: FocusLogEntry[], clearedAt: number[], now: number): FocusStats {
  const today = startOfDay(now);
  const days = Array.from({ length: 7 }, (_, i) => today - (6 - i) * DAY_MS);
  const waits = (from: number, to: number) =>
    log.filter((e) => e.at >= from && e.at < to && e.waitedMs !== null).map((e) => e.waitedMs!);
  return {
    handledToday: log.filter((e) => e.at >= today).length,
    medianTodayMs: median(waits(today, today + DAY_MS)),
    medianByDayMs: days.map((d) => median(waits(d, d + DAY_MS))),
    clearedThisWeek: clearedAt.filter((t) => t >= today - 6 * DAY_MS).length,
  };
}

/** Number of rows the Focus page would show right now — the nav badge. */
export function useFocusCount(): number {
  return useFocusStore((s) => visibleFocusItems(s, Date.now()).length);
}
