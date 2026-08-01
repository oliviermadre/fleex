/**
 * Narrows a `StatsDataset` to the requested window and distributes it across
 * buckets — once, up front, instead of re-filtering per bucket per aggregate.
 *
 * Range membership is inclusive at both ends (`from <= t <= to`), matching the
 * original `inRange`. Bucket membership is `start <= t < end`, so an item
 * timestamped exactly `to` is in range but in no bucket. That asymmetry is
 * pre-existing and preserved.
 */
import { groupIntoBuckets, type StatsBucket } from './buckets.js';
import type { StatsDataset } from './dataset.js';
import type {
  TicketRow, CommentRow, MentionRow, DeliverableRow, ExecutionRow, SessionRow,
  PanelEventRow, WorkflowRunRow,
} from './rows.js';

export interface StatsSlice {
  readonly buckets: readonly StatsBucket[];

  // ── Rows inside [from, to] ──
  readonly tickets: TicketRow[];
  readonly comments: CommentRow[];
  readonly mentions: MentionRow[];
  readonly deliverables: DeliverableRow[];
  readonly executions: ExecutionRow[];
  readonly sessions: SessionRow[];
  /** Done tickets carrying a PR link, whose move to done happened in range. */
  readonly mergedTickets: TicketRow[];
  readonly workflowRuns: WorkflowRunRow[];

  // ── The same rows, distributed across `buckets` ──
  readonly ticketsByBucket: TicketRow[][];
  readonly commentsByBucket: CommentRow[][];
  readonly mentionsByBucket: MentionRow[][];
  readonly deliverablesByBucket: DeliverableRow[][];
  readonly executionsByBucket: ExecutionRow[][];
  readonly sessionsByBucket: SessionRow[][];
  readonly mergedTicketsByBucket: TicketRow[][];
  readonly panelEventsByBucket: PanelEventRow[][];
  readonly workflowRunsByBucket: WorkflowRunRow[][];
  /**
   * *Every* done ticket bucketed by `statusChangedAt`, not just those created in
   * range — the "tickets done by board" chart counts completions whenever the
   * ticket was opened.
   */
  readonly doneTicketsByBucket: TicketRow[][];
}

export function sliceDataset(
  dataset: StatsDataset,
  buckets: readonly StatsBucket[],
  range: { fromMs: number; toMs: number },
): StatsSlice {
  const { fromMs, toMs } = range;
  const inRange = (t: number) => t >= fromMs && t <= toMs;

  const tickets = dataset.tickets.filter((t) => inRange(t.createdAtMs));
  const comments = dataset.comments.filter((c) => inRange(c.createdAtMs));
  const mentions = dataset.mentions.filter((m) => inRange(m.createdAtMs));
  const deliverables = dataset.deliverables.filter((d) => inRange(d.createdAtMs));
  const executions = dataset.executions.filter((e) => inRange(e.startedAtMs));
  const sessions = dataset.sessions.filter((s) => inRange(s.createdAtMs));
  const workflowRuns = dataset.workflowRuns.filter((r) => inRange(r.startedAtMs));

  const mergedTickets = dataset.tickets.filter(
    (t) => t.status === 'done' && t.prLinkCount > 0 && inRange(t.statusChangedAtMs),
  );
  const doneTickets = dataset.tickets.filter((t) => t.status === 'done');

  return {
    buckets,
    tickets,
    comments,
    mentions,
    deliverables,
    executions,
    sessions,
    mergedTickets,
    workflowRuns,
    ticketsByBucket: groupIntoBuckets(tickets, buckets, (t) => t.createdAtMs),
    commentsByBucket: groupIntoBuckets(comments, buckets, (c) => c.createdAtMs),
    mentionsByBucket: groupIntoBuckets(mentions, buckets, (m) => m.createdAtMs),
    deliverablesByBucket: groupIntoBuckets(deliverables, buckets, (d) => d.createdAtMs),
    executionsByBucket: groupIntoBuckets(executions, buckets, (e) => e.startedAtMs),
    sessionsByBucket: groupIntoBuckets(sessions, buckets, (s) => s.createdAtMs),
    mergedTicketsByBucket: groupIntoBuckets(mergedTickets, buckets, (t) => t.statusChangedAtMs),
    doneTicketsByBucket: groupIntoBuckets(doneTickets, buckets, (t) => t.statusChangedAtMs),
    panelEventsByBucket: groupIntoBuckets(dataset.panelEvents, buckets, (e) => e.occurredAtMs),
    workflowRunsByBucket: groupIntoBuckets(workflowRuns, buckets, (r) => r.startedAtMs),
  };
}
