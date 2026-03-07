import type { FastifyInstance } from 'fastify';
import type { CreateSessionRequest } from '@fleex/shared';
import type { Container } from '../container.js';

export function sessionRoutes(container: Container) {
  const emit = (...events: Parameters<typeof container.eventBus.emit>) => container.eventBus.emit(...events);

  return async function (app: FastifyInstance) {
    app.get('/api/sessions', async () => {
      const sessions = await container.listSessions.execute();
      return sessions.map((s) => s.toDTO());
    });

    app.post<{ Body: CreateSessionRequest }>('/api/sessions', async (request, reply) => {
      const cwdExists = await container.hostFs.exists(request.body.cwd);
      if (!cwdExists) {
        return reply.code(422).send({
          code: 'CWD_NOT_FOUND',
          message: `Directory not found: ${request.body.cwd}`,
        });
      }
      const session = await container.createSession.execute(request.body);
      emit({
        type: 'session.created',
        sessionId: session.id,
        sessionType: session.type,
        worktreeBranch: session.worktreeBranch,
        occurredAt: new Date(),
      });
      return reply.code(201).send(session.toDTO());
    });

    app.get('/api/sessions/groups', async () => {
      return container.getSessionGroups.execute();
    });

    app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
      const session = await container.sessionStore.getById(request.params.id);
      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }
      return session.toDTO();
    });

    app.patch<{ Params: { id: string }; Body: { displayName: string } }>(
      '/api/sessions/:id/rename',
      async (request, reply) => {
        await container.renameSession.execute(request.params.id, request.body.displayName);
        emit({
          type: 'session.renamed',
          sessionId: request.params.id,
          displayName: request.body.displayName,
          occurredAt: new Date(),
        });
        const session = await container.sessionStore.getById(request.params.id);
        return reply.code(200).send(session?.toDTO());
      },
    );

    app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
      await container.killSession.execute(request.params.id);
      emit({
        type: 'session.killed',
        sessionId: request.params.id,
        occurredAt: new Date(),
      });
      return reply.code(204).send();
    });
  };
}
