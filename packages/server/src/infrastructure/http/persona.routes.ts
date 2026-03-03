import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { AgentPersonaNotFoundError } from '../../domain/errors.js';

export function personaRoutes(container: Container) {
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
        soulMd?: string;
        identityMd?: string;
        memoryMd?: string;
        humanMentionName?: string | null;
      };
    }>('/api/personas', async (request, reply) => {
      const persona = await container.createPersona.execute(request.body);
      const dto = persona.toDTO();
      container.personaBroadcast('persona:created', dto);
      return reply.code(201).send(dto);
    });

    // PATCH /api/personas/:id — update persona
    app.patch<{
      Params: { id: string };
      Body: {
        name?: string;
        displayName?: string;
        model?: string;
        soulMd?: string;
        identityMd?: string;
        memoryMd?: string;
        humanMentionName?: string | null;
      };
    }>('/api/personas/:id', async (request) => {
      const persona = await container.updatePersona.execute(
        request.params.id,
        request.body,
      );
      const dto = persona.toDTO();
      container.personaBroadcast('persona:updated', dto);
      return dto;
    });

    // DELETE /api/personas/:id — delete persona
    app.delete<{ Params: { id: string } }>('/api/personas/:id', async (request, reply) => {
      await container.deletePersona.execute(request.params.id);
      container.personaBroadcast('persona:deleted', { id: request.params.id });
      return reply.code(204).send();
    });

    // POST /api/personas/:id/execute — trigger "Play"
    app.post<{ Params: { id: string } }>('/api/personas/:id/execute', async (request) => {
      const result = await container.executeAgent.execute(request.params.id);
      if (result.status === 'started') {
        container.personaBroadcast('persona:execution_started', {
          personaId: request.params.id,
          mentionIds: result.mentionIds,
        });
      }
      return result;
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
