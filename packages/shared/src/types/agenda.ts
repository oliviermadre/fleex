/**
 * The /agenda page: every dated thing Fleex knows about, in one shape.
 *
 * One endpoint (`GET /api/agenda`) returns `AgendaItem`s for a window; the
 * client lays them out (grid / all-day band) and filters them by label,
 * routine, board and tags without another request.
 */

export type AgendaItemType =
  | 'ticket.created'
  | 'ticket.done'
  | 'ticket.due'
  | 'routine.run'
  | 'routine.upcoming'
  | 'routine.skipped'
  | 'workflow.run'
  | 'pr.merged';

export const AGENDA_ITEM_TYPES: readonly AgendaItemType[] = [
  'ticket.created',
  'ticket.done',
  'ticket.due',
  'routine.run',
  'routine.upcoming',
  'routine.skipped',
  'workflow.run',
  'pr.merged',
];

/**
 * `point` = an instant · `block` = a duration (`end` null = still running) ·
 * `allDay` = a calendar date (`start` is 'YYYY-MM-DD', no time zone).
 */
export type AgendaShape = 'point' | 'block' | 'allDay';

export interface AgendaTicketRef {
  id: string;
  displayId: number;
  /** Read when the agenda is built, never copied: a rename shows up at once. */
  title: string;
  boardId: string;
  status: string;
  tags: string[];
}

export interface AgendaRoutineRef {
  id: string;
  name: string;
  emoji: string;
}

/**
 * A stretch of a workflow run spent waiting on a human: a `human_gate` step
 * (`gate`) or an agent that asked a question (`question`).
 */
export interface AgendaWaitSegment {
  kind: 'gate' | 'question';
  stepName: string;
  start: string;
  /** Null while it still waits. */
  end: string | null;
}

export interface AgendaItem {
  /** Stable: `${type}:${sourceId}[:${iso}]`. */
  id: string;
  type: AgendaItemType;
  shape: AgendaShape;
  /** ISO instant, or 'YYYY-MM-DD' for `allDay`. */
  start: string;
  end?: string | null;
  title: string;
  status?: string | null;
  ticket?: AgendaTicketRef | null;
  routine?: AgendaRoutineRef | null;
  /** W1 only. */
  workflowName?: string | null;
  /** W1 only: the step running or waiting right now. */
  currentStep?: string | null;
  segments?: AgendaWaitSegment[];
  /** R1: the run's `triggeredFrom` — 'schedule' for the scheduler, anything else is a manual launch. */
  triggeredFrom?: string | null;
  /** R2: the cron expression and its time zone. */
  cron?: string | null;
  timezone?: string | null;
  /** P2: "org/name#123". */
  prRef?: string | null;
  /** T4: due before today and not done. */
  overdue?: boolean;
  /** R1 / W1: the run to open. */
  runId?: string | null;
}

export interface AgendaResponse {
  from: string;
  to: string;
  generatedAt: string;
  /** Sorted by start. */
  items: AgendaItem[];
  /** Routines, so the sidebar can list one checkbox per routine. */
  routines: AgendaRoutineRef[];
  /** Upcoming occurrences hit the per-routine cap (500) for these routine ids. */
  truncated: string[];
}

export type AgendaView = 'day' | 'week' | 'month' | 'schedule';

/** Per-user display preferences, stored server-side (`user_kv` → `agenda:prefs`). */
export interface AgendaPrefs {
  version: 1;
  /** Absent key = the label's default (every label is on by default). */
  labels: Partial<Record<AgendaItemType, boolean>>;
  /** Absent key = shown. Keyed by routine id. */
  routines: Record<string, boolean>;
  filters: { boards: string[]; tags: string[] };
  view: AgendaView;
}

export const DEFAULT_AGENDA_PREFS: AgendaPrefs = {
  version: 1,
  labels: {},
  routines: {},
  filters: { boards: [], tags: [] },
  view: 'week',
};
