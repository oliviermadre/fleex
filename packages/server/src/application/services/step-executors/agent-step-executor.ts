import type { ExecuteAgentUseCase } from '../../use-cases/execute-agent.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput, MentionExecutionMode } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class AgentStepExecutor implements StepExecutor {
  constructor(private readonly executeAgent: ExecuteAgentUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const workflowContextPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      stepPrompt: input.step.prompt,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
    });

    const mode: MentionExecutionMode = input.step.mode ?? 'edit';

    const { structuredOutput, rawText, executionId } = await this.executeAgent.executeForWorkflowStep({
      personaName: input.step.executorRef,
      ticketId: input.ticketId,
      outputFormat,
      workflowContextPrompt,
      mode,
    });

    return { output: this.toStepOutput(structuredOutput, rawText), executionId };
  }

  private toStepOutput(so: Record<string, unknown> | null, _rawText: string): StepOutput {
    if (!so) {
      return { schemaFields: {}, result: 'ko' };
    }
    const schemaFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(so)) {
      if (!STANDARD_KEYS.has(k)) schemaFields[k] = v;
    }
    const mentionStatus = so['mentionStatus'] as 'resolved' | 'waiting_for_info' | undefined;
    const result = mentionStatus === 'waiting_for_info' ? 'needs_review' : 'ok';
    return {
      deliverable: (so['deliverable'] as StepOutput['deliverable']) ?? null,
      comment: (so['comment'] as string | null) ?? null,
      mentionStatus,
      schemaFields,
      result,
    };
  }
}
