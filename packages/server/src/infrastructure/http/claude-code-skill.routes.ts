import type { FastifyInstance } from 'fastify';
import type { UpdateClaudeCodeSkillRequest } from '@fleex/shared';
import type { Container } from '../container.js';

/**
 * Admin of the Claude Code skills mirrored for THIS machine. Rows of other
 * machines sharing the database are never returned nor editable here.
 */
export function claudeCodeSkillRoutes(container: Container) {
  const cc = container.claudeCodeSkills;

  return async function (app: FastifyInstance) {
    // GET /api/claude-code-skills — every row of this host (any status)
    app.get('/api/claude-code-skills', async () => {
      const [skills, systemPersonaId] = await Promise.all([cc.list(), cc.systemPersonaId()]);
      return { hostId: cc.hostId, systemPersonaId, skills: skills.map((s) => s.toDTO()) };
    });

    // POST /api/claude-code-skills/scan — re-scan this machine now
    app.post('/api/claude-code-skills/scan', async () => cc.scan());

    // PATCH /api/claude-code-skills/:id — enable / persona override / revalidate
    app.patch<{ Params: { id: string }; Body: UpdateClaudeCodeSkillRequest }>(
      '/api/claude-code-skills/:id',
      async (request) => (await cc.update(request.params.id, request.body ?? {})).toDTO(),
    );

    // POST /api/claude-code-skills/bulk — enable or disable many at once
    app.post<{ Body: { ids: string[]; enabled: boolean } }>('/api/claude-code-skills/bulk', async (request) => {
      const { ids = [], enabled } = request.body ?? ({} as { ids: string[]; enabled: boolean });
      const changed = await cc.setEnabled(ids, enabled === true);
      return { updated: changed.length };
    });

    // GET /api/claude-code-skills/:id/content — SKILL.md, read live, read-only
    app.get<{ Params: { id: string } }>('/api/claude-code-skills/:id/content', async (request) => {
      return { content: await cc.readContent(request.params.id) };
    });
  };
}
