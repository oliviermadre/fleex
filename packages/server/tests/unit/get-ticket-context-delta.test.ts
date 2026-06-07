import { describe, it, expect } from 'vitest';
import { GetTicketContextUseCase } from '../../src/application/use-cases/get-ticket-context.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { DomainEventLogStorePort } from '../../src/application/ports/domain-event-log-store.port.js';

const T0 = new Date('2026-01-01T00:00:00Z'); // before watermark (seen)
const WATERMARK = new Date('2026-01-02T00:00:00Z');
const T2 = new Date('2026-01-03T00:00:00Z'); // after watermark (edited / created)

function comment(id: string, createdAt: Date, lastEditedAt: Date | null): TicketCommentEntity {
  return new TicketCommentEntity(
    id, 'tkt', 'agent', 'someone', `body-${id}`, 'public', [], [], null,
    createdAt, lastEditedAt ?? createdAt, lastEditedAt, lastEditedAt ? 'editor' : null, lastEditedAt ? 1 : 0,
  );
}

function deliverable(id: string, agentName: string, createdAt: Date, lastEditedAt: Date | null): TicketDeliverableEntity {
  return new TicketDeliverableEntity(
    id, 'tkt', agentName, 'report', `title-${id}`, 'content', 1, 'final', null,
    createdAt, lastEditedAt ?? createdAt, lastEditedAt, lastEditedAt ? 'editor' : null,
  );
}

function buildUseCase(opts: {
  comments: TicketCommentEntity[];
  deliverables: TicketDeliverableEntity[];
  deletedComments?: string[];
  deletedDeliverables?: string[];
}): GetTicketContextUseCase {
  const ticket = TicketEntity.create({ id: 'tkt', boardId: 'b', displayId: 1, title: 'T' });

  const ticketStore = {
    getTicketById: async () => ticket,
    getActivitiesByTicket: async () => [],
  } as unknown as TicketStorePort;
  const commentStore = { getByTicket: async () => opts.comments } as unknown as CommentStorePort;
  const mentionStore = { getByTicket: async () => [] } as unknown as MentionStorePort;
  const deliverableStore = { getByTicket: async () => opts.deliverables } as unknown as DeliverableStorePort;
  const domainEventLogStore = {
    list: async ({ eventType }: { eventType?: string }) => {
      const ids = eventType === 'comment.deleted' ? (opts.deletedComments ?? [])
        : eventType === 'deliverable.deleted' ? (opts.deletedDeliverables ?? [])
        : [];
      const field = eventType === 'comment.deleted' ? 'commentId' : 'deliverableId';
      return ids.map((id) => ({ payload: { ticketId: 'tkt', [field]: id } }));
    },
  } as unknown as DomainEventLogStorePort;

  return new GetTicketContextUseCase(ticketStore, commentStore, mentionStore, deliverableStore, undefined, undefined, domainEventLogStore);
}

describe('GetTicketContextUseCase context delta', () => {
  it('omits the delta when no watermark is provided', async () => {
    const uc = buildUseCase({ comments: [comment('c1', T0, T2)], deliverables: [] });
    const ctx = await uc.execute({ ticketId: 'tkt', agentName: 'alice' });
    expect(ctx.contextDelta).toBeUndefined();
  });

  it('flags comments seen-then-edited but not newly created ones', async () => {
    const uc = buildUseCase({
      comments: [
        comment('seen-edited', T0, T2),   // created before, edited after → in delta
        comment('new', T2, null),         // created after watermark → excluded
        comment('seen-untouched', T0, null), // never edited → excluded
      ],
      deliverables: [],
    });
    const ctx = await uc.execute({ ticketId: 'tkt', agentName: 'alice', sinceWatermark: WATERMARK });
    expect(ctx.contextDelta!.editedComments.map((c) => c.id)).toEqual(['seen-edited']);
  });

  it('detects self-authored deliverable edits for the running agent', async () => {
    const uc = buildUseCase({
      comments: [],
      deliverables: [
        deliverable('mine', 'alice', T0, T2),
        deliverable('theirs', 'bob', T0, T2),
      ],
    });
    const ctx = await uc.execute({ ticketId: 'tkt', agentName: 'alice', sinceWatermark: WATERMARK });
    expect(ctx.contextDelta!.editedDeliverables.map((d) => d.id).sort()).toEqual(['mine', 'theirs']);
    expect(ctx.contextDelta!.selfAuthoredDeliverableEdited).toBe(true);
  });

  it('reconstructs deletions from the audit log', async () => {
    const uc = buildUseCase({
      comments: [],
      deliverables: [],
      deletedComments: ['gone-c'],
      deletedDeliverables: ['gone-d'],
    });
    const ctx = await uc.execute({ ticketId: 'tkt', agentName: 'alice', sinceWatermark: WATERMARK });
    expect(ctx.contextDelta!.deletedCommentIds).toEqual(['gone-c']);
    expect(ctx.contextDelta!.deletedDeliverableIds).toEqual(['gone-d']);
    expect(ctx.contextDelta!.selfAuthoredDeliverableEdited).toBe(false);
  });
});
