import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { EventBus } from '../event-bus.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Startup recovery for workflow steps left in `running` from a previous server
 * lifetime (crash, hot-reload, `bun --watch` restart, …). The Claude SDK
 * process is killed with the parent server, but the `step_run` row stays
 * flagged `running` forever unless we sweep it.
 *
 * Mirrors `ExecuteAgentUseCase.init()` for agent executions. Strategy:
 *  - For each active workflow run (`running`, `blocked`), inspect its step runs.
 *  - Any step_run still in `running` is presumed orphaned; mark it `failed`
 *    with a sentinel error so the UI's existing `FailedStepRetryPanel` shows
 *    up and the user can simply click Retry.
 *  - PARK the parent run in `needs_review` (not `failed`): a server restart is a
 *    resumable interruption, not a genuine failure. Parking keeps the run active
 *    and surfaces it as "needs you" (queue pill + workflow header) awaiting a
 *    Restart, instead of a dead `failed` run that the sidebar reads as idle.
 *
 * We do NOT auto-retry — that would race with whatever the user is doing on
 * page reload, and might silently re-run something they wanted to inspect.
 */
export class RecoverOrphanedWorkflowStepsUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<{ recoveredRuns: number; recoveredStepRuns: number }> {
    const candidateRuns = [
      ...(await this.runStore.getByStatus('running')),
      ...(await this.runStore.getByStatus('blocked')),
    ];

    let recoveredRuns = 0;
    let recoveredStepRuns = 0;

    for (const run of candidateRuns) {
      const stepRuns = await this.stepRunStore.getByWorkflowRun(run.id);
      const orphans = stepRuns.filter((sr) => sr.status === 'running');
      if (orphans.length === 0) continue;

      for (const sr of orphans) {
        sr.fail({ message: 'Interrupted by server restart' });
        await this.stepRunStore.save(sr);
        recoveredStepRuns++;
      }

      // Park the run (needs_review) rather than fail it — see the class doc.
      // currentStepId is preserved (block() doesn't clear it), so the run stays
      // pointed at the interrupted step for the "…› {step} › human required" label.
      run.block();
      await this.runStore.save(run);
      recoveredRuns++;

      // One needs_review event per run so the queue pill + workflow view flip to
      // "needs you" live (the DAG reloads its detail and shows the failed step's
      // Retry). Anchored to an orphan step for the payload shape.
      const anchor = orphans[0]!;
      this.eventBus.emit({
        type: 'workflow.needs_review',
        workflowRunId: run.id,
        stepRunId: anchor.id,
        stepId: anchor.stepId,
        ticketId: run.ticketId,
        routineId: run.routineId,
        occurredAt: new Date(),
      });
    }

    if (recoveredRuns > 0) {
      this.logger.info('Recovered orphaned workflow steps from previous server lifetime', {
        recoveredRuns,
        recoveredStepRuns,
      });
    }

    return { recoveredRuns, recoveredStepRuns };
  }
}
