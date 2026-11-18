/**
 * What an arm lets through, as the page needs it: reading an arm's conditions,
 * naming them, and listing what each field can be compared to. The engine
 * decides what a ticket does (`conditions.ts` on the server); this only reads
 * and describes.
 */
import { TICKET_COMPLEXITIES, TICKET_PRIORITIES, TICKET_TYPE_LABELS, TICKET_TYPES } from '@fleex/shared';
import { QUESTION_OUTCOME, type ArmCondition, type ArmField, type ArmOp, type ArmSpec, type FactoryLayout, type FactoryTicketInfo } from './types';

export const NONE = 'none';

/** An arm's conditions, from the current shape or from the single `filter` of older floors. */
export function conditionsOf(arm: ArmSpec): ArmCondition[] {
  if (Array.isArray(arm.when)) return arm.when;
  const f = arm.filter;
  return f && Array.isArray(f.values) && f.values.length ? [{ field: f.field as ArmField, op: 'is', values: f.values }] : [];
}
export const isConditional = (arm: ArmSpec): boolean => conditionsOf(arm).length > 0;
/**
 * The colour of an arm, of its quay and of the arrow under it: the one it was given by hand, or its own, which says
 * whether it sorts (`sorts`, amber) or takes whatever comes (`plain`, grey).
 */
export const armColor = (arm: ArmSpec, own: { plain: string; sorts: string }): string => (arm.color && /^#[0-9a-f]{6}$/i.test(arm.color) ? arm.color : isConditional(arm) ? own.sorts : own.plain);

/** Whether an arm is the way out for an outcome of its station: it asks about the outcome, and accepts this one. */
export function acceptsOutcome(arm: ArmSpec, outcome: string): boolean {
  const on = conditionsOf(arm).filter((c) => c.field === 'outcome');
  return on.length > 0 && on.every((c) => c.values.includes(outcome) !== (c.op === 'is_not'));
}
export const takesQuestions = (arm: ArmSpec): boolean => conditionsOf(arm).some((c) => c.field === 'outcome' && c.op === 'is' && c.values.includes(QUESTION_OUTCOME));

const SCALES: Partial<Record<ArmField, readonly string[]>> = { priority: TICKET_PRIORITIES, complexity: TICKET_COMPLEXITIES };
/**
 * Whether one condition holds for a ticket and the outcome it carries. The engine decides (`conditions.ts` on the
 * server, which this mirrors); the page only needs it to show, before the arm moves, which arm a ticket will leave by.
 */
export function holds(c: ArmCondition, info: FactoryTicketInfo | null, outcome: string): boolean {
  const not = c.op === 'is_not';
  if (c.field === 'outcome') return c.values.includes(outcome) !== not;
  if (!info) return false;
  if (c.field === 'favorite') return info.favorite !== not;
  if (c.field === 'tag') return info.tags.some((tag) => c.values.includes(tag)) !== not;
  if (c.field === 'board') return c.values.includes(info.boardId) !== not;
  const value = c.field === 'type' ? info.type || NONE : c.field === 'priority' ? info.priority || NONE : info.complexity ?? NONE;
  if (c.op === 'is' || c.op === 'is_not') return c.values.includes(value) !== not;
  /* "no priority" is the bottom of its scale; "not estimated" is on no scale, so neither above nor below anything */
  const scale = SCALES[c.field] ?? [], at = scale.indexOf(value), a = scale.indexOf(c.values[0] ?? ''), b = scale.indexOf(c.values[1] ?? '');
  if (at < 0 || a < 0) return false;
  return c.op === 'gte' ? at >= a : c.op === 'lte' ? at <= a : c.op === 'gt' ? at > a : c.op === 'lt' ? at < a : c.op === 'between' ? b >= 0 && at >= Math.min(a, b) && at <= Math.max(a, b) : false;
}
/** True when every condition of the arm holds. An arm with no condition matches everything. */
export const matches = (arm: ArmSpec, info: FactoryTicketInfo | null, outcome: string): boolean => conditionsOf(arm).every((c) => holds(c, info, outcome));
/** Whether an arm takes a ticket, among the arms that take from the same place: one with no condition takes only what the conditions of the others leave. */
export function wants(arm: ArmSpec, takers: readonly ArmSpec[], info: FactoryTicketInfo | null, outcome: string): boolean {
  if (!matches(arm, info, outcome)) return false;
  return isConditional(arm) || !takers.some((o) => o !== arm && isConditional(o) && matches(o, info, outcome));
}

export const FIELD_LABEL: Record<ArmField, string> = {
  outcome: 'Outcome of the station', type: 'Type', priority: 'Priority', complexity: 'Complexity', board: 'Board', favorite: 'Favourite', tag: 'Tag',
};
export const FIELDS: ArmField[] = ['outcome', 'type', 'priority', 'complexity', 'board', 'favorite', 'tag'];

const ORDERED: ArmOp[] = ['is', 'is_not', 'gte', 'lte', 'gt', 'lt', 'between'];
const PLAIN: ArmOp[] = ['is', 'is_not'];
export const OPS_BY_FIELD: Record<ArmField, readonly ArmOp[]> = { type: PLAIN, board: PLAIN, favorite: PLAIN, tag: PLAIN, outcome: PLAIN, priority: ORDERED, complexity: ORDERED };

export function opLabel(field: ArmField, op: ArmOp): string {
  if (field === 'favorite') return op === 'is_not' ? 'is not a favourite' : 'is a favourite';
  if (field === 'tag') return op === 'is_not' ? 'has none of' : 'has any of';
  return { is: 'is', is_not: 'is not', gte: 'is at least (≥)', lte: 'is at most (≤)', gt: 'is above (>)', lt: 'is below (<)', between: 'is between' }[op];
}
/** How many values an operator compares to: any number, exactly one, a pair, or none. */
export const arity = (field: ArmField, op: ArmOp): 'many' | 'one' | 'two' | 'none' => (field === 'favorite' ? 'none' : op === 'between' ? 'two' : op === 'is' || op === 'is_not' ? 'many' : 'one');

const PRIORITY_NAME: Record<string, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const complexityName = (v: string): string => (v === NONE ? 'Not estimated' : v === 'inf' ? '∞' : `${v} pts`);

export interface Option { value: string; label: string }
/**
 * What a field can be compared to, when the list is finite. Tags have none (any text). Outcomes are those of the
 * stations on the floor, the arm's own source first, plus `question`. An ordered operator leaves out "not estimated",
 * which is neither above nor below anything.
 */
export function optionsFor(field: ArmField, op: ArmOp, ctx: { boards: { id: string; name: string }[]; layout: FactoryLayout; source: string[] }): Option[] | null {
  const plain = op === 'is' || op === 'is_not';
  switch (field) {
    case 'type': return [...TICKET_TYPES.map((t) => ({ value: t as string, label: TICKET_TYPE_LABELS[t] ?? t })), { value: NONE, label: 'No type' }];
    case 'priority': return [...TICKET_PRIORITIES].reverse().map((p) => ({ value: p as string, label: PRIORITY_NAME[p] ?? p }));
    case 'complexity': return [...(plain ? [NONE] : []), ...TICKET_COMPLEXITIES].map((v) => ({ value: v as string, label: complexityName(v) }));
    case 'board': return ctx.boards.map((b) => ({ value: b.id, label: b.name }));
    case 'outcome': {
      const all = new Set<string>(ctx.source);
      for (const m of ctx.layout.machines) if (m.kind === 'station') for (const o of m.outcomes) all.add(o);
      all.add(QUESTION_OUTCOME);
      return [...all].map((o) => ({ value: o, label: o === QUESTION_OUTCOME ? 'question (the agent asked one)' : o }));
    }
    default: return null;
  }
}

/** A condition in a few characters, for the tag an arm carries on the floor. */
export function shortCondition(c: ArmCondition, boardName: (id: string) => string = (id) => id): string {
  const name = (v: string): string => (c.field === 'board' ? boardName(v) : c.field === 'complexity' ? (v === NONE ? 'no estimate' : v === 'inf' ? '∞' : v) : c.field === 'priority' && v === NONE ? 'no priority' : c.field === 'type' && v === NONE ? 'no type' : c.field === 'tag' ? `#${v}` : v);
  if (c.field === 'favorite') return c.op === 'is_not' ? 'not ★' : '★';
  const [a = '', b = ''] = c.values;
  /* an outcome is what arms are mostly sorted on: it is written bare; the rest says what it is about when a bare value would not */
  const about = c.field === 'complexity' ? 'cx ' : c.field === 'priority' && c.op !== 'is' ? 'prio ' : '';
  switch (c.op) {
    case 'is': return `${about}${c.values.map(name).join(' · ')}`;
    case 'is_not': return `${about}≠ ${c.values.map(name).join(' · ')}`;
    case 'gte': return `${about}≥ ${name(a)}`;
    case 'lte': return `${about}≤ ${name(a)}`;
    case 'gt': return `${about}> ${name(a)}`;
    case 'lt': return `${about}< ${name(a)}`;
    default: return `${about}${name(a)}–${name(b)}`;
  }
}

/** What an arm lets through, in a few words: its conditions, or "else" when it takes what conditional neighbours leave. */
export function armTag(arm: ArmSpec, siblings: ArmSpec[], boardName?: (id: string) => string): string {
  const mine = conditionsOf(arm);
  if (mine.length) return mine.map((c) => shortCondition(c, boardName)).join(' + ');
  return siblings.some((s) => s.id !== arm.id && isConditional(s)) ? 'else' : '';
}

/** A condition as a sentence fragment, for the console: "priority is at least High". */
export function longCondition(c: ArmCondition, boardName: (id: string) => string = (id) => id): string {
  if (c.field === 'favorite') return opLabel(c.field, c.op);
  const name = (v: string): string => (c.field === 'board' ? boardName(v) : c.field === 'complexity' ? complexityName(v) : c.field === 'priority' ? PRIORITY_NAME[v] ?? v : c.field === 'type' ? (v === NONE ? 'No type' : TICKET_TYPE_LABELS[v] ?? v) : v);
  const values = c.op === 'between' ? `${name(c.values[0] ?? '')} and ${name(c.values[1] ?? '')}` : c.values.map(name).join(' or ');
  return `${FIELD_LABEL[c.field].toLowerCase()} ${opLabel(c.field, c.op).replace(/ \(.\)$/, '')} ${values}`;
}

/** A blank condition for a field, ready to be filled in. */
export function blank(field: ArmField): ArmCondition { return { field, op: 'is', values: field === 'favorite' ? ['true'] : [] }; }

/** Change a condition's operator, keeping as many of its values as the new one takes. */
export function withOp(c: ArmCondition, op: ArmOp): ArmCondition {
  const n = arity(c.field, op);
  const values = n === 'none' ? ['true'] : n === 'one' ? c.values.filter((v) => v !== NONE).slice(0, 1) : n === 'two' ? c.values.filter((v) => v !== NONE).slice(0, 2) : c.values;
  return { ...c, op, values };
}

/** A condition the engine would drop when the floor is saved: it has nothing to compare to yet. */
export const incomplete = (c: ArmCondition): boolean => { const n = arity(c.field, c.op); return n === 'two' ? c.values.filter(Boolean).length < 2 : n !== 'none' && c.values.filter(Boolean).length === 0; };
