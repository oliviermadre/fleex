/**
 * Per-bucket series backing every chart and KPI sparkline.
 *
 * Panels and workflows used to be emitted as `0` here and patched in afterwards,
 * because they were fetched later than the rest. All I/O now happens in one
 * phase, so every field is final on first write.
 */
import type { StatisticsTimeBucket } from '@fleex/shared';
import { sum } from './math.js';
import { costBySourceOf } from './summary.js';
import type { StatsSlice } from './slice.js';
import type { NamedRef } from './rows.js';

export function computeTimeSeries(
  slice: StatsSlice,
  personaById: ReadonlyMap<string, NamedRef>,
): StatisticsTimeBucket[] {
  return slice.buckets.map((bucket, i) => {
    const bExecutions = slice.executionsByBucket[i]!;
    const bComments = slice.commentsByBucket[i]!;
    const bTickets = slice.ticketsByBucket[i]!;

    const costByAgent: Record<string, number> = {};
    for (const e of bExecutions) {
      if (e.costUsd == null || e.costUsd === 0) continue;
      const p = personaById.get(e.personaId);
      const name = p?.displayName ?? p?.name ?? e.personaId;
      costByAgent[name] = (costByAgent[name] ?? 0) + e.costUsd;
    }

    const ticketsDoneByBoard: Record<string, number> = {};
    for (const t of slice.doneTicketsByBucket[i]!) {
      ticketsDoneByBoard[t.boardName] = (ticketsDoneByBoard[t.boardName] ?? 0) + 1;
    }

    return {
      date: bucket.label,
      worktreesCreated: slice.sessionsByBucket[i]!.filter((s) => s.isWorktree).length,
      prsCreated: sum(bTickets.map((t) => t.prLinkCount)),
      // Tickets with a PR link that moved to done within this bucket.
      prsMerged: slice.mergedTicketsByBucket[i]!.length,
      agentsSpawned: bExecutions.length,
      deliverablesCreated: slice.deliverablesByBucket[i]!.length,
      commentsCreated: bComments.length,
      commentsCreatedByUser: bComments.filter((c) => c.authorType === 'user').length,
      commentsCreatedByAgent: bComments.filter((c) => c.authorType === 'agent').length,
      mentionsCreated: slice.mentionsByBucket[i]!.length,
      mentionsResolved: slice.mentionsByBucket[i]!.filter((m) => m.status === 'resolved').length,
      ticketsCreated: bTickets.length,
      ticketsCompleted: bTickets.filter((t) => t.status === 'done').length,
      skillsExecuted: bExecutions.filter((e) => e.isSkill).length,
      panelsExecuted: slice.panelEventsByBucket[i]!.length,
      workflowsStarted: slice.workflowRunsByBucket[i]!.length,
      totalCostUsd: sum(bExecutions.map((e) => e.costUsd ?? 0)),
      costBySource: costBySourceOf(bExecutions),
      costByAgent,
      ticketsDoneByBoard,
    };
  });
}
