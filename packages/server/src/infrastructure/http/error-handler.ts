import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../domain/errors.js';

const CODE_TO_STATUS: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_ALREADY_EXISTS: 409,
  TMUX_NOT_AVAILABLE: 503,
  WORKTREE_ERROR: 400,
  REPOSITORY_NOT_FOUND: 404,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      const status = CODE_TO_STATUS[error.code] ?? 500;
      return reply.code(status).send({
        error: error.code,
        message: error.message,
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message,
    });
  });
}
