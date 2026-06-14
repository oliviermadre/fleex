/**
 * Minimal capability to register an in-flight agent execution so it becomes
 * abortable through the same machinery as personas/skills/workflow steps — i.e.
 * the Terminate endpoint (`POST /executions/:id/cancel` → `cancelExecution`).
 *
 * Implemented by {@link ExecuteAgentUseCase}. Exposed as a narrow port so other
 * use-cases that spawn their own SDK sessions (notably {@link RunPanelUseCase},
 * which fans out into N member executions + 1 orchestrator) can make each of
 * those sessions individually cancellable WITHOUT depending on the whole
 * ExecuteAgentUseCase surface — and without creating a circular import.
 *
 * The rule this enforces: **every running agent execution, whoever spawned it,
 * must be abortable.** An execution that is not registered here cannot be
 * stopped from the UI.
 */
export interface ExecutionRegistryEntry {
  /** The executionId the UI surfaces and the Terminate endpoint cancels by. */
  executionId: string;
  /** Persona (or synthetic orchestrator id) running this execution. */
  personaId: string;
  /** Ticket the execution belongs to, for audit/broadcast routing. */
  ticketId?: string;
  /** Abort handle; `cancelExecution` calls `.abort()` to stop the SDK loop. */
  abortController: AbortController;
}

export interface ExecutionRegistryPort {
  /**
   * Register a running, cancellable execution. Must be called BEFORE the SDK
   * query starts so a Terminate click during the run can find & abort it.
   */
  registerExecution(entry: ExecutionRegistryEntry): void;

  /**
   * Mark an execution as settled and schedule its eviction from the registry.
   * Idempotent: never resurrects an already-cancelled entry. Safe to call in a
   * `finally`.
   */
  finalizeExecution(executionId: string): void;
}
