import type { CommentVisibility } from '@fleex/shared';
import type { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import type { PostCommentUseCase } from '../use-cases/post-comment.js';
import type { EventBus } from '../event-bus.js';

/**
 * Post a comment on behalf of a workflow and announce it.
 *
 * `PostCommentUseCase` only persists — it deliberately emits nothing, leaving
 * the choice of event to its caller. The WebSocket broadcast that pushes a new
 * comment into an open thread is driven by `comment.posted`, so a caller that
 * forgets to emit writes a comment nobody sees until the ticket is remounted.
 * Every workflow-authored comment goes through here so that can't happen again.
 *
 * `createdMentions` is always empty on purpose: workflows orchestrate via edges,
 * not mentions, so a workflow comment must never auto-trigger an agent or the
 * auto-review workflow — even when a reviewer typed an @mention in their notes.
 */
export async function postWorkflowComment(
  postComment: PostCommentUseCase,
  eventBus: EventBus,
  params: {
    ticketId: string;
    authorName: string;
    body: string;
    visibility?: CommentVisibility;
  },
): Promise<TicketCommentEntity> {
  const { comment } = await postComment.execute({
    ticketId: params.ticketId,
    authorType: 'agent',
    authorName: params.authorName,
    body: params.body,
    visibility: params.visibility,
    parentId: null,
  });

  eventBus.emit({
    type: 'comment.posted',
    commentId: comment.id,
    ticketId: params.ticketId,
    authorType: 'agent',
    authorName: params.authorName,
    createdMentions: [],
    occurredAt: new Date(),
  });

  return comment;
}
