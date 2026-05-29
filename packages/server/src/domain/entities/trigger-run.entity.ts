import type { TriggerRun, TriggerRunStatus } from '@fleex/shared';

export class TriggerRunEntity {
  constructor(
    public readonly id: string,
    public readonly triggerId: string,
    public readonly scheduledFor: Date,
    public status: TriggerRunStatus,
    public workflowRunId: string | null,
    public executionId: string | null,
    public workspacePath: string | null,
    public error: string | null,
    public startedAt: Date | null,
    public completedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(params: { id: string; triggerId: string; scheduledFor: Date }): TriggerRunEntity {
    const now = new Date();
    return new TriggerRunEntity(
      params.id,
      params.triggerId,
      params.scheduledFor,
      'running',
      null,
      null,
      null,
      null,
      now,
      null,
      now,
    );
  }

  complete(params: { workflowRunId?: string | null; executionId?: string | null }): void {
    this.status = 'completed';
    this.workflowRunId = params.workflowRunId ?? this.workflowRunId;
    this.executionId = params.executionId ?? this.executionId;
    this.completedAt = new Date();
  }

  fail(error: string): void {
    this.status = 'failed';
    this.error = error;
    this.completedAt = new Date();
  }

  skip(reason: string): void {
    this.status = 'skipped';
    this.error = reason;
    this.completedAt = new Date();
  }

  toDTO(): TriggerRun {
    return {
      id: this.id,
      triggerId: this.triggerId,
      scheduledFor: this.scheduledFor.toISOString(),
      status: this.status,
      workflowRunId: this.workflowRunId,
      executionId: this.executionId,
      workspacePath: this.workspacePath,
      error: this.error,
      startedAt: this.startedAt?.toISOString() ?? null,
      completedAt: this.completedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
