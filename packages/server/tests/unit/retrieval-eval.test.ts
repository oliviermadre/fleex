import { describe, it, expect } from 'vitest';
import {
  firstRelevantRank,
  scoreOutcomes,
  deriveCasesFromCorpus,
  stripBreadcrumb,
} from '../../src/application/memory/retrieval-eval.js';

function outcome(returned: string[], expected: string[]) {
  return { query: 'q', expected, returned, firstRelevantRank: firstRelevantRank(returned, expected) };
}

describe('firstRelevantRank', () => {
  it('is 1-based', () => {
    expect(firstRelevantRank(['a'], ['a'])).toBe(1);
    expect(firstRelevantRank(['x', 'a'], ['a'])).toBe(2);
  });

  it('is 0 when nothing expected was returned', () => {
    // 0 rather than -1, so the reciprocal-rank sum stays a plain guard.
    expect(firstRelevantRank(['x', 'y'], ['a'])).toBe(0);
  });

  it('finds the earliest of several acceptable answers', () => {
    expect(firstRelevantRank(['x', 'b', 'a'], ['a', 'b'])).toBe(2);
  });

  it('is 0 for empty results', () => {
    expect(firstRelevantRank([], ['a'])).toBe(0);
  });
});

describe('scoreOutcomes', () => {
  it('reports zeroes for no cases rather than dividing by zero', () => {
    expect(scoreOutcomes([], 5)).toEqual({ cases: 0, recallAtK: 0, k: 5, mrr: 0, misses: [] });
  });

  it('counts a hit inside K as recall', () => {
    const report = scoreOutcomes([outcome(['x', 'x', 'a'], ['a'])], 5);
    expect(report.recallAtK).toBe(1);
  });

  it('does not count a hit beyond K', () => {
    // Found, but too far down to survive a prompt's context budget.
    const report = scoreOutcomes([outcome(['x', 'x', 'x', 'a'], ['a'])], 3);
    expect(report.recallAtK).toBe(0);
    expect(report.misses).toHaveLength(0);
  });

  it('rewards putting the answer first through MRR', () => {
    const first = scoreOutcomes([outcome(['a'], ['a'])], 5);
    const third = scoreOutcomes([outcome(['x', 'x', 'a'], ['a'])], 5);
    expect(first.mrr).toBe(1);
    expect(third.mrr).toBeCloseTo(1 / 3, 3);
    // Both are recalled; only MRR distinguishes them.
    expect(first.recallAtK).toBe(third.recallAtK);
  });

  it('collects the cases that found nothing', () => {
    const report = scoreOutcomes([outcome(['x'], ['a']), outcome(['a'], ['a'])], 5);
    expect(report.misses).toHaveLength(1);
    expect(report.recallAtK).toBe(0.5);
  });

  it('averages over every case', () => {
    const report = scoreOutcomes([
      outcome(['a'], ['a']),
      outcome(['x', 'b'], ['b']),
      outcome(['x'], ['c']),
    ], 5);
    expect(report.cases).toBe(3);
    expect(report.recallAtK).toBeCloseTo(2 / 3, 3);
    expect(report.mrr).toBeCloseTo((1 + 0.5 + 0) / 3, 3);
  });
});

describe('stripBreadcrumb', () => {
  it('drops the ticket id nobody types', () => {
    expect(stripBreadcrumb('Ticket #42: Fix login > Solution')).toBe('Fix login > Solution');
  });

  it('drops the part counter', () => {
    expect(stripBreadcrumb('Auth rework (2/3)')).toBe('Auth rework');
  });

  it('drops the source prefix', () => {
    expect(stripBreadcrumb('Scratchpad: org/app')).toBe('org/app');
    expect(stripBreadcrumb('Assistant: Branching')).toBe('Branching');
  });

  it('leaves an ordinary title alone', () => {
    expect(stripBreadcrumb('Session tokens expire early')).toBe('Session tokens expire early');
  });
});

describe('deriveCasesFromCorpus', () => {
  const long = 'x'.repeat(300);

  it('turns a chunk title into a query for its own source', () => {
    const cases = deriveCasesFromCorpus(
      [{ sourceId: 't1', title: 'Ticket #1: Session tokens expire early', content: long }],
      10,
    );
    expect(cases).toEqual([{ query: 'Session tokens expire early', expected: ['t1'] }]);
  });

  it('skips short content, which would make the query its own answer', () => {
    expect(deriveCasesFromCorpus(
      [{ sourceId: 't1', title: 'A short note about caching', content: 'caching is hard' }],
      10,
    )).toEqual([]);
  });

  it('skips a title too short to be a meaningful query', () => {
    expect(deriveCasesFromCorpus([{ sourceId: 't1', title: 'Fix', content: long }], 10)).toEqual([]);
  });

  it('uses each source at most once', () => {
    const cases = deriveCasesFromCorpus([
      { sourceId: 't1', title: 'Session tokens expire early (1/2)', content: long },
      { sourceId: 't1', title: 'Session tokens expire early (2/2)', content: long },
    ], 10);
    expect(cases).toHaveLength(1);
  });

  it('honours the limit', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      sourceId: `t${i}`, title: `Some durable subject number ${i}`, content: long,
    }));
    expect(deriveCasesFromCorpus(chunks, 5)).toHaveLength(5);
  });

  it('returns nothing for an empty corpus', () => {
    expect(deriveCasesFromCorpus([], 10)).toEqual([]);
  });
});
