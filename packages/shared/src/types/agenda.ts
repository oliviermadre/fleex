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
  | 'routine.missed'
  | 'workflow.run'
  | 'pr.merged'
  | 'event'
  | 'external';

export const AGENDA_ITEM_TYPES: readonly AgendaItemType[] = [
  'ticket.created',
  'ticket.done',
  'ticket.due',
  'routine.run',
  'routine.upcoming',
  'routine.skipped',
  'routine.missed',
  'workflow.run',
  'pr.merged',
  'event',
  'external',
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
  /** Epics (ticket groups) the ticket belongs to — F2. */
  epicIds: string[];
  /** Repositories linked to the ticket ("org/name") — F4. */
  repos: string[];
}

export interface AgendaRoutineRef {
  id: string;
  name: string;
  emoji: string;
  /** 'once' routines can be rescheduled by dragging their upcoming slot. */
  triggerKind?: 'cron' | 'once' | 'manual';
}

/** E1 — a free event created in the agenda (stored by Fleex, shared by the instance). */
export type CalendarEventRecurrence = 'daily' | 'weekly' | 'monthly';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  allDay: boolean;
  /** ISO instant, or 'YYYY-MM-DD' when `allDay`. */
  start: string;
  /** ISO instant (exclusive), or 'YYYY-MM-DD' (inclusive last day) when `allDay`. */
  end: string;
  /** A tint hue name (lib/tints) or null for the label colour. */
  color: string | null;
  ticketId: string | null;
  epicId: string | null;
  recurrence: CalendarEventRecurrence | null;
  /** 'YYYY-MM-DD', inclusive; null = forever. */
  recurrenceUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CalendarEventInput = Pick<CalendarEvent, 'title' | 'allDay' | 'start' | 'end'>
  & Partial<Pick<CalendarEvent, 'description' | 'color' | 'ticketId' | 'epicId' | 'recurrence' | 'recurrenceUntil'>>;

/** A deliverable attached to a Google meeting — the link only lives in Fleex. */
export interface AgendaExternalLink {
  id: string;
  provider: 'google';
  /** iCalUID, plus `|<originalStartTime>` for one occurrence of a recurring meeting. */
  eventKey: string;
  deliverableId: string;
  deliverableTitle: string;
  /** Copied on the link so users who don't see this calendar can still read it. */
  eventTitle: string;
  eventStart: string;
  source: 'manual' | 'cli';
  createdAt: string;
}

export interface AgendaGoogleCalendar {
  id: string;
  name: string;
  primary: boolean;
}

/** gogcli (`gog`) reads Google Calendar for Fleex; it is installed and set up outside Fleex. */
export const GOGCLI_SETUP_URL = 'https://gogcli.sh/quickstart.html';
export const GOGCLI_INSTALL_COMMAND = 'brew install openclaw/tap/gogcli';

export interface AgendaGoogleStatus {
  /** Google Calendar is read through gogcli, never through an OAuth flow inside Fleex. */
  provider: 'gogcli';
  /** `gog` runs on the server host (PATH, or FLEEX_GOG_BIN). */
  installed: boolean;
  /** `gog --version`, null when not installed. */
  version: string | null;
  /** gog has an authorized account that can read calendars. */
  connected: boolean;
  /** The account gog reads (its primary calendar id). */
  email: string | null;
  calendars: AgendaGoogleCalendar[];
  /** gog's own message when it can't read calendars (credentials missing, no account…). */
  error: string | null;
  /** Where to set gogcli up (install, Google Cloud project, account). */
  setupUrl: string;
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
  /** R3: why the slot was missed. */
  missedReason?: 'scheduler_down' | null;
  /** E1: the event (the series, for a recurring one). */
  event?: CalendarEvent | null;
  /** E3: the Google meeting. */
  external?: {
    calendarId: string;
    eventKey: string;
    htmlLink: string | null;
    attendees: number;
    location: string | null;
    /** 'default' | 'outOfOffice' | 'workingLocation' | 'focusTime'… */
    eventType: string;
    links: AgendaExternalLink[];
  } | null;
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
  /** Epics, so the sidebar can list the Epic filter by name. */
  epics: { id: string; name: string }[];
  /** A source that failed (Google…) — the other types are still served. */
  errors: Partial<Record<AgendaItemType, string>>;
}

export type AgendaView = 'day' | 'week' | 'month' | 'schedule';

/** Per-user display preferences, stored server-side (`user_kv` → `agenda:prefs`). */
export interface AgendaPrefs {
  version: 1;
  /** Absent key = the label's default (every label is on by default). */
  labels: Partial<Record<AgendaItemType, boolean>>;
  /** Absent key = shown. Keyed by routine id. */
  routines: Record<string, boolean>;
  filters: { boards: string[]; epics: string[]; repos: string[]; tags: string[] };
  view: AgendaView;
  /** The "To schedule" drawer (open tickets without a due date). */
  drawerOpen: boolean;
  /** Google calendars read; [] = the primary one only. */
  googleCalendars: string[];
  /** Show Google `workingLocation` all-day events (hidden by default). */
  showWorkingLocation: boolean;
  /**
   * Colour picked per label (key = item type) or per routine (key =
   * `routine:<id>`), a tint hue name. Absent key = the label's default hue.
   */
  colors: Record<string, string>;
}

export const DEFAULT_AGENDA_PREFS: AgendaPrefs = {
  version: 1,
  labels: {},
  routines: {},
  filters: { boards: [], epics: [], repos: [], tags: [] },
  view: 'week',
  drawerOpen: true,
  googleCalendars: [],
  showWorkingLocation: false,
  colors: {},
};
