import type { TabKindDefinition } from './types';

const kinds: Record<string, TabKindDefinition> = {};

/**
 * Register a tab kind plugin. Call at module scope in each kind file.
 * Duplicate registrations for the same kind will overwrite silently.
 */
export function registerTabKind(kind: string, definition: TabKindDefinition): void {
  kinds[kind] = definition;
}

/** Look up a registered tab kind by its identifier. */
export function getTabKind(kind: string): TabKindDefinition | undefined {
  return kinds[kind];
}
