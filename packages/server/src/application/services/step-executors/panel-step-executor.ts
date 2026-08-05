import type { RunPanelUseCase } from '../../use-cases/run-panel.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class PanelStepExecutor implements StepExecutor {
  constructor(private readonly runPanel: RunPanelUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const ctxPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
      runHistory: input.workflowContext.runHistory,
    });

    // Ticket run: the panel debates the ticket thread, as always. Routine run:
    // no ticket exists — the run's frozen subject (brief + repos) becomes the
    // discussion context instead, and run-panel skips the timeline side effects.
    const result = await this.runPanel.execute({
      panelName: input.step.executorRef,
      ticketId: input.ticketId,
      subject: input.subject ?? null,
      extraContextPrompt: ctxPrompt,
      outputFormatOverride: outputFormat,
      returnStructured: true,
      workflowContext: {
        workflowName: input.workflowContext.workflowName,
        stepName: input.workflowContext.stepName,
      },
    });

    if (!result || !('structuredOutput' in result)) {
      throw new Error('runPanel did not return structured output (returnStructured flag ignored?)');
    }

    return { output: this.toStepOutput(result.structuredOutput), executionId: result.executionId };
  }

  private toStepOutput(so: Record<string, unknown> | null): StepOutput {
    if (!so) return { schemaFields: {}, result: 'ko' };
    const schemaFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(so)) {
      if (!STANDARD_KEYS.has(k)) schemaFields[k] = v;
    }
    const mentionStatus = so['mentionStatus'] as 'resolved' | 'waiting_for_info' | undefined;
    return {
      deliverable: (so['deliverable'] as StepOutput['deliverable']) ?? null,
      comment: (so['comment'] as string | null) ?? null,
      mentionStatus,
      schemaFields,
      result: mentionStatus === 'waiting_for_info' ? 'needs_review' : 'ok',
    };
  }
}
