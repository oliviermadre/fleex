/** What an arm lets through: each field, each operator, and what is kept of a condition that cannot be evaluated. */
import { describe, it, expect } from 'vitest';
import { acceptsOutcome, conditionsOf, holds, isConditional, matches, normaliseConditions, takesQuestions } from '../../src/factory/conditions.js';
import type { ArmCondition, ArmSpec, FactoryTicketInfo } from '../../src/factory/types.js';

const info = (over: Partial<FactoryTicketInfo> = {}): FactoryTicketInfo => ({ id: 't', displayId: 1, title: 't', type: 'build', priority: 'medium', status: 'todo', tags: ['api'], boardId: 'core', complexity: '5', favorite: false, blocked: false, ...over });
const arm = (when?: ArmCondition[], filter?: ArmSpec['filter']): ArmSpec => ({ id: 'a', kind: 'arm', x: 0, y: 0, w: 1, h: 1, dir: 0, when, filter });
const c = (field: ArmCondition['field'], op: ArmCondition['op'], ...values: string[]): ArmCondition => ({ field, op, values });
const ok = (cond: ArmCondition, over: Partial<FactoryTicketInfo> = {}, outcome = '') => holds(cond, info(over), outcome);

describe('arm conditions', () => {
  it('is / is not: any of the values, on type, board, tag and outcome', () => {
    expect(ok(c('type', 'is', 'fix', 'build'))).toBe(true);
    expect(ok(c('type', 'is_not', 'fix'))).toBe(true);
    expect(ok(c('type', 'is', 'none'), { type: '' })).toBe(true);
    expect(ok(c('board', 'is', 'support'))).toBe(false);
    expect(ok(c('board', 'is_not', 'support'))).toBe(true);
    expect(ok(c('tag', 'is', 'api', 'ui'))).toBe(true);
    expect(ok(c('tag', 'is_not', 'api'))).toBe(false);
    expect(ok(c('outcome', 'is', 'bug', 'feature'), {}, 'feature')).toBe(true);
    expect(ok(c('outcome', 'is_not', 'bug'), {}, 'bug')).toBe(false);
  });

  it('favourite or not', () => {
    expect(ok(c('favorite', 'is', 'true'), { favorite: true })).toBe(true);
    expect(ok(c('favorite', 'is', 'true'))).toBe(false);
    expect(ok(c('favorite', 'is_not', 'true'))).toBe(true);
  });

  it('priority is ordered: none, low, medium, high, urgent', () => {
    expect(ok(c('priority', 'gte', 'high'), { priority: 'urgent' })).toBe(true);
    expect(ok(c('priority', 'gte', 'high'), { priority: 'medium' })).toBe(false);
    expect(ok(c('priority', 'gt', 'high'), { priority: 'high' })).toBe(false);
    expect(ok(c('priority', 'lte', 'low'), { priority: 'none' })).toBe(true);
    expect(ok(c('priority', 'lt', 'low'), { priority: '' })).toBe(true);   // no priority is the bottom of the scale
    expect(ok(c('priority', 'between', 'low', 'high'), { priority: 'medium' })).toBe(true);
    expect(ok(c('priority', 'between', 'high', 'low'), { priority: 'urgent' })).toBe(false);   // the bounds may come in either order
    expect(ok(c('priority', 'is', 'urgent', 'high'), { priority: 'high' })).toBe(true);
  });

  it('complexity is ordered too, and a ticket that is not estimated is neither above nor below anything', () => {
    expect(ok(c('complexity', 'gte', '8'), { complexity: '13' })).toBe(true);
    expect(ok(c('complexity', 'gte', '8'), { complexity: 'inf' })).toBe(true);
    expect(ok(c('complexity', 'lt', '3'), { complexity: '0.5' })).toBe(true);
    expect(ok(c('complexity', 'between', '2', '5'), { complexity: '5' })).toBe(true);
    expect(ok(c('complexity', 'gte', '0'), { complexity: null })).toBe(false);
    expect(ok(c('complexity', 'lte', 'inf'), { complexity: null })).toBe(false);
    expect(ok(c('complexity', 'is', 'none'), { complexity: null })).toBe(true);
    expect(ok(c('complexity', 'is_not', 'none'), { complexity: '1' })).toBe(true);
  });

  it('an arm takes a ticket when all its conditions hold; with none, it takes anything', () => {
    const both = arm([c('type', 'is', 'fix'), c('priority', 'gte', 'high')]);
    expect(matches(both, info({ type: 'fix', priority: 'urgent' }), '')).toBe(true);
    expect(matches(both, info({ type: 'fix', priority: 'low' }), '')).toBe(false);
    expect(matches(arm([]), info(), '')).toBe(true);
    expect(isConditional(arm([]))).toBe(false);
    expect(isConditional(both)).toBe(true);
  });

  it('a ticket whose details are not loaded only matches on its outcome', () => {
    expect(holds(c('outcome', 'is', 'ok'), null, 'ok')).toBe(true);
    expect(holds(c('type', 'is_not', 'fix'), null, '')).toBe(false);
  });

  it('reads the single filter of older floors as one "is" condition', () => {
    expect(conditionsOf(arm(undefined, { field: 'outcome', values: ['reject'] }))).toEqual([{ field: 'outcome', op: 'is', values: ['reject'] }]);
    expect(conditionsOf(arm(undefined, { field: 'type', values: [] }))).toEqual([]);
    expect(conditionsOf(arm(undefined, null))).toEqual([]);
    /* once it has conditions, the old filter is not read any more */
    expect(conditionsOf(arm([], { field: 'type', values: ['fix'] }))).toEqual([]);
  });

  it('keeps what can be evaluated when a layout is saved', () => {
    const kept = normaliseConditions(arm([
      c('priority', 'gte', ' high ', 'urgent'),          // one value is enough for an ordered operator
      c('complexity', 'between', '3'),                    // a range needs two bounds: dropped
      c('type', 'gte', 'fix'),                            // types have no order: read as "is"
      c('favorite', 'is_not'),                            // a favourite condition needs no value
      c('board', 'is'),                                   // nothing to compare to: dropped
      { field: 'colour' as never, op: 'is', values: ['red'] },
      c('tag', 'is', 'api', 'api', ''),
    ]));
    expect(kept).toEqual([c('priority', 'gte', 'high'), c('type', 'is', 'fix'), c('favorite', 'is_not', 'true'), c('tag', 'is', 'api')]);
  });

  it('knows which arm an outcome leaves by, and that a question only leaves by an arm that asks for it', () => {
    expect(acceptsOutcome(arm([c('outcome', 'is', 'bug')]), 'bug')).toBe(true);
    expect(acceptsOutcome(arm([c('outcome', 'is_not', 'bug')]), 'feature')).toBe(true);
    expect(acceptsOutcome(arm([c('outcome', 'is', 'bug'), c('priority', 'gte', 'high')]), 'bug')).toBe(true);
    expect(acceptsOutcome(arm([c('priority', 'gte', 'high')]), 'bug')).toBe(false);
    expect(acceptsOutcome(arm([]), 'bug')).toBe(false);
    expect(takesQuestions(arm([c('outcome', 'is', 'bug', 'question')]))).toBe(true);
    expect(takesQuestions(arm([c('outcome', 'is_not', 'bug')]))).toBe(false);
  });
});
