import type { PostCommentUseCase } from '../../use-cases/post-comment.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

export class HumanGateStepExecutor implements StepExecutor {
  constructor(private readonly postComment: PostCommentUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    // A human gate posts a decision prompt as a ticket comment, so it requires
    // a ticket-bound run (there is nowhere to surface the gate otherwise).
    const ticketId = input.ticketId;
    if (ticketId === null) {
      throw new Error(`human_gate step ${input.step.id} requires a ticket-bound workflow run`);
    }

    const outcomes = input.step.humanGateOutcomes ?? [];
    if (outcomes.length === 0) {
      throw new Error(`human_gate step ${input.step.id}: must have at least one outcome`);
    }

    const body = [
      `🚪 **Human Gate** — workflow "${input.workflowContext.workflowName}" is awaiting your decision on step **${input.step.name}**.`,
      ``,
      `Available outcomes: ${outcomes.map((o) => `\`${o}\``).join(' · ')}`,
      ``,
      `_Resolve this gate from the Workflow tab on this ticket._`,
    ].join('\n');

    await this.postComment.execute({
      ticketId,
      body,
      authorName: 'workflow',
      authorType: 'agent',
      humanMentionNames: [],
    });

    return {
      output: {
        schemaFields: { outcomes },
        result: 'needs_review',
      },
    };
  }
}
