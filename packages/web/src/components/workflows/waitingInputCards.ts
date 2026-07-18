import type { WorkflowRun, StepRun, WorkflowStep } from '@fleex/shared';
import { ACTIVE_STATUSES } from '../../stores/workflowRunStore';

export interface WaitingInputCard {
  run: WorkflowRun;
  step: WorkflowStep;
  stepRun: StepRun;
}

/**
 * Non-gate workflow steps paused in `needs_review` to ask the human a question —
 * surfaced as inline "reply + retry" cards in the Comments thread.
 *
 * This is the OTHER half of the `needs_review` split: human_gate steps get the
 * approve/reject gate card (rendered from `gateCards`); everything else
 * (agent/panel/skill) that pauses to ask a question gets a waiting-input card
 * here. A paused step emits NO mention (`persistStepArtifacts` → `createdMentions:[]`),
 * so the mention-driven "…is waiting for your reply" banner never fires for it —
 * this restores that missing signal plus the reply action, without leaving Comments.
 *
 * Detection mirrors the gate-card logic exactly, inverting the `human_gate` filter:
 *  - only ACTIVE runs are considered;
 *  - only the LATEST attempt of a step can be awaiting input (a re-run supersedes
 *    the paused attempt), so the two card sets never disagree on which step is live.
 */
export function selectWaitingInputCards(
  runs: WorkflowRun[] | undefined,
  detailByRunId: Record<string, { stepRuns: StepRun[] }>,
): WaitingInputCard[] {
  const cards: WaitingInputCard[] = [];
  for (const run of runs ?? []) {
    if (!ACTIVE_STATUSES.has(run.status)) continue;
    const d = detailByRunId[run.id];
    if (!d) continue;
    const stepById = new Map(run.templateSnapshot.steps.map((s) => [s.id, s]));

    // Only the latest attempt of each step can be "awaiting" a response.
    const latestPerStep = new Map<string, StepRun>();
    for (const sr of d.stepRuns) {
      const cur = latestPerStep.get(sr.stepId);
      if (!cur || sr.attempt > cur.attempt) latestPerStep.set(sr.stepId, sr);
    }
    for (const sr of latestPerStep.values()) {
      if (sr.status !== 'needs_review') continue;
      const step = stepById.get(sr.stepId);
      // Gate steps are covered by the gate card — skip them here.
      if (!step || step.executorType === 'human_gate') continue;
      cards.push({ run, step, stepRun: sr });
    }
  }
  return cards;
}
