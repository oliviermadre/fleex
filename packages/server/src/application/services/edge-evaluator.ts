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

export const EdgeEvaluator = {
  resolve(ctx: EdgeEvaluationContext, edges: WorkflowEdge[]): WorkflowEdge | null {
    const conditional = edges
      .filter((e) => !e.isDefault && normalizeEdgeCondition(e))
      .sort((a, b) => a.id.localeCompare(b.id));
    const defaults = edges.filter((e) => e.isDefault).sort((a, b) => a.id.localeCompare(b.id));

    for (const edge of conditional) {
      const group = normalizeEdgeCondition(edge);
      if (!group) continue;
      if (evaluateConditionGroup(group, (clause) => readClause(ctx, edge, clause))) {
        return edge;
      }
    }
    return defaults[0] ?? null;
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
