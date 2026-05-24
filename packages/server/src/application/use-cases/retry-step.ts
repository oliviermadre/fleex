import { WorkflowRunNotFoundError, StepRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';

export class RetryStepUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly orchestrator: OrchestratorPort,
  ) {}

  async execute(params: { workflowRunId: string; stepRunId: string }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    // The orchestrator will create a new step_run with attempt+1
    run.advanceTo(stepRun.stepId);
    await this.runStore.save(run);
    this.orchestrator.runStep(run.id, stepRun.stepId);
  }
}
