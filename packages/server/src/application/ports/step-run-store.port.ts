import type { StepRunEntity } from '../../domain/entities/step-run.entity.js';

export interface StepRunStorePort {
  getById(id: string): Promise<StepRunEntity | null>;
  getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]>;
  getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null>;
  save(stepRun: StepRunEntity): Promise<void>;
}
