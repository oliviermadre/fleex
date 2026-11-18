import { TICKET_COMPLEXITIES, TICKET_PRIORITIES, TICKET_TYPES, type TicketStatus } from '@fleex/shared';
import { applyTag, TAG_OPS, type TagOp } from './tags.js';
import type { FactoryTicketInfo } from './types.js';

/**
 * What a Set gantry does to a ticket that goes under it: a list of plain changes, applied in order, with no agent.
 * Only what cannot fail is here (fields of the ticket itself, and its tags); what can fail, such as attaching a
 * worktree, needs a station with two ways out. Pure functions: the engine applies them, the layout check keeps
 * only what makes sense.
 */
export type SetField = 'status' | 'priority' | 'type' | 'complexity' | 'board' | 'favorite' | 'blocked';
export type SetOp = { field: SetField; value: string } | { field: 'tag'; op: TagOp; value: string };

/** The statuses a gantry can set: `done` is the exit's, which also hands the ticket back. */
export const SET_STATUSES: readonly TicketStatus[] = ['backlog', 'todo', 'doing', 'reviewing'];
export const NO_VALUE = 'none';
const ALLOWED: Record<SetField, (v: string) => boolean> = {
  status: (v) => (SET_STATUSES as readonly string[]).includes(v),
  priority: (v) => (TICKET_PRIORITIES as readonly string[]).includes(v),
  type: (v) => v === NO_VALUE || (TICKET_TYPES as readonly string[]).includes(v),
  complexity: (v) => v === NO_VALUE || (TICKET_COMPLEXITIES as readonly string[]).includes(v),
  board: (v) => v.length > 0 && v.length <= 80,
  favorite: (v) => v === 'true' || v === 'false',
  blocked: (v) => v === 'true' || v === 'false',
};
export const MAX_OPS = 12;

/** Keep the operations that can be applied; drop the rest. */
export function normaliseOps(raw: unknown): SetOp[] {
  const out: SetOp[] = [];
  for (const o of (Array.isArray(raw) ? raw : []) as Partial<SetOp & { op: string }>[]) {
    const value = typeof o?.value === 'string' ? o.value.trim() : '';
    if (o?.field === 'tag') { if (value && value.length <= 80 && (TAG_OPS as readonly string[]).includes(String(o.op))) out.push({ field: 'tag', op: o.op as TagOp, value }); }
    else if (o?.field && o.field in ALLOWED && ALLOWED[o.field as SetField](value)) out.push({ field: o.field as SetField, value });
  }
  return out.slice(0, MAX_OPS);
}

/** What has to be written on the ticket: a status goes by the ordinary move, the rest as fields. */
export interface TicketChange {
  status?: TicketStatus;
  fields: { priority?: string; type?: string | null; complexity?: string | null; boardId?: string; favorite?: boolean; blocked?: boolean; tags?: string[] };
}
/** Apply the operations, in order, to what is known of a ticket. `change` is null when they change nothing. */
export function applyOps(info: FactoryTicketInfo, ops: readonly SetOp[]): { info: FactoryTicketInfo; change: TicketChange | null } {
  let next = info, tags: readonly string[] = info.tags;
  const fields: TicketChange['fields'] = {};
  let status: TicketStatus | undefined;
  for (const o of ops) {
    if (o.field === 'tag') { tags = applyTag(tags, o.op, o.value); continue; }
    const v = o.value;
    if (o.field === 'status') { if (next.status !== v) { status = v as TicketStatus; next = { ...next, status: status }; } }
    else if (o.field === 'priority') { if (next.priority !== v) { fields.priority = v; next = { ...next, priority: v }; } }
    else if (o.field === 'type') { const to = v === NO_VALUE ? '' : v; if (next.type !== to) { fields.type = to || null; next = { ...next, type: to }; } }
    else if (o.field === 'complexity') { const to = v === NO_VALUE ? null : v; if (next.complexity !== to) { fields.complexity = to; next = { ...next, complexity: to as FactoryTicketInfo['complexity'] }; } }
    else if (o.field === 'board') { if (next.boardId !== v) { fields.boardId = v; next = { ...next, boardId: v }; } }
    else if (o.field === 'favorite') { const to = v === 'true'; if (next.favorite !== to) { fields.favorite = to; next = { ...next, favorite: to }; } }
    else if (o.field === 'blocked') { const to = v === 'true'; if (next.blocked !== to) { fields.blocked = to; next = { ...next, blocked: to }; } }
  }
  if (tags !== info.tags) { fields.tags = [...tags]; next = { ...next, tags: [...tags] }; }
  const changed = status !== undefined || Object.keys(fields).length > 0;
  return { info: changed ? next : info, change: changed ? { ...(status ? { status } : {}), fields } : null };
}
