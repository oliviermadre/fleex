import type { Routine, RoutineTarget, RoutineTrigger } from '@fleex/shared';
import { die } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';

/** A routine as the list endpoint returns it — DTO + its active run's state. */
export interface RoutineListItem extends Routine {
  activeRunId: string | null;
  activeRunStatus: string | null;
  awaitingAttention: boolean;
}

export function fetchRoutines(): Promise<RoutineListItem[]> {
  return apiGet<RoutineListItem[]>(`${apiBase()}/api/routines`);
}

/**
 * Resolve a routine reference to its row.
 *
 * The slug is the routine's permalink — it is what the web URL uses, so the CLI
 * accepts the same thing rather than forcing a UUID copy/paste. A full UUID and
 * a case-insensitive name also work, in that order of precedence.
 */
export async function resolveRoutine(ref: string): Promise<RoutineListItem> {
  const needle = ref.trim().toLowerCase();
  if (!needle) die('A routine slug is required.');

  const routines = await fetchRoutines();
  const found = routines.find((r) => r.id === ref)
    ?? routines.find((r) => r.slug.toLowerCase() === needle)
    ?? routines.find((r) => r.name.toLowerCase() === needle);
  if (!found) die(`No routine matches "${ref}". Run \`fleex routine list\` to see them.`);
  return found;
}

/** "cron · 0 9 * * * (Europe/Paris)" — the schedule in one readable cell. */
export function describeTrigger(trigger: RoutineTrigger): string {
  if (trigger.kind === 'manual') return 'manual';
  if (trigger.kind === 'once') return `once · ${trigger.runAt} (${trigger.timezone})`;
  return `cron · ${trigger.cron} (${trigger.timezone})`;
}

/** "workflow · <template id>" / "agent · builder" — the target in one cell. */
export function describeTarget(target: RoutineTarget): string {
  return `${target.kind} · ${target.ref}`;
}

export function shortTrigger(trigger: RoutineTrigger): string {
  if (trigger.kind === 'manual') return 'manual';
  if (trigger.kind === 'once') return 'once';
  return trigger.cron;
}
