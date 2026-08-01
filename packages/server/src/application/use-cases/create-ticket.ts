import { randomUUID } from 'node:crypto';
import type { TicketStatus, TicketPriority, TicketType, TicketLink } from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { BoardNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { EventBus } from '../event-bus.js';
import type { TicketMutationActor } from './apply-ticket-mutation.js';

export interface CreateTicketInput {
  boardId: string;
  title: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  type?: TicketType | null;
  tags?: string[];
  links?: Omit<TicketLink, 'id' | 'createdAt'>[];
  dueDate?: string | null;
  actor?: TicketMutationActor;
}

/**
 * Ticket creation, extracted from `POST /api/tickets` so the HTTP route and the
 * native `ticket.create` workflow operation share one implementation —
 * including the "insert at the top of the target column" position rule.
 */
export class CreateTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: CreateTicketInput): Promise<TicketEntity> {
    const board = await this.ticketStore.getBoardById(input.boardId);
    if (!board) throw new BoardNotFoundError(input.boardId);

    // Position: top of the destination column.
    const targetStatus = input.status ?? 'backlog';
    const existing = await this.ticketStore.getTicketsByStatus(input.boardId, targetStatus);
    const minPos = existing.length > 0
      ? existing.reduce((min, t) => Math.min(min, t.position), Infinity)
      : 1;

    const ticketId = randomUUID();
    const now = new Date().toISOString();
    const ticketLinks = (input.links ?? []).map((l) => ({ ...l, id: randomUUID(), createdAt: now }));

    const ticket = TicketEntity.create({
      id: ticketId,
      boardId: input.boardId,
      displayId: 0, // assigned by createTicket() below
      title: input.title,
      description: input.description,
      status: targetStatus,
      priority: input.priority,
      type: input.type,
      position: minPos - 1,
      tags: input.tags,
      links: ticketLinks,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    });

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: 'created',
      actorType: input.actor?.actorType,
      actorName: input.actor?.actorName,
      source: input.actor?.source,
    }));

    this.eventBus.emit({
      type: 'ticket.created',
      ticketId,
      boardId: input.boardId,
      occurredAt: new Date(),
    });

    return ticket;
  }
}
