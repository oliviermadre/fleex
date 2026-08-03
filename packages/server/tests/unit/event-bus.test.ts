import { describe, it, expect, vi } from 'vitest';

import { EventBus } from '../../src/application/event-bus.js';

import type {
  AnyDomainEvent,
  TicketCreatedEvent,
  TicketUpdatedEvent,
} from '../../src/domain/events.js';

describe('EventBus', () => {
  it('should dispatch events to registered handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('ticket.created', handler);
    bus.emit({
      type: 'ticket.created',
      ticketId: 't1',
      boardId: 'b1',
      occurredAt: new Date(),
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.created', ticketId: 't1' }),
    );
  });

  it('should dispatch wildcard handlers for all events', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('*', handler);
    bus.emit(
      { type: 'ticket.created', ticketId: 't1', boardId: 'b1', occurredAt: new Date() },
      { type: 'ticket.deleted', ticketId: 't2', occurredAt: new Date() },
    );

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should not call unrelated handlers', () => {
    const bus = new EventBus();
    const ticketHandler = vi.fn();
    const personaHandler = vi.fn();

    bus.on('ticket.created', ticketHandler);
    bus.on('persona.created', personaHandler);

    bus.emit({ type: 'ticket.created', ticketId: 't1', boardId: 'b1', occurredAt: new Date() });

    expect(ticketHandler).toHaveBeenCalledOnce();
    expect(personaHandler).not.toHaveBeenCalled();
  });

  it('should catch sync errors and forward to error handler', () => {
    const bus = new EventBus();
    const errorHandler = vi.fn();

    bus.onError(errorHandler);
    bus.on('ticket.created', () => {
      throw new Error('sync boom');
    });

    bus.emit({ type: 'ticket.created', ticketId: 't1', boardId: 'b1', occurredAt: new Date() });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket.created' }),
      expect.any(Error),
    );
  });

  it('should catch async errors and forward to error handler', async () => {
    const bus = new EventBus();
    const errorHandler = vi.fn();

    bus.onError(errorHandler);
    bus.on('ticket.created', async () => {
      throw new Error('async boom');
    });

    bus.emit({ type: 'ticket.created', ticketId: 't1', boardId: 'b1', occurredAt: new Date() });

    // Wait for async promise to reject
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it('should support multiple handlers for the same event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('ticket.updated', h1);
    bus.on('ticket.updated', h2);

    bus.emit({ type: 'ticket.updated', ticketId: 't1', changes: {}, occurredAt: new Date() });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('should emit multiple events in one call', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('ticket.created', handler);

    bus.emit(
      { type: 'ticket.created', ticketId: 't1', boardId: 'b1', occurredAt: new Date() },
      { type: 'ticket.created', ticketId: 't2', boardId: 'b1', occurredAt: new Date() },
    );

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
