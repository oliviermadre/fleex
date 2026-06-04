import type { StepRun } from '@fleex/shared';

/**
 * Number of DISTINCT steps whose latest attempt is completed.
 *
 * The header shows "X/total steps completed" where total is the number of distinct
 * template steps, so the numerator must count steps too — not step-run rows. The
 * reject loop-back (e.g. spec → reject → spec → gate waiting) produces several
 * 'completed' rows that must not inflate the count:
 *  - a step re-run after a reject has multiple completed attempts but is ONE step;
 *  - a rejected human gate's step-run is marked 'completed' (resolveGate), yet it has
 *    been superseded by a newer attempt back in 'needs_review'.
 * Only the latest attempt per step counts, so the number matches the live path.
 */
export function countCompletedSteps(stepRuns: StepRun[]): number {
  const latestPerStep = new Map<string, StepRun>();
  for (const sr of stepRuns) {
    const cur = latestPerStep.get(sr.stepId);
    if (!cur || sr.attempt > cur.attempt) latestPerStep.set(sr.stepId, sr);
  }
  let count = 0;
  for (const sr of latestPerStep.values()) {
    if (sr.status === 'completed') count += 1;
  }
  return count;
}
