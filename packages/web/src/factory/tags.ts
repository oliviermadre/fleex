/**
 * Tags of the form `key:value`. A ticket carries at most one value per key: setting `type:major` replaces
 * `type:minor`. A key can be counted on (`passes:2`), which is how a loop is told to stop. Plain tags (no colon) are
 * left as they are. Pure functions: the engine changes tags with them, arms and tolls compare with them.
 */

/** The key of a `key:value` tag, or null for a plain tag. */
export function tagKey(tag: string): string | null {
  const i = tag.indexOf(':');
  return i > 0 ? tag.slice(0, i) : null;
}
/** The value a ticket's tags give a key, or null when no tag has that key. */
export function tagValue(tags: readonly string[], key: string): string | null {
  const prefix = `${key}:`, hit = tags.find((t) => t.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}
const num = (v: string | null): number | null => { if (v === null || v.trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export type TagOp = 'add' | 'remove' | 'set' | 'inc' | 'clear';
export const TAG_OPS: readonly TagOp[] = ['add', 'remove', 'set', 'inc', 'clear'];
/**
 * One change to a list of tags. `add` and `remove` take a whole tag; `set` takes `key:value` and replaces whatever
 * that key had; `inc` takes a key (or `key:n` to add n) and counts from 0 when the key is new or not a number;
 * `clear` takes a key and removes it. Returns the same array when nothing changes.
 */
export function applyTag(tags: readonly string[], op: TagOp, value: string): readonly string[] {
  const v = value.trim();
  if (!v) return tags;
  if (op === 'add') return tags.includes(v) ? tags : [...tags, v];
  if (op === 'remove') return tags.includes(v) ? tags.filter((t) => t !== v) : tags;
  const key = tagKey(v) ?? v, without = tags.filter((t) => tagKey(t) !== key);
  if (op === 'clear') return without.length === tags.length ? tags : without;
  if (op === 'set') { if (tagKey(v) === null || tags.includes(v)) return tags; return [...without, v]; }
  /* inc */
  const by = tagKey(v) === null ? 1 : num(v.slice(key.length + 1)) ?? 1;
  return [...without, `${key}:${(num(tagValue(tags, key)) ?? 0) + by}`];
}

export type TagCompare = 'is' | 'is_not' | 'gte' | 'lte' | 'gt' | 'lt';
/**
 * Compare the value of a key to something. As numbers when both are numbers, a key the ticket does not have counting
 * as 0 (a counter that has not started); otherwise as text, where only "is" and "is not" mean anything.
 */
export function compareTag(tags: readonly string[], key: string, op: TagCompare, to: string): boolean {
  const have = tagValue(tags, key), b = num(to), a = have === null ? (b === null ? null : 0) : num(have);
  if (a !== null && b !== null) return op === 'is' ? a === b : op === 'is_not' ? a !== b : op === 'gte' ? a >= b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a < b;
  if (op === 'is') return have === to;
  if (op === 'is_not') return have !== to;
  return false;
}
