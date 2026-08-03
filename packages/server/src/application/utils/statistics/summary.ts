/** Global KPI tiles at the top of the statistics page. */
import type { StatisticsSummary, CostBySource } from '@fleex/shared';

import { roundedAvg, sum } from './math.js';

import type { ExecutionRow, SessionRow } from './rows.js';
import type { StatsSlice } from './slice.js';

/** Sums `costUsd` grouped by execution origin. */
export function costBySourceOf(execs: readonly ExecutionRow[]): CostBySource {
  const acc = { sdk: 0, cli: 0 };
  for (const e of execs) acc[e.source] += e.costUsd ?? 0;
  return acc;
}

export function computeSummary(
  slice: StatsSlice,
  /** *All* sessions, not just those created in range — `activeSessions` is a live gauge. */
  allSessions: readonly SessionRow[],
  counts: { panelsExecuted: number; workflowsStarted: number },
): StatisticsSummary {
  const { executions } = slice;

  return {
    worktreesCreated: slice.sessions.filter((s) => s.isWorktree).length,
    prsCreated: sum(slice.tickets.map((t) => t.prLinkCount)),
    prsMerged: slice.mergedTickets.length,
    agentsSpawned: executions.length,
    avgAgentDurationMs: roundedAvg(
      executions.filter((e) => e.durationMs !== null).map((e) => e.durationMs!),
    ),
    deliverablesCreated: slice.deliverables.length,
    commentsCreated: slice.comments.length,
    commentsCreatedByUser: slice.comments.filter((c) => c.authorType === 'user').length,
    commentsCreatedByAgent: slice.comments.filter((c) => c.authorType === 'agent').length,
    mentionsCreated: slice.mentions.length,
    mentionsResolved: slice.mentions.filter((m) => m.status === 'resolved').length,
    ticketsCreated: slice.tickets.length,
    ticketsCompleted: slice.tickets.filter((t) => t.status === 'done').length,
    skillsExecuted: executions.filter((e) => e.isSkill).length,
    panelsExecuted: counts.panelsExecuted,
    workflowsStarted: counts.workflowsStarted,
    totalCostUsd: sum(executions.map((e) => e.costUsd ?? 0)),
    totalCostBySource: costBySourceOf(executions),
    totalInputTokens: sum(executions.map((e) => e.inputTokens ?? 0)),
    totalOutputTokens: sum(executions.map((e) => e.outputTokens ?? 0)),
    activeSessions: allSessions.filter((s) => s.isActive).length,
  };
}
