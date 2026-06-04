export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Session not found: ${id}`, 'SESSION_NOT_FOUND');
  }
}

export class SessionAlreadyExistsError extends DomainError {
  constructor(name: string) {
    super(`Session already exists: ${name}`, 'SESSION_ALREADY_EXISTS');
  }
}

export class TmuxNotAvailableError extends DomainError {
  constructor() {
    super('tmux is not available on this system', 'TMUX_NOT_AVAILABLE');
  }
}

export class WorktreeError extends DomainError {
  constructor(message: string) {
    super(message, 'WORKTREE_ERROR');
  }
}

export class RepositoryNotFoundError extends DomainError {
  constructor(path: string) {
    super(`Repository not found: ${path}`, 'REPOSITORY_NOT_FOUND');
  }
}

export class BoardNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Board not found: ${id}`, 'BOARD_NOT_FOUND');
  }
}

export class TicketNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Ticket not found: ${id}`, 'TICKET_NOT_FOUND');
  }
}

export class ApiTokenInvalidError extends DomainError {
  constructor() {
    super('Invalid or missing API token', 'API_TOKEN_INVALID');
  }
}

export class SessionNameConflictError extends DomainError {
  constructor(displayName: string) {
    super(`Session name "${displayName}" conflict`, 'SESSION_NAME_CONFLICT');
  }
}

export class LastBoardError extends DomainError {
  constructor() {
    super('Cannot delete the last board', 'LAST_BOARD');
  }
}

export class CommentNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Comment not found: ${id}`, 'COMMENT_NOT_FOUND');
  }
}

export class MentionNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Mention not found: ${id}`, 'MENTION_NOT_FOUND');
  }
}

export class DeliverableNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Deliverable not found: ${id}`, 'DELIVERABLE_NOT_FOUND');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super(message, 'FORBIDDEN');
  }
}

export class AgentPersonaNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Agent persona not found: ${id}`, 'AGENT_PERSONA_NOT_FOUND');
  }
}

export class AgentPersonaNameConflictError extends DomainError {
  constructor(name: string) {
    super(`Agent persona name already exists: ${name}`, 'AGENT_PERSONA_NAME_CONFLICT');
  }
}

export class SkillNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Skill not found: ${id}`, 'SKILL_NOT_FOUND');
  }
}

export class SkillCommandNameConflictError extends DomainError {
  constructor(commandName: string) {
    super(`Skill command name already exists: ${commandName}`, 'SKILL_COMMAND_NAME_CONFLICT');
  }
}

export class PanelNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Panel not found: ${id}`, 'PANEL_NOT_FOUND');
  }
}

export class PanelNameConflictError extends DomainError {
  constructor(name: string) {
    super(`Panel name already exists: ${name}`, 'PANEL_NAME_CONFLICT');
  }
}

export class WorkflowRunAlreadyActiveError extends DomainError {
  constructor(ticketId: string) {
    super(`A workflow run is already active on ticket ${ticketId}`, 'WORKFLOW_RUN_ALREADY_ACTIVE');
  }
}

export class WorkflowTemplateNotFoundError extends DomainError {
  constructor(slugOrId: string) {
    super(`Workflow template not found: ${slugOrId}`, 'WORKFLOW_TEMPLATE_NOT_FOUND');
  }
}

export class WorkflowRunNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Workflow run not found: ${id}`, 'WORKFLOW_RUN_NOT_FOUND');
  }
}

export class StepRunNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Step run not found: ${id}`, 'STEP_RUN_NOT_FOUND');
  }
}

export class InvalidGateOutcomeError extends DomainError {
  constructor(outcome: string, allowed: string[]) {
    super(`Invalid gate outcome "${outcome}". Allowed: ${allowed.join(', ')}`, 'INVALID_GATE_OUTCOME');
  }
}

export type SlackImportErrorCode =
  | 'SLACK_INVALID_URL'
  | 'SLACK_INTEGRATION_UNAVAILABLE'
  | 'SLACK_CONVERSATION_INACCESSIBLE'
  | 'SLACK_CONVERSATION_EMPTY';

/**
 * Raised when importing a ticket from a Slack message link fails. Carries a
 * specific {@link SlackImportErrorCode} so the HTTP layer can return a 422 with
 * an actionable code (invalid link, integration unavailable, inaccessible, or
 * empty conversation).
 */
export class SlackImportError extends DomainError {
  constructor(message: string, public readonly slackCode: SlackImportErrorCode) {
    super(message, slackCode);
  }
}
