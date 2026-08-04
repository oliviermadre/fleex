import type { WorkflowStep, WorkflowEdge } from '../types/workflow.js';

/**
 * Reachability analysis over a workflow DAG.
 *
 * Extracted from `native-operations/validate.ts` so edge conditions can use the
 * exact same notions of "runs before me" and "is guaranteed to have run": a
 * `{{ steps.x.y }}` reference in a native step and a `stepId` in an edge clause
 * face the same question, and must answer it identically.
 */

/** For each step, the set of steps that can reach it (transitive predecessors). */
export function computeAncestors(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
): Map<string, Set<string>> {
  const preds = new Map<string, string[]>();
  for (const step of steps) preds.set(step.id, []);
  for (const edge of edges) preds.get(edge.target)?.push(edge.source);

  const result = new Map<string, Set<string>>();
  for (const step of steps) {
    const seen = new Set<string>();
    const queue = [...(preds.get(step.id) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      queue.push(...(preds.get(current) ?? []));
    }
    result.set(step.id, seen);
  }
  return result;
}

/**
 * Classic iterative dominator analysis. `X ∈ dom(S)` means every path from the
 * entry step to S passes through X — i.e. if S runs, X is guaranteed to have
 * run. Anything weaker only warrants a warning, because a step on a
 * not-taken branch never lands in `previousOutputs`.
 */
export function computeDominators(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  entryStepId: string,
): Map<string, Set<string>> {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const step of steps) {
    preds.set(step.id, []);
    succs.set(step.id, []);
  }
  for (const edge of edges) {
    preds.get(edge.target)?.push(edge.source);
    succs.get(edge.source)?.push(edge.target);
  }

  // Restrict the analysis to what the entry can actually reach.
  const reachable = new Set<string>([entryStepId]);
  const queue = [entryStepId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of succs.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const dom = new Map<string, Set<string>>();
  for (const id of reachable) {
    dom.set(id, id === entryStepId ? new Set([entryStepId]) : new Set(reachable));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reachable) {
      if (id === entryStepId) continue;
      const livePreds = (preds.get(id) ?? []).filter((p) => reachable.has(p));
      let next: Set<string>;
      if (livePreds.length === 0) {
        next = new Set([id]);
      } else {
        const first = dom.get(livePreds[0] as string) ?? new Set<string>();
        next = new Set(first);
        for (const p of livePreds.slice(1)) {
          const other = dom.get(p) ?? new Set<string>();
          for (const value of [...next]) if (!other.has(value)) next.delete(value);
        }
        next.add(id);
      }
      const current = dom.get(id);
      if (!current || current.size !== next.size || [...next].some((v) => !current.has(v))) {
        dom.set(id, next);
        changed = true;
      }
    }
  }
  return dom;
}
