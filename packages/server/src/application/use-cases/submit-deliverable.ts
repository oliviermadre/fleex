import { randomUUID } from 'node:crypto';
import { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class SubmitDeliverableUseCase {
  constructor(
    private readonly deliverableStore: DeliverableStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    ticketId: string;
    agentName: string;
    type: string;
    title: string;
    content: string;
    status?: 'draft' | 'final';
    mentionId?: string | null;
  }): Promise<TicketDeliverableEntity> {
    const deliverable = TicketDeliverableEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      agentName: params.agentName,
      type: params.type,
      title: params.title,
      content: params.content,
      status: params.status,
      mentionId: params.mentionId,
    });

    await this.deliverableStore.save(deliverable);

    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      action: 'deliverable_submitted',
      changes: { deliverableId: { from: null, to: deliverable.id } },
      actorType: 'agent',
      actorName: params.agentName,
      source: 'api',
    }));

    this.logger.info('Deliverable submitted', {
      ticketId: params.ticketId,
      deliverableId: deliverable.id,
      type: params.type,
    });

    return deliverable;
  }
}
