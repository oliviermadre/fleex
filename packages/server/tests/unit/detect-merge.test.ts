import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PullRequest } from '@fleex/shared';
import { DetectMergeUseCase } from '../../src/application/use-cases/detect-merge.js';
import { AutoReviewWorkflowUseCase } from '../../src/application/use-cases/auto-review-workflow.js';
import { DomainEventListener } from '../../src/application/domain-event-listener.js';
import { EventBus } from '../../src/application/event-bus.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { ConfigPort } from '../../src/application/ports/config.port.js';

const logger: LoggerPort = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function mergedPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: 'Add the thing',
    headRefName: 'feat/x',
    state: 'merged',
    author: 'someone',
    assignees: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function linkedTicket(status: 'doing' | 'backlog' = 'doing'): TicketEntity {
  const ticket = TicketEntity.create({
    id: 'T1',
    boardId: randomUUID(),
    displayId: 1,
    title: 'Ship the thing',
    status,
  });
  ticket.addLink('worktree', 'org/repo:feat/x', 'feat/x', null, randomUUID());
  return ticket;
}

function ticketStoreWith(ticket: TicketEntity): TicketStorePort {
  return {
    getTicketsLinkedTo: vi.fn(async (type: string) => (type === 'worktree' ? [ticket] : [])),
    saveTicket: vi.fn().mockResolvedValue(undefined),
    saveActivity: vi.fn().mockResolvedValue(undefined),
    getTicketById: vi.fn().mockResolvedValue(ticket),
  } as unknown as TicketStorePort;
}

describe('DetectMergeUseCase', () => {
  describe('event emission', () => {
    let ticket: TicketEntity;
    let ticketStore: TicketStorePort;
    let emitted: AnyDomainEvent[];
    let eventBus: EventBus;

    beforeEach(async () => {
      ticket = linkedTicket('doing');
      ticketStore = ticketStoreWith(ticket);
      emitted = [];
      eventBus = { emit: vi.fn((...evts: AnyDomainEvent[]) => { emitted.push(...evts); }) } as unknown as EventBus;

      await new DetectMergeUseCase(ticketStore, logger, eventBus).execute([mergedPR()], 'org/repo');
    });

    it('emits ticket.moved carrying the real origin status, not a placeholder', () => {
      const moved = emitted.find((e) => e.type === 'ticket.moved');

      // The whole point of owning the emission here: `main.ts` used to re-emit
      // with `fromStatus: ''`, which got persisted to the audit log and
      // republished cluster-wide as "moved from nothing to done".
      expect(moved).toMatchObject({
        type: 'ticket.moved',
        ticketId: 'T1',
        fromStatus: 'doing',
        toStatus: 'done',
        source: 'merge-detector',
      });
    });

    it('emits ticket.linkAdded for the PR before the move', () => {
      const linkIdx = emitted.findIndex((e) => e.type === 'ticket.linkAdded');
      const movedIdx = emitted.findIndex((e) => e.type === 'ticket.moved');

      expect(emitted[linkIdx]).toMatchObject({
        type: 'ticket.linkAdded',
        ticketId: 'T1',
        linkType: 'github_pr',
        ref: 'org/repo#42',
        label: 'PR #42',
      });
      // Moving to done triggers mention resolution and summary generation — the
      // PR link must already be in the trail when those run.
      expect(linkIdx).toBeLessThan(movedIdx);
    });

    it('persists the ticket and its moved activity', () => {
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);
      expect(ticketStore.saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'moved', actorName: 'merge-detector' }),
      );
      expect(ticket.status).toBe('done');
    });
  });

  it('ignores tickets already done or cancelled', async () => {
    const ticket = linkedTicket('doing');
    ticket.moveTo('done');
    const ticketStore = ticketStoreWith(ticket);
    const eventBus = { emit: vi.fn() } as unknown as EventBus;

    const moved = await new DetectMergeUseCase(ticketStore, logger, eventBus)
      .execute([mergedPR()], 'org/repo');

    expect(moved).toEqual([]);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  // ── The acceptance criterion, end to end ──
  //
  // Wires a real bus + real listener + real AutoReviewWorkflow so the whole
  // chain is exercised: merge → ticket.moved → handleTicketMovedToDone →
  // handleTicketDone → mentions resolved. Fails if the emission is dropped from
  // the use case, if the fromStatus/toStatus guard breaks, or if the listener
  // gets unsubscribed.
  describe('merged PR auto-resolves the ticket mentions (integration)', () => {
    it('resolves every unresolved mention and emits mention.resolved for each', async () => {
      const ticket = linkedTicket('doing');
      const ticketStore = ticketStoreWith(ticket);

      const pending = TicketMentionEntity.create({
        id: 'm1', ticketId: 'T1', commentId: randomUUID(), targetAgent: 'builder', sourceAgent: 'user',
      });
      const waiting = TicketMentionEntity.create({
        id: 'm2', ticketId: 'T1', commentId: randomUUID(), targetAgent: 'reviewer', sourceAgent: 'user',
      });
      waiting.acknowledge();
      waiting.waitForInfo();
      const alreadyResolved = TicketMentionEntity.create({
        id: 'm3', ticketId: 'T1', commentId: randomUUID(), targetAgent: 'spec', sourceAgent: 'user',
      });
      alreadyResolved.resolve();

      const mentionStore = {
        getByTicket: vi.fn().mockResolvedValue([pending, waiting, alreadyResolved]),
        save: vi.fn().mockResolvedValue(undefined),
      } as unknown as MentionStorePort;

      const config = {
        get: () => ({ humanMentionName: 'nas', humanDisplayName: 'NaS' }),
      } as unknown as ConfigPort;

      const eventBus = new EventBus();
      const autoReviewWorkflow = new AutoReviewWorkflowUseCase(mentionStore, ticketStore, config, logger);
      autoReviewWorkflow.eventBus = eventBus;

      const resolvedEvents: AnyDomainEvent[] = [];
      eventBus.on('mention.resolved', (e) => { resolvedEvents.push(e); });

      const noop = new Proxy({}, { get: () => vi.fn().mockResolvedValue(undefined) });
      const listener = new DomainEventListener({
        eventBus,
        ticketStore,
        mentionStore,
        autoReviewWorkflow,
        logger,
        personaStore: noop,
        skillStore: noop,
        commentStore: noop,
        deliverableStore: noop,
        executeAgent: noop,
        wakeWaitingAgents: noop,
        runPanel: noop,
        generateTicketSummary: noop,
      } as unknown as ConstructorParameters<typeof DomainEventListener>[0]);
      listener.register();

      await new DetectMergeUseCase(ticketStore, logger, eventBus).execute([mergedPR()], 'org/repo');
      // emit() dispatches synchronously but handlers are async — let them settle.
      await new Promise((r) => setTimeout(r, 10));

      expect(pending.status).toBe('resolved');
      expect(waiting.status).toBe('resolved');
      expect(mentionStore.save).toHaveBeenCalledTimes(2);
      expect(vi.mocked(mentionStore.save).mock.calls.map(([m]) => m.id).sort()).toEqual(['m1', 'm2']);

      expect(resolvedEvents).toHaveLength(2);
      expect(resolvedEvents[0]).toMatchObject({ ticketId: 'T1', resolvedBy: 'system' });
    });
  });
});
