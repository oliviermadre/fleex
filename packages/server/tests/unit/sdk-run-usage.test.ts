import { describe, it, expect } from 'vitest';
import { perRunUsage, isUsableBaseline } from '../../src/application/utils/sdk-run-usage.js';

/**
 * The SDK's `total_cost_usd` / `modelUsage` are SESSION totals that a resumed
 * session carries over. A run's cost is what it added to the session — not the
 * session's whole history — or every Σ over executions grows quadratically.
 */
describe('perRunUsage', () => {
  it('a fresh session: the totals are the run', () => {
    expect(perRunUsage({ costUsd: 8.23, inputTokens: 10 }, null)).toEqual({ costUsd: 8.23, inputTokens: 10 });
  });

  it('a resumed session: only what this run added (ticket #636, 01:02 → 01:06)', () => {
    const run = perRunUsage(
      { costUsd: 8.385, inputTokens: 120, outputTokens: 3_000, cacheReadTokens: 900_000, cacheCreationTokens: 5_000 },
      { costUsd: 8.23, inputTokens: 100, outputTokens: 2_500, cacheReadTokens: 800_000, cacheCreationTokens: 5_000 },
    );
    expect(run.costUsd).toBeCloseTo(0.155, 10);
    expect(run).toMatchObject({ inputTokens: 20, outputTokens: 500, cacheReadTokens: 100_000, cacheCreationTokens: 0 });
  });

  it('summing per-run shares gives the session total, not a multiple of it', () => {
    const totals = [8.23, 8.385, 10.613, 10.909, 11.087, 11.394, 11.88, 12.217, 14.403];
    let baseline = null as { costUsd: number } | null;
    let sum = 0;
    for (const t of totals) {
      sum += perRunUsage({ costUsd: t }, baseline).costUsd!;
      baseline = { costUsd: t };
    }
    expect(sum).toBeCloseTo(14.403, 10); // was Σ totals ≈ 99.1
  });

  it('a counter going backwards means the session restarted its count: the totals are the run', () => {
    // Transcript without a saved total, or a /clear mid-session.
    expect(perRunUsage({ costUsd: 0.4, inputTokens: 5 }, { costUsd: 12, inputTokens: 900 }))
      .toEqual({ costUsd: 0.4, inputTokens: 5 });
  });

  it('never yields a negative share when only one counter restarted', () => {
    const run = perRunUsage({ costUsd: 13, inputTokens: 5 }, { costUsd: 12, inputTokens: 900 });
    expect(run).toEqual({ costUsd: 13, inputTokens: 5 });
  });
});

describe('isUsableBaseline', () => {
  it('rejects a zeroed snapshot (crashed run) so the next run is not billed the whole history', () => {
    expect(isUsableBaseline({ costUsd: 0 })).toBe(false);
    expect(isUsableBaseline(null)).toBe(false);
    expect(isUsableBaseline({})).toBe(false);
    expect(isUsableBaseline({ costUsd: 0.01 })).toBe(true);
  });
});
