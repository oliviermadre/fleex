import type { DomainEvent, EventType } from '@asm/shared';

export type EventHandler = (event: DomainEvent) => void;

export interface EventBusPort {
  emit(event: DomainEvent): void;
  on(eventType: EventType | string, handler: EventHandler): void;
  onAny(handler: EventHandler): void;
  off(eventType: EventType | string, handler: EventHandler): void;
  offAny(handler: EventHandler): void;
}
