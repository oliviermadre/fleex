import type { TriggerRunStorePort } from '../ports/trigger-run-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * On startup, mark any trigger_run still in 'running' as failed — its process
 * died with the previous server instance. Scheduling itself self-heals: a
 * past-due trigger is claimed on the next tick and its next_run_at is advanced
 * to the next future occurrence (catch-up is at most one run).
 */
export class RecoverOrphanedTriggerRunsUseCase {
  constructor(
    private readonly triggerRunStore: TriggerRunStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<void> {
    const running = await this.triggerRunStore.getRunning();
    if (running.length === 0) return;
    for (const run of running) {
      run.fail('Interrupted by server restart');
      await this.triggerRunStore.save(run);
    }
    this.logger.info('Recovered orphaned trigger runs', { count: running.length });
  }
}
