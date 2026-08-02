import { randomUUID } from 'node:crypto';
import type { UpdateTicketRequest } from '@fleex/shared';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { deriveTicketUpdateEvents } from '../../domain/services/ticket-audit-events.js';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { EventBus } from '../event-bus.js';
import { type TicketActor, toActivitySource } from './ticket-actor.js';

export interface UpdateTicketInput {
  ticketId: string;
  changes: UpdateTicketRequest;
  actor: TicketActor;
  /** Web `?silent=true`: skip the activity row. Events are still emitted. */
  silent?: boolean;
}

/**
 * Single write path for ticket updates (web UI + agent API).
 *
 * Routes both callers through `deriveTicketUpdateEvents`, so a favorite/blocked/
 * tags change produces the same semantic event whoever made it — the agent API
 * used to emit an opaque `ticket.updated` instead.
 */
export class UpdateTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: UpdateTicketInput): Promise<TicketEntity> {
    const ticket = await this.ticketStore.getTicketById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError(input.ticketId);

    const { dueDate, ...rest } = input.changes;
    const changes: Parameters<TicketEntity['update']>[0] = { ...rest };
    if (dueDate !== undefined) {
      changes.dueDate = dueDate ? new Date(dueDate) : null;
    }

    const diff = ticket.update(changes);

    // Nothing actually changed — `update()` left `updatedAt` untouched, so
    // persisting would be a no-op write and any event/activity would be noise.
    if (Object.keys(diff).length === 0) return ticket;

    await this.ticketStore.saveTicket(ticket);

    if (!input.silent) {
      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'updated',
        changes: diff,
        source: toActivitySource(input.actor),
        actorType: input.actor.actorType,
        actorName: input.actor.actorName,
      }));
    }

    const meta = {
      source: input.actor.source,
      ...(input.actor.executionId ? { executionId: input.actor.executionId } : {}),
    };
    for (const event of deriveTicketUpdateEvents(ticket.id, diff, new Date(), meta)) {
      this.eventBus.emit(event);
    }

    return ticket;
  }
}
