import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { StatusColumn, StatusModel, TicketStatus } from '@fleex/shared';
import {
  getActiveStatusModel,
  setActiveStatusModel,
  validateStatusModel,
} from '@fleex/shared';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { Container } from '../container.js';

interface UpdateStatusModelBody {
  columns: StatusColumn[];
  /** Maps a removed column key → the key its tickets should be moved to. */
  reassign?: Record<string, string>;
}

export function statusModelRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    // Current active model (built-in default until configured).
    app.get('/api/status-model', async () => getActiveStatusModel());

    // Replace the full model. Validates invariants, reassigns tickets that sit
    // in removed columns, persists, refreshes the active registry, broadcasts.
    app.put<{ Body: UpdateStatusModelBody }>('/api/status-model', async (request, reply) => {
      const next: StatusModel = { columns: request.body?.columns ?? [] };
      const reassign = request.body?.reassign ?? {};

      const validation = validateStatusModel(next);
      if (!validation.ok) {
        return reply.code(400).send({ error: 'invalid_status_model', details: validation.errors });
      }

      const nextKeys = new Set<string>(next.columns.map((c) => c.key));
      const removedKeys = getActiveStatusModel().columns
        .map((c) => c.key)
        .filter((k) => !nextKeys.has(k));

      // Plan ticket reassignment for removed columns BEFORE mutating anything.
      // Include archived tickets — otherwise they'd keep a dead status key and
      // resurface in a non-existent column when unarchived.
      const [active, archived] = await Promise.all([
        container.ticketStore.getAllTickets(),
        container.ticketStore.getArchivedTickets(undefined, 100_000, 0),
      ]);
      const allTickets = [...active, ...archived];
      const reassignPlan: { ticketId: string; from: string; to: TicketStatus }[] = [];
      for (const removed of removedKeys) {
        const affected = allTickets.filter((t) => t.status === removed);
        if (affected.length === 0) continue;
        const target = reassign[removed];
        if (!target || !nextKeys.has(target)) {
          return reply.code(400).send({
            error: 'reassignment_required',
            details: [
              `Column '${removed}' still has ${affected.length} ticket(s); provide reassign['${removed}'] pointing to a remaining column.`,
            ],
          });
        }
        for (const t of affected) reassignPlan.push({ ticketId: t.id, from: removed, to: target as TicketStatus });
      }

      // Reassign tickets first (old model still active — a plain status move).
      for (const { ticketId, to } of reassignPlan) {
        const ticket = await container.ticketStore.getTicketById(ticketId);
        if (!ticket) continue;
        const diff = ticket.moveTo(to);
        if (Object.keys(diff).length === 0) continue;
        await container.ticketStore.saveTicket(ticket);
        await container.ticketStore.saveActivity(TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          action: 'moved',
          changes: diff,
          source: 'web',
          actorName: 'status-model',
        }));
        emit({ type: 'ticket.moved', ticketId: ticket.id, fromStatus: diff['status']!.from as string, toStatus: diff['status']!.to as string, occurredAt: new Date() });
      }

      await container.statusModelStore.saveModel(next);
      setActiveStatusModel(next);
      emit({ type: 'status-model.updated', occurredAt: new Date() });

      return next;
    });
  };
}
