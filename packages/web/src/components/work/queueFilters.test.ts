import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_QUEUE_FILTERS,
  clearPopoverFilters,
  compareBy,
  completeConfig,
  matchQueueFilters,
  popoverFilterCount,
  sameConfig,
  normalizeConfig,
  withGroupBy,
  type FilterableTask,
  type QueueFilters,
} from './queueFilters';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const NO_FILTERS: QueueFilters = { ...DEFAULT_QUEUE_FILTERS, statuses: [] };

const task = (over: Partial<FilterableTask> = {}): FilterableTask => ({
  boardId: 'b1',
  status: 'doing',
  priority: 'medium',
  type: 'build',
  favorite: false,
  blocked: false,
  title: 'Fix login',
  epics: [],
  worktrees: [],
  prs: [],
  lastActivityAt: NOW,
  ...over,
});

const passes = (f: Partial<QueueFilters>, t: FilterableTask, search = '') =>
  matchQueueFilters({ ...NO_FILTERS, ...f }, search, t, NOW).length === 0;

describe('matchQueueFilters — the new filters (AC1)', () => {
  it('an empty filter lets everything through', () => {
    expect(matchQueueFilters(NO_FILTERS, '', task(), NOW)).toEqual([]);
  });

  it('type: a ticket without a type only passes with "none"', () => {
    expect(passes({ types: ['build'] }, task({ type: 'build' }))).toBe(true);
    expect(passes({ types: ['fix'] }, task({ type: 'build' }))).toBe(false);
    expect(passes({ types: ['build'] }, task({ type: null }))).toBe(false);
    expect(passes({ types: ['none'] }, task({ type: null }))).toBe(true);
  });

  // AC2: Epic = {A, none} shows A's tickets and the epic-less ones, nothing else.
  it('epic {A, none} keeps A and epic-less tickets, drops B', () => {
    const f = { epics: ['A', 'none'] };
    expect(passes(f, task({ epics: [{ id: 'A' }] }))).toBe(true);
    expect(passes(f, task({ epics: [] }))).toBe(true);
    expect(passes(f, task({ epics: [{ id: 'B' }] }))).toBe(false);
    // A multi-epic ticket matches on any of its epics.
    expect(passes(f, task({ epics: [{ id: 'B' }, { id: 'A' }] }))).toBe(true);
  });

  it('repo matches any attached repo, case-insensitively, "none" for no repo', () => {
    const f = { repos: ['odys-travel/odys-api'] };
    expect(passes(f, task({ worktrees: [{ repo: 'ODYS-TRAVEL/odys-api' }] }))).toBe(true);
    expect(passes(f, task({ worktrees: [{ repo: 'x/front' }, { repo: 'odys-travel/odys-api' }] }))).toBe(true);
    expect(passes(f, task({ worktrees: [] }))).toBe(false);
    expect(passes({ repos: ['none'] }, task({ worktrees: [] }))).toBe(true);
  });

  // AC3
  it('PR {none} keeps only tickets without a PR link; {merged} needs at least one merged PR', () => {
    expect(passes({ prs: ['none'] }, task({ prs: [] }))).toBe(true);
    expect(passes({ prs: ['none'] }, task({ prs: [{ state: 'open' }] }))).toBe(false);
    // A PR whose state hasn't loaded is still a PR.
    expect(passes({ prs: ['none'] }, task({ prs: [{ state: null }] }))).toBe(false);
    expect(passes({ prs: ['merged'] }, task({ prs: [{ state: 'closed' }, { state: 'merged' }] }))).toBe(true);
    expect(passes({ prs: ['merged'] }, task({ prs: [{ state: 'open' }] }))).toBe(false);
  });

  it('blocked: blocked / not blocked / any', () => {
    expect(passes({ blocked: 'blocked' }, task({ blocked: true }))).toBe(true);
    expect(passes({ blocked: 'blocked' }, task({ blocked: false }))).toBe(false);
    expect(passes({ blocked: 'not_blocked' }, task({ blocked: true }))).toBe(false);
    expect(passes({ blocked: 'any' }, task({ blocked: true }))).toBe(true);
  });

  // AC4
  it('inactive for 7 days excludes activity 2 days ago and keeps 8 days ago', () => {
    expect(passes({ inactiveFor: '7d' }, task({ lastActivityAt: NOW - 2 * DAY }))).toBe(false);
    expect(passes({ inactiveFor: '7d' }, task({ lastActivityAt: NOW - 8 * DAY }))).toBe(true);
    // Unknown activity can't prove inactivity.
    expect(passes({ inactiveFor: '1d' }, task({ lastActivityAt: null }))).toBe(false);
  });

  it('AND between filters, OR within one', () => {
    const f = { statuses: ['doing', 'reviewing'], types: ['fix'] };
    expect(passes(f, task({ status: 'reviewing', type: 'fix' }))).toBe(true);
    expect(passes(f, task({ status: 'reviewing', type: 'build' }))).toBe(false);
  });

  // AC5: the pin names every filter that hides the ticket, new ones included.
  it('names every excluding filter, in display order', () => {
    const f: QueueFilters = {
      boards: ['b2'],
      statuses: ['todo'],
      priorities: ['high'],
      types: ['fix'],
      epics: ['A'],
      repos: ['x/y'],
      prs: ['open'],
      blocked: 'blocked',
      inactiveFor: '30d',
      favoriteOnly: true,
    };
    expect(matchQueueFilters(f, 'zzz', task(), NOW)).toEqual([
      'boards', 'statuses', 'priorities', 'types', 'epics', 'repos', 'prs', 'blocked', 'inactiveFor', 'favoriteOnly', 'search',
    ]);
  });
});

describe('Filters popover badge and Clear (AC6)', () => {
  it('counts the active popover filters only — not boards, status or favorites', () => {
    expect(popoverFilterCount({ ...DEFAULT_QUEUE_FILTERS, boards: ['b1'], favoriteOnly: true })).toBe(0);
    expect(popoverFilterCount({ ...DEFAULT_QUEUE_FILTERS, types: ['fix'], blocked: 'blocked', inactiveFor: '7d' })).toBe(3);
  });

  it('Clear empties the popover filters and leaves boards and status alone', () => {
    const f: QueueFilters = { ...DEFAULT_QUEUE_FILTERS, boards: ['b1'], statuses: ['doing'], epics: ['A'], prs: ['none'], blocked: 'blocked' };
    const cleared = clearPopoverFilters(f);
    expect(popoverFilterCount(cleared)).toBe(0);
    expect(cleared.boards).toEqual(['b1']);
    expect(cleared.statuses).toEqual(['doing']);
  });
});

describe('sub-group never equals the group (AC8)', () => {
  it('switching the first level to the sub-group value drops the sub-group', () => {
    const d = { ...DEFAULT_QUEUE_CONFIG.display, groupBy: 'priority' as const, subGroupBy: 'status' as const };
    expect(withGroupBy(d, 'status')).toMatchObject({ groupBy: 'status', subGroupBy: null });
    expect(withGroupBy(d, 'board')).toMatchObject({ groupBy: 'board', subGroupBy: 'status' });
  });

  it('a stored config with both equal is repaired on read', () => {
    expect(completeConfig({ display: { groupBy: 'epic', subGroupBy: 'epic' } }).display.subGroupBy).toBeNull();
  });
});

describe('comparing a view with the queue (dirty state, AC14)', () => {
  const known = { boards: new Set(['b1', 'b2']), epics: new Set(['e1']) };

  it('ignores value order', () => {
    const a = { ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['b1', 'b2'] } };
    const b = { ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['b2', 'b1'] } };
    expect(sameConfig(a, b, known)).toBe(true);
  });

  it('a deleted board or epic in the view is not a modification, and is dropped when saved', () => {
    const view = { ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['b1', 'gone'], epics: ['e-gone', 'none'] } };
    const queue = { ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['b1'], epics: ['none'] } };
    expect(sameConfig(view, queue, known)).toBe(true);
    expect(normalizeConfig(view, known).filters).toMatchObject({ boards: ['b1'], epics: ['none'] });
  });

  it('nothing is pruned before the lists are loaded', () => {
    const view = { ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['b9'] } };
    expect(normalizeConfig(view, { boards: null, epics: null }).filters.boards).toEqual(['b9']);
  });

  it('a different filter or display is a modification', () => {
    const changed = { ...DEFAULT_QUEUE_CONFIG, display: { ...DEFAULT_QUEUE_CONFIG.display, groupBy: 'epic' as const } };
    expect(sameConfig(DEFAULT_QUEUE_CONFIG, changed, known)).toBe(false);
  });
});

describe('compareBy (explicit sorts, AC9)', () => {
  const t = (n: number, over: Record<string, unknown> = {}) =>
    ({ number: n, title: `T${n}`, priority: 'none', lastActivityAt: n, createdAt: n, ...over }) as Parameters<ReturnType<typeof compareBy>>[0];
  const order = (key: Parameters<typeof compareBy>[0]['key'], dir: 'asc' | 'desc', items: ReturnType<typeof t>[]) =>
    [...items].sort(compareBy({ key, dir })).map((x) => x.number);

  it('each key sorts both ways', () => {
    const items = [t(2), t(3), t(1)];
    for (const key of ['lastActivity', 'created', 'number'] as const) {
      expect(order(key, 'asc', items)).toEqual([1, 2, 3]);
      expect(order(key, 'desc', items)).toEqual([3, 2, 1]);
    }
    expect(order('title', 'asc', [t(2, { title: 'beta' }), t(1, { title: 'Alpha' })])).toEqual([1, 2]);
  });

  it('priority desc is high > medium > low > none, ties by most recent activity', () => {
    const items = [
      t(1, { priority: 'low' }),
      t(2, { priority: 'high', lastActivityAt: 10 }),
      t(3, { priority: 'none' }),
      t(4, { priority: 'high', lastActivityAt: 20 }),
      t(5, { priority: 'medium' }),
    ];
    expect(order('priority', 'desc', items)).toEqual([4, 2, 5, 1, 3]);
  });

  it('urgent ranks above high: a newly added top level must not sort as "none"', () => {
    const items = [t(1, { priority: 'high' }), t(2, { priority: 'urgent' }), t(3, { priority: 'none' })];
    expect(order('priority', 'desc', items)).toEqual([2, 1, 3]);
    expect(order('priority', 'asc', items)).toEqual([3, 1, 2]);
  });
});
