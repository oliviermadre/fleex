import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MoveTicketUseCase } from '../../src/application/use-cases/move-ticket.js';
import { TicketNotFoundError } from '../../src/domain/errors.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { EventBus } from '../../src/application/event-bus.js';

describe('MoveTicketUseCase', () => {
  let ticket: TicketEntity;
  let ticketStore: TicketStorePort;
  let emitted: AnyDomainEvent[];
  let eventBus: EventBus;
  let useCase: MoveTicketUseCase;

  const webActor = { source: 'web' as const, actorType: 'user' as const };

  function setup(status: 'backlog' | 'doing' | 'done' = 'doing', position = 2) {
    ticket = TicketEntity.create({
      id: 'T1', boardId: randomUUID(), displayId: 1, title: 'Ship it', status, position,
    });
    ticketStore = {
      getTicketById: vi.fn().mockResolvedValue(ticket),
      saveTicket: vi.fn().mockResolvedValue(undefined),
      saveActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as TicketStorePort;
    emitted = [];
    eventBus = { emit: vi.fn((...e: AnyDomainEvent[]) => { emitted.push(...e); }) } as unknown as EventBus;
    useCase = new MoveTicketUseCase(ticketStore, eventBus);
  }

  beforeEach(() => setup());

  it('rejects an unknown ticket', async () => {
    vi.mocked(ticketStore.getTicketById).mockResolvedValue(null);

    await expect(useCase.execute({ ticketId: 'nope', toStatus: 'done', actor: webActor }))
      .rejects.toThrow(TicketNotFoundError);
  });

  it('emits ticket.moved and records the activity on a real column change', async () => {
    await useCase.execute({ ticketId: 'T1', toStatus: 'done', actor: webActor });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'ticket.moved', ticketId: 'T1', fromStatus: 'doing', toStatus: 'done', source: 'web',
    });
    expect(ticketStore.saveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'moved' }),
    );
  });

  it('records firstDoingAt the first time a ticket enters doing', async () => {
    setup('backlog');

    await useCase.execute({ ticketId: 'T1', toStatus: 'doing', actor: webActor });

    const activity = vi.mocked(ticketStore.saveActivity).mock.calls[0]![0] as unknown as {
      changes: Record<string, unknown>;
    };
    expect(activity.changes).toHaveProperty('firstDoingAt');
  });

  it('treats a drag inside a column as a reposition, not a move', async () => {
    // A `done → done` ticket.moved would pollute the audit log and force every
    // downstream listener (mention auto-resolve, summary) to guard against it.
    await useCase.execute({ ticketId: 'T1', toStatus: 'doing', position: 5, actor: webActor });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'ticket.updated',
      ticketId: 'T1',
      changes: { position: { from: 2, to: 5 } },
    });
    expect(emitted.some((e) => e.type === 'ticket.moved')).toBe(false);
    // Repositioning isn't a user-visible action — no activity row.
    expect(ticketStore.saveActivity).not.toHaveBeenCalled();
    expect(ticket.position).toBe(5);
  });

  it('does nothing when neither the status nor the position changes', async () => {
    await useCase.execute({ ticketId: 'T1', toStatus: 'doing', position: 2, actor: webActor });

    expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('carries the actor origin and executionId on the move', async () => {
    await useCase.execute({
      ticketId: 'T1',
      toStatus: 'done',
      actor: { source: 'api', actorType: 'agent', actorName: 'builder', executionId: 'exec-3' },
    });

    expect(emitted[0]).toMatchObject({ source: 'api', executionId: 'exec-3' });
    expect(ticketStore.saveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'api', actorType: 'agent', actorName: 'builder' }),
    );
  });
});
