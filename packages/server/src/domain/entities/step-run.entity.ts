import type { StepRun, StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

export class StepRunEntity {
  constructor(
    public readonly id: string,
    public readonly workflowRunId: string,
    public readonly stepId: string,
    public attempt: number,
    public status: StepRunStatus,
    public result: StepRunResult | null,
    public output: StepOutput | null,
    public nextEdgeId: string | null,
    public executionId: string | null,
    public startedAt: Date | null,
    public completedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(params: {
    id: string;
    workflowRunId: string;
    stepId: string;
    attempt?: number;
  }): StepRunEntity {
    return new StepRunEntity(
      params.id,
      params.workflowRunId,
      params.stepId,
      params.attempt ?? 1,
      'queued',
      null,
      null,
      null,
      null,
      null,
      null,
      new Date(),
    );
  }

  start(): void {
    this.status = 'running';
    this.startedAt = new Date();
  }

  complete(params: {
    output: StepOutput;
    nextEdgeId?: string | null;
    executionId?: string | null;
  }): void {
    this.status = 'completed';
    this.result = params.output.result;
    this.output = params.output;
    this.nextEdgeId = params.nextEdgeId ?? null;
    this.executionId = params.executionId ?? null;
    this.completedAt = new Date();
  }

  markNeedsReview(params: { output: StepOutput; executionId?: string | null }): void {
    this.status = 'needs_review';
    this.result = 'needs_review';
    this.output = params.output;
    this.executionId = params.executionId ?? null;
  }

  /**
   * The step ran fine but several outgoing edges matched — park it until a human
   * picks one. Unlike `markNeedsReview`, `result` is *preserved*: conditions on
   * the chosen edge (and on every later edge reading this step) still need the
   * real outcome once the route is resolved. `completedAt` stays null — the step
   * is not done until the route is picked.
   */
  markAwaitingRouting(params: {
    output: StepOutput;
    executionId?: string | null;
    candidateEdgeIds: string[];
  }): void {
    this.status = 'awaiting_routing';
    this.result = params.output.result;
    this.output = {
      ...params.output,
      routing: { ...params.output.routing, candidateEdgeIds: params.candidateEdgeIds },
    };
    // Keep any executionId already stamped (the human gate path resolves edges
    // without one, and must not erase what an earlier attempt recorded).
    this.executionId = params.executionId ?? this.executionId;
    // Not done until the route is picked — matters for the human gate path,
    // which stamps `completedAt` before its edges are resolved.
    this.completedAt = null;
  }

  /** Human picked the edge to take: the step is now genuinely complete. */
  resolveRoute(params: { edgeId: string; decidedBy: string; notes?: string }): void {
    const prev = this.output ?? { schemaFields: {}, result: 'ok' as const };
    this.output = {
      ...prev,
      routing: {
        candidateEdgeIds: prev.routing?.candidateEdgeIds ?? [],
        chosenEdgeId: params.edgeId,
        decidedBy: params.decidedBy,
        ...(params.notes ? { notes: params.notes } : {}),
      },
    };
    this.status = 'completed';
    this.nextEdgeId = params.edgeId;
    this.completedAt = new Date();
  }

  fail(error?: { message: string }): void {
    this.status = 'failed';
    this.result = 'ko';
    if (error && this.output) {
      this.output = { ...this.output, schemaFields: { ...this.output.schemaFields, error: error.message } };
    } else if (error) {
      this.output = { schemaFields: { error: error.message }, result: 'ko' };
    }
    this.completedAt = new Date();
  }

  cancel(): void {
    this.status = 'cancelled';
    this.completedAt = new Date();
  }

  resolveGate(outcome: string, notes?: string): void {
    const prev = this.output ?? { schemaFields: {}, result: 'needs_review' as const };
    this.output = {
      ...prev,
      schemaFields: { ...prev.schemaFields, outcome, ...(notes ? { notes } : {}) },
      outcome,
      result: 'ok',
    };
    this.status = 'completed';
    this.result = 'ok';
    this.completedAt = new Date();
  }

  toDTO(): StepRun {
    return {
      id: this.id,
      workflowRunId: this.workflowRunId,
      stepId: this.stepId,
      attempt: this.attempt,
      status: this.status,
      result: this.result,
      output: this.output,
      nextEdgeId: this.nextEdgeId,
      executionId: this.executionId,
      startedAt: this.startedAt?.toISOString() ?? null,
      completedAt: this.completedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
