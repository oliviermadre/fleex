import { create } from 'zustand';

export type ToastType = 'error' | 'warning' | 'success' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
  /** Secondary line, rendered monospace (e.g. the first line of stderr). */
  detail?: string;
  /** One inline button — "Undo", "View logs". Clicking it also dismisses the toast. */
  action?: ToastAction;
}

export interface ToastOptions {
  detail?: string;
  action?: ToastAction;
  /** Override the auto-dismiss delay (an undo window needs longer than 5 s). */
  durationMs?: number;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 5_000;
const DEDUP_WINDOW_MS = 10_000;

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, options?: ToastOptions) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (type, message, options) => {
    const now = Date.now();
    const { toasts } = get();

    // Dedup: skip if same message exists within the last 10s
    const isDuplicate = toasts.some(
      (t) => t.message === message && now - t.createdAt < DEDUP_WINDOW_MS,
    );
    if (isDuplicate) return;

    const id = String(++nextId);
    const toast: Toast = {
      id,
      type,
      message,
      createdAt: now,
      ...(options?.detail ? { detail: options.detail } : {}),
      ...(options?.action ? { action: options.action } : {}),
    };

    set((state) => ({
      toasts: [...state.toasts.slice(-(MAX_TOASTS - 1)), toast],
    }));

    // Auto-dismiss
    setTimeout(() => {
      get().removeToast(id);
    }, options?.durationMs ?? AUTO_DISMISS_MS);
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
