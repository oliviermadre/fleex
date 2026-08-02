import type { LineageRunStatus, SessionMode } from './session-lineage.js';

/**
 * The rule, stated once (ticket #454):
 *
 *   > We only resume where the machine stopped without finishing.
 *
 * | previous run   | default | why                                              |
 * |----------------|---------|--------------------------------------------------|
 * | failed         | resume  | max_turns / usage limit / crash — the work is     |
 * |                |         | unfinished; restarting cold reburns the turns.    |
 * | interrupted    | resume  | timeout, server restart — AND a Terminate on a    |
 * |                |         | mention or skill. See the note below: that is     |
 * |                |         | deliberate, not an oversight.                     |
 * | completed      | fresh   | the run went all the way through. Relaunching is  |
 * |                |         | a new intent, not a continuation — and an agent   |
 * |                |         | handed its own previous answer defends it instead |
 * |                |         | of redoing the work.                              |
 * | cancelled      | fresh   | workflow step runs only (`StepRunEntity.cancel`): |
 * |                |         | Retry-while-running, or cancelling the whole run. |
 * |                |         | Both mean "this attempt is going nowhere" — the   |
 * |                |         | next attempt must start cold or it reproduces the |
 * |                |         | loop it was killed for.                           |
 * | none           | fresh   | nothing to resume.                                |
 *
 * Why a Terminate on a *mention* resumes (ticket #454, confirmed with the
 * product owner): the dominant reason to stop a mention by hand is a
 * mis-configuration noticed after launch — the ticket was left in `plan` when
 * `edit` was wanted. The user fixes the setting and re-mentions, expecting the
 * agent to pick up where it was, with the correction. Starting cold there
 * throws away context the user never intended to discard. `cancelExecution()`
 * accordingly records `interrupted` (with `reason: 'cancelled'` for audit),
 * and `agent_event_executions.status` has no `cancelled` value at all.
 *
 * A workflow step is the opposite: you Retry a step because *that attempt* is
 * bad, so the second attempt must not inherit it. The asymmetry is intentional
 * — same gesture, different primitive, different intent.
 *
 * MUST stay the only implementation. The web client reads the resolved value
 * from the API and never re-derives it — duplicating this rule client-side is
 * exactly what produced the "Execution Log shows a resume the SDK never got"
 * bug this ticket also fixes.
 */
export function resolveSessionDefault(lastRunStatus: LineageRunStatus): SessionMode {
  switch (lastRunStatus) {
    case 'failed':
    case 'interrupted':
      return 'resume';
    case 'completed':
    case 'cancelled':
    case 'none':
      return 'fresh';
  }
}

/** Resolved state of a lineage, as served to launch surfaces. */
export interface SessionLineageState {
  /**
   * True only when a resumable session actually exists. A run that failed
   * before the SDK ever produced a session id is NOT resumable, so this is not
   * derivable from the status alone.
   */
  canResume: boolean;
  lastRunStatus: LineageRunStatus;
  /** What the launch surface pre-selects. */
  defaultMode: SessionMode;
  /** Truncated, for display only — never used to call the SDK. */
  sessionIdPreview: string | null;
}

/** Build the state a launch surface needs from the raw lineage tip. */
export function buildLineageState(tip: {
  sdkSessionId: string | null;
  lastRunStatus: LineageRunStatus;
}): SessionLineageState {
  const canResume = Boolean(tip.sdkSessionId);
  const preferred = resolveSessionDefault(tip.lastRunStatus);
  return {
    canResume,
    lastRunStatus: tip.lastRunStatus,
    // Never pre-select an option the user cannot actually take.
    defaultMode: canResume ? preferred : 'fresh',
    sessionIdPreview: tip.sdkSessionId ? `${tip.sdkSessionId.slice(0, 8)}…` : null,
  };
}
