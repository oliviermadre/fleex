import type { StopAuthor } from '@fleex/shared';

/**
 * Minimal capability to abort a running agent execution by its executionId.
 *
 * Implemented by {@link ExecuteAgentUseCase.cancelExecution}. Exposed as a
 * narrow port so workflow use-cases (cancel run, retry/force-restart step) can
 * interrupt an in-flight step execution without depending on the whole
 * ExecuteAgentUseCase surface — and without creating a circular import.
 */
/** Who asks for the stop, and why. Recorded on the execution before it is aborted. */
export interface ExecutionStop {
  by: StopAuthor;
  reason?: string | null;
  /**
   * The caller settles the mention itself (a wanted stop inside a thread is not
   * a failure): the execution is aborted but its mention is left untouched.
   */
  keepMention?: boolean;
}

export interface CancelExecutionPort {
  /**
   * Abort the running execution identified by `executionId`.
   * Best-effort & idempotent: returns `false` (no throw) if no matching
   * running execution is tracked.
   */
  cancelExecution(executionId: string, stop?: ExecutionStop): Promise<boolean>;
}
