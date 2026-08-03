import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../domain/errors.js';

const CODE_TO_STATUS: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_ALREADY_EXISTS: 409,
  SESSION_NAME_CONFLICT: 409,
  TMUX_NOT_AVAILABLE: 503,
  WORKTREE_ERROR: 400,
  REPOSITORY_NOT_FOUND: 404,
  BOARD_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  API_TOKEN_INVALID: 401,
  LAST_BOARD: 422,
  COMMENT_NOT_FOUND: 404,
  MENTION_NOT_FOUND: 404,
  DELIVERABLE_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_DELIVERABLE_TYPE: 400,
  DELIVERABLE_TYPE_NOT_FOUND: 404,
  DELIVERABLE_TYPE_CONFLICT: 409,
  DELIVERABLE_TYPE_IN_USE: 409,
  SLACK_INVALID_URL: 422,
  SLACK_INTEGRATION_UNAVAILABLE: 422,
  SLACK_CONVERSATION_INACCESSIBLE: 422,
  SLACK_CONVERSATION_EMPTY: 422,
  ACTION_NOT_FOUND: 404,
  ACTION_DISABLED: 409,
  ACTION_ALREADY_RUNNING: 409,
  ACTION_NOT_EXECUTABLE: 400,
  ACTION_INVALID_PARAMS: 400,
  ACTION_MISSING_CONTEXT: 400,
  ACTION_TIMEOUT: 504,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      const status = CODE_TO_STATUS[error.code] ?? 500;
      // Some errors (e.g. invalid action params) carry a per-field breakdown so
      // the caller can fix the request without guessing which field was wrong.
      const { details } = error as DomainError & { details?: unknown };
      return reply.code(status).send({
        error: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details }),
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message,
    });
  });
}
