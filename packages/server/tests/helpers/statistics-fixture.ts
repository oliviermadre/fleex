/**
 * Shared fixture for the `GetStatisticsUseCase` golden test.
 *
 * Every aggregate the use case computes has at least one row here that
 * exercises its non-trivial branch: tickets in all six statuses (including
 * `cancelled`, which must drop out of the cumulative-flow counters), tickets
 * done both with and without move history (the `statusChangedAt` fallback),
 * a ticket created before `from` but completed inside the window, a ticket
 * created after `to`, executions with and without cost/tokens across all three
 * `source` values, `skill:`-prefixed executions pointing at both a known and an
 * unknown skill, sessions of both types with and without a worktree branch and
 * in all three statuses, panel events with and without display metadata, and
 * workflow runs that completed and failed.
 *
 * All timestamps are absolute (`Z`-suffixed), so the fixture itself is
 * timezone-independent; only bucket labelling reads local getters, which the
 * golden test pins by forcing `TZ=UTC`.
 */
import { vi } from 'vitest';
import type { AgentExecution, TicketLink, TicketStatus } from '@fleex/shared';
import { GetStatisticsUseCase } from '../../src/application/use-cases/get-statistics.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { BoardEntity } from '../../src/domain/entities/board.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { SkillEntity } from '../../src/domain/entities/skill.entity.js';
import { SessionEntity } from '../../src/domain/entities.js';
import { DomainEventLogEntity } from '../../src/domain/entities/domain-event-log.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { SessionStorePort } from '../../src/application/ports/session-store.port.js';
import type { SkillStorePort } from '../../src/application/ports/skill-store.port.js';
import type { DomainEventLogStorePort } from '../../src/application/ports/domain-event-log-store.port.js';
import type { WorkflowRunStorePort } from '../../src/application/ports/workflow-run-store.port.js';

export const FROM = '2026-06-01T00:00:00.000Z';
export const TO = '2026-06-08T00:00:00.000Z';
/** Matches `Date.getTimezoneOffset()` for a UTC+2 client — shifts the heatmap by +2h. */
export const TZ_OFFSET_MINUTES = -120;

const BOARD_BACKEND = '11111111-1111-4111-8111-111111111111';
const BOARD_FRONTEND = '22222222-2222-4222-8222-222222222222';
const BOARD_OPS = '33333333-3333-4333-8333-333333333333';
/** Referenced by a ticket but absent from the board list → resolves to "Unknown". */
const BOARD_DELETED = '44444444-4444-4444-8444-444444444444';

function prLink(id: string, createdAt: string): TicketLink {
  return { id, type: 'github_pr', ref: `#${id}`, label: `PR ${id}`, url: null, createdAt };
}

function issueLink(id: string, createdAt: string): TicketLink {
  return { id, type: 'github_issue', ref: `#${id}`, label: `Issue ${id}`, url: null, createdAt };
}

function ticket(o: {
  id: string;
  boardId: string;
  displayId: number;
  title: string;
  status: TicketStatus;
  createdAt: string;
  statusChangedAt: string;
  links?: TicketLink[];
}): TicketEntity {
  return new TicketEntity(
    o.id,
    o.boardId,
    o.displayId,
    o.title,
    '',
    o.status,
    'none',
    null,
    0,
    [],
    o.links ?? [],
    false,
    false,
    null,
    null,
    null,
    null,
    null,
    null,
    new Date(o.statusChangedAt),
    new Date(o.createdAt),
    new Date(o.statusChangedAt),
  );
}

function comment(o: {
  id: string;
  ticketId: string;
  authorType: 'user' | 'agent';
  createdAt: string;
}): TicketCommentEntity {
  return new TicketCommentEntity(
    o.id,
    o.ticketId,
    o.authorType,
    o.authorType === 'user' ? 'nas' : 'builder',
    'body',
    'public',
    [],
    [],
    null,
    new Date(o.createdAt),
    new Date(o.createdAt),
  );
}

function mention(o: {
  id: string;
  ticketId: string;
  status: 'pending' | 'resolved';
  createdAt: string;
}): TicketMentionEntity {
  return new TicketMentionEntity(
    o.id,
    o.ticketId,
    `c-${o.id}`,
    'builder',
    'nas',
    'agent',
    'plan',
    o.status,
    o.status === 'resolved' ? new Date(o.createdAt) : null,
    null,
    null,
    new Date(o.createdAt),
  );
}

function deliverable(o: { id: string; ticketId: string; createdAt: string }): TicketDeliverableEntity {
  return new TicketDeliverableEntity(
    o.id,
    o.ticketId,
    'builder',
    'code',
    'D',
    'content',
    1,
    'final',
    null,
    new Date(o.createdAt),
    new Date(o.createdAt),
  );
}

function session(o: {
  id: string;
  type: 'shell' | 'claude';
  status: 'running' | 'dead' | 'unknown';
  worktreeBranch: string | null;
  createdAt: string;
}): SessionEntity {
  return new SessionEntity(
    o.id,
    `fleex_${o.id}`,
    o.type,
    o.status,
    '/tmp',
    new Date(o.createdAt),
    null,
    null,
    null,
    o.worktreeBranch,
    null,
  );
}

function logEntry(eventType: string, payload: Record<string, unknown>, occurredAt: string): DomainEventLogEntity {
  return new DomainEventLogEntity(`ev-${eventType}-${occurredAt}`, eventType, payload, 'test', new Date(occurredAt));
}

function moved(ticketId: string, toStatus: string, at: string): DomainEventLogEntity {
  return logEntry('ticket.moved', { ticketId, toStatus }, at);
}

function run(o: {
  id: string;
  ticketId: string;
  templateId: string;
  templateName: string;
  status: 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
}): WorkflowRunEntity {
  return new WorkflowRunEntity(
    o.id,
    o.ticketId,
    o.templateId,
    { name: o.templateName } as WorkflowRunEntity['templateSnapshot'],
    o.status,
    null,
    'nas',
    'ticket',
    new Date(o.startedAt),
    o.completedAt ? new Date(o.completedAt) : null,
    new Date(o.startedAt),
    new Date(o.startedAt),
  );
}

// ── Ticket ids, exported so tests can assert on specific rows ───────────────
export const T = {
  backlog: 'aaaaaaaa-0001-4000-8000-000000000000',
  todo: 'aaaaaaaa-0002-4000-8000-000000000000',
  doing: 'aaaaaaaa-0003-4000-8000-000000000000',
  reviewing: 'aaaaaaaa-0004-4000-8000-000000000000',
  doneWithMoves: 'aaaaaaaa-0005-4000-8000-000000000000',
  doneNoMoves: 'aaaaaaaa-0006-4000-8000-000000000000',
  cancelled: 'aaaaaaaa-0007-4000-8000-000000000000',
  doneUnknownBoard: 'aaaaaaaa-0008-4000-8000-000000000000',
  createdBeforeRange: 'aaaaaaaa-0009-4000-8000-000000000000',
  createdAfterRange: 'aaaaaaaa-0010-4000-8000-000000000000',
} as const;

export function buildFixture() {
  const boards = [
    new BoardEntity(BOARD_BACKEND, 'Backend', '🛠', new Date(FROM), new Date(FROM)),
    new BoardEntity(BOARD_FRONTEND, 'Frontend', '🎨', new Date(FROM), new Date(FROM)),
    new BoardEntity(BOARD_OPS, 'Ops', '⚙️', new Date(FROM), new Date(FROM)),
  ];

  const tickets = [
    ticket({ id: T.backlog, boardId: BOARD_BACKEND, displayId: 1, title: 'Backlog item', status: 'backlog', createdAt: '2026-06-01T09:00:00.000Z', statusChangedAt: '2026-06-01T09:00:00.000Z' }),
    ticket({ id: T.todo, boardId: BOARD_BACKEND, displayId: 2, title: 'Todo item', status: 'todo', createdAt: '2026-06-01T10:00:00.000Z', statusChangedAt: '2026-06-01T11:00:00.000Z', links: [prLink('p1', '2026-06-01T10:30:00.000Z')] }),
    ticket({ id: T.doing, boardId: BOARD_FRONTEND, displayId: 3, title: 'Doing item', status: 'doing', createdAt: '2026-06-02T08:00:00.000Z', statusChangedAt: '2026-06-02T18:00:00.000Z' }),
    ticket({ id: T.reviewing, boardId: BOARD_FRONTEND, displayId: 4, title: 'Reviewing item', status: 'reviewing', createdAt: '2026-06-02T12:00:00.000Z', statusChangedAt: '2026-06-04T08:00:00.000Z', links: [prLink('p2', '2026-06-03T10:00:00.000Z'), issueLink('i1', '2026-06-03T10:00:00.000Z')] }),
    ticket({ id: T.doneWithMoves, boardId: BOARD_BACKEND, displayId: 5, title: 'Done with history', status: 'done', createdAt: '2026-06-01T08:00:00.000Z', statusChangedAt: '2026-06-04T10:00:00.000Z', links: [prLink('p3', '2026-06-02T10:00:00.000Z')] }),
    ticket({ id: T.doneNoMoves, boardId: BOARD_OPS, displayId: 6, title: 'Done without history', status: 'done', createdAt: '2026-06-03T08:00:00.000Z', statusChangedAt: '2026-06-05T09:00:00.000Z' }),
    ticket({ id: T.cancelled, boardId: BOARD_OPS, displayId: 7, title: 'Cancelled item', status: 'cancelled', createdAt: '2026-06-02T09:00:00.000Z', statusChangedAt: '2026-06-06T09:00:00.000Z' }),
    ticket({ id: T.doneUnknownBoard, boardId: BOARD_DELETED, displayId: 8, title: 'Done on deleted board', status: 'done', createdAt: '2026-06-01T07:00:00.000Z', statusChangedAt: '2026-06-03T15:00:00.000Z', links: [prLink('p4', '2026-06-02T10:00:00.000Z')] }),
    ticket({ id: T.createdBeforeRange, boardId: BOARD_BACKEND, displayId: 9, title: 'Old ticket completed in range', status: 'done', createdAt: '2026-05-20T08:00:00.000Z', statusChangedAt: '2026-06-02T11:00:00.000Z', links: [prLink('p5', '2026-05-21T10:00:00.000Z')] }),
    ticket({ id: T.createdAfterRange, boardId: BOARD_BACKEND, displayId: 10, title: 'Future ticket', status: 'todo', createdAt: '2026-06-10T08:00:00.000Z', statusChangedAt: '2026-06-10T08:00:00.000Z' }),
  ];

  const comments = [
    comment({ id: 'c1', ticketId: T.doneWithMoves, authorType: 'user', createdAt: '2026-06-01T09:15:00.000Z' }),
    comment({ id: 'c2', ticketId: T.doneWithMoves, authorType: 'agent', createdAt: '2026-06-01T09:45:00.000Z' }),
    comment({ id: 'c3', ticketId: T.doing, authorType: 'user', createdAt: '2026-06-02T10:00:00.000Z' }),
    comment({ id: 'c4', ticketId: T.cancelled, authorType: 'agent', createdAt: '2026-06-03T10:00:00.000Z' }),
    comment({ id: 'c5', ticketId: T.doneNoMoves, authorType: 'agent', createdAt: '2026-06-05T08:00:00.000Z' }),
    // Outside the window — must not be counted anywhere.
    comment({ id: 'c6', ticketId: T.doneWithMoves, authorType: 'user', createdAt: '2026-05-15T08:00:00.000Z' }),
  ];

  const mentions = [
    mention({ id: 'm1', ticketId: T.doneWithMoves, status: 'resolved', createdAt: '2026-06-01T09:20:00.000Z' }),
    mention({ id: 'm2', ticketId: T.doing, status: 'pending', createdAt: '2026-06-02T10:05:00.000Z' }),
    mention({ id: 'm3', ticketId: T.doneNoMoves, status: 'resolved', createdAt: '2026-06-05T08:05:00.000Z' }),
    mention({ id: 'm4', ticketId: T.createdBeforeRange, status: 'resolved', createdAt: '2026-05-21T08:00:00.000Z' }),
  ];

  const deliverables = [
    deliverable({ id: 'd1', ticketId: T.doneWithMoves, createdAt: '2026-06-02T12:00:00.000Z' }),
    deliverable({ id: 'd2', ticketId: T.doing, createdAt: '2026-06-04T16:00:00.000Z' }),
    deliverable({ id: 'd3', ticketId: T.doneNoMoves, createdAt: '2026-05-01T16:00:00.000Z' }), // out of range
  ];

  const personas = [
    new AgentPersonaEntity('p-builder', 'builder', 'The Builder', 'claude-sonnet-5', 'claude_code', '', '', '', null, new Date(FROM), new Date(FROM)),
    new AgentPersonaEntity('p-scout', 'scout', 'The Scout', 'claude-sonnet-5', 'claude_code', '', '', '', null, new Date(FROM), new Date(FROM)),
  ];

  const skills = [
    new SkillEntity('sk-spec', 'spec', 'spec', 'Spec Writer', '', true, 'p-builder', new Date(FROM), new Date(FROM)),
  ];

  const executions: AgentExecution[] = [
    // No `source` → read as sdk. Has cost + tokens.
    { id: 'x1', personaId: 'p-builder', ticketId: T.doneWithMoves, mentionId: 'm1', eventCount: 3, status: 'completed', startedAt: '2026-06-01T09:30:00.000Z', completedAt: '2026-06-01T09:35:00.000Z', lastEventAt: null, costUsd: 0.5, inputTokens: 100, outputTokens: 50 },
    // Explicit sdk.
    { id: 'x2', personaId: 'p-builder', ticketId: T.doing, mentionId: 'm2', eventCount: 5, status: 'completed', startedAt: '2026-06-02T10:00:00.000Z', completedAt: '2026-06-02T10:20:00.000Z', lastEventAt: null, costUsd: 1.25, inputTokens: 2000, outputTokens: 300, source: 'sdk' },
    // Manual CLI session — no tokens recorded.
    { id: 'x3', personaId: 'cli', ticketId: T.doing, mentionId: 'cli:abc', eventCount: 0, status: 'completed', startedAt: '2026-06-03T14:00:00.000Z', completedAt: '2026-06-03T14:45:00.000Z', lastEventAt: null, costUsd: 3, source: 'cli' },
    // Skill run, still open (no completedAt) and failed → excluded from durations.
    { id: 'x4', personaId: 'p-scout', ticketId: T.reviewing, mentionId: 'skill:sk-spec', eventCount: 1, status: 'failed', startedAt: '2026-06-04T11:00:00.000Z', completedAt: null, lastEventAt: null },
    // Skill run on a known skill.
    { id: 'x5', personaId: 'p-scout', ticketId: T.reviewing, mentionId: 'skill:sk-spec', eventCount: 2, status: 'completed', startedAt: '2026-06-05T11:00:00.000Z', completedAt: '2026-06-05T11:02:00.000Z', lastEventAt: null, costUsd: 0.1, inputTokens: 10, outputTokens: 5 },
    // Skill run on an unknown skill id → falls back to the raw id.
    { id: 'x6', personaId: 'p-builder', ticketId: T.reviewing, mentionId: 'skill:sk-ghost', eventCount: 1, status: 'completed', startedAt: '2026-06-06T20:00:00.000Z', completedAt: '2026-06-06T20:10:00.000Z', lastEventAt: null, costUsd: 0.2 },
    // Unknown persona id → falls back to the raw id in the leaderboard.
    { id: 'x7', personaId: 'p-ghost', ticketId: T.todo, mentionId: 'm-ghost', eventCount: 1, status: 'interrupted', startedAt: '2026-06-06T21:00:00.000Z', completedAt: null, lastEventAt: null },
    // Outside the window.
    { id: 'x8', personaId: 'p-builder', ticketId: T.doneWithMoves, mentionId: 'm4', eventCount: 1, status: 'completed', startedAt: '2026-05-30T09:00:00.000Z', completedAt: '2026-05-30T09:10:00.000Z', lastEventAt: null, costUsd: 9 },
  ];

  const sessions = [
    session({ id: 's1', type: 'claude', status: 'running', worktreeBranch: 'agent/x', createdAt: '2026-06-01T08:00:00.000Z' }),
    session({ id: 's2', type: 'shell', status: 'dead', worktreeBranch: null, createdAt: '2026-06-02T08:00:00.000Z' }),
    session({ id: 's3', type: 'claude', status: 'unknown', worktreeBranch: null, createdAt: '2026-06-03T08:00:00.000Z' }),
    session({ id: 's4', type: 'shell', status: 'running', worktreeBranch: 'agent/y', createdAt: '2026-06-04T08:00:00.000Z' }),
    // Outside the window — still counts toward `activeSessions`, which reads the
    // unfiltered session list.
    session({ id: 's5', type: 'claude', status: 'running', worktreeBranch: 'agent/z', createdAt: '2026-05-20T08:00:00.000Z' }),
  ];

  const moveEvents = [
    moved(T.doneWithMoves, 'todo', '2026-06-01T09:00:00.000Z'),
    moved(T.doneWithMoves, 'doing', '2026-06-02T09:00:00.000Z'),
    moved(T.doneWithMoves, 'reviewing', '2026-06-03T12:00:00.000Z'),
    moved(T.doneWithMoves, 'done', '2026-06-04T10:00:00.000Z'),
    moved(T.doing, 'todo', '2026-06-02T09:30:00.000Z'),
    moved(T.doing, 'doing', '2026-06-02T18:00:00.000Z'),
    moved(T.reviewing, 'todo', '2026-06-02T13:00:00.000Z'),
    moved(T.reviewing, 'doing', '2026-06-03T08:00:00.000Z'),
    moved(T.reviewing, 'reviewing', '2026-06-04T08:00:00.000Z'),
    moved(T.cancelled, 'doing', '2026-06-03T10:00:00.000Z'),
    moved(T.cancelled, 'cancelled', '2026-06-06T09:00:00.000Z'),
    // Transitions before `from` — the move query has no lower bound so these
    // must still be visible to lead time and the CFD.
    moved(T.createdBeforeRange, 'doing', '2026-05-25T09:00:00.000Z'),
    moved(T.createdBeforeRange, 'done', '2026-06-02T11:00:00.000Z'),
    // Malformed rows: missing ticketId / toStatus — both must be skipped.
    logEntry('ticket.moved', { toStatus: 'done' }, '2026-06-02T12:00:00.000Z'),
    logEntry('ticket.moved', { ticketId: T.todo }, '2026-06-02T12:30:00.000Z'),
  ];

  const panelEvents = [
    logEntry('panel.executed', { panelId: 'pan1', panelName: 'design-review', panelDisplayName: 'Design Review', status: 'completed', durationMs: 5000, respondedMembers: 3 }, '2026-06-02T15:00:00.000Z'),
    logEntry('panel.executed', { panelId: 'pan1', panelName: 'design-review', panelDisplayName: 'Design Review', status: 'completed', durationMs: 7000, respondedMembers: 2 }, '2026-06-03T15:00:00.000Z'),
    logEntry('panel.executed', { panelId: 'pan1', panelName: 'design-review', panelDisplayName: 'Design Review', status: 'failed', durationMs: 0, respondedMembers: 0 }, '2026-06-04T15:00:00.000Z'),
    // No display metadata → falls back to the panel id.
    logEntry('panel.executed', { panelId: 'pan2', status: 'completed', durationMs: 1000, respondedMembers: 1 }, '2026-06-05T15:00:00.000Z'),
    // No panelId at all → grouped under "unknown"; the name lookup finds nothing.
    logEntry('panel.executed', { status: 'completed', durationMs: 2000, respondedMembers: 4 }, '2026-06-06T15:00:00.000Z'),
  ];

  const workflowRuns = [
    run({ id: 'w1', ticketId: T.doneWithMoves, templateId: 'tpl-a', templateName: 'Ship it', status: 'completed', startedAt: '2026-06-01T09:00:00.000Z', completedAt: '2026-06-01T10:00:00.000Z' }),
    run({ id: 'w2', ticketId: T.doneWithMoves, templateId: 'tpl-a', templateName: 'Ship it', status: 'failed', startedAt: '2026-06-02T09:00:00.000Z', completedAt: null }),
    run({ id: 'w3', ticketId: T.doing, templateId: 'tpl-b', templateName: 'Review it', status: 'completed', startedAt: '2026-06-03T09:00:00.000Z', completedAt: '2026-06-03T09:30:00.000Z' }),
    // Outside the window.
    run({ id: 'w4', ticketId: T.doneNoMoves, templateId: 'tpl-b', templateName: 'Review it', status: 'completed', startedAt: '2026-05-25T09:00:00.000Z', completedAt: '2026-05-25T10:00:00.000Z' }),
  ];

  const allLogEntries = [...moveEvents, ...panelEvents];

  const ticketStore = {
    getAllTickets: vi.fn().mockResolvedValue(tickets),
    getAllBoards: vi.fn().mockResolvedValue(boards),
  } as unknown as TicketStorePort;

  const domainEventLogStore = {
    list: vi.fn(async (p: { eventType?: string; since?: Date; until?: Date; limit: number }) =>
      allLogEntries
        .filter(
          (e) =>
            (!p.eventType || e.eventType === p.eventType) &&
            (!p.since || e.occurredAt >= p.since) &&
            (!p.until || e.occurredAt <= p.until),
        )
        .slice(0, p.limit),
    ),
  } as unknown as DomainEventLogStorePort;

  const useCase = new GetStatisticsUseCase(
    ticketStore,
    { getAll: vi.fn().mockResolvedValue(comments) } as unknown as CommentStorePort,
    { getAll: vi.fn().mockResolvedValue(mentions) } as unknown as MentionStorePort,
    { getAll: vi.fn().mockResolvedValue(deliverables) } as unknown as DeliverableStorePort,
    { getAllExecutions: vi.fn().mockResolvedValue(executions) } as unknown as AgentEventStorePort,
    { getAll: vi.fn().mockResolvedValue(personas) } as unknown as PersonaStorePort,
    { getAll: vi.fn().mockResolvedValue(sessions) } as unknown as SessionStorePort,
    { getAll: vi.fn().mockResolvedValue(skills) } as unknown as SkillStorePort,
    domainEventLogStore,
    { getAll: vi.fn().mockResolvedValue(workflowRuns) } as unknown as WorkflowRunStorePort,
  );

  return {
    useCase,
    tickets,
    boards,
    comments,
    mentions,
    deliverables,
    personas,
    skills,
    executions,
    sessions,
    workflowRuns,
    domainEventLogStore,
  };
}
