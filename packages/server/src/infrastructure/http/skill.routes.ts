import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { ClaudeCodeSkillNotFoundError, SkillNotFoundError } from '../../domain/errors.js';

export function skillRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    // Runnable Claude Code skills of this machine, in the native skill shape
    // (`source: 'claude_code'`). A failure there must never hide native skills.
    const claudeCodeSkillDTOs = () => container.claudeCodeSkills.listAsSkills().catch((err) => {
      container.logger.warn('Listing Claude Code skills failed', { error: err instanceof Error ? err.message : String(err) });
      return [];
    });

    // Opt-in so that consumers expecting editable native skills only (export,
    // import, update by name, workflow/routine pickers) never see mirrored ones.
    type ListQuery = { Querystring: { include?: string } };
    const withClaudeCode = (q: { include?: string }) => (q.include ?? '').split(',').includes('claude_code');

    // GET /api/skills — list all skills (+ runnable Claude Code skills of this host with ?include=claude_code)
    app.get<ListQuery>('/api/skills', async (request) => {
      const skills = (await container.skillStore.getAll()).map((s) => s.toDTO());
      return withClaudeCode(request.query) ? [...skills, ...await claudeCodeSkillDTOs()] : skills;
    });

    // GET /api/skills/enabled — list enabled skills only
    app.get<ListQuery>('/api/skills/enabled', async (request) => {
      const skills = (await container.skillStore.getEnabled()).map((s) => s.toDTO());
      return withClaudeCode(request.query) ? [...skills, ...await claudeCodeSkillDTOs()] : skills;
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
      const skill = await container.updateSkill.execute(
        request.params.id,
        request.body,
      );
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
      if (!skill) {
        // Not native: a Claude Code skill of this host, runnable on this ticket?
        const cc = await container.claudeCodeSkills.get(id).catch(() => null);
        if (!cc) throw new SkillNotFoundError(id);
        const resolved = await container.claudeCodeSkills.resolveForTicket(cc.commandName, ticketId);
        if (!resolved || resolved.id !== cc.id) throw new ClaudeCodeSkillNotFoundError(id);
        container.executeAgent.executeForClaudeCodeSkill(cc.id, ticketId).catch((err) => {
          container.logger.error('Claude Code skill execution failed', {
            skillId: id, ticketId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        return { status: 'started', skillId: id, ticketId };
      }

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
          skillId: id, ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return { status: 'started', skillId: id, ticketId };
    });
  };
}
