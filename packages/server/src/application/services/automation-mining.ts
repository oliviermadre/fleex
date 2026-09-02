import type { AgentExecution } from '@fleex/shared';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';

/** Below this many occurrences, a repeat is a coincidence, not a habit. */
export const MIN_OCCURRENCES = 4;

/** Occurrences older than this say nothing about what you do now. */
export const WINDOW_DAYS = 60;

/**
 * The `personaId` the log carries for a run that came from a local `claude`
 * session rather than from a Fleex persona (see `upsertCliExecution`).
 *
 * It is a sentinel, not an agent. Grouping on it would lump every unrelated
 * manual session into one row, and no persona of that name exists for a routine
 * to target — so the row could never be acted on either.
 */
const CLI_SENTINEL_PERSONA = 'cli';

/**
 * How regular a cadence has to be to be called one.
 *
 * Expressed as the ratio of the standard deviation of the gaps to their mean: a
 * perfectly regular series scores 0, and anything under this threshold is
 * predictable enough that a schedule would have fired at roughly the right times.
 */
const CADENCE_TOLERANCE = 0.6;

/** A group of repeated runs, still keyed by the ids the execution log carries. */
export interface MinedCandidate {
  /** Stable key, so a dismissed candidate can be remembered as dismissed. */
  key: string;
  /** What repeats: the skill or agent doing the work. */
  kind: 'skill' | 'agent';
  /** Persona or skill id — an internal handle, not something a routine can take. */
  targetId: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** Mean gap between occurrences, in hours. */
  meanGapHours: number;
  /** A cron expression when the cadence is regular enough to suggest one. */
  suggestedCron?: string;
  /** Why this was surfaced, in the user's terms. */
  rationale: string;
  /** Total cost of the occurrences so far — what a routine would keep spending. */
  totalCostUsd: number;
}

/** A mined group with its ids resolved to what a person, and `routine create`, reads. */
export interface AutomationCandidate extends MinedCandidate {
  /** What `fleex routine create` takes: a persona name, or a skill command name. */
  target: string;
  /** Display name, for the row a human reads. */
  label: string;
}

/**
 * Finds work you keep doing by hand on a cadence a schedule could have fired on.
 *
 * Purely algorithmic, on purpose: the signal is repetition and cadence, both of
 * which are arithmetic over the execution log. Asking a model to spot habits would
 * cost per analysis and produce something unverifiable, when the interesting part
 * — "you ran this 11 times, roughly every 27 hours" — is a fact the user can check.
 *
 * It groups by executor rather than clustering prompts. Two runs of the same skill
 * *are* the same gesture whatever their arguments, and prompt similarity would
 * instead group unrelated work that happened to be phrased alike. The cost of that
 * choice is that it can only ever surface work already wrapped in a skill or a
 * persona — proposing the *wrapper* is a different question, over a different
 * corpus, and not this one.
 *
 * Which is why an irregular group is dropped unless `includeIrregular` asks for
 * it: the schedule is the only thing this adds to what the log already says. Told
 * that a skill ran 7 times at no particular rhythm, there is nothing to do that
 * having the skill did not already do.
 */
export function mineAutomationCandidates(
  executions: AgentExecution[],
  opts: {
    now?: Date;
    minOccurrences?: number;
    windowDays?: number;
    /** Keep groups whose cadence is too irregular to schedule. Diagnostic only. */
    includeIrregular?: boolean;
  } = {},
): MinedCandidate[] {
  const now = opts.now ?? new Date();
  const minOccurrences = opts.minOccurrences ?? MIN_OCCURRENCES;
  const windowMs = (opts.windowDays ?? WINDOW_DAYS) * 86_400_000;

  const groups = new Map<string, AgentExecution[]>();
  for (const execution of executions) {
    // Only completed runs: a repeatedly failing manual run is a bug to fix, not a
    // habit to schedule.
    if (execution.status !== 'completed') continue;
    const startedAt = Date.parse(execution.startedAt);
    if (!Number.isFinite(startedAt) || now.getTime() - startedAt > windowMs) continue;

    const key = groupKey(execution);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(execution);
    else groups.set(key, [execution]);
  }

  const candidates: MinedCandidate[] = [];

  for (const [key, group] of groups) {
    if (group.length < minOccurrences) continue;

    const sorted = [...group].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const times = sorted.map((e) => Date.parse(e.startedAt));
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    const meanGapMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const meanGapHours = meanGapMs / 3_600_000;

    const suggestedCron = suggestCron(gaps, meanGapMs);
    if (!suggestedCron && !opts.includeIrregular) continue;

    const [kind, targetId] = key.split(':') as ['skill' | 'agent', string];
    const totalCostUsd = sorted.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);

    candidates.push({
      key,
      kind,
      targetId,
      occurrences: sorted.length,
      firstSeen: new Date(times[0]!).toISOString(),
      lastSeen: new Date(times[times.length - 1]!).toISOString(),
      meanGapHours: Math.round(meanGapHours * 10) / 10,
      ...(suggestedCron ? { suggestedCron } : {}),
      rationale: buildRationale(sorted.length, meanGapHours, !!suggestedCron),
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    });
  }

  // Most-repeated first: frequency is the best proxy for how much a routine would
  // actually save.
  return candidates.sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Turn the ids the execution log carries into what a routine actually takes.
 *
 * Kept out of the mining pass so that stays pure arithmetic over the log, with no
 * store to stub. A candidate whose persona or skill no longer exists is dropped
 * rather than shown with its raw id: the row would name nothing the reader
 * recognises, and point at a target `routine create` would reject.
 */
export async function resolveCandidateTargets(
  candidates: MinedCandidate[],
  stores: {
    personaStore: Pick<PersonaStorePort, 'getById'>;
    skillStore: Pick<SkillStorePort, 'getById'>;
  },
): Promise<AutomationCandidate[]> {
  const resolved = await Promise.all(candidates.map(async (candidate) => {
    if (candidate.kind === 'skill') {
      const skill = await stores.skillStore.getById(candidate.targetId);
      if (!skill) return null;
      // `commandName` is what `routine create --skill` resolves against; the
      // display name is only ever shown.
      return { ...candidate, target: skill.commandName, label: skill.displayName || skill.commandName };
    }
    const persona = await stores.personaStore.getById(candidate.targetId);
    if (!persona) return null;
    return { ...candidate, target: persona.name, label: persona.displayName || persona.name };
  }));
  return resolved.filter((c): c is AutomationCandidate => c !== null);
}

/**
 * What identifies "the same gesture".
 *
 * Skills first: a skill *is* a named, repeatable gesture, so repeating one is the
 * clearest possible signal. A persona is a weaker grouping — the same agent does
 * many different things — so it only counts when there is no skill.
 *
 * The skill is read out of `mentionId`, which a skill run sets to `skill:<id>`
 * (see `executeForSkill`). Workflow steps carry `workflow:<executionId>`, which is
 * unique per run and therefore never groups — correctly, since a workflow already
 * *is* the automation this feature would propose.
 */
export function groupKey(execution: AgentExecution): string | null {
  const skillId = execution.mentionId?.startsWith('skill:')
    ? execution.mentionId.slice('skill:'.length)
    : null;
  if (skillId) return `skill:${skillId}`;
  if (execution.mentionId?.startsWith('workflow:')) return null;
  if (execution.personaId === CLI_SENTINEL_PERSONA) return null;
  if (execution.personaId) return `agent:${execution.personaId}`;
  return null;
}

/**
 * Propose a cron only when the observed cadence is regular.
 *
 * Suggesting a daily schedule for work that happened four times in one afternoon
 * and then never again would be worse than suggesting nothing: it invites the user
 * to automate a burst.
 */
export function suggestCron(gaps: number[], meanGapMs: number): string | undefined {
  if (gaps.length < 2 || meanGapMs <= 0) return undefined;

  const variance = gaps.reduce((sum, g) => sum + (g - meanGapMs) ** 2, 0) / gaps.length;
  const relativeSpread = Math.sqrt(variance) / meanGapMs;
  if (relativeSpread > CADENCE_TOLERANCE) return undefined;

  const hours = meanGapMs / 3_600_000;
  // Snapped to the cadences a person actually recognises. A cron matching the
  // mean gap to the minute would be false precision on this little data.
  if (hours <= 2) return '0 * * * *';
  if (hours <= 8) return '0 */4 * * *';
  if (hours <= 36) return '0 9 * * *';
  if (hours <= 24 * 10) return '0 9 * * 1';
  return '0 9 1 * *';
}

function buildRationale(occurrences: number, meanGapHours: number, hasCadence: boolean): string {
  const cadence = meanGapHours < 48
    ? `about every ${Math.round(meanGapHours)}h`
    : `about every ${Math.round(meanGapHours / 24)} days`;
  return hasCadence
    ? `Run ${occurrences} times, ${cadence} — regular enough to schedule.`
    : `Run ${occurrences} times, ${cadence} on average, but too irregularly to schedule.`;
}
