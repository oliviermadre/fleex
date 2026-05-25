import { randomUUID } from 'node:crypto';
import type { CommentVisibility, MentionExecutionMode } from '@fleex/shared';
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
    executionMode?: MentionExecutionMode;
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
    // Phase 1: agent-authored comments do NOT create actionable mentions (no chaining)
    const isAgentAuthored = params.authorType === 'agent';
    const mentionMode = params.executionMode ?? 'plan';

    const createdMentions: TicketMentionEntity[] = [];
    if (!isAgentAuthored) {
      for (const targetAgent of comment.mentions) {
        if (targetAgent === params.authorName) continue; // don't self-mention
        const mention = TicketMentionEntity.create({
          id: randomUUID(),
          ticketId: params.ticketId,
          commentId: comment.id,
          targetAgent,
          sourceAgent: params.authorName,
          targetType: 'agent',
          executionMode: mentionMode,
        });
        await this.mentionStore.save(mention);
        createdMentions.push(mention);
      }

      // Create mentions for @panel:xxx found in the body
      const panelMentions = TicketCommentEntity.extractPanelMentions(params.body);
      for (const panelName of panelMentions) {
        if (panelName === params.authorName) continue; // don't self-mention
        const mention = TicketMentionEntity.create({
          id: randomUUID(),
          ticketId: params.ticketId,
          commentId: comment.id,
          targetAgent: panelName,
          sourceAgent: params.authorName,
          targetType: 'panel',
          executionMode: mentionMode,
        });
        await this.mentionStore.save(mention);
        createdMentions.push(mention);
      }

      // Create mentions for @skill:xxx found in the body
      const skillMentions = TicketCommentEntity.extractSkillMentions(params.body);
      for (const commandName of skillMentions) {
        const mention = TicketMentionEntity.create({
          id: randomUUID(),
          ticketId: params.ticketId,
          commentId: comment.id,
          targetAgent: commandName,
          sourceAgent: params.authorName,
          targetType: 'skill',
          executionMode: 'edit', // skills always run in edit mode
        });
        await this.mentionStore.save(mention);
        createdMentions.push(mention);
      }

      // Create mentions for @workflow:xxx found in the body
      const workflowMentions = TicketCommentEntity.extractWorkflowMentions(params.body);
      for (const workflowSlug of workflowMentions) {
        const mention = TicketMentionEntity.create({
          id: randomUUID(),
          ticketId: params.ticketId,
          commentId: comment.id,
          targetAgent: workflowSlug,
          sourceAgent: params.authorName,
          targetType: 'workflow',
          executionMode: 'talk', // workflows delegate execution to step executors
        });
        await this.mentionStore.save(mention);
        createdMentions.push(mention);
      }
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
