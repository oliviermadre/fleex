import { randomUUID } from 'node:crypto';
import type { TicketStatus } from '@fleex/shared';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { deriveTicketUpdateEvents } from '../../domain/services/ticket-audit-events.js';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { EventBus } from '../event-bus.js';

export type TicketFieldPatch = Parameters<TicketEntity['update']>[0];

export interface TicketMutationActor {
  actorType?: 'user' | 'agent';
  actorName?: string | null;
  source?: 'web' | 'api';
}

export interface ApplyTicketMutationInput {
  ticketId: string;
  /**
   * A status change routed through `moveTo()`. Kept separate from `fields` on
   * purpose: only this path writes a `moved` activity and emits `ticket.moved`.
   * Folding the status into `fields` would silently downgrade it to a generic
   * `ticket.updated`, breaking every automation listening for the move.
   */
  move?: { status: TicketStatus; position?: number };
  /** Everything else, applied through `update()` in a single pass. */
  fields?: TicketFieldPatch;
  /** Skips activity rows (not events) — mirrors `PATCH /api/tickets/:id?silent=true`. */
  silent?: boolean;
  actor?: TicketMutationActor;
}

export interface ApplyTicketMutationResult {
  ticket: TicketEntity;
  diff: Record<string, { from: unknown; to: unknown }>;
  changed: string[];
}

/**
 * The single write path for ticket mutations.
 *
 * One read, every change applied to the in-memory entity, one write — so a
 * multi-action native step is atomic and the order of its actions cannot matter.
 * `PATCH /api/tickets/:id` and `POST /api/tickets/:id/move` delegate here too,
 * which is what keeps HTTP and workflow semantics from drifting apart.
 */
export class ApplyTicketMutationUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(input: ApplyTicketMutationInput): Promise<ApplyTicketMutationResult> {
    const ticket = await this.ticketStore.getTicketById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError(input.ticketId);
    return this.applyTo(ticket, input);
  }

  /**
   * Same semantics against an already-loaded entity — lets a caller that just
   * created a ticket keep working on it without a redundant read.
   */
  async applyTo(
    ticket: TicketEntity,
    input: Omit<ApplyTicketMutationInput, 'ticketId'>,
  ): Promise<ApplyTicketMutationResult> {
    const now = new Date();
    const fromStatus = ticket.status;

    const moveDiff = input.move ? ticket.moveTo(input.move.status) : {};
    if (input.move?.position !== undefined) {
      ticket.position = input.move.position;
      ticket.updatedAt = now;
    }

    const fieldDiff = input.fields ? ticket.update(input.fields) : {};

    await this.ticketStore.saveTicket(ticket);

    const activityBase = {
      ticketId: ticket.id,
      actorType: input.actor?.actorType,
      actorName: input.actor?.actorName,
      source: input.actor?.source,
    };

    if (!input.silent && Object.keys(moveDiff).length > 0) {
      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(), ...activityBase, action: 'moved', changes: moveDiff,
      }));
    }
    if (!input.silent && Object.keys(fieldDiff).length > 0) {
      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(), ...activityBase, action: 'updated', changes: fieldDiff,
      }));
    }

    // Emitted whenever a move was *requested*, even when the ticket already sat
    // in the target status — this matches the pre-existing route behaviour.
    if (input.move) {
      this.eventBus.emit({
        type: 'ticket.moved',
        ticketId: ticket.id,
        fromStatus,
        toStatus: input.move.status,
        occurredAt: now,
      });
    }
    for (const event of deriveTicketUpdateEvents(ticket.id, fieldDiff, now)) {
      this.eventBus.emit(event);
    }

    const diff = { ...moveDiff, ...fieldDiff };
    return { ticket, diff, changed: Object.keys(diff) };
  }
}
