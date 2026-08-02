import { describe, it, expect } from 'vitest';

import { GetRepositoryStatsUseCase } from '../../src/application/use-cases/get-repository-stats.js';

const NOW = new Date('2026-07-19T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

function ticket(id: string, ref: string) {
  return { id, links: [{ type: 'repository', ref }] } as never;
}
function exec(costUsd: number | null, startedAt: string) {
  return { costUsd, startedAt } as never;
}

function makeUseCase(
  ticketsByRef: Record<string, unknown[]>,
  execsByTicket: Record<string, unknown[]>,
) {
  return new GetRepositoryStatsUseCase(
    { getTicketsLinkedTo: async (_type, ref) => (ticketsByRef[ref] ?? []) as never },
    { getExecutionsByTicket: async (id) => (execsByTicket[id] ?? []) as never },
  );
}

describe('GetRepositoryStatsUseCase', () => {
  it('returns zeroed stats for a repo with no linked tickets', async () => {
    const stats = await makeUseCase({}, {}).execute('acme', 'app', 30, NOW);
    expect(stats.totalCostUsd).toBe(0);
    expect(stats.costPerTicketUsd).toBe(0);
    expect(stats.dailyCosts).toHaveLength(30);
    expect(stats.dailyCosts.every((d) => d.costUsd === 0)).toBe(true);
  });

  it('sums costs in the window, buckets per day, and computes the previous window', async () => {
    const stats = await makeUseCase(
      { 'acme/app': [ticket('t1', 'acme/app'), ticket('t2', 'acme/app')] },
      {
        t1: [exec(10, daysAgo(1)), exec(5, daysAgo(1)), exec(100, daysAgo(45))],
        t2: [exec(2.5, daysAgo(10)), exec(null, daysAgo(2))],
      },
    ).execute('acme', 'app', 30, NOW);

    expect(stats.totalCostUsd).toBeCloseTo(17.5);
    expect(stats.previousTotalCostUsd).toBeCloseTo(100);
    expect(stats.ticketsWithCostCount).toBe(2);
    expect(stats.costPerTicketUsd).toBeCloseTo(8.75);
    const yesterday = stats.dailyCosts[stats.dailyCosts.length - 2]!;
    expect(yesterday.costUsd).toBeCloseTo(15);
  });

  it('merges tickets found under the lowercased ref without double-counting', async () => {
    const t = ticket('t1', 'Acme/App');
    const stats = await makeUseCase(
      { 'Acme/App': [t], 'acme/app': [t] },
      { t1: [exec(4, daysAgo(3))] },
    ).execute('Acme', 'App', 30, NOW);
    expect(stats.totalCostUsd).toBeCloseTo(4);
  });

  it('counts an execution on the first bucket calendar day in both totalCostUsd and dailyCosts[0]', async () => {
    const stats = await makeUseCase(
      { 'acme/app': [ticket('t1', 'acme/app')] },
      { t1: [exec(7, '2026-06-19T18:00:00Z'), exec(3, '2026-06-20T06:00:00Z')] },
    ).execute('acme', 'app', 30, NOW);

    // 2026-06-19T18:00:00Z is before windowStartDay (2026-06-20T00:00:00Z), so it goes into previousTotalCostUsd
    expect(stats.previousTotalCostUsd).toBeCloseTo(7);
    // 2026-06-20T06:00:00Z is in the window, goes into totalCostUsd and dailyCosts[0]
    expect(stats.totalCostUsd).toBeCloseTo(3);
    expect(stats.dailyCosts[0]!.date).toBe('2026-06-20');
    expect(stats.dailyCosts[0]!.costUsd).toBeCloseTo(3);
    // Ensure sum of dailyCosts buckets matches totalCostUsd (not including previousTotalCostUsd)
    const sumOfBuckets = stats.dailyCosts.reduce((acc, d) => acc + d.costUsd, 0);
    expect(sumOfBuckets).toBeCloseTo(stats.totalCostUsd);
  });
});
