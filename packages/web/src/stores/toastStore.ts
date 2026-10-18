import { create } from 'zustand';

/**
 * INTERNAL — the state behind Fleex's one toast surface.
 *
 * Do not import this module outside `lib/toast.ts` and `components/ui/toast/**`
 * (enforced by `architecture/toasts.guard.test.ts`, rule R1). Call
 * `toast.*()` from `lib/toast.ts` instead. See docs/adr/0001-single-toast.md.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error' | 'action';

export type ToastDismissReason = 'timeout' | 'close' | 'action' | 'click' | 'programmatic';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  message: string;
  /** Default `'info'`. `'action'` (purple) = "something needs you". */
  tone?: ToastTone;
  /** Optional bold first line. */
  title?: string;
  /** Secondary line, rendered monospace (e.g. the first line of stderr). */
  detail?: string;
  /** Emoji replacing the tone dot (Pulse notifications). */
  icon?: string;
  /** At most one inline button — "Undo", "View logs". Clicking it also dismisses the toast. */
  action?: ToastAction;
  /** In-app route: makes the whole card clickable (navigate, then dismiss). */
  link?: string;
  /** Auto-dismiss delay. `null` = persistent until closed. Default depends on the tone (see DEFAULT_DURATION_MS). */
  durationMs?: number | null;
  /** Hovering / focusing the toast pauses its countdown. Default `true`. */
  pauseOnHover?: boolean;
  /** Stable key: showing the same id again updates the toast in place (no duplicate). */
  id?: string;
  onDismiss?: (reason: ToastDismissReason) => void;
}

export interface ToastItem extends Omit<ToastInput, 'tone' | 'durationMs' | 'pauseOnHover' | 'id'> {
  id: string;
  tone: ToastTone;
  durationMs: number | null;
  pauseOnHover: boolean;
  createdAt: number;
  /** Bumped on every in-place update so the progress bar restarts. */
  version: number;
  paused: boolean;
}

export const MAX_VISIBLE_TOASTS = 3;
export const DEDUP_WINDOW_MS = 10_000;
export const DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  info: 5_000,
  success: 5_000,
  action: 5_000,
  warning: 8_000,
  error: 8_000,
};
/** An undo / "View logs" button needs time to be reached. */
export const MIN_ACTION_DURATION_MS = 8_000;

export function resolveDuration(input: ToastInput, tone: ToastTone): number | null {
  if (input.durationMs !== undefined) return input.durationMs;
  const base = DEFAULT_DURATION_MS[tone];
  return input.action ? Math.max(base, MIN_ACTION_DURATION_MS) : base;
}

interface LayoutEntry<T> {
  key: number;
  value: T;
}

interface ToastState {
  toasts: ToastItem[];
  /** Bottom offsets pushed by layouts (last mounted wins). */
  offsets: LayoutEntry<number>[];
  /** Top anchors pushed by layouts (any = anchored top). */
  anchors: LayoutEntry<'top'>[];

  show: (input: ToastInput) => string;
  dismiss: (id: string, reason?: ToastDismissReason) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  pushOffset: (px: number) => number;
  pushAnchor: (anchor: 'top') => number;
  popLayout: (key: number) => void;
}

/** Live countdown per toast: the timer and how much time it had left when (re)started. */
const timers = new Map<string, { handle: ReturnType<typeof setTimeout>; startedAt: number; remaining: number }>();

let nextId = 0;
let nextLayoutKey = 0;

export const useToastStore = create<ToastState>((set, get) => {
  const clearTimer = (id: string) => {
    const t = timers.get(id);
    if (t) clearTimeout(t.handle);
    timers.delete(id);
  };

  const startTimer = (id: string, ms: number) => {
    clearTimer(id);
    timers.set(id, {
      handle: setTimeout(() => get().dismiss(id, 'timeout'), ms),
      startedAt: Date.now(),
      remaining: ms,
    });
  };

  return {
    toasts: [],
    offsets: [],
    anchors: [],

    show: (input) => {
      const now = Date.now();
      const { toasts } = get();

      // Dedup: a plain toast repeating a recent visible one is dropped (API
      // errors in bursts). A toast with an id or an action is never a
      // duplicate: it is either an explicit update or acts on its own event.
      if (!input.id && !input.action) {
        const dup = toasts.find((t) => t.message === input.message && now - t.createdAt < DEDUP_WINDOW_MS);
        if (dup) return dup.id;
      }

      const tone = input.tone ?? 'info';
      const id = input.id ?? `toast-${++nextId}`;
      const existing = toasts.find((t) => t.id === id);
      const { tone: _t, durationMs: _d, pauseOnHover: _p, id: _i, ...rest } = input;
      const item: ToastItem = {
        ...rest,
        id,
        tone,
        durationMs: resolveDuration(input, tone),
        pauseOnHover: input.pauseOnHover ?? true,
        createdAt: now,
        version: (existing?.version ?? 0) + 1,
        paused: false,
      };

      let evicted: ToastItem[] = [];
      if (existing) {
        set({ toasts: toasts.map((t) => (t.id === id ? item : t)) });
      } else {
        const next = [...toasts, item];
        evicted = next.slice(0, Math.max(0, next.length - MAX_VISIBLE_TOASTS));
        set({ toasts: next.slice(-MAX_VISIBLE_TOASTS) });
      }
      for (const old of evicted) {
        clearTimer(old.id);
        old.onDismiss?.('programmatic');
      }

      if (item.durationMs === null) clearTimer(id);
      else startTimer(id, item.durationMs);
      return id;
    },

    dismiss: (id, reason = 'programmatic') => {
      const target = get().toasts.find((t) => t.id === id);
      if (!target) return;
      clearTimer(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      target.onDismiss?.(reason);
    },

    pause: (id) => {
      const target = get().toasts.find((t) => t.id === id);
      const t = timers.get(id);
      if (!target || !t || !target.pauseOnHover || target.paused) return;
      clearTimeout(t.handle);
      timers.set(id, { ...t, remaining: Math.max(0, t.remaining - (Date.now() - t.startedAt)) });
      set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, paused: true } : x)) }));
    },

    resume: (id) => {
      const target = get().toasts.find((t) => t.id === id);
      const t = timers.get(id);
      if (!target || !t || !target.paused) return;
      startTimer(id, t.remaining);
      set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, paused: false } : x)) }));
    },

    pushOffset: (px) => {
      const key = ++nextLayoutKey;
      set((s) => ({ offsets: [...s.offsets, { key, value: px }] }));
      return key;
    },

    pushAnchor: (anchor) => {
      const key = ++nextLayoutKey;
      set((s) => ({ anchors: [...s.anchors, { key, value: anchor }] }));
      return key;
    },

    popLayout: (key) => {
      set((s) => ({
        offsets: s.offsets.filter((o) => o.key !== key),
        anchors: s.anchors.filter((a) => a.key !== key),
      }));
    },
  };
});

/** Test seam: drop every toast, timer and layout entry. */
export function resetToasts(): void {
  for (const t of timers.values()) clearTimeout(t.handle);
  timers.clear();
  useToastStore.setState({ toasts: [], offsets: [], anchors: [] });
}
