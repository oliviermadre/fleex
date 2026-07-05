import { die, c } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import {
  DELIVERABLE_RENDERERS,
  DELIVERABLE_COLOR_PRESETS,
} from '@fleex/shared';
import type { DeliverableTypeDef, DeliverableRenderer, DeliverableTypeColor } from '@fleex/shared';

/** Full view returned by the deliverable-types API: configured types + usage counts. */
export interface DeliverableTypesView {
  types: DeliverableTypeDef[];
  usage: Record<string, number>;
}

/** Fetch the workspace's configured deliverable types + usage counts. */
export async function fetchDeliverableTypes(): Promise<DeliverableTypesView> {
  return apiGet<DeliverableTypesView>(`${apiBase()}/api/deliverable-types`);
}

/**
 * Resolve a deliverable-type reference to its definition. Ids are stable slugs
 * (not UUIDs), so this is an exact, case-insensitive id match. A missing type is
 * surfaced with the list of valid ids rather than guessed — editing/deleting the
 * wrong type would silently reshape every deliverable of that kind.
 */
export async function resolveDeliverableType(input: string): Promise<DeliverableTypeDef> {
  const { types } = await fetchDeliverableTypes();
  const wanted = input.trim().toLowerCase();
  const match = types.find((t) => t.id.toLowerCase() === wanted);
  if (match) return match;
  die(
    `No deliverable type matches "${input}". Configured types: ${
      types.map((t) => t.id).join(', ') || '(none)'
    }.`,
  );
}

export function assertValidRenderer(renderer: string): asserts renderer is DeliverableRenderer {
  if (!(DELIVERABLE_RENDERERS as readonly string[]).includes(renderer)) {
    die(`Invalid renderer: ${renderer} (valid: ${DELIVERABLE_RENDERERS.join(', ')})`);
  }
}

/** Valid preset colour keys (gray, red, blue, …). */
export const COLOR_KEYS = DELIVERABLE_COLOR_PRESETS.map((p) => p.key);

/**
 * Map a preset colour key to a concrete `{bg, text}` pair. Unknown keys are
 * rejected with the list of valid keys rather than silently ignored.
 */
export function resolveColor(key: string): DeliverableTypeColor {
  const preset = DELIVERABLE_COLOR_PRESETS.find((p) => p.key === key.trim().toLowerCase());
  if (!preset) {
    die(`Invalid colour: ${key} (valid: ${COLOR_KEYS.join(', ')})`);
  }
  return { bg: preset.bg, text: preset.text };
}

/** Shared column header for `list`. */
export function typeLine(t: DeliverableTypeDef, usage: Record<string, number>): string {
  const id = t.id.slice(0, 24).padEnd(24);
  const label = (t.label ?? '-').slice(0, 20).padEnd(20);
  const renderer = (t.renderer ?? '-').padEnd(10);
  const count = String(usage[t.id] ?? 0).padStart(5);
  const flags = t.system ? c.dim(' (system)') : '';
  return `  ${id} ${label} ${renderer} ${count}${flags}`;
}
