import type { FastifyRequest, FastifyReply } from 'fastify';
import { ApiTokenEntity } from '../../domain/entities/api-token.entity.js';
import { ApiTokenInvalidError } from '../../domain/errors.js';
import type { Container } from '../container.js';

declare module 'fastify' {
  interface FastifyRequest {
    agent?: { id: string; name: string };
  }
}

export function createAgentAuthHook(container: Container) {
  return async function agentAuthHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiTokenInvalidError();
    }

    const token = authHeader.slice(7);
    const hash = ApiTokenEntity.hashToken(token);
    const entity = await container.agentTokenStore.getByHash(hash);

    if (!entity) {
      throw new ApiTokenInvalidError();
    }

    // Mark used (fire-and-forget)
    entity.markUsed();
    container.agentTokenStore.save(entity).catch(() => {});

    const agentName = request.headers['x-agent-name'];
    request.agent = {
      id: entity.id,
      name: typeof agentName === 'string' ? agentName : entity.name,
    };
  };
}
