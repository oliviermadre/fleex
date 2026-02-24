import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';
import type { Container } from '../container.js';

export function agentTokenRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/agent-tokens', async () => {
      return (await container.agentTokenStore.getAll()).map((t) => t.toDTO());
    });

    app.post<{ Body: { name: string } }>('/api/agent-tokens', async (request, reply) => {
      const { name } = request.body;
      if (!name || typeof name !== 'string') {
        return reply.code(400).send({ error: 'name is required' });
      }

      const { entity, secret } = ApiTokenEntity.create({ id: randomUUID(), name });
      await container.agentTokenStore.save(entity);

      return reply.code(201).send(entity.toCreatedDTO(secret));
    });

    app.delete<{ Params: { id: string } }>('/api/agent-tokens/:id', async (request, reply) => {
      await container.agentTokenStore.remove(request.params.id);
      return reply.code(204).send();
    });
  };
}
