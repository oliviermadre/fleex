import type { AnyDomainEvent, TicketEventSource } from '../events.js';

type TicketDiff = Record<string, { from: unknown; to: unknown }>;

/**
 * Translate a ticket `update()` diff into the audit events to emit.
 *
 * Favorite / blocked / tags changes become *semantic* events
 * (`ticket.favorited`, `ticket.blocked`, `ticket.tagsChanged`, …) so the audit
 * trail records the user's actual intent instead of an opaque `ticket.updated`.
 * Every other changed field stays on a single `ticket.updated` carrying just
 * those remaining keys. When the diff only touched favorite/blocked/tags, no
 * `ticket.updated` is produced at all (avoids a content-less audit row).
 *
 * Pure function: takes the diff, returns the events. The caller emits them and
 * decides the timestamp via `occurredAt`.
 *
 * `meta` (origin of the action) is attached to the generic `ticket.updated`
 * only — the semantic events don't carry it yet, no consumer needs it.
 */
export function deriveTicketUpdateEvents(
  ticketId: string,
  diff: TicketDiff,
  occurredAt: Date,
  meta?: { source?: TicketEventSource; executionId?: string },
): AnyDomainEvent[] {
  const events: AnyDomainEvent[] = [];
  const { favorite: favoriteDiff, blocked: blockedDiff, tags: tagsDiff, ...restDiff } = diff;

  if (favoriteDiff) {
    events.push({
      type: favoriteDiff.to ? 'ticket.favorited' : 'ticket.unfavorited',
      ticketId,
      occurredAt,
    });
  }

  if (blockedDiff) {
    events.push({
      type: blockedDiff.to ? 'ticket.blocked' : 'ticket.unblocked',
      ticketId,
      occurredAt,
    });
  }

  if (tagsDiff) {
    const from = (tagsDiff.from as string[] | undefined) ?? [];
    const to = (tagsDiff.to as string[] | undefined) ?? [];
    const added = to.filter((t) => !from.includes(t));
    const removed = from.filter((t) => !to.includes(t));
    if (added.length > 0 || removed.length > 0) {
      events.push({ type: 'ticket.tagsChanged', ticketId, added, removed, occurredAt });
    }
  }

  if (Object.keys(restDiff).length > 0) {
    events.push({
      type: 'ticket.updated',
      ticketId,
      changes: restDiff,
      occurredAt,
      ...(meta?.source ? { source: meta.source } : {}),
      ...(meta?.executionId ? { executionId: meta.executionId } : {}),
    });
  }

  return events;
}
