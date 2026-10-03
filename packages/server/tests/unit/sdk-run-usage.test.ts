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

import { carriesSessionTotals, meterSdkRun, classifySession, type HistoricalRun } from '../../src/application/utils/sdk-run-usage.js';

describe('carriesSessionTotals — the CLI regime, never guessed from the numbers', () => {
  it('≥ 2.1.284 carries totals over a resume (verified 78/83 against transcripts)', () => {
    expect(carriesSessionTotals('2.1.284')).toBe(true);
    expect(carriesSessionTotals('2.2.0')).toBe(true);
  });
  it('≤ 2.1.279 reported per-query usage (raw matched transcripts 43/58)', () => {
    expect(carriesSessionTotals('2.1.270')).toBe(false);
    expect(carriesSessionTotals('2.1.143')).toBe(false);
  });
  it('2.1.280–2.1.283 and missing versions are unknown: nothing may be subtracted', () => {
    expect(carriesSessionTotals('2.1.280')).toBeNull();
    expect(carriesSessionTotals(undefined)).toBeNull();
    expect(carriesSessionTotals('garbage')).toBeNull();
  });
});

describe('meterSdkRun — runtime rule', () => {
  const totals = { costUsd: 10.613, inputTokens: 1000 };
  const carryBaseline = { priorRuns: 2, latest: { totals: { costUsd: 8.385, inputTokens: 800 }, cliVersion: '2.1.284' } };

  it('resumed run on a carrying CLI with a same-regime baseline: the delta', () => {
    const m = meterSdkRun(totals, '2.1.284', carryBaseline);
    expect(m.basis).toBe('per_run');
    expect(m.run.costUsd).toBeCloseTo(2.228, 10);
  });

  it('per-query CLI: raw is already the run, never subtract', () => {
    expect(meterSdkRun(totals, '2.1.270', carryBaseline)).toEqual({ run: totals, basis: 'per_run' });
  });

  it('baseline written by an older regime: store raw, flagged unverified', () => {
    const m = meterSdkRun(totals, '2.1.284', { priorRuns: 1, latest: { totals: { costUsd: 2.459 }, cliVersion: '2.1.270' } });
    expect(m).toMatchObject({ run: totals, basis: 'unverified' });
  });

  it('resumed but the previous run left no raw totals (pre-deploy row): unverified, not a guess', () => {
    expect(meterSdkRun(totals, '2.1.284', { priorRuns: 3, latest: null })).toMatchObject({ run: totals, basis: 'unverified' });
  });

  it('fresh session: the totals are the run', () => {
    expect(meterSdkRun(totals, '2.1.284', { priorRuns: 0, latest: null })).toEqual({ run: totals, basis: 'per_run' });
  });

  it('unknown CLI on a resume: unverified', () => {
    expect(meterSdkRun(totals, undefined, carryBaseline)).toMatchObject({ run: totals, basis: 'unverified' });
  });
});

describe('classifySession — historical correction', () => {
  const run = (id: string, cost: number, cliVersion: string | null, tx: number | null = null, basis: HistoricalRun['basis'] = null): HistoricalRun =>
    ({ executionId: id, raw: { costUsd: cost }, basis, cliVersion, transcriptCostUsd: tx });

  it('NEVER rewrites an old per-query session whose costs happen to grow (the trap in the first PR)', () => {
    const d = classifySession([run('a', 1.2, '2.1.270'), run('b', 2.4, '2.1.270'), run('c', 3.1, '2.1.270')]);
    expect(d.map((x) => x.action)).toEqual(['confirm', 'confirm', 'confirm']);
  });

  it('carrying CLI: rewrites to the delta by version when the chain is proven', () => {
    const d = classifySession([run('a', 8.23, '2.1.284'), run('b', 8.385, '2.1.284'), run('c', 10.613, '2.1.284')]);
    expect(d[0]).toMatchObject({ action: 'confirm', evidence: 'fresh-session' });
    expect(d[1]).toMatchObject({ action: 'rewrite', evidence: 'version' });
    expect((d[2] as { run: { costUsd: number } }).run.costUsd).toBeCloseTo(2.228, 10);
  });

  it('the transcript overrides the version (both directions)', () => {
    const d = classifySession([run('a', 5.585, '2.1.284'), run('b', 12.156, '2.1.284', 12.15)]);
    expect(d[1]).toMatchObject({ action: 'confirm', evidence: 'transcript' }); // raw proven
    const e = classifySession([run('a', 5.585, null), run('b', 12.156, null, 6.571)]);
    expect(e[1]).toMatchObject({ action: 'rewrite', evidence: 'transcript' }); // delta proven, version unknown
  });

  it('skips when the transcript matches neither hypothesis, or nothing is known', () => {
    const d = classifySession([run('a', 6.0, '2.1.284'), run('b', 9.0, '2.1.284', 0.5), run('c', 4.0, null)]);
    expect(d[1]).toMatchObject({ action: 'skip' });
    expect(d[2]).toMatchObject({ action: 'skip' });
  });

  it('mixed regimes: a carrying run after a per-query run is not subtracted without proof', () => {
    const d = classifySession([run('a', 2.459, '2.1.270'), run('b', 5.586, '2.1.284')]);
    expect(d[1]).toMatchObject({ action: 'skip' });
  });

  it('is idempotent: already-decided rows are not re-decided, they only serve as the baseline', () => {
    const d = classifySession([run('a', 8.23, '2.1.284', null, 'per_run:backfill'), run('b', 8.385, '2.1.284')]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ executionId: 'b', action: 'rewrite' });
  });
});
