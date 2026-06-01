import type { ActiveRecentTicket, TicketActivitySource, TicketStatus } from '@fleex/shared';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';

/** Minimal ticket shape, already filtered to active (≠ done/cancelled). */
export interface ActiveRecentTicketInput {
  readonly id: string;
  readonly displayId: number;
  readonly title: string;
  readonly status: TicketStatus;
  readonly updatedAt: string;
}

export interface ActiveRecentTicketsDeps {
  readonly tickets: ActiveRecentTicketInput[];
  readonly commentStore: CommentStorePort;
  readonly deliverableStore: DeliverableStorePort;
  readonly mentionStore: MentionStorePort;
  readonly now: Date;
  /** Activity window in days. Default 7. */
  readonly windowDays?: number;
}

const DAY_MS = 86_400_000;

/** Reduce records to a map of ticketId → latest timestamp (ms). */
function latestByTicket<T>(records: T[], ticketId: (r: T) => string, at: (r: T) => Date): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    const ms = at(r).getTime();
    const prev = map.get(ticketId(r));
    if (prev === undefined || ms > prev) map.set(ticketId(r), ms);
  }
  return map;
}

/**
 * Active tickets (≠ done/cancelled) that had activity within the window, where
 * "activity" is the most recent of: ticket update, last comment, last
 * deliverable, last mention. Each store is queried defensively so one failing
 * source degrades that signal rather than the whole section.
 */
export async function getActiveRecentTickets(deps: ActiveRecentTicketsDeps): Promise<ActiveRecentTicket[]> {
  const windowMs = (deps.windowDays ?? 7) * DAY_MS;
  const nowMs = deps.now.getTime();
  const ids = deps.tickets.map((t) => t.id);
  if (ids.length === 0) return [];

  const idSet = new Set(ids);
  const [comments, deliverables, mentions] = await Promise.all([
    deps.commentStore.getByTicketIds(ids).catch(() => []),
    deps.deliverableStore.getByTicketIds(ids).catch(() => []),
    deps.mentionStore.getAll().catch(() => []),
  ]);

  const commentMax = latestByTicket(comments, (c) => c.ticketId, (c) => c.updatedAt);
  const deliverableMax = latestByTicket(deliverables, (d) => d.ticketId, (d) => d.updatedAt);
  const mentionMax = latestByTicket(
    mentions.filter((m) => idSet.has(m.ticketId)),
    (m) => m.ticketId,
    (m) => m.createdAt,
  );

  const result: ActiveRecentTicket[] = [];
  for (const t of deps.tickets) {
    const updatedMs = Date.parse(t.updatedAt);
    const candidates: { source: TicketActivitySource; ms: number }[] = [
      { source: 'updated', ms: updatedMs },
    ];
    const c = commentMax.get(t.id);
    if (c !== undefined) candidates.push({ source: 'comment', ms: c });
    const d = deliverableMax.get(t.id);
    if (d !== undefined) candidates.push({ source: 'deliverable', ms: d });
    const m = mentionMax.get(t.id);
    if (m !== undefined) candidates.push({ source: 'mention', ms: m });

    const lastActivityMs = Math.max(...candidates.map((x) => x.ms));
    if (Number.isNaN(lastActivityMs) || nowMs - lastActivityMs >= windowMs) continue;

    // Sources whose own activity falls inside the window.
    const activitySources = candidates
      .filter((x) => !Number.isNaN(x.ms) && nowMs - x.ms < windowMs)
      .map((x) => x.source);

    result.push({
      id: t.id,
      displayId: t.displayId,
      title: t.title,
      status: t.status,
      lastActivityAt: new Date(lastActivityMs).toISOString(),
      activitySources,
    });
  }

  return result.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}
