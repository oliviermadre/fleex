import type { WorkflowStep } from '@fleex/shared';
import { getNativeOperation } from '@fleex/shared';

/**
 * One-line summary of a native step's actions, shown where the other executor
 * types show their `executorRef`. A native step has no ref, so without this the
 * node would render a bare "—" and the canvas would be unreadable: you'd have to
 * click every node to know what it does.
 *
 * Returns null for non-native steps so callers can fall back to `executorRef`.
 */
export function nativeStepSummary(step: WorkflowStep, maxLabels = 2): string | null {
  if (step.executorType !== 'native') return null;
  const actions = step.nativeActions ?? [];
  if (actions.length === 0) return 'No actions';

  const labels = actions.map((a) => getNativeOperation(a.operationId)?.label ?? a.operationId);
  const shown = labels.slice(0, maxLabels).join(', ');
  const rest = labels.length - maxLabels;
  return rest > 0 ? `${shown} +${rest}` : shown;
}
