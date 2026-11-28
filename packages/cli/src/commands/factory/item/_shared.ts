import { die } from '../../../core/colors.ts';

export const ITEM_SOURCES = ['slack', 'gmail', 'github', 'manual'] as const;

/** An item as the Factory keeps it (`GET /api/factory/items/:id`), on the floor or archived. */
export interface ItemRow {
  id: string; source: string; sourceKey: string; title: string; author: string; excerpt: string; url: string | null; tags: string[];
  fields: Record<string, string | string[] | boolean>; messages: number; lastActivityAt: string; intakeId: string | null;
  machineId: string | null; archivedAt: string | null; archivedReason: 'junk' | 'exit' | 'dropped' | null; createdAt: string;
}

/**
 * `--field key=value` pairs as an item's source fields: `true` and `false` are yes and no, a value with commas is a
 * list (Gmail's labels), anything else is text.
 */
export function parseFields(pairs: readonly string[] | undefined): Record<string, string | string[] | boolean> | undefined {
  if (!pairs?.length) return undefined;
  const out: Record<string, string | string[] | boolean> = {};
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i <= 0) die(`Invalid --field "${pair}" (expected key=value, e.g. channel=#ops)`);
    const key = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    out[key] = value === 'true' ? true : value === 'false' ? false : value.includes(',') ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;
  }
  return out;
}
