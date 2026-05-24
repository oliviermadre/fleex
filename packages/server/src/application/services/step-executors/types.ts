import type {
  WorkflowStep,
  StepOutput,
  WorkflowEdgeCondition,
} from '@fleex/shared';

export interface StepExecutionInput {
  ticketId: string;
  workflowRunId: string;
  stepRunId: string;
  step: WorkflowStep;
  workflowContext: {
    workflowName: string;
    stepName: string;
    outgoingEdges: {
      id: string;
      label?: string;
      condition?: WorkflowEdgeCondition;
      targetName: string;
    }[];
    previousOutputs: Record<string, Record<string, unknown>>;
  };
}

export interface StepExecutorResult {
  output: StepOutput;
  executionId?: string;
}

export interface StepExecutor {
  execute(input: StepExecutionInput): Promise<StepExecutorResult>;
}
