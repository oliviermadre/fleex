import { useEffect } from 'react';
import { appWs } from '../services/websocket';
import { useRoutineStore } from '../stores/routineStore';

/**
 * Which routine, if any, a `tickets`-channel message concerns.
 *
 * Exported for testing: this predicate is the whole reactivity contract of the
 * Routines screen, and it is far too easy to break by widening it (every ticket
 * event then refetches the routine list) or narrowing it (the screen goes stale
 * again for that transition).
 */
export function routineIdForMessage(raw: { type: string; data: unknown }): string | null {
  if (!raw.type.startsWith('workflow:') && !raw.type.startsWith('routine:')) return null;
  const routineId = (raw.data as { routineId?: string | null } | null)?.routineId;
  // No routine anchor ⇒ a ticket run. The ticket views own that one.
  return routineId ?? null;
}

/**
 * Keeps everything routine-shaped live: the nav badge, the list rows ("waiting"),
 * and the open routine's run history (DAG, step statuses, gate panels).
 *
 * A routine run has no ticket, so it is invisible to every ticket-scoped
 * subscription in the app. Until the server started stamping `routineId` on the
 * `workflow:*` pushes, nothing on this screen could know a step had finished or
 * a gate had opened — the only way to see it was to reload the page, which is
 * exactly the complaint this fixes.
 *
 * Mounted by the nav sidebar (always rendered) rather than by /routines: the
 * badge must light up while the user is looking at another screen, which is the
 * whole point of having a badge.
 */
export function useRoutineLiveUpdates(): void {
  useEffect(() => {
    // A single step transition produces a burst (step_completed → step_started
    // → …). Coalesce it: one list reload and one runs reload per burst instead
    // of one fetch per event.
    let listTimer: ReturnType<typeof setTimeout> | null = null;
    let runsTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleList = () => {
      if (listTimer) return;
      listTimer = setTimeout(() => {
        listTimer = null;
        void useRoutineStore.getState().load();
      }, 120);
    };
    const scheduleRuns = () => {
      if (runsTimer) return;
      runsTimer = setTimeout(() => {
        runsTimer = null;
        void useRoutineStore.getState().refreshRuns();
      }, 120);
    };

    const unsub = appWs.onChannel('tickets', (raw) => {
      const routineId = routineIdForMessage(raw);
      if (!routineId) return;

      scheduleList();
      if (useRoutineStore.getState().selectedId === routineId) scheduleRuns();
    });

    return () => {
      if (listTimer) clearTimeout(listTimer);
      if (runsTimer) clearTimeout(runsTimer);
      unsub();
    };
  }, []);
}
