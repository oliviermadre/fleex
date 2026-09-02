/**
 * Cumulative flow diagram (C16) and throughput vs WIP (C18).
 *
 * At each bucket boundary we need how many tickets sat in each status. Only a
 * ticket's *current* status is persisted, so the history is reconstructed by
 * replaying `ticket.moved` transitions.
 *
 * Replaying them per boundary is quadratic — every bucket re-walks every
 * ticket's whole move list. Instead we merge all transitions into one
 * chronological stream and sweep it once, snapshotting the running tally as each
 * boundary goes by. Boundaries are non-decreasing (buckets are ascending and the
 * clamp is a constant), so the cursor never rewinds.
 */
import type { CumulativeFlowBucket, ThroughputWipBucket } from '@fleex/shared';
import { FLOW_STATUSES, type FlowStatus } from './constants.js';
import type { StatsBucket } from './buckets.js';
import type { TicketRow, TicketMove } from './rows.js';

export interface CumulativeFlowResult {
  readonly cumulativeFlow: CumulativeFlowBucket[];
  readonly throughputWip: ThroughputWipBucket[];
}

/** A ticket entering a status: its creation into `backlog`, or a recorded move. */
interface StatusEvent {
  readonly atMs: number;
  readonly ticketId: string;
  readonly to: string;
}

function emptyCounts(): Record<FlowStatus, number> {
  return { backlog: 0, todo: 0, doing: 0, reviewing: 0, done: 0 };
}

/**
 * Every transition across every ticket, ordered in time.
 *
 * A ticket's birth is pushed before its moves and the sort is stable, so a move
 * recorded at the exact creation instant still lands after the birth. Tickets
 * whose creation date is unparseable are never visible, and a move with an
 * unparseable date truncates that ticket's timeline — both matching the
 * per-boundary walk this replaced.
 */
function buildEventStream(
  tickets: readonly TicketRow[],
  movesByTicket: ReadonlyMap<string, TicketMove[]>,
): StatusEvent[] {
  const events: StatusEvent[] = [];

  for (const t of tickets) {
    if (Number.isNaN(t.createdAtMs)) continue;
    events.push({ atMs: t.createdAtMs, ticketId: t.id, to: 'backlog' });

    for (const mv of movesByTicket.get(t.id) ?? []) {
      if (!Number.isFinite(mv.atMs)) break;
      events.push({ atMs: mv.atMs, ticketId: t.id, to: mv.to });
    }
  }

  return events.sort((a, b) => a.atMs - b.atMs);
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

  const events = buildEventStream(tickets, movesByTicket);
  const statusOf = new Map<string, string>();
  const counts = emptyCounts();
  let cursor = 0;

  // Buckets are contiguous and ascending, so each completion lands in at most
  // one of them and a single forward cursor suffices.
  const doneMs = opts.doneDates.map((d) => d.getTime()).sort((a, b) => a - b);
  let doneCursor = 0;

  for (const bucket of buckets) {
    // The final bucket's end is already clamped to `to`; this guards the rest.
    const boundaryMs = Math.min(bucket.endMs, opts.toMs);

    while (cursor < events.length && events[cursor]!.atMs <= boundaryMs) {
      const ev = events[cursor]!;
      const prev = statusOf.get(ev.ticketId);
      // `cancelled` is a real status but not a flow column, so it is neither
      // decremented on the way out nor counted on the way in.
      if (prev !== undefined && prev in counts) counts[prev as FlowStatus] -= 1;
      if (ev.to in counts) counts[ev.to as FlowStatus] += 1;
      statusOf.set(ev.ticketId, ev.to);
      cursor++;
    }

    while (doneCursor < doneMs.length && doneMs[doneCursor]! < bucket.startMs) doneCursor++;
    let completed = 0;
    while (doneCursor < doneMs.length && doneMs[doneCursor]! < bucket.endMs) {
      completed++;
      doneCursor++;
    }

    cumulativeFlow.push({ date: bucket.label, ...counts });
    throughputWip.push({
      date: bucket.label,
      completed,
      wip: counts.doing + counts.reviewing,
    });
  }

  return { cumulativeFlow, throughputWip };
}

/** Re-exported so callers can assert the column set without importing constants. */
export { FLOW_STATUSES };
