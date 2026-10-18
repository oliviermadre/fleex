import type { WorkflowEdge, WorkflowStep } from '@fleex/shared';

/**
 * Steps in the order the run walks them, for the mobile step list: by shortest
 * distance (in edges) from the entry step, ties kept in template order. The
 * template's `steps` array is creation order — a step added last in the editor
 * would otherwise sit at the bottom even when it runs second. Loops (reject →
 * back to an earlier step) don't move anything: a step keeps its first, shortest
 * distance. Steps the entry can't reach go last, in template order.
 */
export function orderStepsByFlow(
  steps: readonly WorkflowStep[],
  edges: readonly WorkflowEdge[],
  entryStepId: string,
): WorkflowStep[] {
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    const list = succs.get(e.source);
    if (list) list.push(e.target);
    else succs.set(e.source, [e.target]);
  }

  const depth = new Map<string, number>([[entryStepId, 0]]);
  const queue = [entryStepId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const next of succs.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(id)! + 1);
      queue.push(next);
    }
  }

  const index = new Map(steps.map((s, i) => [s.id, i]));
  const rank = (s: WorkflowStep) => depth.get(s.id) ?? Number.POSITIVE_INFINITY;
  return [...steps].sort((a, b) => rank(a) - rank(b) || index.get(a.id)! - index.get(b.id)!);
}
