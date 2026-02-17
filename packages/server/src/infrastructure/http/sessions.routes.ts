import type { FastifyInstance } from 'fastify';
import type { CreateSessionRequest } from '@asm/shared';
import type { Container } from '../container.js';

export function sessionRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/sessions', async () => {
      const sessions = await container.listSessions.execute();
      return sessions.map((s) => s.toDTO());
    });

    app.post<{ Body: CreateSessionRequest }>('/api/sessions', async (request, reply) => {
      const session = await container.createSession.execute(request.body);
      return reply.code(201).send(session.toDTO());
    });

    app.get('/api/sessions/groups', async () => {
      return container.getSessionGroups.execute();
    });

    app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
      const session = container.sessionStore.getById(request.params.id);
      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }
      return session.toDTO();
    });

    app.patch<{ Params: { id: string }; Body: { displayName: string } }>(
      '/api/sessions/:id/rename',
      async (request, reply) => {
        await container.renameSession.execute(request.params.id, request.body.displayName);
        const session = container.sessionStore.getById(request.params.id);
        return reply.code(200).send(session?.toDTO());
      },
    );

    app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
      await container.killSession.execute(request.params.id);
      return reply.code(204).send();
    });
  };
}
