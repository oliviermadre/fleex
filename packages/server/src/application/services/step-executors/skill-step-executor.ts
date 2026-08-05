import type { ExecuteAgentUseCase } from '../../use-cases/execute-agent.js';
import type { SkillStorePort } from '../../ports/skill-store.port.js';
import type { PersonaStorePort } from '../../ports/persona-store.port.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class SkillStepExecutor implements StepExecutor {
  constructor(
    private readonly executeAgent: ExecuteAgentUseCase,
    private readonly skillStore: SkillStorePort,
    private readonly personaStore: PersonaStorePort,
  ) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const skill = await this.skillStore.getByCommandName(input.step.executorRef);
    if (!skill) throw new Error(`skill "${input.step.executorRef}" not found`);

    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const workflowContextPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
      runHistory: input.workflowContext.runHistory,
    });

    // Routine run: `executeForSkill` is built around a ticket thread (announce
    // comment, session resume, ticket context), none of which exists here.
    // Instead the skill runs as its persona through the routine-capable
    // workflow-step pipeline, with the skill's markdown put in front of the
    // step context — the routine's brief (in the subject) composes with the
    // skill's own instructions, which is the whole contract of a skill.
    if (!input.ticketId) {
      const persona = await this.personaStore.getById(skill.personaId);
      if (!persona) throw new Error(`skill "${skill.commandName}": persona ${skill.personaId} not found`);

      const skillPreamble = `# Skill: ${skill.displayName}\n\n${skill.markdownContent}`;
      const { structuredOutput, executionId } = await this.executeAgent.executeForWorkflowStep({
        personaName: persona.name,
        ticketId: null,
        routineId: input.routineId,
        subject: input.subject,
        workflowRunId: input.workflowRunId,
        outputFormat,
        workflowContextPrompt: `${skillPreamble}\n\n---\n\n${workflowContextPrompt}`,
        mode: 'edit',
        onExecutionStarted: input.onExecutionStarted,
      });
      return { output: this.toStepOutput(structuredOutput), executionId };
    }

    const ticketId = input.ticketId;
    const result = await this.executeAgent.executeForSkill(skill.id, ticketId, {
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
