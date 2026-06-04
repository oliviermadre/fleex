import type { NotificationRenderer } from './types';

/**
 * Open–closed registry mapping a WS event type (e.g. `deliverable:created`) to
 * the renderer that turns its payload into a notification draft.
 *
 * Adding support for a new event type is purely additive: call `register` with
 * the new type and renderer. Nothing else in the pipeline needs to change.
 */
export class NotificationRendererRegistry {
  private readonly renderers = new Map<string, NotificationRenderer>();

  /** Register (or replace) the renderer for a WS event type. Chainable. */
  register(eventType: string, renderer: NotificationRenderer): this {
    this.renderers.set(eventType, renderer);
    return this;
  }

  get(eventType: string): NotificationRenderer | undefined {
    return this.renderers.get(eventType);
  }

  has(eventType: string): boolean {
    return this.renderers.has(eventType);
  }

  /** Registered event types — mainly for tests / introspection. */
  types(): string[] {
    return [...this.renderers.keys()];
  }
}

/** App-wide singleton. Default renderers are registered in ./renderers. */
export const notificationRegistry = new NotificationRendererRegistry();
