import type {
  WorkflowRun, WorkflowRunStatus, WorkflowTemplateSnapshot, RunSubject,
} from '@fleex/shared';

const ACTIVE_STATUSES: WorkflowRunStatus[] = ['running', 'needs_review'];

export class WorkflowRunEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string | null,
    /**
     * Null for a synthetic run: a routine targeting a primitive (agent / skill /
     * panel) fabricates its one-step snapshot at launch and has no template row.
     */
    public readonly templateId: string | null,
    public readonly templateSnapshot: WorkflowTemplateSnapshot,
    public status: WorkflowRunStatus,
    public currentStepId: string | null,
    public readonly triggeredBy: string,
    public readonly triggeredFrom: string,
    public readonly startedAt: Date,
    public completedAt: Date | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    // Trailing + defaulted so the 12 existing positional call sites keep
    // compiling; only the code that actually needs an anchor other than a
    // ticket has to change.
    public readonly routineId: string | null = null,
    public readonly subjectSnapshot: RunSubject | null = null,
    public workspacePath: string | null = null,
    /**
     * The run whose `workflow.trigger` spawned this one. Only read to bound the
     * depth of a chain of runs — see `CreateWorkflowRunUseCase`.
     */
    public readonly parentRunId: string | null = null,
    /**
     * JSON body of the webhook delivery that fired this run — persisted so a
     * retried step re-reads the exact payload. Null for every other source.
     */
    public readonly triggerPayload: unknown = null,
  ) {
    // Exactly one anchor. A run with neither would be unreachable from every
    // screen (kanban, cockpit, routines); a run with both would have two
    // conflicting sources of context — ticket context vs routine subject —
    // for its agent steps. Enforced here rather than only in the DB because
    // SQLite cannot express the CHECK constraint.
    if ((ticketId === null) === (routineId === null)) {
      throw new Error(
        `workflow run ${id}: exactly one of ticketId / routineId must be set `
        + `(got ticketId=${ticketId}, routineId=${routineId})`,
      );
    }
  }

  static create(params: {
    id: string;
    ticketId?: string | null;
    routineId?: string | null;
    subjectSnapshot?: RunSubject | null;
    templateId: string | null;
    templateSnapshot: WorkflowTemplateSnapshot;
    triggeredBy: string;
    triggeredFrom: string;
    parentRunId?: string | null;
    triggerPayload?: unknown;
  }): WorkflowRunEntity {
    const now = new Date();
    return new WorkflowRunEntity(
      params.id,
      params.ticketId ?? null,
      params.templateId,
      params.templateSnapshot,
      'running',
      params.templateSnapshot.entryStepId,
      params.triggeredBy,
      params.triggeredFrom,
      now,
      null,
      now,
      now,
      params.routineId ?? null,
      params.subjectSnapshot ?? null,
      null,
      params.parentRunId ?? null,
      params.triggerPayload ?? null,
    );
  }

  /** True when this run is anchored to a routine instead of a ticket. */
  isRoutineRun(): boolean {
    return this.routineId !== null;
  }

  /**
   * Recorded the first time a step provisions a workspace, so subsequent steps
   * of the same routine run reuse the worktree instead of forking a new one.
   */
  setWorkspacePath(path: string | null): void {
    this.workspacePath = path;
    this.updatedAt = new Date();
  }

  advanceTo(stepId: string): void {
    this.currentStepId = stepId;
    this.status = 'running';
    this.updatedAt = new Date();
  }

  block(): void {
    this.status = 'needs_review';
    this.updatedAt = new Date();
  }

  complete(): void {
    this.status = 'completed';
    this.currentStepId = null;
    this.completedAt = new Date();
    this.updatedAt = new Date();
  }

  fail(): void {
    this.status = 'failed';
    this.currentStepId = null;
    this.completedAt = new Date();
    this.updatedAt = new Date();
  }

  cancel(): void {
    this.status = 'cancelled';
    this.completedAt = new Date();
    this.updatedAt = new Date();
  }

  isActive(): boolean {
    return ACTIVE_STATUSES.includes(this.status);
  }

  findStep(stepId: string) {
    return this.templateSnapshot.steps.find((s) => s.id === stepId);
  }

  outgoingEdges(stepId: string) {
    return this.templateSnapshot.edges.filter((e) => e.source === stepId);
  }

  toDTO(): WorkflowRun {
    return {
      id: this.id,
      ticketId: this.ticketId,
      routineId: this.routineId,
      parentRunId: this.parentRunId,
      subjectSnapshot: this.subjectSnapshot,
      workspacePath: this.workspacePath,
      triggerPayload: this.triggerPayload,
      templateId: this.templateId,
      templateSnapshot: this.templateSnapshot,
      status: this.status,
      currentStepId: this.currentStepId,
      triggeredBy: this.triggeredBy,
      triggeredFrom: this.triggeredFrom,
      startedAt: this.startedAt.toISOString(),
      completedAt: this.completedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
