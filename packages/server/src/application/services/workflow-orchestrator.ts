import type { RunWorkflowStepUseCase } from '../use-cases/run-workflow-step.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Dispatches workflow steps. Each step is fired independently — there is NO
 * global serial queue here anymore.
 *
 * Within a single run, steps are inherently sequential (the next step is only
 * dispatched after the current one completes and an edge resolves), so firing
 * concurrently only lets *different* runs progress in parallel. The actual
 * backpressure on Claude Agent SDK work comes from the single global
 * SdkConcurrencyLimiter, shared by every execution source. The old serial
 * queue meant one slow step on any ticket blocked every other run — sometimes
 * for tens of minutes.
 */
export class WorkflowOrchestrator implements OrchestratorPort {
  constructor(
    private readonly runStepUseCase: RunWorkflowStepUseCase,
    private readonly logger: LoggerPort,
  ) {}

  runStep(workflowRunId: string, stepId: string): void {
    void this.runStepUseCase.execute({ workflowRunId, stepId }).catch((err) => {
      this.logger.error('Workflow step execution crashed', {
        workflowRunId, stepId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
