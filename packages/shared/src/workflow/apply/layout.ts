import type { WorkflowEdge, WorkflowStep } from '../../types/workflow.js';
import type { DocumentStep } from './types.js';

export const LAYOUT_COLUMN_WIDTH = 260;
export const LAYOUT_ROW_HEIGHT = 140;

/**
 * Give every step a position, so a template written in a terminal opens as a
 * readable graph in the visual builder.
 *
 * - a step that has a position keeps it;
 * - otherwise a step whose id existed in the previous version keeps its old
 *   position (re-applying a document without positions does not reshuffle the
 *   graph a human arranged);
 * - otherwise, when NO step has a position, steps are laid out in layers by BFS
 *   distance from the entry step (`x = depth × 260`, `y = rank × 140`; back
 *   edges never deepen a layer, cycles are fine);
 * - otherwise the remaining steps are stacked below the existing ones.
 *
 * Returns the steps (same order) and the ids whose position was computed.
 */
export function layoutSteps(
  steps: DocumentStep[],
  edges: WorkflowEdge[],
  entryStepId: string,
  previous: WorkflowStep[] = [],
): { steps: WorkflowStep[]; computed: string[] } {
  const previousPos = new Map(previous.map((s) => [s.id, s.position]));
  const placed = new Map<string, { x: number; y: number }>();
  for (const step of steps) {
    const pos = step.position ?? previousPos.get(step.id);
    if (pos) placed.set(step.id, pos);
  }

  const missing = steps.filter((s) => !placed.has(s.id));
  const computed = missing.map((s) => s.id);

  if (missing.length > 0 && placed.size === 0) {
    const depth = new Map<string, number>([[entryStepId, 0]]);
    const queue = [entryStepId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.source === current && !depth.has(edge.target)) {
          depth.set(edge.target, depth.get(current)! + 1);
          queue.push(edge.target);
        }
      }
    }
    const lastLayer = Math.max(0, ...depth.values()) + 1;
    const ranks = new Map<number, number>();
    for (const step of steps) {
      const d = depth.get(step.id) ?? lastLayer;
      const rank = ranks.get(d) ?? 0;
      ranks.set(d, rank + 1);
      placed.set(step.id, { x: d * LAYOUT_COLUMN_WIDTH, y: rank * LAYOUT_ROW_HEIGHT });
    }
  } else if (missing.length > 0) {
    const bottom = Math.max(...[...placed.values()].map((p) => p.y));
    missing.forEach((step, i) => placed.set(step.id, { x: 0, y: bottom + (i + 1) * LAYOUT_ROW_HEIGHT }));
  }

  return {
    steps: steps.map((s) => ({ ...s, position: placed.get(s.id)! })),
    computed,
  };
}
