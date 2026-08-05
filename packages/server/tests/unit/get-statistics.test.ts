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
import type { DomainEventLogStorePort } from '../../src/application/ports/domain-event-log-store.port.js';
import { DomainEventLogEntity } from '../../src/domain/entities/domain-event-log.entity.js';

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

// ── Cost by source (agentic SDK vs manual CLI) ──────────────────────────────

describe('GetStatisticsUseCase — costBySource', () => {
  const params = { from: '2026-06-01', to: '2026-06-04', granularity: 'day' as const };

  it('splits cost into sdk vs cli, treating a NULL/absent source as sdk', async () => {
    const executions = {
      getAllExecutions: vi.fn().mockResolvedValue([
        // source absent → counts as sdk
        { mentionId: 'm1', personaId: 'p1', startedAt: '2026-06-01T09:00:00Z', completedAt: '2026-06-01T09:05:00Z', status: 'completed', costUsd: 2 },
        // explicit sdk
        { mentionId: 'm2', personaId: 'p1', startedAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T10:05:00Z', status: 'completed', costUsd: 3, source: 'sdk' },
        // manual CLI session
        { mentionId: 'cli:abc', personaId: 'cli', startedAt: '2026-06-01T11:00:00Z', completedAt: '2026-06-01T11:30:00Z', status: 'completed', costUsd: 10, source: 'cli' },
      ]),
    } as unknown as AgentEventStorePort;
    const empty = () => ({ getAll: vi.fn().mockResolvedValue([]) });
    const ticketStore = {
      getAllTickets: vi.fn().mockResolvedValue([]),
      getAllBoards: vi.fn().mockResolvedValue([]),
    } as unknown as TicketStorePort;

    const useCase = new GetStatisticsUseCase(
      ticketStore,
      empty() as unknown as CommentStorePort,
      empty() as unknown as MentionStorePort,
      empty() as unknown as DeliverableStorePort,
      executions,
      empty() as unknown as PersonaStorePort,
      empty() as unknown as SessionStorePort,
    );

    const result = await useCase.execute(params);

    expect(result.summary.totalCostBySource).toEqual({ sdk: 5, cli: 10 });
    expect(result.summary.totalCostUsd).toBe(15); // unchanged global total still includes CLI
    // All three land in the 06-01 bucket.
    expect(result.timeSeries[0]!.costBySource).toEqual({ sdk: 5, cli: 10 });
    expect(result.timeSeries[1]!.costBySource).toEqual({ sdk: 0, cli: 0 });
  });
});

// ── Extended flow metrics (lead time, iterations, usage trend) ──────────────

function logEntry(eventType: string, payload: Record<string, unknown>, occurredAt: string): DomainEventLogEntity {
  return DomainEventLogEntity.create({
    id: randomUUID(),
    eventType,
    payload,
    instanceId: 'test',
    occurredAt: new Date(occurredAt),
  });
}

function withItem<T>(toDTO: () => T): { toDTO: () => T } {
  return { toDTO };
}

describe('GetStatisticsUseCase — flow metrics', () => {
  const params = { from: '2026-06-01', to: '2026-06-04', granularity: 'day' as const };

  it('derives lead time, iterations, usage trend and throughput from the event log', async () => {
    const board = BoardEntity.create({ id: randomUUID(), name: 'Backend' });
    const ticket = doneTicket(board.id, '2026-06-02T08:00:00Z');
    const tid = ticket.id;

    const events = [
      logEntry('ticket.moved', { ticketId: tid, fromStatus: 'todo', toStatus: 'doing' }, '2026-06-01T08:00:00Z'),
      logEntry('ticket.moved', { ticketId: tid, fromStatus: 'doing', toStatus: 'done' }, '2026-06-02T08:00:00Z'),
    ];

    // One workflow run for this ticket, started 06-01, completed an hour later.
    const workflowRunStore = {
      getAll: vi.fn().mockResolvedValue([
        {
          id: 'w1',
          ticketId: tid,
          templateId: 'wf-tpl',
          templateSnapshot: { name: 'Ship it' },
          status: 'completed',
          startedAt: new Date('2026-06-01T09:00:00Z'),
          completedAt: new Date('2026-06-01T10:00:00Z'),
        },
      ]),
    } as unknown as import('../../src/application/ports/workflow-run-store.port.js').WorkflowRunStorePort;

    const domainEventLogStore = {
      list: vi.fn(async (p: { eventType?: string; since?: Date; until?: Date }) =>
        events.filter(
          (e) =>
            (!p.eventType || e.eventType === p.eventType) &&
            (!p.since || e.occurredAt >= p.since) &&
            (!p.until || e.occurredAt <= p.until),
        ),
      ),
    } as unknown as DomainEventLogStorePort;

    const comments = {
      getAll: vi.fn().mockResolvedValue([
        withItem(() => ({ id: 'c1', ticketId: tid, createdAt: '2026-06-01T10:00:00Z', authorType: 'user' })),
        withItem(() => ({ id: 'c2', ticketId: tid, createdAt: '2026-06-01T11:00:00Z', authorType: 'agent' })),
      ]),
    } as unknown as CommentStorePort;
    const mentions = {
      getAll: vi.fn().mockResolvedValue([
        withItem(() => ({ id: 'm1', ticketId: tid, createdAt: '2026-06-01T09:30:00Z', status: 'resolved' })),
      ]),
    } as unknown as MentionStorePort;
    const executions = {
      getAllExecutions: vi.fn().mockResolvedValue([
        { mentionId: 'm1', personaId: 'p1', startedAt: '2026-06-01T09:30:00Z', completedAt: '2026-06-01T09:35:00Z', status: 'completed', costUsd: 0.5, inputTokens: 100, outputTokens: 50 },
        { mentionId: 'skill:s1', personaId: 'p1', startedAt: '2026-06-01T12:00:00Z', completedAt: null, status: 'completed' },
      ]),
    } as unknown as AgentEventStorePort;

    const ticketStore = {
      getAllTickets: vi.fn().mockResolvedValue([ticket]),
      getAllBoards: vi.fn().mockResolvedValue([board]),
    } as unknown as TicketStorePort;
    const empty = () => ({ getAll: vi.fn().mockResolvedValue([]) });

    const useCase = new GetStatisticsUseCase(
      ticketStore,
      comments,
      mentions,
      empty() as unknown as DeliverableStorePort,
      executions,
      empty() as unknown as PersonaStorePort,
      empty() as unknown as SessionStorePort,
      undefined,
      domainEventLogStore,
      workflowRunStore,
    );

    const result = await useCase.execute(params);

    // Lead time: doing 06-01T08 → done 06-02T08 = exactly one day.
    expect(result.leadTime.points).toHaveLength(1);
    expect(result.leadTime.points[0]!.leadTimeMs).toBe(86_400_000);
    expect(result.leadTime.avgMs).toBe(86_400_000);

    // Iterations: 2 comments + 1 mention + 1 workflow run = 4.
    expect(result.ticketIterations).toHaveLength(1);
    const it0 = result.ticketIterations[0]!;
    expect(it0).toMatchObject({ comments: 2, mentions: 1, workflowRuns: 1, agentRuns: 1, total: 4 });

    // Usage trend: 1 agent run + 1 skill run on 06-01, 1 workflow on 06-01.
    const day1 = result.usageByType[0]!;
    expect(day1).toMatchObject({ date: '2026-06-01', agents: 1, skills: 1, workflows: 1 });

    // Throughput: the ticket completes in the 06-02 bucket.
    expect(result.throughputWip.find((b) => b.date === '2026-06-02')!.completed).toBe(1);

    // Summary KPI + leaderboard: one workflow run within the window.
    expect(result.summary.workflowsStarted).toBe(1);
    expect(result.workflowLeaderboard).toHaveLength(1);
    expect(result.workflowLeaderboard[0]).toMatchObject({
      workflowDisplayName: 'Ship it',
      executionCount: 1,
      completedCount: 1,
      avgDurationMs: 3_600_000,
    });
  });
});

// ── Routine leaderboard ─────────────────────────────────────────────────────

describe('GetStatisticsUseCase — routine leaderboard', () => {
  const params = { from: '2026-06-01', to: '2026-06-04', granularity: 'day' as const };

  function useCaseWith(runs: unknown[], routines: unknown[]) {
    const empty = () => ({ getAll: vi.fn().mockResolvedValue([]) });
    return new GetStatisticsUseCase(
      { getAllTickets: vi.fn().mockResolvedValue([]), getAllBoards: vi.fn().mockResolvedValue([]) } as unknown as TicketStorePort,
      empty() as unknown as CommentStorePort,
      empty() as unknown as MentionStorePort,
      empty() as unknown as DeliverableStorePort,
      { getAllExecutions: vi.fn().mockResolvedValue([]) } as unknown as AgentEventStorePort,
      empty() as unknown as PersonaStorePort,
      empty() as unknown as SessionStorePort,
      undefined,
      undefined,
      { getAll: vi.fn().mockResolvedValue(runs) } as never,
      { getAll: vi.fn().mockResolvedValue(routines) } as never,
    );
  }

  const routineRun = (id: string, routineId: string, over: Record<string, unknown> = {}) => ({
    id,
    routineId,
    templateId: null,
    templateSnapshot: { name: 'synthetic' },
    status: 'completed',
    startedAt: new Date('2026-06-01T09:00:00Z'),
    completedAt: new Date('2026-06-01T09:30:00Z'),
    ...over,
  });

  it('counts primitive-target routine runs the workflow board can never show', async () => {
    // A routine targeting an agent produces runs with a null templateId: they
    // are excluded from the workflow leaderboard by construction, so without
    // this board their activity appears nowhere in Statistics.
    const result = await useCaseWith(
      [
        routineRun('r-run-1', 'rt-1'),
        routineRun('r-run-2', 'rt-1', { status: 'failed', completedAt: null }),
      ],
      [{ id: 'rt-1', name: 'Daily recap', target: { kind: 'agent', ref: 'builder' } }],
    ).execute(params);

    expect(result.workflowLeaderboard).toHaveLength(0);
    expect(result.routineLeaderboard).toHaveLength(1);
    expect(result.routineLeaderboard[0]).toMatchObject({
      routineId: 'rt-1',
      routineName: 'Daily recap',
      targetKind: 'agent',
      targetRef: 'builder',
      executionCount: 2,
      completedCount: 1,
      failedCount: 1,
      avgDurationMs: 1_800_000,
    });
  });

  it('leaves ticket-anchored runs off the board', async () => {
    const result = await useCaseWith(
      [routineRun('w1', undefined as unknown as string, { ticketId: 't-1', templateId: 'tpl-1' })],
      [],
    ).execute(params);

    expect(result.routineLeaderboard).toHaveLength(0);
  });

  it('keeps a row for a routine deleted since its runs', async () => {
    // Dropping it would silently rewrite the period's totals — the runs
    // happened, whatever the catalogue looks like today.
    const result = await useCaseWith([routineRun('r-run-1', 'gone')], []).execute(params);

    expect(result.routineLeaderboard).toHaveLength(1);
    expect(result.routineLeaderboard[0]!.routineId).toBe('gone');
  });
});
