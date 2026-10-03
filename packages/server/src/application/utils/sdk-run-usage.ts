/**
 * Usage counters as the SDK reports them on a `result` message.
 *
 * Since Claude Code CLI 2.1.284 (agent SDK ≥ 0.3.280, bumped in Fleex on
 * 2026-09-28) these are SESSION totals: a resumed session "continues from the
 * total its transcript saved, so the first result already carries the earlier
 * turns". Older CLIs reported per-query figures. Verified on production data
 * against Claude transcripts: ≤ 2.1.270 the raw value matches the transcript
 * (43/58), at 2.1.284 the delta does (78/83, raw 0/83).
 */
export interface SdkUsageTotals {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** How a stored `cost_usd` should be read. */
export type CostBasis =
  /** This run's own spend (fresh session, old per-query CLI, or computed delta). */
  | 'per_run'
  /** Historical row confirmed/rewritten by `scripts/fix-sdk-session-costs.ts` (revertible). */
  | 'per_run:backfill'
  /** Raw SDK value stored without proof it is per-run — the fix script must look at it. */
  | 'unverified';

const FIELDS = ['costUsd', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'] as const;

/** First CLI verified to carry session totals over a resume. */
export const CARRY_OVER_CLI = '2.1.284';
/** First CLI whose SDK docs mention the carry-over — 2.1.280…2.1.283 are unproven (5 runs, ambiguous). */
const CARRY_OVER_DOCUMENTED_CLI = '2.1.280';

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Does this Claude Code CLI report session totals that carry over a resume?
 * `null` = unknown (no version, or the unproven 2.1.280–2.1.283 range): callers
 * must not subtract anything on an unknown regime.
 */
export function carriesSessionTotals(cliVersion: string | null | undefined): boolean | null {
  if (!cliVersion || !/^\d+\.\d+\.\d+/.test(cliVersion)) return null;
  if (cmpVersion(cliVersion, CARRY_OVER_CLI) >= 0) return true;
  if (cmpVersion(cliVersion, CARRY_OVER_DOCUMENTED_CLI) >= 0) return null;
  return false;
}

/**
 * Totals minus the totals recorded at the end of the previous run of the same
 * SDK session. When any counter went backwards the session restarted its count
 * (transcript without a saved total, or a `/clear`), so the totals are taken
 * whole rather than producing a negative or partial delta.
 *
 * No assumption about caching: the SDK total already includes whatever the run
 * paid (cache writes after an idle gap or a model switch included), so the
 * difference is exact accounting, not an estimate.
 */
export function perRunUsage(totals: SdkUsageTotals, baseline: SdkUsageTotals | null): SdkUsageTotals {
  if (!baseline) return { ...totals };
  const restarted = FIELDS.some((f) => totals[f] != null && totals[f]! < (baseline[f] ?? 0));
  if (restarted) return { ...totals };
  const run: SdkUsageTotals = {};
  for (const f of FIELDS) {
    if (totals[f] != null) run[f] = totals[f]! - (baseline[f] ?? 0);
  }
  return run;
}

/** A crashed run's result "may carry zeroed values": never a baseline. */
export function isUsableBaseline(t: SdkUsageTotals | null | undefined): t is SdkUsageTotals {
  return t?.costUsd != null && t.costUsd > 0;
}

/** What the store knows about earlier runs of a session. */
export interface SdkSessionBaseline {
  /** Earlier executions of this SDK session (any status, any regime). */
  priorRuns: number;
  /** Latest earlier execution that recorded usable raw totals, if any. */
  latest: { totals: SdkUsageTotals; cliVersion: string | null } | null;
}

export interface MeteredRun {
  run: SdkUsageTotals;
  basis: Exclude<CostBasis, 'per_run:backfill'>;
  /** Why the run was not metered as a delta — logged when `basis` is 'unverified'. */
  reason?: string;
}

/**
 * Runtime rule. Subtract only when BOTH this run and its baseline come from a
 * CLI proven to carry session totals; otherwise store the raw value and say
 * whether it is known to be per-run or not.
 */
export function meterSdkRun(totals: SdkUsageTotals, cliVersion: string | null | undefined, baseline: SdkSessionBaseline): MeteredRun {
  const carries = carriesSessionTotals(cliVersion);
  if (carries === false) return { run: { ...totals }, basis: 'per_run' };
  if (baseline.priorRuns === 0) {
    // Fresh session: whatever the regime, the totals are this run.
    return { run: { ...totals }, basis: carries ? 'per_run' : 'unverified', ...(carries ? {} : { reason: `unknown CLI regime (${cliVersion ?? 'no version'})` }) };
  }
  if (carries === null) return { run: { ...totals }, basis: 'unverified', reason: `resumed session, unknown CLI regime (${cliVersion ?? 'no version'})` };
  const b = baseline.latest;
  if (!b || !isUsableBaseline(b.totals) || carriesSessionTotals(b.cliVersion) !== true) {
    return { run: { ...totals }, basis: 'unverified', reason: 'resumed session without a baseline from the same CLI regime' };
  }
  return { run: perRunUsage(totals, b.totals), basis: 'per_run' };
}

// ── Historical correction (scripts/fix-sdk-session-costs.ts) ────────────────

/** One stored execution of a session, oldest first. */
export interface HistoricalRun {
  executionId: string;
  /** What the SDK reported (sdk_total_* when set, else the cost/token columns). */
  raw: SdkUsageTotals;
  /** Current cost_basis column. */
  basis: CostBasis | null;
  /** CLI version: column, else the run's local event log. */
  cliVersion: string | null;
  /** Spend priced from the Claude transcript over the run's time window, when available here. */
  transcriptCostUsd: number | null;
}

export type HistoricalDecision =
  | { executionId: string; action: 'rewrite'; run: SdkUsageTotals; evidence: 'transcript' | 'version' }
  | { executionId: string; action: 'confirm'; evidence: 'transcript' | 'version' | 'fresh-session' }
  | { executionId: string; action: 'skip'; reason: string };

/** Transcript agreement: within 2 cents or 15 % (subagent spend is not in the main transcript). */
export function costsAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.02, 0.15 * Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * Decide, run by run, what a historical session's stored costs really are.
 * Evidence order: transcript (ground truth) → CLI version → nothing (skip).
 * Rows already decided (`per_run*`) are not re-decided — they only provide the
 * baseline for the next run — which makes the correction idempotent.
 */
export function classifySession(runs: HistoricalRun[]): HistoricalDecision[] {
  const out: HistoricalDecision[] = [];
  // Session total at the end of the previous run, and whether it is proven to be one.
  let prev: { totals: SdkUsageTotals; carry: boolean | null } | null = null;

  for (const r of runs) {
    const carryByVersion = carriesSessionTotals(r.cliVersion);
    if (r.basis === 'per_run' || r.basis === 'per_run:backfill') {
      prev = { totals: r.raw, carry: carryByVersion };
      continue;
    }
    const raw = r.raw.costUsd ?? 0;
    const prevUsable = prev && isUsableBaseline(prev.totals) && prev.carry !== false ? prev : null;
    const delta = prevUsable ? perRunUsage(r.raw, prevUsable.totals) : null;
    const deltaIsReal = delta != null && delta.costUsd !== r.raw.costUsd; // not a detected restart

    let decision: HistoricalDecision;
    let carry: boolean | null = carryByVersion;

    if (r.transcriptCostUsd != null) {
      const tx = r.transcriptCostUsd;
      const rawOk = costsAgree(tx, raw);
      const deltaOk = deltaIsReal && costsAgree(tx, delta!.costUsd ?? 0);
      if (deltaOk && !rawOk) {
        decision = { executionId: r.executionId, action: 'rewrite', run: delta!, evidence: 'transcript' };
        carry = true;
      } else if (rawOk && !deltaOk) {
        // Raw = this run's spend. On a carrying CLI that means the session restarted
        // its count, so raw is still the running total the next run continues from.
        decision = { executionId: r.executionId, action: 'confirm', evidence: 'transcript' };
      } else if (rawOk && deltaOk) {
        decision = carryByVersion === true
          ? { executionId: r.executionId, action: 'rewrite', run: delta!, evidence: 'transcript' }
          : { executionId: r.executionId, action: 'skip', reason: 'transcript matches both raw and delta, CLI regime unknown' };
      } else {
        decision = { executionId: r.executionId, action: 'skip', reason: 'transcript matches neither raw nor delta' };
      }
    } else if (carryByVersion === false) {
      decision = { executionId: r.executionId, action: 'confirm', evidence: 'version' };
    } else if (carryByVersion === true && prev === null) {
      decision = { executionId: r.executionId, action: 'confirm', evidence: 'fresh-session' };
    } else if (carryByVersion === true && prev?.carry === true && deltaIsReal) {
      decision = { executionId: r.executionId, action: 'rewrite', run: delta!, evidence: 'version' };
    } else if (carryByVersion === true && prev?.carry === true) {
      // A counter went backwards: the session restarted its count, raw is this run.
      decision = { executionId: r.executionId, action: 'confirm', evidence: 'version' };
    } else {
      decision = {
        executionId: r.executionId,
        action: 'skip',
        reason: carryByVersion === null
          ? `unknown CLI regime (${r.cliVersion ?? 'no version'}) and no transcript here`
          : 'previous run of the session has an unproven regime and no transcript here',
      };
    }
    out.push(decision);
    prev = { totals: r.raw, carry };
  }
  return out;
}
