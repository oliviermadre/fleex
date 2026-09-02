import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MemoryKernel } from './memory-kernel.js';

/** How many batches one pass drains before yielding the process back. */
const MAX_BATCHES_PER_PASS = 8;

/**
 * Embeds the rows ingestion had to store without a vector.
 *
 * The kernel is allowed to defer: when the model is still downloading, or the
 * optional encoder package is missing, content is written with a null embedding
 * so nothing is lost. Without something to come back for those rows, that
 * tolerance turns into silent data loss — the content is in the table, invisible
 * to every query, until someone happens to run a full reindex.
 *
 * A poll rather than a retry queue, because the thing being waited on is a model
 * download or an install: both are external, minutes-long, and give no callback.
 * Each pass is bounded so a large backlog is worked through over several ticks
 * instead of pinning the CPU in one.
 */
export class MemorySweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;
  /** Last failure message, so an unavailable provider is logged once, not hourly. */
  private lastError: string | null = null;

  constructor(
    private readonly kernel: MemoryKernel,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    // Never hold the process open: this is background catch-up work, and a
    // pending timer that keeps a CLI or a test runner alive is a bug.
    this.timer.unref?.();
    this.logger.info('Memory embedding sweeper started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One bounded pass. Returns how many chunks were embedded.
   *
   * Public so a finished backfill can drain immediately rather than waiting for
   * the next tick — the backfill is exactly when a large deferred batch appears.
   */
  async sweep(): Promise<number> {
    // The engine is read per pass, not at construction: switching to legacy in
    // Settings has to stop the CPU cost without a restart.
    if (this.config.get().memoryEngine !== 'semantic') return 0;
    // A pass that overruns the interval must not stack another on top of itself.
    if (this.sweeping) return 0;

    this.sweeping = true;
    let embedded = 0;
    try {
      for (let i = 0; i < MAX_BATCHES_PER_PASS; i++) {
        const done = await this.kernel.sweepPendingEmbeddings();
        if (done === 0) break;
        embedded += done;
      }
      if (embedded > 0) {
        this.lastError = null;
        this.logger.info('Embedded deferred memory chunks', { chunks: embedded });
      }
    } catch (error) {
      // The expected cause is a provider that is not ready yet, which stays true
      // for as long as a download takes — so the message is logged on change
      // only, and the next pass simply tries again.
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) {
        this.lastError = message;
        this.logger.warn('Deferred embeddings still pending', { error: message });
      }
    } finally {
      this.sweeping = false;
    }
    return embedded;
  }
}
