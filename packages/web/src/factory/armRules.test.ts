import { describe, it, expect } from 'vitest';
import { acceptsOutcome, arity, armTag, blank, conditionsOf, incomplete, isConditional, longCondition, optionsFor, OPS_BY_FIELD, shortCondition, takesQuestions, withOp } from './armRules';
import type { ArmCondition, ArmSpec, FactoryLayout, MachineSpec } from './types';

const arm = (when?: ArmCondition[], filter?: ArmSpec['filter'], id = 'a'): ArmSpec => ({ id, kind: 'arm', x: 0, y: 0, w: 1, h: 1, dir: 0, when, filter });
const c = (field: ArmCondition['field'], op: ArmCondition['op'], ...values: string[]): ArmCondition => ({ field, op, values });
const station = (id: string, outcomes: string[]): MachineSpec => ({ id, kind: 'station', x: 0, y: 0, w: 3, h: 3, name: id, exec: 'agent', outcomes, cap: 8 } as MachineSpec);
const layout: FactoryLayout = { w: 10, h: 10, machines: [station('triage', ['bug', 'feature']), station('qa', ['approve', 'reject'])] };
const ctx = { boards: [{ id: 'b1', name: 'Core product' }, { id: 'b2', name: 'Support' }], layout, source: ['bug', 'feature'] };
const board = (id: string) => ctx.boards.find((b) => b.id === id)?.name ?? id;

describe('arm rules', () => {
  it('reads conditions, and the single filter of older floors as one "is"', () => {
    expect(conditionsOf(arm([c('type', 'is', 'fix')]))).toEqual([c('type', 'is', 'fix')]);
    expect(conditionsOf(arm(undefined, { field: 'outcome', values: ['reject'] }))).toEqual([c('outcome', 'is', 'reject')]);
    expect(isConditional(arm(undefined, { field: 'type', values: [] }))).toBe(false);
    expect(isConditional(arm([]))).toBe(false);
  });

  it('knows which arm an outcome leaves by, as the engine does', () => {
    expect(acceptsOutcome(arm([c('outcome', 'is', 'bug')]), 'bug')).toBe(true);
    expect(acceptsOutcome(arm([c('outcome', 'is', 'bug')]), 'feature')).toBe(false);
    expect(acceptsOutcome(arm([c('outcome', 'is_not', 'bug')]), 'feature')).toBe(true);
    expect(acceptsOutcome(arm([c('priority', 'gte', 'high')]), 'bug')).toBe(false);
    expect(takesQuestions(arm([c('outcome', 'is', 'question')]))).toBe(true);
    expect(takesQuestions(arm([c('outcome', 'is_not', 'bug')]))).toBe(false);
  });

  it('only priority and complexity can be compared; the others are, or are not', () => {
    expect(OPS_BY_FIELD.priority).toContain('between');
    expect(OPS_BY_FIELD.complexity).toContain('gte');
    for (const f of ['type', 'board', 'favorite', 'tag', 'outcome'] as const) expect(OPS_BY_FIELD[f]).toEqual(['is', 'is_not']);
    expect([arity('type', 'is'), arity('priority', 'gte'), arity('complexity', 'between'), arity('favorite', 'is')]).toEqual(['many', 'one', 'two', 'none']);
  });

  it('offers the values a field can take, when the list is finite', () => {
    expect(optionsFor('type', 'is', ctx)!.map((o) => o.value)).toEqual(['build', 'fix', 'review', 'ops', 'lead', 'think', 'none']);
    expect(optionsFor('priority', 'gte', ctx)!.map((o) => o.label)).toEqual(['Urgent', 'High', 'Medium', 'Low', 'No priority']);
    expect(optionsFor('board', 'is', ctx)).toEqual([{ value: 'b1', label: 'Core product' }, { value: 'b2', label: 'Support' }]);
    /* the arm's own station first, then the other outcomes of the floor, then the question */
    expect(optionsFor('outcome', 'is', ctx)!.map((o) => o.value)).toEqual(['bug', 'feature', 'approve', 'reject', 'question']);
    expect(optionsFor('tag', 'is', ctx)).toBeNull();
    /* "not estimated" can be asked for, but is on no scale: it is not offered to compare against */
    expect(optionsFor('complexity', 'is', ctx)![0]).toEqual({ value: 'none', label: 'Not estimated' });
    expect(optionsFor('complexity', 'gte', ctx)!.some((o) => o.value === 'none')).toBe(false);
  });

  it('writes a condition short for the floor, and in words for the console', () => {
    expect(shortCondition(c('outcome', 'is', 'bug', 'question'))).toBe('bug · question');
    expect(shortCondition(c('outcome', 'is_not', 'bug'))).toBe('≠ bug');
    expect(shortCondition(c('priority', 'gte', 'high'))).toBe('prio ≥ high');
    expect(shortCondition(c('priority', 'is', 'urgent'))).toBe('urgent');
    expect(shortCondition(c('complexity', 'between', '3', '8'))).toBe('cx 3–8');
    expect(shortCondition(c('complexity', 'is', 'none'))).toBe('cx no estimate');
    expect(shortCondition(c('board', 'is', 'b2'), board)).toBe('Support');
    expect(shortCondition(c('favorite', 'is', 'true'))).toBe('★');
    expect(shortCondition(c('tag', 'is', 'api'))).toBe('#api');
    expect(longCondition(c('priority', 'gte', 'high'))).toBe('priority is at least High');
    expect(longCondition(c('complexity', 'between', '3', '8'))).toBe('complexity is between 3 pts and 8 pts');
    expect(longCondition(c('board', 'is_not', 'b1', 'b2'), board)).toBe('board is not Core product or Support');
    expect(longCondition(c('favorite', 'is_not', 'true'))).toBe('is not a favourite');
  });

  it('tags an arm with its conditions, or "else" when its neighbours have some', () => {
    const bug = arm([c('outcome', 'is', 'bug')], null, 'a1'), rest = arm([], null, 'a2'), hot = arm([c('type', 'is', 'fix'), c('priority', 'gte', 'high')], null, 'a3');
    expect(armTag(bug, [bug, rest])).toBe('bug');
    expect(armTag(rest, [bug, rest])).toBe('else');
    expect(armTag(rest, [rest])).toBe('');
    expect(armTag(hot, [hot])).toBe('fix + prio ≥ high');
  });

  it('keeps the values an operator can take when the operator changes, and knows a half-filled condition', () => {
    expect(blank('favorite')).toEqual(c('favorite', 'is', 'true'));
    expect(incomplete(blank('type'))).toBe(true);
    expect(incomplete(blank('favorite'))).toBe(false);
    expect(withOp(c('priority', 'is', 'high', 'urgent'), 'gte')).toEqual(c('priority', 'gte', 'high'));
    expect(withOp(c('complexity', 'is', 'none', '5'), 'lte')).toEqual(c('complexity', 'lte', '5'));
    expect(incomplete(withOp(c('priority', 'gte', 'high'), 'between'))).toBe(true);
    expect(incomplete(c('priority', 'between', 'low', 'high'))).toBe(false);
  });
});
