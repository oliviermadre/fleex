/**
 * Fallback wall-clock budget for a single agent run when none is configured.
 * Re-exported from shared so the Settings field and the server agree on the
 * default a user sees before they ever touch it.
 */
export { DEFAULT_AGENT_EXECUTION_TIMEOUT_MS } from '@fleex/shared';

/**
 * Arm the wall-clock budget of one agent run.
 *
 * This is a TOTAL DURATION cap, not an inactivity timeout: it is armed once
 * when the SDK query starts and is never reset by activity, so a run that is
 * progressing normally is still aborted once the budget expires. That is the
 * intended contract — it is the only hard bound on how long a single agent run
 * may occupy an SDK concurrency slot.
 *
 * Every SDK path (mention, skill, workflow step, panel) must arm it, otherwise
 * that path has no bound at all and relies on the stale watchdog, which cannot
 * tell "stuck" from "slow".
 *
 * Returns a disarm function; call it in a `finally` so a settled run never
 * leaves a live timer behind.
 */
export function armExecutionTimeout(
  timeoutMs: number,
  abortController: AbortController,
  onTimeout: (timeoutMs: number) => void,
): () => void {
  const handle = setTimeout(() => {
    onTimeout(timeoutMs);
    abortController.abort(new Error('timeout'));
  }, timeoutMs);
  return () => clearTimeout(handle);
}
