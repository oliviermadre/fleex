import type { AnyDomainEvent, DomainEventType } from '../domain/events.js';

export type DomainEventHandler = (event: AnyDomainEvent) => void | Promise<void>;

/**
 * Lightweight in-process event bus for domain events.
 *
 * Events are dispatched asynchronously (fire-and-forget with error logging).
 * Handlers can subscribe to specific event types or '*' for all events.
 */
export class EventBus {
  private handlers = new Map<string, DomainEventHandler[]>();
  private errorHandler: ((event: AnyDomainEvent, error: unknown) => void) | null = null;

  on(eventType: DomainEventType | '*', handler: DomainEventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  onError(handler: (event: AnyDomainEvent, error: unknown) => void): void {
    this.errorHandler = handler;
  }

  /**
   * Emit one or more domain events. Handlers run asynchronously.
   * Errors in handlers are caught and forwarded to the error handler.
   */
  emit(...events: AnyDomainEvent[]): void {
    for (const event of events) {
      const specific = this.handlers.get(event.type) ?? [];
      const wildcard = this.handlers.get('*') ?? [];

      for (const handler of [...specific, ...wildcard]) {
        try {
          const result = handler(event);
          if (result && typeof result.catch === 'function') {
            result.catch((err) => this.handleError(event, err));
          }
        } catch (err) {
          this.handleError(event, err);
        }
      }
    }
  }

  private handleError(event: AnyDomainEvent, error: unknown): void {
    if (this.errorHandler) {
      this.errorHandler(event, error);
    }
  }
}
