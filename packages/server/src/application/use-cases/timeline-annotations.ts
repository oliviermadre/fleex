import { randomUUID } from 'node:crypto';
import { TimelineAnnotationEntity, titleFromCommentBody, type AnnotationPatch } from '../../domain/entities/timeline-annotation.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import {
  AnnotationNotFoundError,
  CommentAlreadyAnnotatedError,
  CommentNotFoundError,
  ForbiddenError,
  TicketNotFoundError,
} from '../../domain/errors.js';
import type { AnyDomainEvent } from '../../domain/events.js';
import type { AnnotationStorePort } from '../ports/annotation-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

/** Who acts. An agent may only edit or delete the annotations it wrote. */
export interface AnnotationActor {
  type: 'user' | 'agent';
  name: string;
}

/**
 * Timeline annotations: create (dropped on the frieze), promote (from a
 * comment), update, delete. Every write records a ticket activity and emits the
 * domain event the WS broadcast listens to — so the web and agent routes, and
 * the CLI/MCP behind the latter, share one behaviour.
 */
export class TimelineAnnotationsUseCase {
  constructor(
    private readonly annotationStore: AnnotationStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly emit: (event: AnyDomainEvent) => void,
  ) {}

  async list(ticketId: string): Promise<TimelineAnnotationEntity[]> {
    await this.requireTicket(ticketId);
    return this.annotationStore.listByTicket(ticketId);
  }

  async create(
    ticketId: string,
    input: { at: string; title: string; body?: string; tone?: string },
    actor: AnnotationActor,
  ): Promise<TimelineAnnotationEntity> {
    const ticket = await this.requireTicket(ticketId);
    const annotation = TimelineAnnotationEntity.create({
      id: randomUUID(),
      ticketId,
      ticketCreatedAt: ticket.createdAt,
      at: input.at,
      title: input.title,
      body: input.body,
      tone: input.tone,
      authorType: actor.type,
      authorName: actor.name,
    });
    return this.persistNew(annotation, actor);
  }

  /**
   * Pin a comment to the Timeline. The text is copied (the annotation can be
   * shortened and survives the comment); `sourceCommentId` keeps the link.
   * Defaults: title = the comment's first line, body = the whole comment,
   * instant = when it was posted.
   */
  async promote(
    ticketId: string,
    commentId: string,
    input: { at?: string; title?: string; body?: string; tone?: string },
    actor: AnnotationActor,
  ): Promise<TimelineAnnotationEntity> {
    const ticket = await this.requireTicket(ticketId);
    const comment = await this.commentStore.getById(commentId);
    if (!comment || comment.ticketId !== ticketId) throw new CommentNotFoundError(commentId);
    if (actor.type === 'agent' && !comment.isVisibleTo(actor.name)) throw new CommentNotFoundError(commentId);
    const existing = await this.annotationStore.getBySourceComment(commentId);
    if (existing) throw new CommentAlreadyAnnotatedError(commentId, existing.id);

    const annotation = TimelineAnnotationEntity.create({
      id: randomUUID(),
      ticketId,
      ticketCreatedAt: ticket.createdAt,
      at: input.at ?? comment.createdAt.toISOString(),
      title: input.title ?? titleFromCommentBody(comment.body),
      body: input.body ?? comment.body,
      tone: input.tone,
      sourceCommentId: comment.id,
      authorType: actor.type,
      authorName: actor.name,
    });
    return this.persistNew(annotation, actor);
  }

  async update(
    ticketId: string,
    annotationId: string,
    patch: AnnotationPatch,
    actor: AnnotationActor,
  ): Promise<TimelineAnnotationEntity> {
    const ticket = await this.requireTicket(ticketId);
    const annotation = await this.requireOwned(ticketId, annotationId, actor, 'edit');
    annotation.update(patch, ticket.createdAt);
    await this.annotationStore.save(annotation);
    this.emit({ type: 'annotation.updated', ticketId, annotationId, annotation: annotation.toDTO(), occurredAt: new Date() });
    return annotation;
  }

  async remove(ticketId: string, annotationId: string, actor: AnnotationActor): Promise<void> {
    await this.requireTicket(ticketId);
    const annotation = await this.requireOwned(ticketId, annotationId, actor, 'delete');
    await this.annotationStore.remove(annotationId);
    await this.recordActivity(ticketId, 'annotation_removed', annotation.title, null, actor);
    this.emit({ type: 'annotation.deleted', ticketId, annotationId, occurredAt: new Date() });
  }

  /**
   * The comment is being deleted: its annotation stays, only the link goes.
   * Broadcast the unlinked annotation so open frieze drop "see the comment".
   */
  async onCommentDeleted(commentId: string): Promise<void> {
    const linked = await this.annotationStore.getBySourceComment(commentId);
    if (!linked) return;
    await this.annotationStore.clearSourceComment(commentId);
    linked.sourceCommentId = null;
    this.emit({
      type: 'annotation.updated',
      ticketId: linked.ticketId,
      annotationId: linked.id,
      annotation: linked.toDTO(),
      occurredAt: new Date(),
    });
  }

  private async persistNew(annotation: TimelineAnnotationEntity, actor: AnnotationActor): Promise<TimelineAnnotationEntity> {
    await this.annotationStore.save(annotation);
    await this.recordActivity(annotation.ticketId, 'annotation_added', null, annotation.title, actor);
    this.emit({
      type: 'annotation.created',
      ticketId: annotation.ticketId,
      annotationId: annotation.id,
      annotation: annotation.toDTO(),
      occurredAt: new Date(),
    });
    return annotation;
  }

  private async requireTicket(ticketId: string) {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);
    return ticket;
  }

  private async requireOwned(
    ticketId: string,
    annotationId: string,
    actor: AnnotationActor,
    verb: 'edit' | 'delete',
  ): Promise<TimelineAnnotationEntity> {
    const annotation = await this.annotationStore.getById(annotationId);
    if (!annotation || annotation.ticketId !== ticketId) throw new AnnotationNotFoundError(annotationId);
    if (actor.type === 'agent' && !(annotation.authorType === 'agent' && annotation.authorName === actor.name)) {
      throw new ForbiddenError(`Only the author can ${verb} this annotation`);
    }
    return annotation;
  }

  private async recordActivity(
    ticketId: string,
    action: 'annotation_added' | 'annotation_removed',
    from: string | null,
    to: string | null,
    actor: AnnotationActor,
  ): Promise<void> {
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action,
      changes: { annotation: { from, to } },
      actorType: actor.type,
      actorName: actor.name,
      source: actor.type === 'agent' ? 'api' : 'web',
    }));
  }
}
