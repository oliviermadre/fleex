import * as api from '../services/api';
import { useSessionStore } from '../stores/sessionStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Open a new system shell (no ticket, no worktree) as a floating terminal.
 * System shells have no home in the ticket-centred Work view, so the overlay is
 * where they live. Used by Alt+T and the palette's "New system shell".
 */
export async function openSystemShell(basePath: string | undefined): Promise<void> {
  try {
    const session = await api.createSession({ cwd: basePath || '~', type: 'shell' });
    useSessionStore.getState().addSessionToGroup(session);
    useUIStore.getState().addFloatingSession(session.id);
    api.fetchSessionGroups().then(useSessionStore.getState().setSessionGroups).catch(() => {});
  } catch {
    /* silently fail, as before */
  }
}
