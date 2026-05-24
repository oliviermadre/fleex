export interface OrchestratorPort {
  runStep(workflowRunId: string, stepId: string): void;
}
