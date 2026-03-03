import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../domain/errors.js';

const CODE_TO_STATUS: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_ALREADY_EXISTS: 409,
  SESSION_NAME_CONFLICT: 409,
  TMUX_NOT_AVAILABLE: 503,
  WORKTREE_ERROR: 400,
  INVALID_WORKING_DIRECTORY: 400,
  REPOSITORY_NOT_FOUND: 404,
  BOARD_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  API_TOKEN_INVALID: 401,
  LAST_BOARD: 422,
  COMMENT_NOT_FOUND: 404,
  MENTION_NOT_FOUND: 404,
  DELIVERABLE_NOT_FOUND: 404,
  FORBIDDEN: 403,
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
