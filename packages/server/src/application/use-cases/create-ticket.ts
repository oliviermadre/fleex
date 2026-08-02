import { randomUUID } from 'node:crypto';
import type { TicketStatus, TicketPriority, TicketType, TicketLink } from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { BoardNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { EventBus } from '../event-bus.js';
import { type TicketActor, toActivitySource } from './ticket-actor.js';

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
  actor: TicketActor;
}

/**
 * Single write path for ticket creation (web UI + agent API).
 *
 * Owns the position placement, the activity row and the `ticket.created`
 * emission so both callers stay in sync — they used to duplicate all three.
 */
export class CreateTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: CreateTicketInput): Promise<TicketEntity> {
    const board = await this.ticketStore.getBoardById(input.boardId);
    if (!board) throw new BoardNotFoundError(input.boardId);

    // New tickets land at the top of their column.
    const targetStatus = input.status ?? 'backlog';
    const existing = await this.ticketStore.getTicketsByStatus(input.boardId, targetStatus);
    const minPos = existing.length > 0
      ? existing.reduce((min, t) => Math.min(min, t.position), Infinity)
      : 1;

    const ticketId = randomUUID();
    const links: TicketLink[] = (input.links ?? []).map((l) => ({
      ...l,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }));

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
      links,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    });

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: 'created',
      source: toActivitySource(input.actor),
      actorType: input.actor.actorType,
      actorName: input.actor.actorName,
    }));

    this.eventBus.emit({
      type: 'ticket.created',
      ticketId,
      boardId: input.boardId,
      source: input.actor.source,
      ...(input.actor.executionId ? { executionId: input.actor.executionId } : {}),
      occurredAt: new Date(),
    });

    return ticket;
  }
}
