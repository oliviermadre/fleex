import type { WorkflowRun, StepRun, WorkflowStep, TicketDeliverable } from '@fleex/shared';
import { ACTIVE_STATUSES } from '../../stores/workflowRunStore';

/** Minimal execution shape the derivation needs (subset of AgentExecution). */
export interface GateExecutionInput {
  id: string;
  deliverableId?: string | null;
}

export interface GateCard {
  run: WorkflowRun;
  step: WorkflowStep;
  stepRun: StepRun;
  outcomes: string[];
  reviewDeliverables: TicketDeliverable[];
}

/**
 * One card per `human_gate` step run currently in `needs_review` (concurrent
 * runs ⇒ multiple cards) — the approve/reject decision surfaced inline in a
 * ticket thread rather than only in the Workflow tab.
 *
 * The deliverables "to review" are those produced anywhere in the run, resolved
 * via the explicit execution→deliverable FK (never agentName matching), most
 * recent first and deduplicated. Only the LATEST attempt of each step can be
 * awaiting a decision (a re-run supersedes it), matching selectWaitingInputCards
 * so the two card sets partition `needs_review` cleanly.
 *
 * Extracted from TicketComments so every thread surface (comments, Work stream)
 * derives gate cards the same way.
 */
export function selectGateCards(
  runs: WorkflowRun[] | undefined,
  detailByRunId: Record<string, { stepRuns: StepRun[] }>,
  executions: readonly GateExecutionInput[],
  deliverables: readonly TicketDeliverable[],
): GateCard[] {
  const cards: GateCard[] = [];
  const execById = new Map(executions.map((e) => [e.id, e]));
  const deliverableById = new Map(deliverables.map((d) => [d.id, d]));
  for (const run of runs ?? []) {
    if (!ACTIVE_STATUSES.has(run.status)) continue;
    const d = detailByRunId[run.id];
    if (!d) continue;
    const stepById = new Map(run.templateSnapshot.steps.map((s) => [s.id, s]));

    // Deliverables produced anywhere in this run, most recent first, deduped.
    const orderedStepRuns = [...d.stepRuns].sort((a, b) => {
      const ta = a.completedAt ?? a.startedAt ?? a.createdAt;
      const tb = b.completedAt ?? b.startedAt ?? b.createdAt;
      return tb.localeCompare(ta);
    });
    const reviewDeliverables: TicketDeliverable[] = [];
    const seen = new Set<string>();
    for (const sr of orderedStepRuns) {
      if (!sr.executionId) continue;
      const exec = execById.get(sr.executionId);
      if (!exec?.deliverableId) continue;
      const del = deliverableById.get(exec.deliverableId);
      if (del && !seen.has(del.id)) { seen.add(del.id); reviewDeliverables.push(del); }
    }

    // Only the latest attempt of each step can be "awaiting" a decision.
    const latestPerStep = new Map<string, StepRun>();
    for (const sr of d.stepRuns) {
      const cur = latestPerStep.get(sr.stepId);
      if (!cur || sr.attempt > cur.attempt) latestPerStep.set(sr.stepId, sr);
    }
    for (const sr of latestPerStep.values()) {
      if (sr.status !== 'needs_review') continue;
      const step = stepById.get(sr.stepId);
      if (!step || step.executorType !== 'human_gate') continue;
      const outcomes = (sr.output?.schemaFields?.outcomes as string[] | undefined)
        ?? step.humanGateOutcomes ?? [];
      cards.push({ run, step, stepRun: sr, outcomes, reviewDeliverables });
    }
  }
  return cards;
}
