import { AGENT_BACKFILL_TIMEOUT_MS, type HubAgentBackfillEndMessage } from '@fleex/shared';

export interface AgentBackfillResult {
  /** Whether any instance answered before the timeout. */
  answered: boolean;
  /** Events the owner sent (already mirrored to local storage by the caller). */
  count: number;
  /** Older events were dropped to respect the response cap. */
  elided: boolean;
}

/**
 * Tracks in-flight backfill requests so an HTTP handler can await a hub response.
 *
 * The hub is a broadcast bus with no request/response semantics — the correlation
 * is ours: we mint a `requestId`, park a promise on it, and the owning instance
 * echoes it back on `agentBackfillEnd`. A request nobody owns simply times out,
 * which is also the "run happened on a machine that's now offline" case.
 */
export class AgentBackfillRegistry {
  private readonly pending = new Map<
    string,
    { resolve: (r: AgentBackfillResult) => void; timer: NodeJS.Timeout }
  >();

  /**
   * Wait for the response to `requestId`. Resolves with `answered: false` on
   * timeout — never rejects, so callers can fall back to whatever they already
   * have instead of failing the request.
   */
  await(requestId: string, timeoutMs = AGENT_BACKFILL_TIMEOUT_MS): Promise<AgentBackfillResult> {
    return new Promise<AgentBackfillResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ answered: false, count: 0, elided: false });
      }, timeoutMs);
      // Don't hold the process open for a best-effort cosmetic fetch.
      timer.unref?.();
      this.pending.set(requestId, { resolve, timer });
    });
  }

  /** Resolve the waiter for this response, if any is still parked. */
  settle(msg: HubAgentBackfillEndMessage): void {
    const entry = this.pending.get(msg.requestId);
    if (!entry) return;
    this.pending.delete(msg.requestId);
    clearTimeout(entry.timer);
    entry.resolve({ answered: true, count: msg.count, elided: msg.elided });
  }
}
