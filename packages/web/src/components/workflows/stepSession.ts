import type { StepRun, WorkflowExecutorType, WorkflowStep } from '@fleex/shared';

/**
 * Which executor types actually run a Claude SDK session, and therefore can
 * carry an `executionId` worth opening.
 *
 * `human_gate`, `native` and `route` never spawn an agent — offering a
 * "SDK session" affordance on them would be a dead link, so they are excluded
 * at the type level rather than by checking for a null executionId (which
 * would also swallow the "agent step that hasn't started yet" case below).
 */
const SESSION_BEARING: ReadonlySet<WorkflowExecutorType> = new Set<WorkflowExecutorType>([
  'agent',
  'panel',
  'skill',
]);

export type StepSessionState =
  /** This kind of step never produces a session — show nothing. */
  | { kind: 'none' }
  /** Agentic step, but no execution has been stamped yet (pending / queued). */
  | { kind: 'pending' }
  /** A session exists and can be opened. `live` = still streaming turns. */
  | { kind: 'available'; executionId: string; live: boolean };

/**
 * Whether the SDK session of a step can be inspected, and whether it is still
 * in flight.
 *
 * `executionId` is stamped the moment the agent starts (run-workflow-step.ts),
 * not at completion — so a step that is still `running` already exposes a
 * readable, live-streaming session. That is precisely the case worth watching,
 * hence `live` rather than gating the affordance on a terminal status.
 */
export function stepSessionState(
  step: Pick<WorkflowStep, 'executorType'>,
  stepRun: Pick<StepRun, 'executionId' | 'status'> | undefined,
): StepSessionState {
  if (!SESSION_BEARING.has(step.executorType)) return { kind: 'none' };
  if (!stepRun?.executionId) return { kind: 'pending' };
  return { kind: 'available', executionId: stepRun.executionId, live: stepRun.status === 'running' };
}
