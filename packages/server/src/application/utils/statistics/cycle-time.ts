/** Time-in-status accumulation (C17), split out of the flow-metrics walk. */
import type { TicketMove } from './rows.js';

export interface CycleAccumulator {
  total: number;
  count: number;
}

/**
 * Adds the time this ticket held each non-terminal status to the running totals.
 *
 * The timeline starts at creation in `backlog`; the sort is stable and the birth
 * entry is first, so a move recorded at the exact creation instant still comes
 * after it.
 */
export function accumulateCycleTime(
  createdAtMs: number,
  moves: readonly TicketMove[],
  lastDoneMs: number,
  accum: Map<string, CycleAccumulator>,
): void {
  const seq: Array<{ atMs: number; status: string }> = [{ atMs: createdAtMs, status: 'backlog' }];
  for (const mv of moves) seq.push({ atMs: mv.atMs, status: mv.to });
  seq.sort((a, b) => a.atMs - b.atMs);

  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i]!;
    if (cur.status === 'done' || cur.status === 'cancelled') continue;
    const nextAtMs = i + 1 < seq.length ? seq[i + 1]!.atMs : lastDoneMs;
    const duration = nextAtMs - cur.atMs;
    if (duration <= 0) continue;
    const acc = accum.get(cur.status) ?? { total: 0, count: 0 };
    acc.total += duration;
    acc.count += 1;
    accum.set(cur.status, acc);
  }
}
