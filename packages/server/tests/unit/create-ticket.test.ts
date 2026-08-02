import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateTicketUseCase } from '../../src/application/use-cases/create-ticket.js';
import { BoardNotFoundError } from '../../src/domain/errors.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { EventBus } from '../../src/application/event-bus.js';

describe('CreateTicketUseCase', () => {
  let ticketStore: TicketStorePort;
  let emitted: AnyDomainEvent[];
  let eventBus: EventBus;
  let useCase: CreateTicketUseCase;

  beforeEach(() => {
    ticketStore = {
      getBoardById: vi.fn().mockResolvedValue({ id: 'b1', name: 'Board' }),
      getTicketsByStatus: vi.fn().mockResolvedValue([]),
      createTicket: vi.fn().mockResolvedValue(undefined),
      saveActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as TicketStorePort;

    emitted = [];
    eventBus = { emit: vi.fn((...e: AnyDomainEvent[]) => { emitted.push(...e); }) } as unknown as EventBus;
    useCase = new CreateTicketUseCase(ticketStore, eventBus);
  });

  const webInput = { boardId: 'b1', title: 'Do the thing', actor: { source: 'web' as const, actorType: 'user' as const } };

  it('rejects an unknown board before writing anything', async () => {
    vi.mocked(ticketStore.getBoardById).mockResolvedValue(null);

    await expect(useCase.execute(webInput)).rejects.toThrow(BoardNotFoundError);
    expect(ticketStore.createTicket).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('places a new ticket above the current top of its column', async () => {
    vi.mocked(ticketStore.getTicketsByStatus).mockResolvedValue([
      { position: 7 }, { position: 3 }, { position: 5 },
    ] as TicketEntity[]);

    const ticket = await useCase.execute(webInput);

    expect(ticket.position).toBe(2);
  });

  it('defaults to position 0 in an empty column', async () => {
    const ticket = await useCase.execute(webInput);
    expect(ticket.position).toBe(0);
  });

  it('hydrates links with a generated id and creation timestamp', async () => {
    const ticket = await useCase.execute({
      ...webInput,
      links: [{ type: 'repository', ref: 'org/repo', label: 'org/repo', url: null }],
    });

    expect(ticket.links).toHaveLength(1);
    expect(ticket.links[0]).toMatchObject({ type: 'repository', ref: 'org/repo' });
    expect(ticket.links[0]!.id).toEqual(expect.any(String));
    expect(ticket.links[0]!.createdAt).toEqual(expect.any(String));
  });

  it('records a created activity attributed to the web user', async () => {
    await useCase.execute(webInput);

    expect(ticketStore.saveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', source: 'web', actorType: 'user' }),
    );
  });

  it('attributes agent-authored tickets to the api source', async () => {
    await useCase.execute({
      ...webInput,
      actor: { source: 'api', actorType: 'agent', actorName: 'builder' },
    });

    // TicketActivityEntity.source only knows 'web' | 'api' — everything that
    // isn't the web UI projects onto 'api'.
    expect(ticketStore.saveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', source: 'api', actorType: 'agent', actorName: 'builder' }),
    );
  });

  it('emits ticket.created carrying the board and the origin', async () => {
    const ticket = await useCase.execute(webInput);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'ticket.created', ticketId: ticket.id, boardId: 'b1', source: 'web',
    });
  });

  it('omits executionId unless the action came from an agent execution', async () => {
    await useCase.execute(webInput);
    expect(emitted[0]).not.toHaveProperty('executionId');

    emitted.length = 0;
    await useCase.execute({ ...webInput, actor: { source: 'api', executionId: 'exec-9' } });
    expect(emitted[0]).toMatchObject({ executionId: 'exec-9' });
  });
});
