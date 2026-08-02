import { randomUUID } from 'node:crypto';
import type { TicketStatus } from '@fleex/shared';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { EventBus } from '../event-bus.js';
import { type TicketActor, toActivitySource } from './ticket-actor.js';

export interface MoveTicketInput {
  ticketId: string;
  toStatus: TicketStatus;
  position?: number;
  actor: TicketActor;
}

/**
 * Single write path for moving/reordering a ticket (web UI + agent API).
 *
 * A real column change emits `ticket.moved`; a drag *within* a column is a pure
 * repositioning and emits `ticket.updated { position }` instead. That keeps the
 * audit log free of `done → done` transitions, which downstream listeners
 * (auto-resolve mentions, summary generation) had to guard against.
 */
export class MoveTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: MoveTicketInput): Promise<TicketEntity> {
    const ticket = await this.ticketStore.getTicketById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError(input.ticketId);

    const fromStatus = ticket.status;
    const diff = ticket.moveTo(input.toStatus);

    const posFrom = ticket.position;
    const posChanged = input.position !== undefined && input.position !== ticket.position;
    if (posChanged) {
      ticket.position = input.position!;
      ticket.updatedAt = new Date();
    }

    const statusChanged = Object.keys(diff).length > 0;
    if (!statusChanged && !posChanged) return ticket;

    await this.ticketStore.saveTicket(ticket);

    const executionId = input.actor.executionId ? { executionId: input.actor.executionId } : {};

    if (statusChanged) {
      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'moved',
        changes: diff,
        source: toActivitySource(input.actor),
        actorType: input.actor.actorType,
        actorName: input.actor.actorName,
      }));

      this.eventBus.emit({
        type: 'ticket.moved',
        ticketId: ticket.id,
        fromStatus,
        toStatus: input.toStatus,
        source: input.actor.source,
        ...executionId,
        occurredAt: new Date(),
      });
    } else {
      // Reorder only: no activity row — repositioning isn't a user-visible action.
      this.eventBus.emit({
        type: 'ticket.updated',
        ticketId: ticket.id,
        changes: { position: { from: posFrom, to: input.position } },
        source: input.actor.source,
        ...executionId,
        occurredAt: new Date(),
      });
    }

    return ticket;
  }
}
