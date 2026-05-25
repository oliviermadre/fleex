import type { RunWorkflowStepUseCase } from '../use-cases/run-workflow-step.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class WorkflowOrchestrator implements OrchestratorPort {
  private queue: { runId: string; stepId: string }[] = [];
  private running = false;

  constructor(
    private readonly runStepUseCase: RunWorkflowStepUseCase,
    private readonly logger: LoggerPort,
  ) {}

  runStep(workflowRunId: string, stepId: string): void {
    this.queue.push({ runId: workflowRunId, stepId });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        try {
          await this.runStepUseCase.execute({ workflowRunId: item.runId, stepId: item.stepId });
        } catch (err) {
          this.logger.error('Workflow step execution crashed', {
            workflowRunId: item.runId, stepId: item.stepId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
