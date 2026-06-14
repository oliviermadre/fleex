/**
 * Minimal capability to abort a running agent execution by its executionId.
 *
 * Implemented by {@link ExecuteAgentUseCase.cancelExecution}. Exposed as a
 * narrow port so workflow use-cases (cancel run, retry/force-restart step) can
 * interrupt an in-flight step execution without depending on the whole
 * ExecuteAgentUseCase surface — and without creating a circular import.
 */
export interface CancelExecutionPort {
  /**
   * Abort the running execution identified by `executionId`.
   * Best-effort & idempotent: returns `false` (no throw) if no matching
   * running execution is tracked.
   */
  cancelExecution(executionId: string): Promise<boolean>;
}
