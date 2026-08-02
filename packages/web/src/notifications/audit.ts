import type { DomainEventLog } from '@fleex/shared';

import { toNotification } from './pipeline';

import type { NotificationRendererRegistry } from './registry';
import type { PulseNotification, RendererContext, WsChannelMessage } from './types';

/**
 * Audit-trail → Pulse bridge.
 *
 * The notification center is in-memory, so a full restart (Electron reallocates
 * a dynamic web port → new localStorage origin) would otherwise start from a
 * blank bell. To survive that we rebuild the recent history from the persistent
 * server-side domain-event log (the audit trail) on app load — no SQL migration
 * required, the data is already there.
 *
 * The catch: the audit log stores the leaner *domain* event, while the renderers
 * were written for the richer *WS DTO* broadcast live. They differ in two ways:
 *   1. naming — `deliverable.created` (dot) vs `deliverable:created` (colon);
 *   2. fields — domain `deliverableId`/`mentionId` vs DTO `id`, and the
 *      `deliverable.updated` status lives under `newStatus`.
 *
 * `auditEntryToWsMessage` normalises a log entry into the exact shape the live
 * pipeline already consumes, so a single renderer set serves both paths and the
 * dedup keys line up (a reconstructed entry and its live twin collapse to one).
 */

/** Pull a string field defensively from an unknown payload. */
function s(payload: Record<string, unknown>, key: string): unknown {
  return payload[key];
}

/**
 * Normalise a persisted domain-event log entry into the WS channel message the
 * renderer registry expects, or `null` when the entry is not a Pulse event.
 *
 * Note on `title`: domain events emitted before this field was added won't carry
 * it; the deliverable renderers don't need it (they fall back to the ticket
 * title), so a missing `title` degrades gracefully.
 */
export function auditEntryToWsMessage(entry: DomainEventLog): WsChannelMessage | null {
  const p = entry.payload ?? {};
  switch (entry.eventType) {
    case 'deliverable.created':
      return {
        type: 'deliverable:created',
        data: {
          id: s(p, 'deliverableId'),
          ticketId: s(p, 'ticketId'),
          agentName: s(p, 'agentName'),
          status: s(p, 'status'),
          title: s(p, 'title'),
        },
      };
    case 'deliverable.updated':
      return {
        type: 'deliverable:updated',
        data: {
          id: s(p, 'deliverableId'),
          ticketId: s(p, 'ticketId'),
          agentName: s(p, 'agentName'),
          // domain event carries the transition; the renderer reads `status`
          status: s(p, 'newStatus'),
          title: s(p, 'title'),
        },
      };
    case 'mention.waiting_for_info':
      return {
        type: 'mention:waiting_for_info',
        data: {
          id: s(p, 'mentionId'),
          ticketId: s(p, 'ticketId'),
          targetAgent: s(p, 'targetAgent'),
        },
      };
    // Workflow domain payloads already match what the renderers read 1:1.
    case 'workflow.needs_review':
      return { type: 'workflow:needs_review', data: p };
    case 'workflow.run_completed':
      return { type: 'workflow:run_completed', data: p };
    case 'workflow.run_failed':
      return { type: 'workflow:run_failed', data: p };
    default:
      return null;
  }
}

/**
 * The set of audit-trail event-type *prefixes* whose subtypes can produce a
 * Pulse notification. Derived from the registry so it stays open–closed: adding
 * a renderer for `comment:created` automatically widens the prefixes we query.
 */
export function pulseEventPrefixes(registry: NotificationRendererRegistry): string[] {
  const roots = new Set<string>();
  for (const type of registry.types()) {
    const root = type.split(':')[0];
    if (root) roots.add(root);
  }
  return [...roots];
}

/**
 * Rebuild the notification center from a batch of audit-trail entries.
 *
 * Each entry is normalised, run through the existing renderer pipeline (stamped
 * with the event's real `occurredAt`, not "now"), deduplicated by notification
 * id (newest wins), sorted newest-first, and capped.
 */
export function reconstructNotifications(
  entries: DomainEventLog[],
  registry: NotificationRendererRegistry,
  ctx: RendererContext,
  max = 50,
): PulseNotification[] {
  const byId = new Map<string, PulseNotification>();
  for (const entry of entries) {
    const msg = auditEntryToWsMessage(entry);
    if (!msg) continue;
    const n = toNotification(msg, registry, ctx, () => entry.occurredAt);
    if (!n) continue;
    const existing = byId.get(n.id);
    if (!existing || existing.createdAt < n.createdAt) byId.set(n.id, n);
  }
  return [...byId.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, max);
}
