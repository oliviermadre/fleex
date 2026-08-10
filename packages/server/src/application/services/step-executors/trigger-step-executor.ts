import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

/**
 * Runs a `trigger` step: the deterministic entry node that materialises "what
 * started this run" as an ordinary step output.
 *
 * - The webhook payload's top-level keys are spread into `schemaFields`, types
 *   preserved — so `forEach: {{ steps.<id>.items }}` iterates a payload array
 *   with no dedicated grammar. A non-object payload is published under
 *   `payload` instead.
 * - `previousRunAt` (start of the routine's previous run, null on the first),
 *   `firedVia` (the run's `triggeredFrom`: schedule / webhook / routine / api /
 *   workflow / mention:*) and `firedAt` let edges route push vs pull in one
 *   template and let extraction prompts poll incrementally.
 *
 * In a ticket-anchored run the step still resolves — empty payload, meta
 * fields set — which is what will let `POST /api/workflows/runs` carry input
 * parameters one day without a new step type.
 *
 * Like `RouteStepExecutor` it resolves synchronously, spends no tokens and
 * never calls `onExecutionStarted`.
 */
export class TriggerStepExecutor implements StepExecutor {
  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const info = input.runInfo;
    const payload = info?.triggerPayload;

    const payloadFields: Record<string, unknown> = isPlainObject(payload)
      ? payload
      : payload !== undefined
        ? { payload }
        : {};

    return {
      output: {
        schemaFields: {
          ...payloadFields,
          // Spread order makes the meta fields win over identically named
          // payload keys: a sender must not be able to spoof `firedVia` and
          // reroute an edge that branches on it. Names mirror
          // TRIGGER_STEP_META_PROPERTIES in @fleex/shared.
          previousRunAt: info?.previousRunAt ?? null,
          firedVia: info?.triggeredFrom ?? '',
          firedAt: info?.startedAt ?? null,
        },
        result: 'ok',
      },
    };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
