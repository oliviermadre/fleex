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
 * | interrupted    | resume  | timeout or server restart: a machine event, not   |
 * |                |         | a decision.                                       |
 * | completed      | fresh   | the run went all the way through. Relaunching is  |
 * |                |         | a new intent, not a continuation — and an agent   |
 * |                |         | handed its own previous answer defends it instead |
 * |                |         | of redoing the work.                              |
 * | cancelled      | fresh   | a human explicitly stopped it, typically because  |
 * |                |         | it was stuck or looping. Re-injecting the context |
 * |                |         | of that loop reproduces it.                       |
 * | none           | fresh   | nothing to resume.                                |
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
