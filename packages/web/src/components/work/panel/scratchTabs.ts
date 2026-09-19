/**
 * Pure tab model for the Work view's Notes (scratchpad) panel. Mirrors the
 * session sidebar's SidebarTopPanel: one Global scratchpad plus one per repo
 * attached to the ticket. Kept free of React/stores so it can be unit-tested.
 */

/** Logical store key for the ticket-wide (non-repo) scratchpad. */
export const GLOBAL_KEY = '__global__';

export interface ScratchTab {
  /** Store key passed to the scratchpad store — '__global__' or 'org/name'. */
  key: string;
  /** Short label shown in the tab strip. */
  label: string;
}

/**
 * Build the tab list: Global first, then one tab per repo key (e.g. 'org/name'),
 * in the given order, deduped. A repo key that collides with the Global key is
 * ignored so Global is never duplicated.
 */
export function scratchTabs(repoKeys: string[]): ScratchTab[] {
  const seen = new Set<string>([GLOBAL_KEY]);
  const repoTabs: ScratchTab[] = [];
  for (const key of repoKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    repoTabs.push({ key, label: key.split('/').pop() || key });
  }
  return [{ key: GLOBAL_KEY, label: 'Global' }, ...repoTabs];
}

/**
 * Resolve the effective active tab: the persisted key if it still maps to a
 * tab, otherwise Global (a repo may have been detached since we last saved).
 */
export function resolveActiveScratchTab(tabs: ScratchTab[], persisted: string | undefined): string {
  if (persisted && tabs.some((t) => t.key === persisted)) return persisted;
  return GLOBAL_KEY;
}
