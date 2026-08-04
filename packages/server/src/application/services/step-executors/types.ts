import type {
  WorkflowStep,
  StepOutput,
  WorkflowEdgeCondition,
  WorkflowEdgeConditionGroup,
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
      conditionGroup?: WorkflowEdgeConditionGroup;
      targetName: string;
    }[];
    previousOutputs: Record<string, Record<string, unknown>>;
    /**
     * Names of every step in the run snapshot, so an edge condition reading an
     * earlier step renders as "Compute status.status" rather than a raw id.
     */
    stepNames?: Record<string, string>;
    /**
     * Direct predecessors of this step in the run snapshot. Native steps use it
     * to resolve the `{{ output.<field> }}` shorthand, which is only meaningful
     * when there is exactly one incoming edge.
     */
    predecessorStepIds?: string[];
  };
  /**
   * Invoked by the executor as soon as the underlying agent execution has
   * started and its `executionId` is known — i.e. while the step is still
   * running, not at completion. Lets the orchestrator persist
   * `step_run.executionId` live so an in-flight step can be cancelled
   * (Terminate / cancel run / force restart). Optional: executors that have no
   * cancellable execution (human gate) simply never call it.
   */
  onExecutionStarted?: (executionId: string) => void | Promise<void>;
}

export interface StepExecutorResult {
  output: StepOutput;
  executionId?: string;
}

export interface StepExecutor {
  execute(input: StepExecutionInput): Promise<StepExecutorResult>;
}
