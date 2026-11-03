import { describe, it, expect } from 'vitest';
import { groupTasks } from './queueGrouping';
import { DEFAULT_QUEUE_DISPLAY, type QueueDisplay } from './queueFilters';
import type { WorkTask } from './types';

const task = (id: string, over: Partial<WorkTask> = {}): WorkTask =>
  ({
    id,
    number: Number(id.replace(/\D/g, '')) || 0,
    title: id,
    boardId: 'b1',
    boardName: 'ODYS AI',
    status: 'doing',
    type: 'build',
    priority: 'medium',
    favorite: false,
    blocked: false,
    epics: [],
    createdAt: 0,
    activity: 'idle',
    since: null,
    lastActivityAt: 0,
    worktrees: [],
    prs: [],
    ...over,
  }) as WorkTask;

const display = (over: Partial<QueueDisplay>): QueueDisplay => ({ ...DEFAULT_QUEUE_DISPLAY, ...over });
const ids = (items: WorkTask[]) => items.map((t) => t.id);

describe('groupTasks — default order is unchanged (AC9 non-regression)', () => {
  const tasks = [
    task('w-old', { activity: 'waiting', since: 1 }),
    task('w-new', { activity: 'waiting', since: 5 }),
    task('r-old', { activity: 'running', since: 1 }),
    task('r-new', { activity: 'running', since: 5 }),
    task('i-old', { lastActivityAt: 1 }),
    task('i-new', { lastActivityAt: 5 }),
  ];

  it('activity: NEEDS YOU oldest first, RUNNING newest first, IDLE most recent first', () => {
    const groups = groupTasks(tasks, DEFAULT_QUEUE_DISPLAY);
    expect(groups.map((g) => g.label)).toEqual(['NEEDS YOU', 'RUNNING', 'IDLE']);
    expect(groups.map((g) => ids(g.items))).toEqual([['w-old', 'w-new'], ['r-new', 'r-old'], ['i-new', 'i-old']]);
  });

  it('other groupings: groups in their fixed order, rows by recency', () => {
    const groups = groupTasks(
      [task('a', { status: 'reviewing', lastActivityAt: 9 }), task('b', { lastActivityAt: 1 }), task('c', { lastActivityAt: 7 })],
      display({ groupBy: 'status' }),
    );
    expect(groups.map((g) => g.label)).toEqual(['DOING', 'REVIEWING']);
    expect(ids(groups[0]!.items)).toEqual(['c', 'b']);
  });
});

describe('groupTasks — epic (AC7, D6)', () => {
  it('groups by epic name, epic-less last, a multi-epic task in its first epic by name only', () => {
    const groups = groupTasks(
      [
        task('t1', { epics: [{ id: 'z', name: 'Zeta', emoji: '' }, { id: 'a', name: 'Alpha', emoji: '🅰' }] }),
        task('t2', { epics: [] }),
        task('t3', { epics: [{ id: 'z', name: 'Zeta', emoji: '' }] }),
      ],
      display({ groupBy: 'epic' }),
    );
    expect(groups.map((g) => [g.label, ids(g.items)])).toEqual([
      ['🅰 ALPHA', ['t1']],
      ['ZETA', ['t3']],
      ['NO EPIC', ['t2']],
    ]);
  });
});

describe('groupTasks — sub-groups', () => {
  const tasks = [
    task('h-doing', { priority: 'high', status: 'doing', lastActivityAt: 3 }),
    task('h-review', { priority: 'high', status: 'reviewing', lastActivityAt: 9 }),
    task('h-doing2', { priority: 'high', status: 'doing', lastActivityAt: 8 }),
    task('m-doing', { priority: 'medium', status: 'doing' }),
  ];

  it('priority › status: ordered sub-groups, the group rows follow them (keyboard order), empty ones absent', () => {
    const [high, medium] = groupTasks(tasks, display({ groupBy: 'priority', subGroupBy: 'status' }));
    expect(high!.label).toBe('HIGH');
    expect(high!.subgroups!.map((s) => [s.label, ids(s.items)])).toEqual([
      ['Doing', ['h-doing2', 'h-doing']],
      ['Reviewing', ['h-review']],
    ]);
    expect(ids(high!.items)).toEqual(['h-doing2', 'h-doing', 'h-review']);
    expect(medium!.subgroups!.map((s) => s.label)).toEqual(['Doing']);
    // Sub-group keys are unique across groups (they key the fold state).
    expect(high!.subgroups![0]!.key).not.toBe(medium!.subgroups![0]!.key);
  });

  it('group by priority puts URGENT first and NO PRIORITY last', () => {
    const groups = groupTasks(
      [task('n', { priority: 'none' }), task('h', { priority: 'high' }), task('u', { priority: 'urgent' })],
      display({ groupBy: 'priority' }),
    );
    expect(groups.map((g) => ids(g.items))).toEqual([['u'], ['h'], ['n']]);
  });

  it('a sub-group equal to the group is ignored', () => {
    const groups = groupTasks(tasks, display({ groupBy: 'status', subGroupBy: 'status' }));
    expect(groups[0]!.subgroups).toBeUndefined();
  });

  it('activity as sub-group keeps the partition order inside each group', () => {
    const [g] = groupTasks(
      [task('i', { lastActivityAt: 9 }), task('w', { activity: 'waiting', since: 2 })],
      display({ groupBy: 'board', subGroupBy: 'activity' }),
    );
    expect(g!.subgroups!.map((s) => s.label)).toEqual(['NEEDS YOU', 'IDLE']);
  });
});

describe('groupTasks — an explicit sort applies inside every (sub-)group, activity included', () => {
  it('sorts rows by number inside NEEDS YOU / IDLE', () => {
    const groups = groupTasks(
      [task('t3', { lastActivityAt: 9 }), task('t1', { lastActivityAt: 1 }), task('t2', { activity: 'waiting', since: 1 }), task('t4', { activity: 'waiting', since: 0 })],
      display({ sort: { key: 'number', dir: 'asc' } }),
    );
    expect(groups.map((g) => ids(g.items))).toEqual([['t2', 't4'], ['t1', 't3']]);
  });

  it('sorts inside sub-groups', () => {
    const [g] = groupTasks(
      [task('t2', { status: 'doing' }), task('t1', { status: 'doing' })],
      display({ groupBy: 'board', subGroupBy: 'status', sort: { key: 'title', dir: 'asc' } }),
    );
    expect(ids(g!.subgroups![0]!.items)).toEqual(['t1', 't2']);
  });
});
