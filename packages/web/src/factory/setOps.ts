/**
 * What a Set gantry does to a ticket, as the page needs it: the fields it can set, the words for each operation
 * (short enough to be read on the floor), and what an operation still lacks. The engine applies them (`set-ops.ts`
 * on the server); this only lists and describes.
 */
import { TICKET_COMPLEXITIES, TICKET_PRIORITIES, TICKET_TYPE_LABELS, TICKET_TYPES } from '@fleex/shared';
import { tagKey, type TagOp } from './tags';

export type SetField = 'status' | 'priority' | 'type' | 'complexity' | 'board' | 'favorite' | 'blocked';
export type SetOp = { field: SetField; value: string } | { field: 'tag'; op: TagOp; value: string };
export type AnyField = SetField | 'tag';

export const NO_VALUE = 'none';
export const SET_FIELDS: readonly AnyField[] = ['status', 'priority', 'type', 'complexity', 'board', 'favorite', 'blocked', 'tag'];
export const SET_FIELD_LABEL: Record<AnyField, string> = { status: 'Status', priority: 'Priority', type: 'Type', complexity: 'Complexity', board: 'Board', favorite: 'Favourite', blocked: 'Blocked', tag: 'Tag' };
export const TAG_OP_LABEL: Record<TagOp, string> = { add: 'add', remove: 'remove', set: 'set key:value', inc: 'add 1 to key', clear: 'remove key' };
export const TAG_OP_HINT: Record<TagOp, string> = { add: 'a tag', remove: 'a tag', set: 'key:value', inc: 'key', clear: 'key' };

export interface Choice { value: string; label: string }
/** What a field can be set to, when the list is finite (a tag is free text). */
export function choicesFor(field: AnyField, boards: readonly { id: string; name: string }[]): Choice[] | null {
  switch (field) {
    case 'status': return ['backlog', 'todo', 'doing', 'reviewing'].map((v) => ({ value: v, label: v }));
    case 'priority': return [...TICKET_PRIORITIES].reverse().map((v) => ({ value: v as string, label: v === 'none' ? 'no priority' : v }));
    case 'type': return [...TICKET_TYPES.map((v) => ({ value: v as string, label: TICKET_TYPE_LABELS[v] ?? v })), { value: NO_VALUE, label: 'no type' }];
    case 'complexity': return [...TICKET_COMPLEXITIES.map((v) => ({ value: v as string, label: v === 'inf' ? '∞' : `${v} pts` })), { value: NO_VALUE, label: 'not estimated' }];
    case 'board': return boards.map((b) => ({ value: b.id, label: b.name }));
    case 'favorite': return [{ value: 'true', label: 'a favourite' }, { value: 'false', label: 'not a favourite' }];
    case 'blocked': return [{ value: 'true', label: 'blocked' }, { value: 'false', label: 'not blocked' }];
    default: return null;
  }
}
/** A new operation on a field, ready to be filled in. */
export function blankOp(field: AnyField, boards: readonly { id: string; name: string }[]): SetOp {
  if (field === 'tag') return { field: 'tag', op: 'add', value: '' };
  return { field, value: choicesFor(field, boards)?.[0]?.value ?? '' };
}
/** An operation the engine would drop: it has nothing to set yet, or a `key:value` that is not one. */
export const incompleteOp = (o: SetOp): boolean => !o.value.trim() || (o.field === 'tag' && o.op === 'set' && tagKey(o.value.trim()) === null);

/** An operation in a few characters, as written on the gantry's plate. */
export function opText(o: SetOp, boardName: (id: string) => string = (id) => id): string {
  const v = o.value.trim();
  if (o.field === 'tag') {
    const key = tagKey(v) ?? v;
    return o.op === 'add' ? `+ ${v}` : o.op === 'remove' ? `− ${v}` : o.op === 'set' ? v : o.op === 'inc' ? `${key} +${tagKey(v) ? v.slice(key.length + 1) || 1 : 1}` : `${key} ✕`;
  }
  if (o.field === 'favorite') return v === 'true' ? '★ favourite' : 'not favourite';
  if (o.field === 'blocked') return v === 'true' ? 'blocked' : 'not blocked';
  if (o.field === 'board') return `board → ${boardName(v)}`;
  if (o.field === 'type') return v === NO_VALUE ? 'no type' : `type → ${v}`;
  if (o.field === 'complexity') return v === NO_VALUE ? 'not estimated' : `complexity → ${v}`;
  return `${o.field} → ${v}`;
}
/** The lines of a plate: the first `max` of them, then how many more there are. */
export function plateLines(lines: readonly string[], max = 4): string[] {
  return lines.length <= max ? [...lines] : [...lines.slice(0, max - 1), `+${lines.length - (max - 1)} more`];
}
