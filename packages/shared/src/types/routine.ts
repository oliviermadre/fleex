/**
 * Routines — workflow executions that are NOT anchored to a ticket.
 *
 * A Routine is "the continuous-improvement ticket, created once and for all":
 * a named, durable recipe made of a workflow template, a subject (what the
 * workflow works on) and a trigger (how it starts). Every workflow run that has
 * no ticket belongs to a routine — there is no such thing as an orphan run, so
 * a run is always reachable either from its ticket or from its routine.
 */

/**
 * The matter a run works on when there is no ticket. All fields are optional
 * and cumulative: a routine with none of them is legal (that's "ask an agent
 * its opinion from nothing").
 */
export interface RunSubject {
  /** `org/name` — drives worktree creation. Empty = no workspace, agent runs in `talk`. */
  repos: string[];
  /** Free-form markdown injected into the agent prompt. */
  brief?: string;
  /** Fleex deliverable ids whose content is injected as context. */
  documentIds?: string[];
  /** Default board for tickets the workflow creates (`ticket.create`). */
  boardId?: string;
}

export type RoutineTriggerKind = 'manual' | 'once' | 'cron';

export type RoutineTrigger =
  | { kind: 'manual' }
  | { kind: 'once'; runAt: string; timezone: string }
  | { kind: 'cron'; cron: string; timezone: string };

/** What to do when a scheduled tick fires while the previous run is still active. */
export type RoutineOverlapPolicy = 'skip' | 'queue';

export interface Routine {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string | null;
  enabled: boolean;
  templateId: string;
  subject: RunSubject;
  trigger: RoutineTrigger;
  overlapPolicy: RoutineOverlapPolicy;
  lastRunAt: string | null;
  lastRunId: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoutineInput {
  name: string;
  emoji?: string;
  description?: string | null;
  templateId: string;
  subject?: Partial<RunSubject>;
  trigger?: RoutineTrigger;
  overlapPolicy?: RoutineOverlapPolicy;
  enabled?: boolean;
}

export interface UpdateRoutineInput {
  name?: string;
  emoji?: string;
  description?: string | null;
  templateId?: string;
  subject?: Partial<RunSubject>;
  trigger?: RoutineTrigger;
  overlapPolicy?: RoutineOverlapPolicy;
  enabled?: boolean;
}

/** Empty subject — the "from nothing" case. Never mutate the returned object. */
export function emptyRunSubject(): RunSubject {
  return { repos: [] };
}

/**
 * Normalises a partial/untrusted subject into a well-formed one. Used on both
 * the HTTP boundary and when reading a persisted JSON blob, so an older row
 * without `repos` doesn't crash the worktree builder.
 */
export function normalizeRunSubject(raw: unknown): RunSubject {
  if (typeof raw !== 'object' || raw === null) return emptyRunSubject();
  const o = raw as Record<string, unknown>;
  const subject: RunSubject = {
    repos: Array.isArray(o['repos']) ? o['repos'].filter((r): r is string => typeof r === 'string') : [],
  };
  if (typeof o['brief'] === 'string' && o['brief'].length > 0) subject.brief = o['brief'];
  if (Array.isArray(o['documentIds'])) {
    const ids = o['documentIds'].filter((d): d is string => typeof d === 'string');
    if (ids.length > 0) subject.documentIds = ids;
  }
  if (typeof o['boardId'] === 'string' && o['boardId'].length > 0) subject.boardId = o['boardId'];
  return subject;
}

/** Splits an `org/name` repo ref. Returns null when the ref is malformed. */
export function parseRepoRef(ref: string): { org: string; name: string } | null {
  const slashIdx = ref.indexOf('/');
  if (slashIdx <= 0 || slashIdx === ref.length - 1) return null;
  return { org: ref.substring(0, slashIdx), name: ref.substring(slashIdx + 1) };
}
