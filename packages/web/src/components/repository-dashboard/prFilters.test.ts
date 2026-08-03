import { describe, it, expect } from 'vitest';

import type { PullRequest } from '@fleex/shared';

import { filterPulls } from './prFilters';

function pr(number: number, over: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `PR ${number}`,
    headRefName: `b${number}`,
    state: 'open',
    author: 'alice',
    assignees: [],
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: `2026-07-${String(10 + number).padStart(2, '0')}T00:00:00Z`,
    ...over,
  };
}

const open = [pr(1), pr(2, { author: 'bob', assignees: ['alice'] })];
const merged = [pr(3, { state: 'merged', mergedAt: '2026-07-15T00:00:00Z', author: 'alice' })];

describe('filterPulls', () => {
  it('segment open / merged / all', () => {
    expect(filterPulls(open, merged, 'open', false, false, null).map((p) => p.number)).toEqual([
      2, 1,
    ]);
    expect(filterPulls(open, merged, 'merged', false, false, null).map((p) => p.number)).toEqual([
      3,
    ]);
    expect(filterPulls(open, merged, 'all', false, false, null)).toHaveLength(3);
  });
  it('sorts all by updatedAt desc', () => {
    // factory dates: pr1 → 2026-07-11, pr2 → 2026-07-12, pr3 → 2026-07-13
    expect(filterPulls(open, merged, 'all', false, false, null).map((p) => p.number)).toEqual([
      3, 2, 1,
    ]);
  });
  it('mine AND assigned combine with AND', () => {
    expect(filterPulls(open, merged, 'all', true, false, 'alice').map((p) => p.number)).toEqual([
      3, 1,
    ]);
    expect(filterPulls(open, merged, 'all', false, true, 'alice').map((p) => p.number)).toEqual([
      2,
    ]);
    expect(filterPulls(open, merged, 'all', true, true, 'alice')).toEqual([]);
  });
  it('ignores the toggles when the user is unknown', () => {
    expect(filterPulls(open, merged, 'all', true, true, null)).toHaveLength(3);
  });
});
