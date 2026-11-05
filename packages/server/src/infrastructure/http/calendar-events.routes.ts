import type { FastifyInstance, FastifyReply } from 'fastify';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import {
  CalendarEventNotFoundError,
  CalendarEventValidationError,
  CalendarEventsService,
} from '../../application/use-cases/calendar-events.js';

/** WS message pushed on the `tickets` channel after every write, so open agendas refetch. */
export const CALENDAR_EVENT_CHANGED = 'calendar_event:changed';

/**
 * /api/calendar-events — E1 free events, CRUD over the KV store. Without a KV
 * store every route answers 501.
 */
export function calendarEventsRoutes(deps: {
  kvStore: KvStorePort | null | undefined;
  /** Pushes on the `tickets` WS channel (`container.ticketBroadcast`). */
  broadcast?: (type: string, data: unknown) => void;
  now?: () => Date;
  newId?: () => string;
}) {
  const service = deps.kvStore ? new CalendarEventsService(deps.kvStore, deps.now, deps.newId) : null;
  const changed = (id: string, action: 'created' | 'updated' | 'deleted') => {
    try {
      deps.broadcast?.(CALENDAR_EVENT_CHANGED, { id, action });
    } catch {
      // a broadcast failure must not fail the write
    }
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof CalendarEventValidationError) return reply.code(400).send({ error: err.message });
    if (err instanceof CalendarEventNotFoundError) return reply.code(404).send({ error: err.message });
    throw err;
  };
  const unavailable = (reply: FastifyReply) => reply.code(501).send({ error: 'Calendar events are unavailable on this storage' });

  return async function (app: FastifyInstance) {
    app.get('/api/calendar-events', async (_request, reply) => {
      if (!service) return unavailable(reply);
      return service.list();
    });

    app.post<{ Body: unknown }>('/api/calendar-events', async (request, reply) => {
      if (!service) return unavailable(reply);
      try {
        const event = await service.create(request.body);
        changed(event.id, 'created');
        return reply.code(201).send(event);
      } catch (err) {
        return fail(reply, err);
      }
    });

    app.patch<{ Params: { id: string }; Body: unknown }>('/api/calendar-events/:id', async (request, reply) => {
      if (!service) return unavailable(reply);
      try {
        const event = await service.update(request.params.id, request.body);
        changed(event.id, 'updated');
        return event;
      } catch (err) {
        return fail(reply, err);
      }
    });

    app.delete<{ Params: { id: string } }>('/api/calendar-events/:id', async (request, reply) => {
      if (!service) return unavailable(reply);
      try {
        await service.delete(request.params.id);
        changed(request.params.id, 'deleted');
        return reply.code(204).send();
      } catch (err) {
        return fail(reply, err);
      }
    });
  };
}
