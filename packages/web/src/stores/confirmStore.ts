import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  /** Short title summarising the action (e.g. "Delete board"). */
  title: string;
  /** Detailed message shown in the modal body. */
  message?: ReactNode;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Render the confirm button in the destructive (red) style. Defaults to true. */
  danger?: boolean;
}

interface ConfirmState {
  request: ConfirmOptions | null;
  resolve: ((confirmed: boolean) => void) | null;
  /** Opens the confirmation modal and resolves to the user's choice. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

/**
 * Promise-based replacement for the native `confirm()`. Backing store for
 * `useConfirm()` / `<ConfirmModalHost />` — a single modal is shown at a time
 * and the promise resolves `true` (confirm) or `false` (cancel/Escape/backdrop).
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  resolve: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      // If a confirmation is already pending, cancel it before showing the next.
      get().resolve?.(false);
      set({ request: options, resolve });
    }),
  handleConfirm: () => {
    get().resolve?.(true);
    set({ request: null, resolve: null });
  },
  handleCancel: () => {
    get().resolve?.(false);
    set({ request: null, resolve: null });
  },
}));
