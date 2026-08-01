/**
 * The five "who ran what, how often, how well" tables.
 *
 * All share the same shape: group by an id, derive counts and averages, then
 * sort by volume descending. `Array.prototype.sort` is stable, so ties keep the
 * order in which the group was first seen.
 */
import type {
  AgentLeaderboardEntry, SkillLeaderboardEntry, PanelLeaderboardEntry, WorkflowLeaderboardEntry,
  RoutineLeaderboardEntry,
} from '@fleex/shared';
import { avg, roundedAvg, sum } from './math.js';
import type { ExecutionRow, PanelEventRow, WorkflowRunRow, NamedRef, RoutineRef } from './rows.js';

function groupByKey<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export function computeAgentLeaderboard(
  executions: readonly ExecutionRow[],
  personaById: ReadonlyMap<string, NamedRef>,
): AgentLeaderboardEntry[] {
  return [...groupByKey(executions, (e) => e.personaId).entries()]
    .map(([personaId, execs]) => {
      const persona = personaById.get(personaId);
      const completed = execs.filter((e) => e.status === 'completed');
      const durations = completed.filter((e) => e.durationMs !== null).map((e) => e.durationMs!);
      const costs = execs.filter((e) => e.costUsd !== null).map((e) => e.costUsd!);
      const inToks = execs.filter((e) => e.inputTokens !== null).map((e) => e.inputTokens!);
      const outToks = execs.filter((e) => e.outputTokens !== null).map((e) => e.outputTokens!);

      return {
        personaId,
        personaName: persona?.name ?? personaId,
        personaDisplayName: persona?.displayName ?? personaId,
        spawnCount: execs.length,
        avgDurationMs: roundedAvg(durations),
        completedCount: completed.length,
        failedCount: execs.filter((e) => e.status === 'failed').length,
        totalCostUsd: sum(costs),
        avgCostUsd: avg(costs),
        totalInputTokens: sum(inToks),
        totalOutputTokens: sum(outToks),
        avgInputTokens: roundedAvg(inToks),
        avgOutputTokens: roundedAvg(outToks),
      };
    })
    .sort((a, b) => b.spawnCount - a.spawnCount);
}

export function computeSkillLeaderboard(
  skillExecutions: readonly ExecutionRow[],
  skillById: ReadonlyMap<string, NamedRef>,
): SkillLeaderboardEntry[] {
  return [...groupByKey(skillExecutions, (e) => e.skillId!).entries()]
    .map(([skillId, execs]) => {
      const skill = skillById.get(skillId);
      return {
        skillId,
        skillName: skill?.name ?? skillId,
        skillDisplayName: skill?.displayName ?? skillId,
        executionCount: execs.length,
        completedCount: execs.filter((e) => e.status === 'completed').length,
        failedCount: execs.filter((e) => e.status === 'failed').length,
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount);
}

export function computePanelLeaderboard(events: readonly PanelEventRow[]): PanelLeaderboardEntry[] {
  return [...groupByKey(events, (e) => e.panelId).entries()]
    .map(([panelId, execs]) => {
      // Matched against the *raw* payload id, so a group keyed "unknown" because
      // its events carried no panelId finds nothing and falls back to the key.
      const named = events.find((e) => e.rawPanelId === panelId);
      const completed = execs.filter((e) => e.status === 'completed');
      const durations = completed.map((e) => e.durationMs).filter((d) => d > 0);
      const responded = completed.map((e) => e.respondedMembers);
      const avgResponded = avg(responded);

      return {
        panelId,
        panelName: named?.panelName ?? panelId,
        panelDisplayName: named?.panelDisplayName ?? panelId,
        executionCount: execs.length,
        completedCount: completed.length,
        failedCount: execs.filter((e) => e.status === 'failed').length,
        avgDurationMs: roundedAvg(durations),
        avgRespondedMembers: avgResponded === null ? null : Math.round(avgResponded * 10) / 10,
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount);
}

/** Completed runs' durations, in the order the group was built. */
function completedDurations(group: readonly WorkflowRunRow[]): number[] {
  return group
    .filter((r) => r.status === 'completed' && r.durationMs !== null)
    .map((r) => r.durationMs!)
    .filter((d) => d > 0);
}

export function computeWorkflowLeaderboard(runs: readonly WorkflowRunRow[]): WorkflowLeaderboardEntry[] {
  // Synthetic runs (routine → single primitive) have no template: they'd all
  // collapse into one meaningless "null" row, so they stay off the board.
  const templated = runs.filter((r) => r.templateId !== null);
  return [...groupByKey(templated, (r) => r.templateId!).entries()]
    .map(([templateId, group]) => {
      const name = group[0]?.templateName ?? templateId;
      const durations = completedDurations(group);
      return {
        workflowId: templateId,
        workflowName: name,
        workflowDisplayName: name,
        executionCount: group.length,
        completedCount: group.filter((r) => r.status === 'completed').length,
        failedCount: group.filter((r) => r.status === 'failed').length,
        avgDurationMs: roundedAvg(durations),
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount);
}

/**
 * Routine-anchored runs in range, grouped by routine.
 *
 * Routines are the one launcher no other board can show: a routine that targets
 * a primitive produces runs with no templateId, so it is absent from the
 * workflow board, and its steps are attributed to the primitive, not to the
 * routine. A routine deleted since its runs still gets a row — dropping it
 * would silently change historical totals.
 */
export function computeRoutineLeaderboard(
  runs: readonly WorkflowRunRow[],
  routineById: ReadonlyMap<string, RoutineRef>,
): RoutineLeaderboardEntry[] {
  const anchored = runs.filter((r) => r.routineId);
  return [...groupByKey(anchored, (r) => r.routineId!).entries()]
    .map(([routineId, group]) => {
      const routine = routineById.get(routineId);
      const lastRunAtMs = group.reduce((acc, r) => (r.startedAtMs > acc ? r.startedAtMs : acc), -Infinity);
      return {
        routineId,
        routineName: routine?.name ?? group[0]?.templateName ?? routineId,
        targetKind: routine?.target.kind ?? 'workflow',
        targetRef: routine?.target.ref ?? '',
        executionCount: group.length,
        completedCount: group.filter((r) => r.status === 'completed').length,
        failedCount: group.filter((r) => r.status === 'failed').length,
        avgDurationMs: roundedAvg(completedDurations(group)),
        lastRunAt: Number.isFinite(lastRunAtMs) ? new Date(lastRunAtMs).toISOString() : null,
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount);
}
