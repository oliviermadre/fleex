import type {
  WorkflowStep,
  StepOutput,
  WorkflowEdgeCondition,
  WorkflowEdgeConditionGroup,
  RunSubject,
} from '@fleex/shared';
import type { RunHistoryEntry } from '../../utils/run-history.js';

export interface StepExecutionInput {
  /** Null for a routine run — `routineId` + `subject` carry the context instead. */
  ticketId: string | null;
  routineId?: string | null;
  /**
   * The run's frozen subject (repos / brief / documents / board). Replaces the
   * ticket as the agent's "what am I working on" when there is no ticket.
   */
  subject?: RunSubject | null;
  workflowRunId: string;
  stepRunId: string;
  step: WorkflowStep;
  /**
   * How this run started — only assembled for `trigger` steps (it costs a store
   * query), which turn it into their output. Other executors never see it.
   */
  runInfo?: {
    /** The run's `triggeredFrom`: schedule / webhook / routine / api / workflow / mention:*. */
    triggeredFrom: string;
    /** ISO start of this run. */
    startedAt: string;
    /** ISO start of the routine's previous run; null on the first run or in a ticket run. */
    previousRunAt: string | null;
    /** Payload delivered by a webhook fire; undefined when the run has none. */
    triggerPayload?: unknown;
  };
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
     * The run's narrative so far (see `utils/run-history.ts`). Agentic executors
     * inject it in the prompt; `previousOutputs` stays the machine-readable
     * channel for edge conditions and `{{ steps.* }}` references.
     */
    runHistory?: RunHistoryEntry[];
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
