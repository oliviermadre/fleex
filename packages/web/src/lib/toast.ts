import { useEffect } from 'react';
import { useToastStore, type ToastInput } from '../stores/toastStore';

/**
 * Fleex has ONE toast — this module is its only entry point.
 *
 *   import { toast } from '../lib/toast';
 *   toast.error('Request failed (500)', { detail: 'POST /api/tickets' });
 *   toast.info('"Build" deleted', { action: { label: 'Undo', onClick: restore } });
 *
 * Rendered by `<Toaster/>` (components/ui/toast), mounted once in App.tsx,
 * bottom-centre. Works outside React (stores, services/api.ts).
 *
 * Missing something (a new option, a new look)? Extend `ToastInput` here and
 * render it in `Toaster.tsx`. Never build another toast/snackbar/floating
 * notice — `architecture/toasts.guard.test.ts` fails the build if you do.
 * See docs/adr/0001-single-toast.md.
 */

export type { ToastInput, ToastTone, ToastAction, ToastDismissReason } from '../stores/toastStore';

type ToneOptions = Omit<ToastInput, 'message' | 'tone'>;

export const toast = {
  /** Show a toast; returns its id (the existing one when deduplicated or updated in place). */
  show: (input: ToastInput): string => useToastStore.getState().show(input),
  info: (message: string, opts?: ToneOptions): string => toast.show({ ...opts, message, tone: 'info' }),
  success: (message: string, opts?: ToneOptions): string => toast.show({ ...opts, message, tone: 'success' }),
  warning: (message: string, opts?: ToneOptions): string => toast.show({ ...opts, message, tone: 'warning' }),
  error: (message: string, opts?: ToneOptions): string => toast.show({ ...opts, message, tone: 'error' }),
  /** Remove a toast early. Safe when it is already gone. */
  dismiss: (id: string): void => useToastStore.getState().dismiss(id, 'programmatic'),
};

/**
 * Layout hook: while mounted with a non-zero `px`, lifts the toast stack by
 * `px` (e.g. above a sticky action bar). The last mounted offset wins. This is
 * the ONLY way to move the toasts — callers of `toast()` never choose a position.
 */
export function useToastOffset(px: number): void {
  useEffect(() => {
    if (!px) return;
    const { pushOffset, popLayout } = useToastStore.getState();
    const key = pushOffset(px);
    return () => popLayout(key);
  }, [px]);
}

/**
 * Layout hook: while mounted with `'top'`, anchors the stack top-centre (e.g.
 * a mobile bottom sheet covers the bottom). Pass `null` to release.
 */
export function useToastAnchor(anchor: 'top' | null): void {
  useEffect(() => {
    if (!anchor) return;
    const { pushAnchor, popLayout } = useToastStore.getState();
    const key = pushAnchor(anchor);
    return () => popLayout(key);
  }, [anchor]);
}
