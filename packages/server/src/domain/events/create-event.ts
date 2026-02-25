import { randomUUID } from 'node:crypto';
import type { DomainEvent, EventMeta, EventType } from '@asm/shared';

export function createEvent<T extends EventType, P>(
  type: T,
  payload: P,
  meta: Partial<EventMeta> = {},
): DomainEvent<T, P> {
  return {
    id: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    payload,
    meta: {
      source: meta.source ?? 'use-case',
      actor: meta.actor,
      correlationId: meta.correlationId,
    },
  };
}
