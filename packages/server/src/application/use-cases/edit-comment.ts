import { randomUUID } from 'node:crypto';
import type { MentionExecutionMode, MentionTargetType } from '@fleex/shared';
import { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import { CommentNotFoundError } from '../../domain/errors.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

interface DesiredMention {
  targetAgent: string;
  targetType: MentionTargetType;
  executionMode: MentionExecutionMode;
}

/**
 * Edits an existing comment's body and reconciles the mentions it carries.
 *
 * Shared by the agent port (`PATCH /tickets/:id/comments/:commentId`) and the
 * web port (`PATCH /api/tickets/:id/comments/:commentId`) so both behave
 * identically. Authorization (author-only vs. trusted human) stays in the
 * route layer; this use-case assumes the caller is allowed to edit.
 *
 * Reconciliation mirrors {@link PostCommentUseCase}: it computes the desired
 * mention set from the new body (gated the same way — agent-authored comments
 * never create actionable agent/panel/skill/workflow mentions), then creates
 * the newly-added ones and resolves the ones that disappeared.
 */
export class EditCommentUseCase {
  constructor(
    private readonly commentStore: CommentStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    commentId: string;
    body: string;
    editorName: string;
    executionMode?: MentionExecutionMode;
    humanMentionNames?: string[];
  }): Promise<{ comment: TicketCommentEntity; createdMentions: TicketMentionEntity[]; bodyChanged: boolean }> {
    const comment = await this.commentStore.getById(params.commentId);
    if (!comment) throw new CommentNotFoundError(params.commentId);

    const bodyChanged = comment.updateBody(params.body, params.editorName);
    if (bodyChanged) {
      await this.commentStore.save(comment);
    }

    const desired = this.computeDesiredMentions(comment, params);
    const existing = await this.mentionStore.getByComment(comment.id);

    const key = (targetType: string, targetAgent: string) => `${targetType}:${targetAgent}`;
    const existingKeys = new Set(existing.map((m) => key(m.targetType, m.targetAgent)));
    const desiredKeys = new Set(desired.map((d) => key(d.targetType, d.targetAgent)));

    // Resolve mentions that were removed from the body.
    for (const m of existing) {
      if (!desiredKeys.has(key(m.targetType, m.targetAgent)) && m.status !== 'resolved') {
        m.resolve();
        await this.mentionStore.save(m);
      }
    }

    // Create mentions for targets newly added by the edit.
    const createdMentions: TicketMentionEntity[] = [];
    for (const d of desired) {
      if (existingKeys.has(key(d.targetType, d.targetAgent))) continue;
      const mention = TicketMentionEntity.create({
        id: randomUUID(),
        ticketId: comment.ticketId,
        commentId: comment.id,
        targetAgent: d.targetAgent,
        sourceAgent: params.editorName,
        targetType: d.targetType,
        executionMode: d.executionMode,
      });
      await this.mentionStore.save(mention);
      createdMentions.push(mention);
    }

    this.logger.info('Comment edited', {
      commentId: comment.id,
      ticketId: comment.ticketId,
      bodyChanged,
      createdMentions: createdMentions.length,
    });

    return { comment, createdMentions, bodyChanged };
  }

  private computeDesiredMentions(
    comment: TicketCommentEntity,
    params: { editorName: string; executionMode?: MentionExecutionMode; humanMentionNames?: string[] },
  ): DesiredMention[] {
    const body = comment.body;
    const desired: DesiredMention[] = [];
    const mode = params.executionMode ?? 'plan';

    // Agent-authored comments never chain into actionable mentions (parity with PostCommentUseCase).
    if (comment.authorType !== 'agent') {
      for (const targetAgent of comment.mentions) {
        if (targetAgent === params.editorName) continue;
        desired.push({ targetAgent, targetType: 'agent', executionMode: mode });
      }
      for (const panelName of TicketCommentEntity.extractPanelMentions(body)) {
        if (panelName === params.editorName) continue;
        desired.push({ targetAgent: panelName, targetType: 'panel', executionMode: mode });
      }
      for (const skillName of TicketCommentEntity.extractSkillMentions(body)) {
        desired.push({ targetAgent: skillName, targetType: 'skill', executionMode: 'edit' });
      }
      for (const workflowSlug of TicketCommentEntity.extractWorkflowMentions(body)) {
        desired.push({ targetAgent: workflowSlug, targetType: 'workflow', executionMode: 'talk' });
      }
    }

    if (params.humanMentionNames && params.humanMentionNames.length > 0) {
      for (const humanName of TicketCommentEntity.extractHumanMentions(body, params.humanMentionNames)) {
        if (humanName === params.editorName) continue;
        desired.push({ targetAgent: humanName, targetType: 'human', executionMode: mode });
      }
    }

    return desired;
  }
}
