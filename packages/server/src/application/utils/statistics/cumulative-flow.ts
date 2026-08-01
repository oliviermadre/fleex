/**
 * Cumulative flow diagram (C16) and throughput vs WIP (C18).
 *
 * At each bucket boundary we need how many tickets sat in each status. This is
 * reconstructed by replaying `ticket.moved` transitions, since only the ticket's
 * *current* status is persisted.
 */
import type { CumulativeFlowBucket, ThroughputWipBucket } from '@fleex/shared';
import { FLOW_STATUSES, type FlowStatus } from './constants.js';
import type { StatsBucket } from './buckets.js';
import type { TicketRow, TicketMove } from './rows.js';

export interface CumulativeFlowResult {
  readonly cumulativeFlow: CumulativeFlowBucket[];
  readonly throughputWip: ThroughputWipBucket[];
}

/**
 * A ticket's status as of `timeMs`, or `null` before it existed.
 *
 * Both comparisons are inclusive, so a transition landing exactly on a boundary
 * is already applied at that boundary. A ticket whose creation date is
 * unparseable is never visible.
 */
function statusAtTime(
  ticket: TicketRow,
  moves: readonly TicketMove[],
  timeMs: number,
): string | null {
  if (Number.isNaN(ticket.createdAtMs) || ticket.createdAtMs > timeMs) return null;
  let status = 'backlog';
  for (const mv of moves) {
    if (mv.atMs <= timeMs) status = mv.to;
    else break;
  }
  return status;
}

export function computeCumulativeFlow(
  /** *All* tickets — the CFD is a board-wide snapshot, not a window-filtered one. */
  tickets: readonly TicketRow[],
  movesByTicket: ReadonlyMap<string, TicketMove[]>,
  buckets: readonly StatsBucket[],
  opts: { toMs: number; doneDates: readonly Date[] },
): CumulativeFlowResult {
  const cumulativeFlow: CumulativeFlowBucket[] = [];
  const throughputWip: ThroughputWipBucket[] = [];
  const doneMs = opts.doneDates.map((d) => d.getTime());

  for (const bucket of buckets) {
    // The final bucket's end is already clamped to `to`; this guards the rest.
    const boundaryMs = Math.min(bucket.endMs, opts.toMs);

    const counts: Record<FlowStatus, number> = { backlog: 0, todo: 0, doing: 0, reviewing: 0, done: 0 };
    for (const t of tickets) {
      const status = statusAtTime(t, movesByTicket.get(t.id) ?? [], boundaryMs);
      // `cancelled` is a real status but not a flow column — it drops out here.
      if (status !== null && status in counts) counts[status as FlowStatus] += 1;
    }

    cumulativeFlow.push({ date: bucket.label, ...counts });
    throughputWip.push({
      date: bucket.label,
      completed: doneMs.filter((d) => d >= bucket.startMs && d < bucket.endMs).length,
      wip: counts.doing + counts.reviewing,
    });
  }

  return { cumulativeFlow, throughputWip };
}

/** Re-exported so callers can assert the column set without importing constants. */
export { FLOW_STATUSES };
