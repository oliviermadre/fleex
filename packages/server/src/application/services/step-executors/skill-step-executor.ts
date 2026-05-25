import type { ExecuteAgentUseCase } from '../../use-cases/execute-agent.js';
import type { SkillStorePort } from '../../ports/skill-store.port.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class SkillStepExecutor implements StepExecutor {
  constructor(
    private readonly executeAgent: ExecuteAgentUseCase,
    private readonly skillStore: SkillStorePort,
  ) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const skill = await this.skillStore.getByCommandName(input.step.executorRef);
    if (!skill) throw new Error(`skill "${input.step.executorRef}" not found`);

    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const workflowContextPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
    });

    const result = await this.executeAgent.executeForSkill(skill.id, input.ticketId, {
      outputFormatOverride: outputFormat,
      workflowContextPrompt,
      returnStructured: true,
      workflowContext: {
        workflowName: input.workflowContext.workflowName,
        stepName: input.workflowContext.stepName,
      },
    });

    if (!result || !('structuredOutput' in result)) {
      throw new Error('executeForSkill did not return structured output (returnStructured flag ignored?)');
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
