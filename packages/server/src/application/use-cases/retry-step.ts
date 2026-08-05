import { WorkflowRunNotFoundError, StepRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { CancelExecutionPort } from '../ports/cancel-execution.port.js';

export class RetryStepUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly canceller: CancelExecutionPort,
  ) {}

  async execute(params: {
    workflowRunId: string;
    stepRunId: string;
    /**
     * The human's answer when the step paused asking a question. Recorded on the
     * attempt that asked, so the retry (attempt+1) reads it back from the run
     * history. Mandatory plumbing for routine runs, which have no ticket
     * timeline to carry the answer.
     */
    humanResponse?: string;
  }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    if (params.humanResponse && params.humanResponse.trim().length > 0) {
      stepRun.recordHumanResponse(params.humanResponse.trim());
      await this.stepRunStore.save(stepRun);
    }

    // If the target step_run is still flagged `running`, abort its agent
    // execution before restarting. The process may genuinely still be alive (a
    // stuck/looping agent the user wants to force-restart) — without this abort
    // we'd spawn a second agent on the same worktree, running in parallel with
    // the old one. Best-effort: an orphan after a crash/hot-reload simply has no
    // live execution to cancel, and that's fine.
    if (stepRun.status === 'running') {
      if (stepRun.executionId) {
        try {
          await this.canceller.cancelExecution(stepRun.executionId);
        } catch {
          // swallow — restarting must proceed regardless
        }
      }
      stepRun.cancel();
      await this.stepRunStore.save(stepRun);
    }

    // The orchestrator will create a new step_run with attempt+1
    run.advanceTo(stepRun.stepId);
    await this.runStore.save(run);
    this.orchestrator.runStep(run.id, stepRun.stepId);
  }
}
