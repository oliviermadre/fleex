/**
 * AC2 — the invariants the cumulative-flow sweep must hold.
 *
 * The sweep replaced a per-boundary rescan of every ticket's move list. The
 * rescan was obviously correct and slow; the sweep is fast and depends on
 * ordering assumptions that are easy to break silently — a transition landing
 * exactly on a boundary, two transitions sharing an instant, a ticket born at
 * the same instant it moves. Each test below pins one of those assumptions.
 *
 * These run against the pure function with plain object literals, because
 * several cases (an unparseable creation date, a transition to a status the CFD
 * does not chart) cannot be produced through the entity layer at all.
 */
process.env['TZ'] = 'UTC';

import { describe, it, expect } from 'vitest';
import type { TicketStatus } from '@fleex/shared';
import { buildBuckets } from '../../src/application/utils/statistics/buckets.js';
import {
  computeCumulativeFlow,
  FLOW_STATUSES,
} from '../../src/application/utils/statistics/cumulative-flow.js';
import type { TicketRow, TicketMove } from '../../src/application/utils/statistics/rows.js';

const DAY_1 = '2026-06-01T00:00:00.000Z';
const DAY_4 = '2026-06-04T00:00:00.000Z';

function ticketAt(id: string, createdAt: string | number, status: TicketStatus = 'backlog'): TicketRow {
  const createdAtMs = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  const at = new Date(createdAtMs);
  return {
    id,
    title: id,
    status,
    boardName: 'Board',
    createdAt: at,
    createdAtMs,
    statusChangedAt: at,
    statusChangedAtMs: createdAtMs,
    prLinkCount: 0,
  };
}

function move(to: string, at: string): TicketMove {
  const atMs = Date.parse(at);
  return { at: new Date(atMs), atMs, to };
}

/** Runs the sweep over daily buckets spanning `[from, to)`. */
function run(
  tickets: TicketRow[],
  moves: Record<string, TicketMove[]>,
  opts: { from?: string; to?: string; doneDates?: Date[]; granularity?: 'day' | 'month' } = {},
) {
  const from = opts.from ?? DAY_1;
  const to = opts.to ?? DAY_4;
  const buckets = buildBuckets(new Date(from), new Date(to), opts.granularity ?? 'day');
  return computeCumulativeFlow(tickets, new Map(Object.entries(moves)), buckets, {
    toMs: Date.parse(to),
    doneDates: opts.doneDates ?? [],
  });
}

describe('computeCumulativeFlow — boundary semantics', () => {
  it('applies a transition landing exactly on a bucket boundary at that boundary', () => {
    // Bucket 0 is [Jun 1, Jun 2); its boundary is Jun 2 00:00 exactly.
    const { cumulativeFlow } = run(
      [ticketAt('t1', DAY_1)],
      { t1: [move('doing', '2026-06-02T00:00:00.000Z')] },
    );

    expect(cumulativeFlow[0]).toMatchObject({ backlog: 0, doing: 1 });
  });

  it('treats a ticket as born in backlog before any move at the same instant', () => {
    const bornAndMoved = '2026-06-01T12:00:00.000Z';
    const { cumulativeFlow } = run(
      [ticketAt('t1', bornAndMoved)],
      { t1: [move('todo', bornAndMoved)] },
    );

    // Birth must not overwrite the move — the ticket ends the day in `todo`,
    // and is counted exactly once.
    expect(cumulativeFlow[0]).toMatchObject({ backlog: 0, todo: 1 });
    expect(FLOW_STATUSES.reduce((n, s) => n + cumulativeFlow[0]![s], 0)).toBe(1);
  });

  it('keeps store order when two moves share an instant, so the last one wins', () => {
    const sameInstant = '2026-06-01T09:00:00.000Z';
    const { cumulativeFlow } = run(
      [ticketAt('t1', DAY_1)],
      { t1: [move('todo', sameInstant), move('doing', sameInstant)] },
    );

    expect(cumulativeFlow[0]).toMatchObject({ todo: 0, doing: 1 });
  });

  it('never double-counts a ticket across the five flow columns', () => {
    const { cumulativeFlow } = run(
      [ticketAt('t1', DAY_1), ticketAt('t2', DAY_1)],
      {
        t1: [move('todo', '2026-06-01T01:00:00.000Z'), move('doing', '2026-06-02T01:00:00.000Z')],
        t2: [move('reviewing', '2026-06-02T02:00:00.000Z'), move('done', '2026-06-03T01:00:00.000Z')],
      },
    );

    for (const bucket of cumulativeFlow) {
      expect(FLOW_STATUSES.reduce((n, s) => n + bucket[s], 0)).toBe(2);
    }
  });
});

describe('computeCumulativeFlow — ticket visibility', () => {
  it('drops a cancelled ticket from every flow column', () => {
    const { cumulativeFlow } = run(
      [ticketAt('t1', DAY_1, 'cancelled')],
      { t1: [move('cancelled', '2026-06-02T12:00:00.000Z')] },
    );

    // Charted while it lived, gone from every column once cancelled.
    expect(FLOW_STATUSES.reduce((n, s) => n + cumulativeFlow[0]![s], 0)).toBe(1);
    expect(FLOW_STATUSES.reduce((n, s) => n + cumulativeFlow[1]![s], 0)).toBe(0);
    expect(FLOW_STATUSES.reduce((n, s) => n + cumulativeFlow[2]![s], 0)).toBe(0);
  });

  it('hides a ticket created after the window entirely', () => {
    const { cumulativeFlow } = run([ticketAt('t1', '2026-07-01T00:00:00.000Z')], {});

    for (const bucket of cumulativeFlow) {
      expect(FLOW_STATUSES.reduce((n, s) => n + bucket[s], 0)).toBe(0);
    }
  });

  it('hides a ticket whose creation date is unparseable', () => {
    // Reachable only at this layer: `TicketEntity.toDTO()` throws on an invalid
    // date, so a NaN row can never come through the store path.
    const { cumulativeFlow } = run([ticketAt('t1', Number.NaN)], {
      t1: [move('doing', '2026-06-02T00:00:00.000Z')],
    });

    for (const bucket of cumulativeFlow) {
      expect(FLOW_STATUSES.reduce((n, s) => n + bucket[s], 0)).toBe(0);
    }
  });

  it('counts a ticket created before the window from the very first bucket', () => {
    const { cumulativeFlow } = run([ticketAt('t1', '2026-05-01T00:00:00.000Z')], {});

    expect(cumulativeFlow[0]).toMatchObject({ backlog: 1 });
  });
});

describe('computeCumulativeFlow — throughput', () => {
  it('excludes a completion landing exactly on `to`', () => {
    // Buckets tile [from, to), so the instant `to` itself belongs to no bucket.
    const { throughputWip } = run([], {}, { doneDates: [new Date(DAY_4)] });

    expect(throughputWip.reduce((n, b) => n + b.completed, 0)).toBe(0);
  });

  it('assigns each completion to exactly one bucket', () => {
    const doneDates = [
      new Date('2026-06-01T05:00:00.000Z'),
      new Date('2026-06-02T00:00:00.000Z'), // exactly on a boundary → next bucket
      new Date('2026-06-03T23:59:59.999Z'),
    ];
    const { throughputWip } = run([], {}, { doneDates });

    expect(throughputWip.map((b) => b.completed)).toEqual([1, 1, 1]);
  });

  it('is unaffected by the order completions arrive in', () => {
    const dates = [
      new Date('2026-06-03T10:00:00.000Z'),
      new Date('2026-06-01T10:00:00.000Z'),
      new Date('2026-06-02T10:00:00.000Z'),
    ];
    const shuffled = run([], {}, { doneDates: dates });
    const sorted = run([], {}, { doneDates: [...dates].sort((a, b) => a.getTime() - b.getTime()) });

    expect(shuffled.throughputWip).toEqual(sorted.throughputWip);
  });

  it('reports WIP as doing + reviewing only', () => {
    const { throughputWip } = run(
      [ticketAt('t1', DAY_1), ticketAt('t2', DAY_1), ticketAt('t3', DAY_1)],
      {
        t1: [move('doing', '2026-06-01T01:00:00.000Z')],
        t2: [move('reviewing', '2026-06-01T01:00:00.000Z')],
        t3: [move('done', '2026-06-01T01:00:00.000Z')],
      },
    );

    expect(throughputWip[0]!.wip).toBe(2);
  });
});

describe('computeCumulativeFlow — degenerate ranges', () => {
  it('emits nothing when the range is empty', () => {
    const result = run([ticketAt('t1', DAY_1)], {}, { from: DAY_4, to: DAY_4 });

    expect(result.cumulativeFlow).toEqual([]);
    expect(result.throughputWip).toEqual([]);
  });

  it('clamps the final month bucket to `to` rather than reading past it', () => {
    const lateJune = '2026-06-20T00:00:00.000Z';
    const { cumulativeFlow } = run(
      [ticketAt('t1', '2026-05-10T00:00:00.000Z')],
      // A move after `to` must not be visible in the clamped final bucket.
      { t1: [move('done', '2026-06-25T00:00:00.000Z')] },
      { from: '2026-05-01T00:00:00.000Z', to: lateJune, granularity: 'month' },
    );

    expect(cumulativeFlow).toHaveLength(2);
    expect(cumulativeFlow[1]).toMatchObject({ backlog: 1, done: 0 });
  });
});
