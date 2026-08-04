import type { WorkflowRun, StepRun, WorkflowStep, WorkflowEdge } from '@fleex/shared';
import { ACTIVE_STATUSES } from '../../stores/workflowRunStore';

export interface AmbiguousRoutingCard {
  run: WorkflowRun;
  step: WorkflowStep;
  stepRun: StepRun;
  /** The edges the engine actually saw match — never recomputed from the template. */
  candidates: WorkflowEdge[];
}

/**
 * Steps parked in `awaiting_routing`: the step succeeded, but several outgoing
 * edges matched at once and only a human can say which branch the run should
 * take. Surfaced as an inline card in the Comments thread so the decision is
 * reachable from cockpit / mobile / ticket detail, not just the workflow tab.
 *
 * Two rules make this safe and are pinned by tests:
 *  - candidates come from `stepRun.output.routing.candidateEdgeIds`, persisted at
 *    pause time. Recomputing them from the template snapshot would let a
 *    mid-run template edit silently widen or invalidate the reviewer's choices.
 *  - only the LATEST attempt of a step can be awaiting a route (a re-run
 *    supersedes the parked attempt), matching the gate / waiting-input cards so
 *    the three sets never disagree on which step is live.
 */
export function selectAmbiguousRoutingCards(
  runs: WorkflowRun[] | undefined,
  detailByRunId: Record<string, { stepRuns: StepRun[] }>,
): AmbiguousRoutingCard[] {
  const cards: AmbiguousRoutingCard[] = [];
  for (const run of runs ?? []) {
    if (!ACTIVE_STATUSES.has(run.status)) continue;
    const d = detailByRunId[run.id];
    if (!d) continue;
    const stepById = new Map(run.templateSnapshot.steps.map((s) => [s.id, s]));
    const edgeById = new Map(run.templateSnapshot.edges.map((e) => [e.id, e]));

    const latestPerStep = new Map<string, StepRun>();
    for (const sr of d.stepRuns) {
      const cur = latestPerStep.get(sr.stepId);
      if (!cur || sr.attempt > cur.attempt) latestPerStep.set(sr.stepId, sr);
    }
    for (const sr of latestPerStep.values()) {
      if (sr.status !== 'awaiting_routing') continue;
      const step = stepById.get(sr.stepId);
      if (!step) continue;
      const candidates = (sr.output?.routing?.candidateEdgeIds ?? [])
        .map((id) => edgeById.get(id))
        .filter((e): e is WorkflowEdge => Boolean(e));
      // An edge that vanished from the snapshot can't be offered; with none left
      // there is nothing to decide, so we don't render an empty, un-actionable card.
      if (candidates.length === 0) continue;
      cards.push({ run, step, stepRun: sr, candidates });
    }
  }
  return cards;
}
