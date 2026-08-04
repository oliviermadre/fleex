import type { WorkflowEdge, StepOutput, EdgeConditionClause } from '@fleex/shared';
import { normalizeEdgeCondition, evaluateConditionGroup, getByPath } from '@fleex/shared';

/**
 * What a condition can read when the run reaches an edge.
 *
 * `current` is the step the edge leaves from — the only one whose standard
 * fields (`result`, `outcome`, `deliverable.*`) are still around. `steps` holds
 * the `schemaFields` of every earlier completed step, which is what makes
 * "branch on what the step three hops back computed" possible.
 */
export interface EdgeEvaluationContext {
  current: StepOutput;
  steps: Record<string, Record<string, unknown>>;
}

/**
 * Outcome of resolving a step's outgoing edges.
 *
 * `ambiguous` is what makes the engine honest: two edges matching is a *config*
 * problem the engine cannot arbitrate, so it stops and asks instead of silently
 * picking the oldest one.
 */
export type EdgeResolution =
  | { kind: 'single'; edge: WorkflowEdge }
  | { kind: 'ambiguous'; edges: WorkflowEdge[] }
  | { kind: 'none' };

export const EdgeEvaluator = {
  /**
   * Evaluates *every* conditional edge — no short-circuit — because knowing
   * there are two matches is the whole point. Ordering by id is kept only so the
   * candidate list is rendered in a stable (creation) order; it no longer
   * arbitrates anything.
   */
  resolve(ctx: EdgeEvaluationContext, edges: WorkflowEdge[]): EdgeResolution {
    const conditional = edges
      .filter((e) => !e.isDefault && normalizeEdgeCondition(e))
      .sort((a, b) => a.id.localeCompare(b.id));
    const defaults = edges.filter((e) => e.isDefault).sort((a, b) => a.id.localeCompare(b.id));

    const matched: WorkflowEdge[] = [];
    for (const edge of conditional) {
      const group = normalizeEdgeCondition(edge);
      if (!group) continue;
      if (evaluateConditionGroup(group, (clause) => readClause(ctx, edge, clause))) {
        matched.push(edge);
      }
    }

    // A default is a fallback, not a competitor: as soon as one condition matched
    // the defaults are out of the picture, ambiguous or not.
    if (matched.length === 1) return { kind: 'single', edge: matched[0]! };
    if (matched.length > 1) return { kind: 'ambiguous', edges: matched };

    if (defaults.length === 1) return { kind: 'single', edge: defaults[0]! };
    // Two defaults is a save-time error; if one slipped through (template saved
    // before the check existed) we ask rather than pick.
    if (defaults.length > 1) return { kind: 'ambiguous', edges: defaults };
    return { kind: 'none' };
  },
};

function readClause(
  ctx: EdgeEvaluationContext,
  edge: WorkflowEdge,
  clause: EdgeConditionClause,
): unknown {
  // No `stepId` (or one pointing back at the edge's own source) means the
  // merged view of the step that just ran — identical to the legacy behaviour.
  if (!clause.stepId || clause.stepId === edge.source) {
    return getByPath(mergedView(ctx.current), clause.field);
  }
  // A step that never ran leaves nothing here; the clause resolves to
  // `undefined`, which `evaluateClause` turns into `false` rather than an error.
  return getByPath(ctx.steps[clause.stepId], clause.field);
}

function mergedView(output: StepOutput): Record<string, unknown> {
  return {
    ...output.schemaFields,
    deliverable: output.deliverable,
    comment: output.comment,
    mentionStatus: output.mentionStatus,
    outcome: output.outcome,
    result: output.result,
  };
}
