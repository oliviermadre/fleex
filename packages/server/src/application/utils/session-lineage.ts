/**
 * Session lineage — which SDK sessions may be resumed by which run (ticket #454).
 *
 * A *lineage* is a chain of runs that continue the same piece of work. A run may
 * only resume a session from its own lineage; two lineages never cross.
 *
 * This exists because the isolation guarantees the product needs ("a direct
 * mention must never inherit a workflow step's session") used to hold only by
 * accident — the workflow path simply never read the session map. Any refactor
 * that "harmonised" the three paths would have broken it silently. Encoding the
 * primitive *and its origin* in the key makes the guarantee structural instead
 * of a rule someone has to remember.
 *
 * Keys are deliberately prefix-namespaced so they can never collide:
 *   mention:<personaId>:<ticketId>   the conversation with this persona
 *   skill:<skillId>:<ticketId>       relaunches of this skill on this ticket
 *   (panel / one-shot query)         no lineage at all
 *
 * Workflow steps have a lineage too — the attempts of one step of ONE run — but
 * it needs no key: the step run already stores the `executionId` of its previous
 * attempt, so the retry walks `step_run.executionId → execution.sdkSessionId`
 * directly. Scoping to the run (rather than the step template) is what makes
 * "relaunch the whole workflow" start every step cold while a Retry inside a run
 * continues its attempt.
 */

/**
 * Terminal state of the previous run of a lineage. Drives `resolveSessionDefault`.
 *
 * `interrupted` and `cancelled` are deliberately distinct, but NOT along the
 * machine/human axis one would expect:
 *   interrupted — the run stopped without settling: timeout, server restart,
 *                 or a Terminate on a mention/skill (`cancelExecution` writes
 *                 `interrupted` + `reason: 'cancelled'`; the DB status enum has
 *                 no `cancelled`).
 *   cancelled   — a workflow *step run* was thrown away: Retry-while-running,
 *                 or cancelling the whole run.
 * They warrant opposite defaults; see `resolveSessionDefault` for why.
 */
export type LineageRunStatus = 'failed' | 'interrupted' | 'completed' | 'cancelled' | 'none';

/** What the next run of a lineage does with the previous session. */
export type SessionMode = 'resume' | 'fresh';

/** The conversation with `personaId` on `ticketId`, driven by @mentions. */
export function mentionLineageKey(personaId: string, ticketId: string): string {
  return `mention:${personaId}:${ticketId}`;
}

/**
 * Relaunches of one skill on one ticket. Keyed by skill *id*, not command name:
 * the id is what the execution row carries (`mention_id = 'skill:<skillId>'`),
 * so the in-memory key and the persisted one resolve to each other without a
 * lookup.
 */
export function skillLineageKey(skillId: string, ticketId: string): string {
  return `skill:${skillId}:${ticketId}`;
}

/**
 * Classify a persisted `agent_event_executions.mention_id` back into a lineage.
 *
 * The column is overloaded: real mentions store a UUID, skills store
 * `skill:<skillId>`, workflow steps store `workflow:<executionId>`. Restoring
 * every row under a bare `personaId:ticketId` key (the pre-#454 behaviour) let
 * the most recent execution of ANY kind win, so a mention could resume a
 * skill's or a workflow step's session — a different conversation, under a
 * different system prompt.
 *
 * Returns `null` for rows that must not seed any lineage (workflow steps, whose
 * resume handle is the `step_run.executionId` chain instead).
 */
export function lineageKeyForExecution(params: {
  personaId: string;
  ticketId: string;
  mentionId: string;
}): string | null {
  const { personaId, ticketId, mentionId } = params;

  // Workflow steps are keyed by run+step, which the execution row does not
  // carry. They resume via `step_run.executionId`, never via this map.
  if (mentionId.startsWith('workflow:')) return null;

  if (mentionId.startsWith('skill:')) {
    const skillId = mentionId.slice('skill:'.length);
    if (!skillId) return null;
    return skillLineageKey(skillId, ticketId);
  }

  return mentionLineageKey(personaId, ticketId);
}
