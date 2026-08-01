/**
 * Lead time (C15), cycle time per status (C17) and per-ticket iteration counts
 * (C14) — all derived from one walk over every ticket's move history.
 *
 * A ticket contributes only if it reached `done` inside `[from, to)`. "Reached
 * done" prefers the last `ticket.moved` transition and falls back to
 * `statusChangedAt` for tickets completed before the audit log existed.
 */
import type { CycleTimeStatus, LeadTimeStats, LeadTimePoint, TicketIterations } from '@fleex/shared';
import { FLOW_STATUSES } from './constants.js';
import { percentile, roundedAvg } from './math.js';
import { accumulateCycleTime, type CycleAccumulator } from './cycle-time.js';
import type { StatsDataset } from './dataset.js';
import type { TicketMove } from './rows.js';

export interface FlowMetrics {
  readonly leadTime: LeadTimeStats;
  readonly cycleTimeByStatus: CycleTimeStatus[];
  readonly ticketIterations: TicketIterations[];
  /** Completion instants in range, consumed by the throughput series. */
  readonly doneDates: Date[];
}

/** How much back-and-forth each ticket saw, over its whole history. */
function countInteractions(dataset: StatsDataset) {
  const ticketOfMention = new Map<string, string>();
  const mentions = new Map<string, number>();
  for (const m of dataset.mentions) {
    ticketOfMention.set(m.id, m.ticketId);
    mentions.set(m.ticketId, (mentions.get(m.ticketId) ?? 0) + 1);
  }

  const comments = new Map<string, number>();
  for (const c of dataset.comments) comments.set(c.ticketId, (comments.get(c.ticketId) ?? 0) + 1);

  const agentRuns = new Map<string, number>();
  for (const e of dataset.executions) {
    if (e.isSkill) continue;
    const tid = ticketOfMention.get(e.mentionId);
    if (!tid) continue;
    agentRuns.set(tid, (agentRuns.get(tid) ?? 0) + 1);
  }

  const workflowRuns = new Map<string, number>();
  for (const r of dataset.workflowRuns) {
    workflowRuns.set(r.ticketId, (workflowRuns.get(r.ticketId) ?? 0) + 1);
  }

  return { mentions, comments, agentRuns, workflowRuns };
}

export function computeFlowMetrics(
  dataset: StatsDataset,
  range: { fromMs: number; toMs: number },
): FlowMetrics {
  const interactions = countInteractions(dataset);
  const leadPoints: LeadTimePoint[] = [];
  const ticketIterations: TicketIterations[] = [];
  const doneDates: Date[] = [];
  const cycleAccum = new Map<string, CycleAccumulator>();

  for (const t of dataset.tickets) {
    const moves = dataset.movesByTicket.get(t.id) ?? [];
    let firstDoing: TicketMove | null = null;
    let lastDone: Date | null = null;
    let lastDoneMs = 0;
    for (const mv of moves) {
      if (mv.to === 'doing' && !firstDoing) firstDoing = mv;
      if (mv.to === 'done') {
        lastDone = mv.at;
        lastDoneMs = mv.atMs;
      }
    }
    // Fallback for tickets done before move history was recorded.
    if (!lastDone && t.status === 'done' && !Number.isNaN(t.statusChangedAtMs)) {
      lastDone = t.statusChangedAt;
      lastDoneMs = t.statusChangedAtMs;
    }
    if (!lastDone || lastDoneMs < range.fromMs || lastDoneMs >= range.toMs) continue;
    doneDates.push(lastDone);

    const mentionsN = interactions.mentions.get(t.id) ?? 0;
    const commentsN = interactions.comments.get(t.id) ?? 0;
    const workflowN = interactions.workflowRuns.get(t.id) ?? 0;
    ticketIterations.push({
      ticketId: t.id,
      title: t.title,
      mentions: mentionsN,
      comments: commentsN,
      agentRuns: interactions.agentRuns.get(t.id) ?? 0,
      workflowRuns: workflowN,
      total: mentionsN + commentsN + workflowN,
    });

    if (firstDoing && lastDoneMs >= firstDoing.atMs) {
      leadPoints.push({
        ticketId: t.id,
        title: t.title,
        doneAt: lastDone.toISOString(),
        leadTimeMs: lastDoneMs - firstDoing.atMs,
      });
    }

    accumulateCycleTime(t.createdAt.getTime(), moves, lastDoneMs, cycleAccum);
  }

  const leadMs = leadPoints.map((p) => p.leadTimeMs).sort((a, b) => a - b);

  return {
    leadTime: {
      points: leadPoints,
      avgMs: roundedAvg(leadMs),
      medianMs: percentile(leadMs, 50),
      p85Ms: percentile(leadMs, 85),
    },
    cycleTimeByStatus: FLOW_STATUSES.filter((s) => s !== 'done').map((status) => {
      const acc = cycleAccum.get(status);
      return {
        status,
        avgMs: acc && acc.count > 0 ? Math.round(acc.total / acc.count) : null,
        count: acc?.count ?? 0,
      };
    }),
    ticketIterations,
    doneDates,
  };
}
