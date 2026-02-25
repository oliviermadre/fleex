import { EVENT_BUFFER_SIZE } from '@asm/shared';
import type { DomainEvent } from '@asm/shared';
import type { EventBusPort, EventHandler } from '../../application/ports/event-bus.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export class EventBusAdapter implements EventBusPort {
  private handlers = new Map<string, Set<EventHandler>>();
  private anyHandlers = new Set<EventHandler>();
  private buffer: DomainEvent[] = [];
  private readonly maxBuffer: number;

  constructor(
    private readonly logger: LoggerPort,
    maxBuffer: number = EVENT_BUFFER_SIZE,
  ) {
    this.maxBuffer = maxBuffer;
  }

  emit(event: DomainEvent): void {
    // Store in circular buffer for SSE replay
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    this.logger.debug('EventBus emit', { type: event.type, id: event.id });

    // Exact match handlers
    const exact = this.handlers.get(event.type);
    if (exact) {
      for (const h of exact) this.safeCall(h, event);
    }

    // Wildcard namespace handlers (e.g. "ticket.*")
    const ns = event.type.split('.')[0];
    if (ns) {
      const wildcard = this.handlers.get(`${ns}.*`);
      if (wildcard) {
        for (const h of wildcard) this.safeCall(h, event);
      }
    }

    // Any handlers
    for (const h of this.anyHandlers) this.safeCall(h, event);
  }

  on(eventType: string, handler: EventHandler): void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
  }

  onAny(handler: EventHandler): void {
    this.anyHandlers.add(handler);
  }

  off(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  offAny(handler: EventHandler): void {
    this.anyHandlers.delete(handler);
  }

  /** Get events after a given ID for SSE replay */
  getRecentEvents(sinceId?: string): DomainEvent[] {
    if (!sinceId) return [];
    const idx = this.buffer.findIndex((e) => e.id === sinceId);
    if (idx === -1) return [...this.buffer]; // ID not found, return all
    return this.buffer.slice(idx + 1);
  }

  private safeCall(handler: EventHandler, event: DomainEvent): void {
    try {
      handler(event);
    } catch (err) {
      this.logger.error('EventBus handler error', { type: event.type, error: err });
    }
  }
}
