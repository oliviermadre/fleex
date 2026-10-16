import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { agentCommentsRoutes } from '../../src/infrastructure/http/agent-comments.routes.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TimelineAnnotationEntity } from '../../src/domain/entities/timeline-annotation.entity.js';
import { TimelineAnnotationsUseCase } from '../../src/application/use-cases/timeline-annotations.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import { FakeAnnotationStore } from '../helpers/fakes.js';

// ---------------------------------------------------------------------------
// AC16/AC17 on pg/supabase: `source_comment_id` is a FK `ON DELETE SET NULL`,
// so the moment the comment row goes, the database has already unlinked the
// annotation. If the route deleted the comment first, the use-case would find
// nothing to unlink and open friezes would keep a dead « Voir le commentaire »
// link. The comment store below reproduces that FK, so this test fails as soon
// as the route deletes before unlinking.
// ---------------------------------------------------------------------------

describe('DELETE comment (agent API) with a pinned annotation', () => {
  it('broadcasts the unlinked annotation even when the database nulls the FK on delete', async () => {
    const comment = TicketCommentEntity.create({ id: 'c1', ticketId: 't1', authorType: 'agent', authorName: 'builder', body: 'pivot' });
    const annotations = new FakeAnnotationStore();
    const pinned = TimelineAnnotationEntity.create({
      ticketId: 't1',
      at: comment.createdAt.toISOString(),
      title: 'Pivot',
      sourceCommentId: 'c1',
      authorType: 'user',
      authorName: 'Nas',
      ticketCreatedAt: new Date(comment.createdAt.getTime() - 60_000),
    });
    await annotations.save(pinned);

    const commentStore = {
      getById: async (id: string) => (id === 'c1' ? comment : null),
      // pg/supabase: ON DELETE SET NULL on timeline_annotations.source_comment_id
      remove: async (id: string) => annotations.clearSourceComment(id),
    } as unknown as CommentStorePort;
    const events: AnyDomainEvent[] = [];
    const emit = (e: AnyDomainEvent) => events.push(e);
    const timelineAnnotations = new TimelineAnnotationsUseCase(annotations, {} as TicketStorePort, commentStore, emit);

    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (req) => {
      (req as unknown as { agent: { name: string } }).agent = { name: 'builder' };
    });
    await app.register(
      agentCommentsRoutes({
        commentStore,
        mentionStore: { getByComment: async () => [] },
        timelineAnnotations,
        eventBus: { emit },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    );
    const res = await app.inject({ method: 'DELETE', url: '/tickets/t1/comments/c1' });
    await app.close();

    expect(res.statusCode).toBe(204);
    expect(events.map((e) => e.type)).toEqual(['annotation.updated', 'comment.deleted']);
    expect(events[0]).toMatchObject({ annotationId: pinned.id, annotation: { sourceCommentId: null } });
  });
});
