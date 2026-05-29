import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { TriggerStorePort, ClaimedTrigger } from '../../application/ports/trigger-store.port.js';
import type { TriggerEntity } from '../entities/trigger.entity.js';

export type TriggerRunner = (claimed: ClaimedTrigger) => Promise<void>;

/**
 * Durable scheduler that fires due triggers. On each tick it atomically claims
 * all due triggers (advancing their next_run_at so concurrent instances never
 * double-fire) and runs each one. A reentrancy guard prevents overlapping ticks
 * if a previous tick is still running.
 */
export class TriggerScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private runner: TriggerRunner | null = null;

  constructor(
    private readonly triggerStore: TriggerStorePort,
    private readonly logger: LoggerPort,
  ) {}

  setRunner(fn: TriggerRunner): void {
    this.runner = fn;
  }

  start(tickMs: number): void {
    this.stop();
    if (tickMs <= 0) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error('Trigger scheduler tick failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }, tickMs);
    this.logger.info('Trigger scheduler started', { tickMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking || !this.runner) return;
    this.ticking = true;
    try {
      const due = await this.triggerStore.claimDue(now, (t: TriggerEntity, from: Date) => t.computeNextRun(from));
      for (const claimed of due) {
        try {
          await this.runner(claimed);
        } catch (err) {
          this.logger.error('Trigger run threw', {
            triggerId: claimed.trigger.id, error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
