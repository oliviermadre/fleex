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
  AGENT_PERSONA_NOT_FOUND: 404,
  AGENT_PERSONA_NAME_CONFLICT: 409,
  SKILL_NOT_FOUND: 404,
  SKILL_COMMAND_NAME_CONFLICT: 409,
  PANEL_NOT_FOUND: 404,
  PANEL_NAME_CONFLICT: 409,
  WORKFLOW_TEMPLATE_NOT_FOUND: 404,
  WORKFLOW_RUN_NOT_FOUND: 404,
  WORKFLOW_RUN_ALREADY_ACTIVE: 409,
  STEP_RUN_NOT_FOUND: 404,
  INVALID_GATE_OUTCOME: 400,
  TICKET_GROUP_NOT_FOUND: 404,
  // Raised when a user explicitly terminates a step's execution. It is a
  // deliberate interruption, not a server fault, and callers are expected to
  // swallow it — 409 is the least wrong status should it ever reach the wire.
  EXECUTION_CANCELLED: 409,
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
