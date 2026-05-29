import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { CreateTriggerInput, UpdateTriggerInput } from '@fleex/shared';
import { TriggerNotFoundError } from '../../domain/errors.js';

/**
 * Trigger CRUD + manual run + run history. Registered only when the storage
 * backend provides trigger stores (sqlite / supabase).
 */
export function triggerRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const triggerStore = container.triggerStore;
    const runTrigger = container.runTrigger;
    const createTrigger = container.createTrigger;
    const updateTrigger = container.updateTrigger;
    const deleteTrigger = container.deleteTrigger;
    const listTriggerRuns = container.listTriggerRuns;
    if (!triggerStore || !runTrigger || !createTrigger || !updateTrigger || !deleteTrigger || !listTriggerRuns) {
      return; // triggers unavailable on this backend
    }

    app.get('/api/triggers', async () => {
      const triggers = await triggerStore.getAll();
      return triggers.map((t) => t.toDTO());
    });

    app.get<{ Params: { id: string } }>('/api/triggers/:id', async (request) => {
      const t = await triggerStore.getById(request.params.id);
      if (!t) throw new TriggerNotFoundError(request.params.id);
      return t.toDTO();
    });

    app.post<{ Body: CreateTriggerInput }>('/api/triggers', async (request, reply) => {
      const t = await createTrigger.execute(request.body);
      return reply.code(201).send(t.toDTO());
    });

    app.patch<{ Params: { id: string }; Body: UpdateTriggerInput }>('/api/triggers/:id', async (request) => {
      const t = await updateTrigger.execute(request.params.id, request.body);
      return t.toDTO();
    });

    app.delete<{ Params: { id: string } }>('/api/triggers/:id', async (request, reply) => {
      await deleteTrigger.execute(request.params.id);
      return reply.code(204).send();
    });

    // Manual fire — runs immediately regardless of schedule.
    app.post<{ Params: { id: string } }>('/api/triggers/:id/run', async (request, reply) => {
      const trigger = await triggerStore.getById(request.params.id);
      if (!trigger) throw new TriggerNotFoundError(request.params.id);
      const run = await runTrigger.execute({ trigger, scheduledFor: new Date() });
      return reply.code(201).send(run.toDTO());
    });

    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      '/api/triggers/:id/runs',
      async (request) => {
        const limit = request.query.limit ? Number(request.query.limit) : 50;
        return listTriggerRuns.execute(request.params.id, limit);
      },
    );
  };
}
