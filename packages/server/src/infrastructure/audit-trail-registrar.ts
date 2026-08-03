import { randomUUID } from 'node:crypto';
import type { AnyDomainEvent } from '../domain/events.js';
import type { DomainEventLogStorePort } from '../application/ports/domain-event-log-store.port.js';
import { DomainEventLogEntity } from '../domain/entities/domain-event-log.entity.js';
import type { EventBus } from '../application/event-bus.js';

/**
 * High-frequency, ephemeral signals (driven by Claude Code hooks) whose source
 * of truth is already the corresponding entity row. Persisting them would also
 * create one duplicate row per running instance when storage is shared
 * (Supabase/pgsql).
 */
const AUDIT_EXCLUDED_EVENTS = new Set<string>(['session.hookStatusChanged']);

/**
 * Whether an event should leave a row in the audit trail.
 *
 * Broadcasting and auditing are two separate jobs done by two subscribers of
 * the same bus. An event can therefore be delivered to WS clients while leaving
 * no trace — that is what `audit: false` means (see {@link DomainEvent.audit}),
 * and it is what `?silent=true` relies on.
 */
export function isAuditable(event: AnyDomainEvent): boolean {
  if (AUDIT_EXCLUDED_EVENTS.has(event.type)) return false;
  if (event.audit === false) return false;
  return true;
}

/**
 * Persist every auditable domain event.
 *
 * Only the originating bus is registered — `remoteEventBus` is deliberately
 * left out so an event keeps a single audit row across the cluster.
 */
export function registerAuditTrail(
  bus: EventBus,
  store: DomainEventLogStorePort,
  instanceId: string,
): void {
  bus.on('*', (event) => {
    if (!isAuditable(event)) return;
    return store.save(
      DomainEventLogEntity.create({
        id: randomUUID(),
        eventType: event.type,
        payload: { ...event } as Record<string, unknown>,
        instanceId,
        occurredAt: event.occurredAt,
      }),
    );
  });
}
