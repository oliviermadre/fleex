/**
 * Copy for the surfaces gated behind a server capability.
 *
 * Every gated surface (Primitives sidebar, workflow editor route, ticket
 * Workflow tab, mention chips…) pulls its wording from here so the explanation
 * a user reads is always the same one, whichever door they knocked on.
 */

/** Storage drivers that DO support workflows — mirrors the server referential. */
const WORKFLOW_CAPABLE_DRIVERS = 'sqlite, pgsql ou supabase';

export const WORKFLOWS_UNAVAILABLE_TITLE = 'Workflows indisponibles sur ce driver';

/** Body of the explanation. `driver` is null while capabilities are unknown. */
export function workflowsUnavailableDetail(driver: string | null): string {
  const storage = driver ? `Le stockage ${driver}` : 'Le stockage actuel';
  return `${storage} ne supporte pas les workflows. Basculez sur ${WORKFLOW_CAPABLE_DRIVERS} pour activer cette fonctionnalité.`;
}

/** Single-line variant for the `title=` tooltip of a disabled control. */
export function workflowsUnavailableTooltip(driver: string | null): string {
  return `${WORKFLOWS_UNAVAILABLE_TITLE} — ${workflowsUnavailableDetail(driver)}`;
}
