import type { ExecutionMode } from '@fleex/shared';

import { AgentPersonaNotFoundError } from '../../domain/errors.js';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

export function personaRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) =>
    container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    // GET /api/personas — list all personas
    app.get('/api/personas', async () => {
      const personas = await container.personaStore.getAll();
      return personas.map((p) => p.toDTO());
    });

    // GET /api/personas/:id — get single persona
    app.get<{ Params: { id: string } }>('/api/personas/:id', async (request) => {
      const persona = await container.personaStore.getById(request.params.id);
      if (!persona) throw new AgentPersonaNotFoundError(request.params.id);
      return persona.toDTO();
    });

    // POST /api/personas — create persona
    app.post<{
      Body: {
        name: string;
        displayName: string;
        model?: string;
        executionMode?: ExecutionMode;
        soulMd?: string;
        identityMd?: string;
        memoryMd?: string;
        humanMentionName?: string | null;
      };
    }>('/api/personas', async (request, reply) => {
      const persona = await container.createPersona.execute(request.body);
      emit({ type: 'persona.created', personaId: persona.id, occurredAt: new Date() });
      return reply.code(201).send(persona.toDTO());
    });

    // PATCH /api/personas/:id — update persona
    app.patch<{
      Params: { id: string };
      Body: {
        name?: string;
        displayName?: string;
        model?: string;
        executionMode?: ExecutionMode;
        soulMd?: string;
        identityMd?: string;
        memoryMd?: string;
        humanMentionName?: string | null;
      };
    }>('/api/personas/:id', async (request) => {
      const persona = await container.updatePersona.execute(request.params.id, request.body);
      emit({ type: 'persona.updated', personaId: persona.id, occurredAt: new Date() });
      return persona.toDTO();
    });

    // DELETE /api/personas/:id — delete persona
    app.delete<{ Params: { id: string } }>('/api/personas/:id', async (request, reply) => {
      await container.deletePersona.execute(request.params.id);
      emit({ type: 'persona.deleted', personaId: request.params.id, occurredAt: new Date() });
      return reply.code(204).send();
    });

    // POST /api/personas/:id/execute — trigger "Play"
    app.post<{ Params: { id: string } }>('/api/personas/:id/execute', async (request) => {
      const result = await container.executeAgent.execute(request.params.id);
      if (result.status === 'started') {
        emit({
          type: 'persona.execution_started',
          personaId: request.params.id,
          mentionIds: result.mentionIds,
          occurredAt: new Date(),
        });
      }
      return result;
    });

    // GET /api/personas/statuses — bulk execution statuses (1 query instead of N)
    app.get('/api/personas/statuses', async () => {
      const personas = await container.personaStore.getAll();
      const allMentions = await container.mentionStore.getAll();

      // Group pending mentions by agent name
      const pendingByAgent = new Map<string, number>();
      for (const m of allMentions) {
        if (m.status !== 'resolved' && m.status !== 'waiting_for_info') {
          pendingByAgent.set(m.targetAgent, (pendingByAgent.get(m.targetAgent) ?? 0) + 1);
        }
      }

      const statuses: Record<
        string,
        { running: boolean; pendingMentionCount: number; activeMentionIds: string[] }
      > = {};
      for (const persona of personas) {
        const status = container.executeAgent.getStatus(persona.id);
        statuses[persona.id] = {
          running: status.running,
          pendingMentionCount: pendingByAgent.get(persona.name) ?? 0,
          activeMentionIds: status.activeMentionIds,
        };
      }
      return statuses;
    });

    // GET /api/personas/:id/status — get execution status
    app.get<{ Params: { id: string } }>('/api/personas/:id/status', async (request) => {
      const persona = await container.personaStore.getById(request.params.id);
      if (!persona) throw new AgentPersonaNotFoundError(request.params.id);

      const status = container.executeAgent.getStatus(request.params.id);
      const pendingMentions = await container.mentionStore.getPendingForAgent(persona.name);

      return {
        running: status.running,
        pendingMentionCount: pendingMentions.length,
        activeMentionIds: status.activeMentionIds,
      };
    });
  };
}
