import { randomUUID } from 'node:crypto';
import type { DeliverableType, DeliverableStatus } from '@fleex/shared';
import { normalizeDeliverableTypes, stripHtmlCodeFence } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { InvalidDeliverableTypeError } from '../../domain/errors.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class SubmitDeliverableUseCase {
  constructor(
    private readonly deliverableStore: DeliverableStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    ticketId: string;
    agentName: string;
    type: DeliverableType;
    title: string;
    content: string;
    status?: DeliverableStatus;
    mentionId?: string | null;
  }): Promise<TicketDeliverableEntity> {
    // Validate the type against the workspace's configured deliverable types.
    // (Existing deliverables with now-invalid types are tolerated on read; only
    // new writes are constrained to the configured set.)
    const validTypes = normalizeDeliverableTypes(this.config.get().deliverableTypes);
    const typeDef = validTypes.find((t) => t.id === params.type);
    if (!typeDef) {
      throw new InvalidDeliverableTypeError(params.type);
    }

    // html-rendered content is embedded directly into an iframe — defensively
    // unwrap a markdown code fence the agent may have wrapped the HTML in, so the
    // stored content (and copy/detach) is clean raw HTML.
    const content = typeDef.renderer === 'html' ? stripHtmlCodeFence(params.content) : params.content;

    const deliverable = TicketDeliverableEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      agentName: params.agentName,
      type: params.type,
      title: params.title,
      content,
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
