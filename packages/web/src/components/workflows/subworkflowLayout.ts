import type { WorkflowTemplateSnapshot, StepRunStatus } from '@fleex/shared';
import { isInsideSubworkflow } from '@fleex/shared';

/**
 * Run-graph layout for a snapshot whose sub-workflows were expanded at launch.
 *
 * The positions copied from the child templates were authored for the child's
 * own canvas, so once several children sit side by side they overlap. Such a
 * run is laid out afresh instead: one column per hop from the entry step, one
 * row per step within a column. Snapshots without sub-workflows keep the
 * positions their author chose.
 */

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 80;
const COLUMN_GAP = 80;
const ROW_GAP = 60;

export type Point = { x: number; y: number };

export function layoutRun(snapshot: WorkflowTemplateSnapshot): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (!snapshot.subworkflows?.length) {
    for (const s of snapshot.steps) positions.set(s.id, s.position);
    return positions;
  }

  // Shortest hop count from the entry: back edges (QA ko → Build) don't push
  // the steps they lead to further right.
  const column = new Map<string, number>([[snapshot.entryStepId, 0]]);
  const queue = [snapshot.entryStepId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of snapshot.edges) {
      if (e.source === id && !column.has(e.target)) {
        column.set(e.target, column.get(id)! + 1);
        queue.push(e.target);
      }
    }
  }
  // Unreachable steps (a dangling branch) still need a place: after the rest.
  const last = Math.max(0, ...column.values());
  const rows = new Map<number, number>();
  for (const s of snapshot.steps) {
    const col = column.get(s.id) ?? last + 1;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    positions.set(s.id, { x: col * (NODE_WIDTH + COLUMN_GAP), y: row * (NODE_HEIGHT + ROW_GAP) });
  }
  return positions;
}

export type GroupStatus = 'pending' | 'running' | 'needs_you' | 'failed' | 'completed';

export interface SubworkflowGroup {
  id: string;
  label: string;
  depth: number;
  status: GroupStatus;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One frame per expanded sub-workflow, around its copied steps and its exit,
 * with a status aggregated from their latest attempts. A nested frame gets
 * less padding than its parent so both borders stay visible.
 */
export function subworkflowGroups(
  snapshot: WorkflowTemplateSnapshot,
  positions: Map<string, Point>,
  statusOf: (stepId: string) => StepRunStatus | 'pending',
): SubworkflowGroup[] {
  const infos = snapshot.subworkflows ?? [];
  const byId = new Map(infos.map((i) => [i.stepId, i]));
  const depthOf = (id: string): number => {
    let depth = 0;
    for (let cur = byId.get(id)?.parentStepId; cur; cur = byId.get(cur)?.parentStepId) depth += 1;
    return depth;
  };

  return infos.flatMap((info) => {
    const members = snapshot.steps
      .map((s) => s.id)
      .filter((id) => id === info.stepId || isInsideSubworkflow(id, info.stepId));
    const points = members.map((id) => positions.get(id)).filter((p): p is Point => !!p);
    if (points.length === 0) return [];
    const depth = depthOf(info.stepId);
    const pad = Math.max(12, 36 - depth * 12);
    const labelSpace = 20;
    const minX = Math.min(...points.map((p) => p.x)) - pad;
    const minY = Math.min(...points.map((p) => p.y)) - pad - labelSpace;
    const maxX = Math.max(...points.map((p) => p.x)) + NODE_WIDTH + pad;
    const maxY = Math.max(...points.map((p) => p.y)) + NODE_HEIGHT + pad;
    return [{
      id: `group:${info.stepId}`,
      label: `${info.emoji ? `${info.emoji} ` : ''}${info.name}`,
      depth,
      status: aggregate(members.map(statusOf), statusOf(info.stepId)),
      x: minX, y: minY, width: maxX - minX, height: maxY - minY,
    }];
  });
}

/**
 * The sub-workflow is done once its exit completed — branches it didn't take
 * stay pending forever and must not hold the frame back.
 */
function aggregate(statuses: (StepRunStatus | 'pending')[], exit: StepRunStatus | 'pending'): GroupStatus {
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'needs_review' || s === 'awaiting_routing')) return 'needs_you';
  if (statuses.some((s) => s === 'running' || s === 'queued')) return 'running';
  if (exit === 'completed') return 'completed';
  return statuses.some((s) => s !== 'pending') ? 'running' : 'pending';
}
