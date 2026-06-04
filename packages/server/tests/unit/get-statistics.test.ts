import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GetStatisticsUseCase } from '../../src/application/use-cases/get-statistics.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { BoardEntity } from '../../src/domain/entities/board.entity.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { SessionStorePort } from '../../src/application/ports/session-store.port.js';

/**
 * Builds a done TicketEntity on a given board whose status transitioned at
 * `doneAt`. `statusChangedAt` is the signal the chart buckets tickets by.
 */
function doneTicket(boardId: string, doneAt: string, status: 'done' | 'doing' = 'done'): TicketEntity {
  const ticket = TicketEntity.create({
    id: randomUUID(),
    boardId,
    displayId: 1,
    title: 'T',
    status,
  });
  ticket.statusChangedAt = new Date(doneAt);
  return ticket;
}

function makeUseCase(tickets: TicketEntity[], boards: BoardEntity[]): GetStatisticsUseCase {
  const ticketStore = {
    getAllTickets: vi.fn().mockResolvedValue(tickets),
    getAllBoards: vi.fn().mockResolvedValue(boards),
  } as unknown as TicketStorePort;
  const empty = () => ({ getAll: vi.fn().mockResolvedValue([]) });

  return new GetStatisticsUseCase(
    ticketStore,
    empty() as unknown as CommentStorePort,
    empty() as unknown as MentionStorePort,
    empty() as unknown as DeliverableStorePort,
    { getAllExecutions: vi.fn().mockResolvedValue([]) } as unknown as AgentEventStorePort,
    empty() as unknown as PersonaStorePort,
    empty() as unknown as SessionStorePort,
    // skillStore + domainEventLogStore are optional — omitted on purpose.
  );
}

describe('GetStatisticsUseCase — ticketsDoneByBoard', () => {
  const params = { from: '2026-06-01', to: '2026-06-04', granularity: 'day' as const };

  it('counts tickets that moved to done per bucket, stacked by board name', async () => {
    const backend = BoardEntity.create({ id: randomUUID(), name: 'Backend' });
    const frontend = BoardEntity.create({ id: randomUUID(), name: 'Frontend' });

    const tickets = [
      doneTicket(backend.id, '2026-06-01T10:00:00Z'),
      doneTicket(backend.id, '2026-06-01T15:00:00Z'),
      doneTicket(frontend.id, '2026-06-02T09:00:00Z'),
    ];

    const result = await makeUseCase(tickets, [backend, frontend]).execute(params);

    // 3 daily buckets: 06-01, 06-02, 06-03
    expect(result.timeSeries.map((b) => b.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(result.timeSeries[0]!.ticketsDoneByBoard).toEqual({ Backend: 2 });
    expect(result.timeSeries[1]!.ticketsDoneByBoard).toEqual({ Frontend: 1 });
    expect(result.timeSeries[2]!.ticketsDoneByBoard).toEqual({});
  });

  it('ignores tickets that are not done, and those whose statusChangedAt is outside the range', async () => {
    const board = BoardEntity.create({ id: randomUUID(), name: 'Backend' });

    const tickets = [
      doneTicket(board.id, '2026-06-02T09:00:00Z'), // counted
      doneTicket(board.id, '2026-06-02T11:00:00Z', 'doing'), // not done → ignored
      doneTicket(board.id, '2026-05-30T09:00:00Z'), // done but before range → ignored
    ];

    const result = await makeUseCase(tickets, [board]).execute(params);

    expect(result.timeSeries[0]!.ticketsDoneByBoard).toEqual({}); // 06-01
    expect(result.timeSeries[1]!.ticketsDoneByBoard).toEqual({ Backend: 1 }); // 06-02
  });

  it('falls back to "Unknown" when the ticket references a board that no longer exists', async () => {
    const tickets = [doneTicket('deleted-board-id', '2026-06-03T09:00:00Z')];

    const result = await makeUseCase(tickets, []).execute(params);

    expect(result.timeSeries[2]!.ticketsDoneByBoard).toEqual({ Unknown: 1 });
  });
});
