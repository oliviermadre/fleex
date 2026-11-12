import type { LoggerPort } from '../../application/ports/logger.port.js';

/**
 * Runs the thread repair on a timer, so a stuck thread is put right with no
 * interface open.
 *
 * Same shape as {@link RepositoryRefreshScheduler} and the routine scheduler:
 * a single interval, a re-entrancy guard so a slow pass never overlaps itself
 * (the tick that finds one still running is skipped, not queued), and a
 * `.catch` inside the interval callback — an unhandled rejection there would
 * kill the ticker and silently stop the surveillance.
 *
 * The `workThreadsEnabled` switch is read on every tick: off, the tick does
 * nothing, and turning it on needs no restart.
 */
export class ThreadRepairScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly repair: { repairOpen(): Promise<number> },
    private readonly isEnabled: () => boolean,
    private readonly logger: LoggerPort,
  ) {}

  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error('Thread repair tick failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }, intervalMs);
    this.logger.info('Thread repair scheduler started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One pass. Public so tests (and nothing else) can drive it without waiting. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.isEnabled()) return;
    this.ticking = true;
    try {
      await this.repair.repairOpen();
    } finally {
      this.ticking = false;
    }
  }

  get isTicking(): boolean {
    return this.ticking;
  }
}
