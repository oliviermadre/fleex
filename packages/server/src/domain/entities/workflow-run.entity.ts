import {
  isCancellableRunStatus,
  type WorkflowRun, type WorkflowRunStatus, type WorkflowTemplateSnapshot,
} from '@fleex/shared';

// `blocked` is a run waiting on a human gate — as live as `needs_review`. It was
// missing here, which made any isActive()-guarded operation a silent no-op on a
// blocked run.
const ACTIVE_STATUSES: WorkflowRunStatus[] = ['running', 'blocked', 'needs_review'];

export class WorkflowRunEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly templateId: string,
    public readonly templateSnapshot: WorkflowTemplateSnapshot,
    public status: WorkflowRunStatus,
    public currentStepId: string | null,
    public readonly triggeredBy: string,
    public readonly triggeredFrom: string,
    public readonly startedAt: Date,
    public completedAt: Date | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    templateId: string;
    templateSnapshot: WorkflowTemplateSnapshot;
    triggeredBy: string;
    triggeredFrom: string;
  }): WorkflowRunEntity {
    const now = new Date();
    return new WorkflowRunEntity(
      params.id,
      params.ticketId,
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
    );
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

  /**
   * Wider than isActive(): a `failed` run is not active, yet must stay
   * cancellable so the user can close it out without retrying a step.
   */
  isCancellable(): boolean {
    return isCancellableRunStatus(this.status);
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
