/**
 * Tags of the form key:value, and the conditions that read them: what a loop counter and a toll are made of.
 */
import { describe, it, expect } from 'vitest';
import { applyTag, compareTag, tagKey, tagValue } from '../../src/factory/tags.js';
import { holds, normaliseList } from '../../src/factory/conditions.js';
import type { ArmCondition, FactoryTicketInfo } from '../../src/factory/types.js';

const info = (tags: string[]): FactoryTicketInfo => ({ id: 't', displayId: 1, title: 't', type: 'fix', priority: 'medium', status: 'todo', tags, boardId: 'b', complexity: null, favorite: false, blocked: false });

describe('key:value tags', () => {
  it('reads a key and its value; a plain tag has neither', () => {
    expect(tagKey('type:major')).toBe('type'); expect(tagKey('customer')).toBeNull(); expect(tagKey(':odd')).toBeNull();
    expect(tagValue(['customer', 'type:major', 'url:http://x'], 'type')).toBe('major');
    expect(tagValue(['url:http://x:3000'], 'url')).toBe('http://x:3000');           // only the first colon splits
    expect(tagValue(['customer'], 'type')).toBeNull();
  });

  it('a key has one value: setting it replaces what it had', () => {
    expect(applyTag(['customer', 'type:minor'], 'set', 'type:major')).toEqual(['customer', 'type:major']);
    expect(applyTag(['customer'], 'set', 'type:major')).toEqual(['customer', 'type:major']);
    expect(applyTag(['customer'], 'set', 'plain')).toEqual(['customer']);            // nothing to set without a key
  });

  it('counts on a key, from nothing, and by more than one when asked', () => {
    let tags: readonly string[] = ['customer'];
    tags = applyTag(tags, 'inc', 'passes'); expect(tags).toEqual(['customer', 'passes:1']);
    tags = applyTag(tags, 'inc', 'passes'); expect(tags).toEqual(['customer', 'passes:2']);
    expect(applyTag(tags, 'inc', 'passes:5')).toEqual(['customer', 'passes:7']);
    expect(applyTag(['passes:many'], 'inc', 'passes')).toEqual(['passes:1']);        // what was not a number starts over
    expect(applyTag(tags, 'clear', 'passes')).toEqual(['customer']);
  });

  it('adds and removes whole tags, and gives the same list back when nothing changes', () => {
    const tags = ['customer', 'type:major'];
    expect(applyTag(tags, 'add', 'urgent')).toEqual(['customer', 'type:major', 'urgent']);
    expect(applyTag(tags, 'remove', 'customer')).toEqual(['type:major']);
    for (const [op, v] of [['add', 'customer'], ['remove', 'nope'], ['set', 'type:major'], ['clear', 'passes'], ['add', '  ']] as const) expect(applyTag(tags, op, v)).toBe(tags);
  });

  it('compares a value as a number when it is one; a key the ticket does not have is a counter at 0', () => {
    expect(compareTag(['passes:3'], 'passes', 'gt', '3')).toBe(false);
    expect(compareTag(['passes:4'], 'passes', 'gt', '3')).toBe(true);
    expect(compareTag(['passes:10'], 'passes', 'gte', '9')).toBe(true);             // as numbers, not as text
    expect(compareTag([], 'passes', 'gt', '3')).toBe(false);
    expect(compareTag([], 'passes', 'lt', '3')).toBe(true);
    expect(compareTag([], 'passes', 'is', '0')).toBe(true);
    expect(compareTag(['type:major'], 'type', 'is', 'major')).toBe(true);
    expect(compareTag(['type:major'], 'type', 'is_not', 'minor')).toBe(true);
    expect(compareTag([], 'type', 'is', 'major')).toBe(false);
    expect(compareTag(['type:major'], 'type', 'gt', 'minor')).toBe(false);          // text has no order here
  });
});

describe('a condition on the value of a tag', () => {
  const c = (op: ArmCondition['op'], ...values: string[]): ArmCondition => ({ field: 'tagkey', op, values });
  it('holds as the comparison does, whatever the outcome', () => {
    expect(holds(c('gt', 'passes', '3'), info(['passes:4']), '')).toBe(true);
    expect(holds(c('gt', 'passes', '3'), info(['passes:3']), 'ko')).toBe(false);
    expect(holds(c('is_not', 'type', 'major'), info([]), '')).toBe(true);
    expect(holds(c('gt', 'passes', '3'), null, '')).toBe(false);                      // nothing is known of the ticket
  });
  it('needs a key and something to compare to, and keeps both even when they are equal', () => {
    expect(normaliseList([c('gt', 'passes', '3'), c('gt', 'passes'), c('is', 'a', 'a'), c('between', 'passes', '1', '2'), c('gt', 'passes:9', '3')])).toEqual([
      c('gt', 'passes', '3'), c('is', 'a', 'a'), c('is', 'passes', '1'), c('gt', 'passes', '3'),
    ]);
  });
});
