import { randomUUID } from 'node:crypto';
import type { CommentVisibility } from '@asm/shared';
import { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class PostCommentUseCase {
  constructor(
    private readonly commentStore: CommentStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    ticketId: string;
    authorType: 'user' | 'agent';
    authorName: string;
    body: string;
    visibility?: CommentVisibility;
    privateRecipients?: string[];
    parentId?: string | null;
    humanMentionNames?: string[];
  }): Promise<{ comment: TicketCommentEntity; createdMentions: TicketMentionEntity[] }> {
    const comment = TicketCommentEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      authorType: params.authorType,
      authorName: params.authorName,
      body: params.body,
      visibility: params.visibility,
      privateRecipients: params.privateRecipients,
      parentId: params.parentId,
    });

    await this.commentStore.save(comment);

    // Create mentions for each @agent:xxx found in the body
    const createdMentions: TicketMentionEntity[] = [];
    for (const targetAgent of comment.mentions) {
      if (targetAgent === params.authorName) continue; // don't self-mention
      const mention = TicketMentionEntity.create({
        id: randomUUID(),
        ticketId: params.ticketId,
        commentId: comment.id,
        targetAgent,
        sourceAgent: params.authorName,
        targetType: 'agent',
      });
      await this.mentionStore.save(mention);
      createdMentions.push(mention);
    }

    // Create mentions for human @mentions (tracked but never auto-executed)
    if (params.humanMentionNames && params.humanMentionNames.length > 0) {
      const humanMentions = TicketCommentEntity.extractHumanMentions(
        params.body,
        params.humanMentionNames,
      );
      for (const humanName of humanMentions) {
        if (humanName === params.authorName) continue;
        const mention = TicketMentionEntity.create({
          id: randomUUID(),
          ticketId: params.ticketId,
          commentId: comment.id,
          targetAgent: humanName,
          sourceAgent: params.authorName,
          targetType: 'human',
        });
        await this.mentionStore.save(mention);
        createdMentions.push(mention);
      }
    }

    // Log activity
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      action: 'commented',
      actorType: params.authorType,
      actorName: params.authorName,
      source: params.authorType === 'agent' ? 'api' : 'web',
    }));

    this.logger.info('Comment posted', {
      ticketId: params.ticketId,
      commentId: comment.id,
      mentionCount: createdMentions.length,
    });

    return { comment, createdMentions };
  }
}
