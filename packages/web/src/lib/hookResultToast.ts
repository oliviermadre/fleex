import { useToastStore } from '../stores/toastStore';

/**
 * Show an informational toast when a post-checkout hook has been started.
 * The hook runs asynchronously on the server — this is purely a "started" notification.
 */
export function notifyHookStarted(hookStarted?: boolean): void {
  if (!hookStarted) return;

  useToastStore.getState().addToast(
    'info',
    'Post-checkout hook running...',
  );
}
