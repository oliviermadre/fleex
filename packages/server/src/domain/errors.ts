import type { ImportSourceId } from '@fleex/shared';

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

const BOARD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BoardNotFoundError extends DomainError {
  constructor(id: string) {
    // A bare "Board not found: aad33682" reads as "this board doesn't exist"
    // and sends callers (agents especially) into retry loops, when the real
    // problem is that they pasted the 8-char id shown in listings. Say so.
    const hint = BOARD_UUID_RE.test(id)
      ? ''
      : ' (not a full board UUID — the API requires the full id; list boards via GET /api/boards.'
        + ' The fleex CLI additionally accepts board names and id prefixes)';
    super(`Board not found: ${id}${hint}`, 'BOARD_NOT_FOUND');
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

export class InvalidDeliverableTypeError extends DomainError {
  constructor(type: string) {
    super(`Invalid deliverable type: ${type}`, 'INVALID_DELIVERABLE_TYPE');
  }
}

export class DeliverableTypeNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Deliverable type not found: ${id}`, 'DELIVERABLE_TYPE_NOT_FOUND');
  }
}

export class DeliverableTypeConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'DELIVERABLE_TYPE_CONFLICT');
  }
}

export class DeliverableTypeInUseError extends DomainError {
  constructor(id: string, count: number) {
    super(`Deliverable type "${id}" is used by ${count} deliverable(s)`, 'DELIVERABLE_TYPE_IN_USE');
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

/**
 * A `workflow.trigger` chain got too deep.
 *
 * A workflow that triggers a workflow is a feature; a workflow that — directly
 * or through two others — triggers itself is an incident: every run spawns
 * another, forever, each one creating tickets. A depth cap is the cheap,
 * always-correct guard (no cycle detection to get subtly wrong), and a chain
 * that long is a modelling mistake in its own right.
 */
export class WorkflowRunDepthExceededError extends DomainError {
  constructor(templateId: string, maxDepth: number) {
    super(
      `Refusing to start workflow ${templateId}: it would be nested more than ${maxDepth} `
      + 'runs deep. A workflow triggering itself, directly or through others, is the usual cause.',
      'WORKFLOW_RUN_DEPTH_EXCEEDED',
    );
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

/**
 * Raised when a workflow step's agent execution is interrupted by an explicit
 * user action (Terminate button, cancel run, or force restart). It is NOT a
 * failure: callers must mark the step `cancelled` and avoid emitting
 * `workflow.run_failed` or advancing the run.
 */
export class ExecutionCancelledError extends DomainError {
  constructor(executionId: string) {
    super(`Execution cancelled: ${executionId}`, 'EXECUTION_CANCELLED');
  }
}

export class InvalidGateOutcomeError extends DomainError {
  constructor(outcome: string, allowed: string[]) {
    super(`Invalid gate outcome "${outcome}". Allowed: ${allowed.join(', ')}`, 'INVALID_GATE_OUTCOME');
  }
}

/** The picked edge isn't one the engine offered — the candidates are persisted, never recomputed. */
export class InvalidRouteEdgeError extends DomainError {
  constructor(edgeId: string, allowed: string[]) {
    super(`Edge "${edgeId}" is not a routing candidate. Allowed: ${allowed.join(', ')}`, 'INVALID_ROUTE_EDGE');
  }
}

/** Routing was already resolved (or never ambiguous) — resolving again would fork the run. */
export class StepNotAwaitingRoutingError extends DomainError {
  constructor(stepRunId: string, status: string) {
    super(`Step run ${stepRunId} is not awaiting routing (status: ${status})`, 'STEP_NOT_AWAITING_ROUTING');
  }
}

// ── Routines ───────────────────────────────────────────────────────────────

export class RoutineNotFoundError extends DomainError {
  constructor(slugOrId: string) {
    super(`Routine not found: ${slugOrId}`, 'ROUTINE_NOT_FOUND');
  }
}

/**
 * The primitive a routine targets (persona / skill / panel) does not exist.
 * Workflow targets keep their own {@link WorkflowTemplateNotFoundError} —
 * distinct codes because the fix differs (pick a template vs fix a name).
 */
export class RoutineTargetNotFoundError extends DomainError {
  constructor(kind: string, ref: string) {
    super(`Routine target not found: ${kind} "${ref}"`, 'ROUTINE_TARGET_NOT_FOUND');
  }
}

/**
 * A routine already has a run in flight. Mirrors
 * {@link WorkflowRunAlreadyActiveError} for tickets: two concurrent runs of the
 * same routine would race on the same workspace and the same subject.
 */
export class RoutineRunAlreadyActiveError extends DomainError {
  constructor(routineId: string) {
    super(`A workflow run is already active on routine ${routineId}`, 'ROUTINE_RUN_ALREADY_ACTIVE');
  }
}

/** A routine's slug collides with an existing one. */
export class RoutineSlugConflictError extends DomainError {
  constructor(slug: string) {
    super(`A routine with slug "${slug}" already exists`, 'ROUTINE_SLUG_CONFLICT');
  }
}

/**
 * A `once` / `cron` trigger the scheduler could not turn into a fire time: an
 * unparseable cron expression, an unknown IANA timezone, a non-ISO `runAt`.
 *
 * Rejected at write time rather than at tick time: a malformed trigger stored
 * now becomes a routine the scheduler silently never fires, and the author
 * would keep believing it is armed.
 */
export class InvalidRoutineTriggerError extends DomainError {
  constructor(reason: string) {
    super(`Invalid routine trigger: ${reason}`, 'INVALID_ROUTINE_TRIGGER');
  }
}

/**
 * Error codes shared by every import source. The first four map to a 422 (the
 * caller can fix the input or the integration); `IMPORT_UPSTREAM_FAILED` maps to
 * a 502 (a transient failure of the source, worth retrying).
 */
export type ImportErrorCode =
  | 'IMPORT_INVALID_INPUT' // detectSource() returned null
  | 'IMPORT_SOURCE_UNAVAILABLE' // Slack integration missing · `gh` not authenticated
  | 'IMPORT_NOT_FOUND' // issue/PR/conversation missing or inaccessible
  | 'IMPORT_EMPTY' // conversation reached but has no content
  | 'IMPORT_UPSTREAM_FAILED'; // any other upstream failure (timeout, rate limit, SDK crash)

export type SlackImportErrorCode =
  | 'SLACK_INVALID_URL'
  | 'SLACK_INTEGRATION_UNAVAILABLE'
  | 'SLACK_CONVERSATION_INACCESSIBLE'
  | 'SLACK_CONVERSATION_EMPTY';

/**
 * Raised when resolving or importing a task from an external source fails.
 * Carries a code the HTTP layer maps to a status, and the source it came from so
 * the front can attribute the message. Generalises the former Slack-only error.
 */
export class ImportError extends DomainError {
  constructor(
    message: string,
    code: ImportErrorCode | SlackImportErrorCode,
    public readonly sourceId?: ImportSourceId,
  ) {
    super(message, code);
  }
}

/**
 * Legacy Slack-import error, kept so the Slack routes keep returning the exact
 * same `SLACK_*` codes (and `slackCode` field) they always did. Now a subclass
 * of {@link ImportError}.
 */
export class SlackImportError extends ImportError {
  constructor(message: string, public readonly slackCode: SlackImportErrorCode) {
    super(message, slackCode, 'slack_message');
  }
}

/** A connector (Slack…) could not be set up. `CONNECTOR_INVALID_TOKEN` is the user's to fix; `CONNECTOR_UPSTREAM_FAILED` is not. */
export class ConnectorError extends DomainError {
  constructor(message: string, code: 'CONNECTOR_INVALID_TOKEN' | 'CONNECTOR_UPSTREAM_FAILED') {
    super(message, code);
  }
}
