import { TICKET_COMPLEXITIES, TICKET_PRIORITIES } from '@fleex/shared';
import type { ArmCondition, ArmField, ArmOp, ArmSpec, FactoryTicketInfo } from './types.js';

/**
 * What an arm lets through. An arm carries a list of conditions and takes a
 * ticket when all of them hold; with no condition it takes what its neighbours'
 * conditions leave. Pure functions: the engine routes with them, the layout
 * check validates with them.
 */

/** The outcome a run gets when the agent asks a question instead of answering. */
export const QUESTION_OUTCOME = 'question';
/** Stands for "no type", "no priority" and "not estimated" in a condition's values. */
export const NONE = 'none';

const ORDERED: ArmOp[] = ['is', 'is_not', 'gte', 'lte', 'gt', 'lt', 'between'];
const PLAIN: ArmOp[] = ['is', 'is_not'];
/** Which operators make sense on which field: only priority and complexity have an order. */
export const OPS_BY_FIELD: Record<ArmField, readonly ArmOp[]> = {
  type: PLAIN, board: PLAIN, favorite: PLAIN, tag: PLAIN, outcome: PLAIN, priority: ORDERED, complexity: ORDERED,
};

const SCALES: Partial<Record<ArmField, readonly string[]>> = { priority: TICKET_PRIORITIES, complexity: TICKET_COMPLEXITIES };

/** An arm's conditions, read from the current shape or from the single `filter` older floors were saved with. */
export function conditionsOf(arm: ArmSpec): ArmCondition[] {
  if (Array.isArray(arm.when)) return arm.when;
  const f = arm.filter;
  return f && Array.isArray(f.values) && f.values.length ? [{ field: f.field as ArmField, op: 'is', values: f.values }] : [];
}

/** Keep what can be evaluated, drop the rest: an unknown field, an operator the field has no use for, a condition with nothing to compare to. */
export function normaliseConditions(arm: ArmSpec): ArmCondition[] {
  const out: ArmCondition[] = [];
  for (const raw of conditionsOf(arm)) {
    const ops = OPS_BY_FIELD[raw?.field];
    if (!ops) continue;
    const op: ArmOp = ops.includes(raw.op) ? raw.op : 'is';
    let values = (Array.isArray(raw.values) ? raw.values : []).map((v) => String(v).trim()).filter(Boolean);
    if (raw.field === 'favorite') values = ['true'];
    if (op !== 'is' && op !== 'is_not') values = values.slice(0, op === 'between' ? 2 : 1);
    if (!values.length || (op === 'between' && values.length < 2)) continue;
    out.push({ field: raw.field, op, values: [...new Set(values)] });
  }
  return out.slice(0, 8);
}

function ordered(field: ArmField, op: ArmOp, value: string, values: string[]): boolean {
  const scale = SCALES[field] ?? [];
  /* "no priority" is the bottom of its scale; "not estimated" is on no scale at all, so it is neither above nor below anything */
  const rank = (v: string) => scale.indexOf(v), at = rank(value), a = rank(values[0] ?? ''), b = rank(values[1] ?? '');
  if (at < 0 || a < 0) return false;
  switch (op) {
    case 'gte': return at >= a;
    case 'lte': return at <= a;
    case 'gt': return at > a;
    case 'lt': return at < a;
    case 'between': return b >= 0 && at >= Math.min(a, b) && at <= Math.max(a, b);
    default: return false;
  }
}

export function holds(c: ArmCondition, info: FactoryTicketInfo | null, outcome: string): boolean {
  const not = c.op === 'is_not';
  if (c.field === 'outcome') return c.values.includes(outcome) !== not;
  if (!info) return false;
  if (c.field === 'favorite') return info.favorite !== not;
  if (c.field === 'tag') return info.tags.some((tag) => c.values.includes(tag)) !== not;
  if (c.field === 'board') return c.values.includes(info.boardId) !== not;
  const value = c.field === 'type' ? info.type || NONE : c.field === 'priority' ? info.priority || NONE : info.complexity ?? NONE;
  if (c.op === 'is' || c.op === 'is_not') return c.values.includes(value) !== not;
  return ordered(c.field, c.op, value, c.values);
}

/** True when every condition holds. An arm with no condition matches everything. */
export const matches = (arm: ArmSpec, info: FactoryTicketInfo | null, outcome: string): boolean => conditionsOf(arm).every((c) => holds(c, info, outcome));
export const isConditional = (arm: ArmSpec): boolean => conditionsOf(arm).length > 0;

/**
 * Whether an arm is the way out for a given outcome of its station: it has at
 * least one condition on the outcome, and they all accept this one. Used to tell
 * an agent where each of its answers leads.
 */
export function acceptsOutcome(arm: ArmSpec, outcome: string): boolean {
  const on = conditionsOf(arm).filter((c) => c.field === 'outcome');
  return on.length > 0 && on.every((c) => holds(c, null, outcome));
}

/** Only an arm that explicitly asks for `question` takes a ticket whose agent asked one: "is not bug" does not. */
export const takesQuestions = (arm: ArmSpec): boolean => conditionsOf(arm).some((c) => c.field === 'outcome' && c.op === 'is' && c.values.includes(QUESTION_OUTCOME));
