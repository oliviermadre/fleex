import type { WorkflowRun, StepRun, WorkflowStep } from '@fleex/shared';

export interface FailedStepCard {
  run: WorkflowRun;
  step: WorkflowStep;
  stepRun: StepRun;
}

/**
 * Workflow steps that died (max turns, crash, server restart) — surfaced as an
 * inline "Step failed → Retry" card in the Comments thread.
 *
 * Why this exists: a failing step is completely invisible from Comments today.
 * `RunWorkflowStepUseCase` posts NO comment when a step fails (only the success
 * path persists the step's `comment`), and a workflow step runs via
 * `executeForWorkflowStep` with NO backing mention — so the mention-driven
 * "session crashed" card (`crashedMentionCards`) can never fire for it either.
 * The retry button therefore only lived in the Workflow tab. This selector is
 * the missing signal; the action reuses the very same store call, so the two
 * surfaces can't diverge.
 *
 * Detection mirrors the gate / waiting-input cards, with one deliberate
 * departure:
 *  - only the MOST RECENT run is considered — `RetryStepUseCase` calls
 *    `run.advanceTo()`, which resurrects the run into `running`. Offering retry
 *    on an older failed run would start a second concurrent run on the ticket;
 *  - only the LATEST attempt of a step counts, so a re-run supersedes the card;
 *  - unlike the gate/waiting cards there is NO `executorType` filter: a
 *    `human_gate` that blows up at execution time is just as stuck as an agent.
 */
export function selectFailedStepCards(
  runs: WorkflowRun[] | undefined,
  detailByRunId: Record<string, { stepRuns: StepRun[] }>,
): FailedStepCard[] {
  // R1 — the most recent run only (by startedAt, not array order).
  const latestRun = [...(runs ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!latestRun) return [];

  // R2 — `cancelled` is a deliberate Terminate, `completed` has nothing to retry.
  if (latestRun.status !== 'failed') return [];

  // R3 — step-run status lives in the run detail; render nothing rather than guess.
  const detail = detailByRunId[latestRun.id];
  if (!detail) return [];

  const stepById = new Map(latestRun.templateSnapshot.steps.map((s) => [s.id, s]));

  // R4 — only the latest attempt of each step decides; a retry clears the card.
  const latestPerStep = new Map<string, StepRun>();
  for (const sr of detail.stepRuns) {
    const cur = latestPerStep.get(sr.stepId);
    if (!cur || sr.attempt > cur.attempt) latestPerStep.set(sr.stepId, sr);
  }

  const cards: FailedStepCard[] = [];
  for (const sr of latestPerStep.values()) {
    if (sr.status !== 'failed') continue;
    const step = stepById.get(sr.stepId);
    if (!step) continue; // R5 — no executorType filter, on purpose.
    cards.push({ run: latestRun, step, stepRun: sr });
  }
  return cards;
}
