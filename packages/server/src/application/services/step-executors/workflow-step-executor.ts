import { isInsideSubworkflow } from '@fleex/shared';
import type { StepRunStorePort } from '../../ports/step-run-store.port.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

/**
 * Runs the exit of an expanded sub-workflow (the `workflow` step itself, kept
 * in the snapshot after its child's steps were copied in — see
 * `expandSubworkflows`).
 *
 * Like a `route` step it spends no tokens and writes nothing to the ticket. Its
 * output is the output of the *last child step that completed*, so the
 * parent's outgoing edges can branch on what the sub-workflow concluded —
 * `verdict == "ko"` read on QA's last step sends the run back to Build.
 *
 * Only machine-readable fields cross over: the child step already posted its
 * comment and deliverable, and repeating them here would publish them twice.
 */
export class WorkflowStepExecutor implements StepExecutor {
  constructor(private readonly stepRunStore: StepRunStorePort) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const stepRuns = await this.stepRunStore.getByWorkflowRun(input.workflowRunId);
    const last = stepRuns
      .filter((sr) => sr.status === 'completed' && sr.output && isInsideSubworkflow(sr.stepId, input.step.id))
      .sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0))
      .at(-1);
    if (!last?.output) return { output: { schemaFields: {}, result: 'ok' } };
    return {
      output: {
        schemaFields: last.output.schemaFields ?? {},
        result: last.output.result,
        ...(last.output.outcome !== undefined ? { outcome: last.output.outcome } : {}),
      },
    };
  }
}
