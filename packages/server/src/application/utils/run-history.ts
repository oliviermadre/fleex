import type { StepOutput, StepRunStatus } from '@fleex/shared';

/**
 * One line of a workflow run's timeline, as an agent should read it.
 *
 * A ticket run gets its narrative for free: every step comment and deliverable
 * lands on the ticket, and `getTicketContext` replays them to the next agent. A
 * routine run has no ticket — its step_runs ARE its timeline (the Routines PRD
 * deliberately introduces no run-comments table). `previousOutputs` alone is not
 * that timeline: it carries only `schemaFields` of *completed* steps, keyed by
 * opaque step id, so comments, deliverables, gate decisions and human answers
 * never crossed a step boundary on a routine.
 */
export interface RunHistoryEntry {
  stepName: string;
  attempt: number;
  status: StepRunStatus;
  /** True when this is an earlier attempt of the step being executed right now. */
  isEarlierAttemptOfCurrentStep: boolean;
  fields?: Record<string, unknown>;
  comment?: string;
  /** Human gate outcome, or the outcome an agent step reported. */
  outcome?: string;
  /** Notes typed by the human when resolving a gate or an ambiguous route. */
  humanNotes?: string;
  /** Answer typed by the human to a `waiting_for_info` question. */
  humanResponse?: string;
  deliverableTitle?: string;
}

interface SourceStepRun {
  stepId: string;
  attempt: number;
  status: StepRunStatus;
  output: StepOutput | null;
  createdAt: Date;
}

const EMPTY_STATUSES: ReadonlySet<StepRunStatus> = new Set<StepRunStatus>(['queued', 'running']);

/**
 * Folds the run's step_runs into a chronological narrative.
 *
 * Earlier attempts of the *current* step are kept on purpose. That is how the
 * answer to a `waiting_for_info` question reaches the retry: the answer is
 * recorded on the attempt that asked, and the retry runs as attempt+1.
 */
export function buildRunHistory(params: {
  /** Step id → display name, from the run's template snapshot. */
  stepNames: Record<string, string>;
  stepRuns: SourceStepRun[];
  /** The step being executed — its earlier attempts are flagged, not dropped. */
  currentStepId: string;
  /** The in-flight step_run, which has nothing to say yet. */
  currentAttempt: number;
}): RunHistoryEntry[] {
  return params.stepRuns
    .filter((sr) => !(sr.stepId === params.currentStepId && sr.attempt >= params.currentAttempt))
    .filter((sr) => !EMPTY_STATUSES.has(sr.status))
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.attempt - b.attempt)
    .map((sr) => {
      const out = sr.output;
      const fields = out?.schemaFields ?? {};
      const entry: RunHistoryEntry = {
        stepName: params.stepNames[sr.stepId] ?? sr.stepId,
        attempt: sr.attempt,
        status: sr.status,
        isEarlierAttemptOfCurrentStep: sr.stepId === params.currentStepId,
      };
      if (Object.keys(fields).length > 0) entry.fields = fields;
      if (out?.comment) entry.comment = out.comment;
      if (out?.outcome) entry.outcome = out.outcome;
      if (out?.routing?.notes) entry.humanNotes = out.routing.notes;
      // Gate notes live in schemaFields (StepRunEntity.resolveGate merges them
      // there so edge conditions can read them); surface them as what they are.
      else if (typeof fields['notes'] === 'string') entry.humanNotes = fields['notes'];
      if (out?.humanResponse) entry.humanResponse = out.humanResponse;
      if (out?.deliverable) entry.deliverableTitle = out.deliverable.title;
      return entry;
    });
}

/** Renders the history as the markdown block injected in a step's prompt. */
export function formatRunHistory(entries: RunHistoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines: string[] = ['**Run history so far** (what earlier steps produced and what humans answered):'];
  for (const e of entries) {
    const suffix = e.isEarlierAttemptOfCurrentStep ? ' — *an earlier attempt of the step you are running now*' : '';
    lines.push(`- **${e.stepName}** (attempt ${e.attempt}, ${e.status})${suffix}`);
    if (e.outcome) lines.push(`  - outcome: ${e.outcome}`);
    if (e.comment) lines.push(`  - said: ${e.comment}`);
    if (e.deliverableTitle) lines.push(`  - produced deliverable: "${e.deliverableTitle}"`);
    if (e.humanNotes) lines.push(`  - human notes: ${e.humanNotes}`);
    if (e.humanResponse) lines.push(`  - **human answered your question**: ${e.humanResponse}`);
    if (e.fields) lines.push(`  - output: ${JSON.stringify(e.fields)}`);
  }
  return lines.join('\n');
}
