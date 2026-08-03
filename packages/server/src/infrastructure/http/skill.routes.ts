import { SkillNotFoundError } from '../../domain/errors.js';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

export function skillRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) =>
    container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    // GET /api/skills — list all skills
    app.get('/api/skills', async () => {
      const skills = await container.skillStore.getAll();
      return skills.map((s) => s.toDTO());
    });

    // GET /api/skills/enabled — list enabled skills only
    app.get('/api/skills/enabled', async () => {
      const skills = await container.skillStore.getEnabled();
      return skills.map((s) => s.toDTO());
    });

    // GET /api/skills/:id — get single skill
    app.get<{ Params: { id: string } }>('/api/skills/:id', async (request) => {
      const skill = await container.skillStore.getById(request.params.id);
      if (!skill) throw new SkillNotFoundError(request.params.id);
      return skill.toDTO();
    });

    // POST /api/skills — create skill
    app.post<{
      Body: {
        commandName: string;
        name: string;
        displayName: string;
        markdownContent?: string;
        enabled?: boolean;
        personaId: string;
      };
    }>('/api/skills', async (request, reply) => {
      const skill = await container.createSkill.execute(request.body);
      emit({ type: 'skill.created', skillId: skill.id, occurredAt: new Date() });
      return reply.code(201).send(skill.toDTO());
    });

    // PATCH /api/skills/:id — update skill
    app.patch<{
      Params: { id: string };
      Body: {
        commandName?: string;
        name?: string;
        displayName?: string;
        markdownContent?: string;
        enabled?: boolean;
        personaId?: string;
      };
    }>('/api/skills/:id', async (request) => {
      const skill = await container.updateSkill.execute(request.params.id, request.body);
      emit({ type: 'skill.updated', skillId: skill.id, occurredAt: new Date() });
      return skill.toDTO();
    });

    // DELETE /api/skills/:id — delete skill
    app.delete<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
      await container.deleteSkill.execute(request.params.id);
      emit({ type: 'skill.deleted', skillId: request.params.id, occurredAt: new Date() });
      return reply.code(204).send();
    });

    // POST /api/skills/:id/execute — execute skill against a ticket
    app.post<{
      Params: { id: string };
      Body: { ticketId: string };
    }>('/api/skills/:id/execute', async (request) => {
      const { id } = request.params;
      const { ticketId } = request.body;

      const skill = await container.skillStore.getById(id);
      if (!skill) throw new SkillNotFoundError(id);

      emit({
        type: 'skill.executed',
        skillId: id,
        personaId: skill.personaId,
        ticketId,
        occurredAt: new Date(),
      });

      // Fire-and-forget — execution runs in background like mention execution
      container.executeAgent.executeForSkill(id, ticketId).catch((err) => {
        container.logger.error('Skill execution failed', {
          skillId: id,
          ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return { status: 'started', skillId: id, ticketId };
    });
  };
}
