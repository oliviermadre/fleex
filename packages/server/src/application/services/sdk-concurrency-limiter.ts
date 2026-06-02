/**
 * A single global gate over concurrent Claude Agent SDK executions.
 *
 * Every path that invokes the Claude Agent SDK — agent mentions, skills,
 * panels, workflow steps and ticket summaries — acquires a slot here, so the
 * total number of SDK queries running in parallel across the whole server never
 * exceeds the configured `agentMaxConcurrency`. This is the ONLY concurrency
 * limit in Fleex: subsystems no longer impose their own caps or serial queues
 * (the workflow orchestrator used to run one step at a time globally, which
 * caused unrelated tickets to block each other for tens of minutes).
 *
 * Capacity is read live on every acquisition, so changing the setting at
 * runtime applies to subsequent acquisitions without a restart.
 */

/** Fallback parallel-SDK limit when `agentMaxConcurrency` is unset in config. */
export const DEFAULT_AGENT_MAX_CONCURRENCY = 10;

export class SdkConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  /** @param capacity reads the live limit (e.g. `() => config.get().agentMaxConcurrency ?? DEFAULT_AGENT_MAX_CONCURRENCY`). */
  constructor(private readonly capacity: () => number) {}

  private get limit(): number {
    const c = this.capacity();
    return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
  }

  /**
   * Acquire a slot, waiting if all are in use. Returns a release function that
   * is safe to call exactly once (subsequent calls are no-ops). Always release
   * in a `finally`.
   */
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
    } else {
      // A slot is reserved for us by `wakeNext` (it increments `active` on our
      // behalf before resolving), so we must NOT increment again here.
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.wakeNext();
    };
  }

  /** Run `fn` while holding a slot, releasing it when `fn` settles. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Snapshot for logging / monitoring. */
  get snapshot(): { active: number; waiting: number; limit: number } {
    return { active: this.active, waiting: this.waiters.length, limit: this.limit };
  }

  private wakeNext(): void {
    // Loop, not `if`, so a raised limit admits several waiters at once.
    while (this.active < this.limit && this.waiters.length > 0) {
      this.active++;
      const next = this.waiters.shift()!;
      next();
    }
  }
}
