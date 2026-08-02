import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { UpdateTicketUseCase } from '../../src/application/use-cases/update-ticket.js';
import { TicketNotFoundError } from '../../src/domain/errors.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { EventBus } from '../../src/application/event-bus.js';

describe('UpdateTicketUseCase', () => {
  let ticket: TicketEntity;
  let ticketStore: TicketStorePort;
  let emitted: AnyDomainEvent[];
  let eventBus: EventBus;
  let useCase: UpdateTicketUseCase;

  const webActor = { source: 'web' as const, actorType: 'user' as const };

  beforeEach(() => {
    ticket = TicketEntity.create({
      id: 'T1', boardId: randomUUID(), displayId: 1, title: 'Original', status: 'doing',
    });
    ticketStore = {
      getTicketById: vi.fn().mockResolvedValue(ticket),
      saveTicket: vi.fn().mockResolvedValue(undefined),
      saveActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as TicketStorePort;

    emitted = [];
    eventBus = { emit: vi.fn((...e: AnyDomainEvent[]) => { emitted.push(...e); }) } as unknown as EventBus;
    useCase = new UpdateTicketUseCase(ticketStore, eventBus);
  });

  it('rejects an unknown ticket', async () => {
    vi.mocked(ticketStore.getTicketById).mockResolvedValue(null);

    await expect(useCase.execute({ ticketId: 'nope', changes: { title: 'x' }, actor: webActor }))
      .rejects.toThrow(TicketNotFoundError);
  });

  it('writes nothing at all when the payload changes nothing', async () => {
    // A PATCH that re-sends the current values is a no-op, not an audit entry:
    // persisting it would produce empty activity rows and no-op WS broadcasts.
    await useCase.execute({ ticketId: 'T1', changes: { title: 'Original' }, actor: webActor });

    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    expect(ticketStore.saveActivity).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('normalizes a dueDate string into a Date, and null into null', async () => {
    await useCase.execute({ ticketId: 'T1', changes: { dueDate: '2026-09-01' }, actor: webActor });
    expect(ticket.dueDate).toBeInstanceOf(Date);
    expect(ticket.dueDate?.toISOString()).toBe(new Date('2026-09-01').toISOString());

    await useCase.execute({ ticketId: 'T1', changes: { dueDate: null }, actor: webActor });
    expect(ticket.dueDate).toBeNull();
  });

  it('turns a favorite toggle into a semantic event only', async () => {
    await useCase.execute({ ticketId: 'T1', changes: { favorite: true }, actor: webActor });

    expect(emitted.map((e) => e.type)).toEqual(['ticket.favorited']);
  });

  it('splits a mixed change into its semantic event plus a reduced ticket.updated', async () => {
    await useCase.execute({ ticketId: 'T1', changes: { favorite: true, title: 'Renamed' }, actor: webActor });

    expect(emitted.map((e) => e.type)).toEqual(['ticket.favorited', 'ticket.updated']);
    const updated = emitted[1] as { changes: Record<string, unknown> };
    expect(Object.keys(updated.changes)).toEqual(['title']);
  });

  it('emits the same semantic events for an agent as for the web', async () => {
    // The agent API used to emit an opaque `ticket.updated` here, so the audit
    // trail recorded the same action in two different shapes.
    await useCase.execute({
      ticketId: 'T1',
      changes: { blocked: true },
      actor: { source: 'api', actorType: 'agent', actorName: 'builder' },
    });

    expect(emitted.map((e) => e.type)).toEqual(['ticket.blocked']);
    expect(ticketStore.saveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'api', actorType: 'agent', actorName: 'builder' }),
    );
  });

  it('skips the activity row in silent mode but still emits', async () => {
    await useCase.execute({ ticketId: 'T1', changes: { title: 'Quietly renamed' }, actor: webActor, silent: true });

    expect(ticketStore.saveActivity).not.toHaveBeenCalled();
    expect(ticketStore.saveTicket).toHaveBeenCalled();
    expect(emitted.map((e) => e.type)).toEqual(['ticket.updated']);
  });

  it('propagates source and executionId onto ticket.updated', async () => {
    await useCase.execute({
      ticketId: 'T1',
      changes: { title: 'From an agent run' },
      actor: { source: 'api', actorType: 'agent', executionId: 'exec-7' },
    });

    expect(emitted[0]).toMatchObject({ type: 'ticket.updated', source: 'api', executionId: 'exec-7' });
  });
});
