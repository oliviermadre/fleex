import { resolveStoppedBy, type AgentExecution, type AgentThread, type StopAuthor } from '@fleex/shared';

/**
 * How a run stopped on purpose is named, everywhere a run shows. Neutral on
 * purpose: a wanted stop is a decision, not an error — never a red state.
 * A `system` stop (timeout, server restart) is a failure and keeps the run's
 * own status label.
 */
export const STOP_LABEL: Record<Exclude<StopAuthor, 'system'>, string> = {
  user: 'Arrêté par toi',
  assistant: "Arrêté par l'assistant",
};

/** The label of a stopped execution, or null when it was not stopped on purpose. */
export function executionStopLabel(execution: Pick<AgentExecution, 'status' | 'stoppedBy' | 'manuallyTerminatedByUser' | 'autoTerminatedAtConclusion'>): string | null {
  if (execution.status === 'running') return null;
  const by = resolveStoppedBy(execution);
  return by === 'user' || by === 'assistant' ? STOP_LABEL[by] : null;
}

/** The label of a thread whose current run was stopped on purpose and not relaunched since. */
export function threadStopLabel(thread: Pick<AgentThread, 'status' | 'lastStop'>): string | null {
  if (thread.status !== 'idle' || !thread.lastStop) return null;
  return STOP_LABEL[thread.lastStop.by];
}

/** True while the human's own stop holds the thread: only they can put it back to work. */
export function isUserHeld(thread: Pick<AgentThread, 'status' | 'userHoldAt'>): boolean {
  return thread.status !== 'concluded' && !!thread.userHoldAt;
}
