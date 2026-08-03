import { randomUUID } from 'node:crypto';

import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { MentionNotFoundError, ForbiddenError } from '../../domain/errors.js';

import type { LoggerPort } from '../ports/logger.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

export class ResolveMentionUseCase {
  constructor(
    private readonly mentionStore: MentionStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    mentionId: string;
    agentName: string;
    commentId?: string;
    deliverableId?: string;
  }): Promise<void> {
    const mention = await this.mentionStore.getById(params.mentionId);
    if (!mention) throw new MentionNotFoundError(params.mentionId);

    if (!mention.isResolvableBy(params.agentName)) {
      throw new ForbiddenError(`Only ${mention.targetAgent} can resolve this mention`);
    }

    mention.resolve({
      commentId: params.commentId,
      deliverableId: params.deliverableId,
    });
    await this.mentionStore.save(mention);

    await this.ticketStore.saveActivity(
      TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: mention.ticketId,
        action: 'mention_resolved',
        changes: { mentionId: { from: mention.id, to: 'resolved' } },
        actorType: 'agent',
        actorName: params.agentName,
        source: 'api',
      }),
    );

    this.logger.info('Mention resolved', {
      mentionId: params.mentionId,
      agentName: params.agentName,
    });
  }
}
