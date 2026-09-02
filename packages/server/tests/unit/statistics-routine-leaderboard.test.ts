/**
 * Routine and workflow leaderboard grouping.
 *
 * These two boards are the only consumers that have to reason about a run whose
 * `templateId` or `ticketId` is null — a routine targeting a primitive has no
 * template, and a routine run has no ticket. The golden fixture carries no
 * routines, so the branches below are pinned here instead.
 */
import { describe, it, expect } from 'vitest';
import {
  computeRoutineLeaderboard,
  computeWorkflowLeaderboard,
} from '../../src/application/utils/statistics/leaderboards.js';
import type { WorkflowRunRow, RoutineRef } from '../../src/application/utils/statistics/rows.js';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

function run(over: Partial<WorkflowRunRow> = {}): WorkflowRunRow {
  return {
    ticketId: null,
    templateId: 'tpl-1',
    templateName: 'Template One',
    routineId: 'routine-1',
    status: 'completed',
    startedAtMs: T0,
    durationMs: 1000,
    ...over,
  };
}

const ROUTINES = new Map<string, RoutineRef>([
  ['routine-1', { id: 'routine-1', name: 'Daily Recap', target: { kind: 'agent', ref: 'builder' } }],
]);

describe('computeRoutineLeaderboard', () => {
  it('counts only routine-anchored runs, and reports the routine target', () => {
    const board = computeRoutineLeaderboard(
      [run(), run(), run({ routineId: null, ticketId: 'ticket-9' })],
      ROUTINES,
    );

    expect(board).toEqual([
      {
        routineId: 'routine-1',
        routineName: 'Daily Recap',
        targetKind: 'agent',
        targetRef: 'builder',
        executionCount: 2,
        completedCount: 2,
        failedCount: 0,
        avgDurationMs: 1000,
        lastRunAt: new Date(T0).toISOString(),
      },
    ]);
  });

  it('keeps a row for a routine deleted since its runs, rather than dropping history', () => {
    // Dropping the row would silently change historical totals, so the name
    // degrades to the frozen snapshot and then to the raw id.
    const [named, unnamed] = computeRoutineLeaderboard(
      [
        run({ routineId: 'gone-1', templateName: 'Frozen Snapshot' }),
        run({ routineId: 'gone-2', templateName: null }),
      ],
      new Map(),
    );

    expect(named).toMatchObject({ routineName: 'Frozen Snapshot', targetKind: 'workflow', targetRef: '' });
    expect(unnamed).toMatchObject({ routineName: 'gone-2' });
  });

  it('averages only completed runs of positive duration, and nulls an empty average', () => {
    const board = computeRoutineLeaderboard(
      [
        run({ status: 'completed', durationMs: 2000 }),
        run({ status: 'completed', durationMs: 4000 }),
        run({ status: 'failed', durationMs: 90_000 }), // not completed → excluded
        run({ status: 'completed', durationMs: null }), // never finished → excluded
        run({ status: 'completed', durationMs: -5 }), // clock skew → excluded
      ],
      ROUTINES,
    );

    expect(board[0]).toMatchObject({ executionCount: 5, completedCount: 4, failedCount: 1, avgDurationMs: 3000 });

    const noDurations = computeRoutineLeaderboard([run({ status: 'running', durationMs: null })], ROUTINES);
    expect(noDurations[0]!.avgDurationMs).toBeNull();
  });

  it('reports the most recent run, and orders the board by volume', () => {
    const board = computeRoutineLeaderboard(
      [
        run({ routineId: 'quiet' }),
        run({ routineId: 'busy', startedAtMs: T0 + 5_000 }),
        run({ routineId: 'busy', startedAtMs: T0 + 1_000 }),
      ],
      new Map(),
    );

    expect(board.map((e) => e.routineId)).toEqual(['busy', 'quiet']);
    expect(board[0]!.lastRunAt).toBe(new Date(T0 + 5_000).toISOString());
  });
});

describe('computeWorkflowLeaderboard', () => {
  it('excludes synthetic runs that have no template', () => {
    // A routine targeting a primitive fabricates a one-step run with no
    // templateId; grouping those would collapse them into one "null" row.
    const board = computeWorkflowLeaderboard([
      run({ templateId: 'tpl-1' }),
      run({ templateId: null, templateName: 'Synthetic' }),
    ]);

    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ workflowId: 'tpl-1', executionCount: 1 });
  });
});
