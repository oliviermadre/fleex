import type { StepRunEntity } from '../../domain/entities/step-run.entity.js';

export interface StepRunStorePort {
  getById(id: string): Promise<StepRunEntity | null>;
  getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]>;
  getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null>;
  /** Returns every step_run across all runs. Used by the Execution Log view. */
  getAll(): Promise<StepRunEntity[]>;
  save(stepRun: StepRunEntity): Promise<void>;
}
