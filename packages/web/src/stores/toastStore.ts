import { create } from 'zustand';

export type ToastType = 'error' | 'warning' | 'success' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 5_000;
const DEDUP_WINDOW_MS = 10_000;

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (type, message) => {
    const now = Date.now();
    const { toasts } = get();

    // Dedup: skip if same message exists within the last 10s
    const isDuplicate = toasts.some(
      (t) => t.message === message && now - t.createdAt < DEDUP_WINDOW_MS,
    );
    if (isDuplicate) return;

    const id = String(++nextId);
    const toast: Toast = { id, type, message, createdAt: now };

    set((state) => ({
      toasts: [...state.toasts.slice(-(MAX_TOASTS - 1)), toast],
    }));

    // Auto-dismiss
    setTimeout(() => {
      get().removeToast(id);
    }, AUTO_DISMISS_MS);
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
