export const FLEEX_PREFIX = 'fleex_';
export const FLEEX_SHELL_PREFIX = 'fleex_shell_';
export const FLEEX_CLAUDE_PREFIX = 'fleex_claude_';
export const FLEEX_SIDEBAR_PREFIX = 'fleex_sidebar_';

/** A sidebar terminal session, hosted in a parent session's right panel — excluded from main session lists. */
export const isSidebarSession = (s: { tmuxName: string }): boolean =>
  s.tmuxName.startsWith(FLEEX_SIDEBAR_PREFIX);

export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;

export const WS_PATH = '/ws';

// Channels multiplexed over the single WS connection
export type WsChannel = 'dashboard' | 'repositories' | 'tickets' | 'personas' | 'skills' | 'agent-events';

/** @deprecated Use WS_PATH — terminal is now multiplexed as binary frames */
export const WS_TERMINAL_PATH = '/ws/terminal';
/** @deprecated Use WS_PATH */
export const WS_DASHBOARD_PATH = '/ws/dashboard';

export const API_BASE = '/api';

export const DASHBOARD_BROADCAST_INTERVAL_MS = 1000;
export const RESIZE_DEBOUNCE_MS = 100;
export const STALE_TERMINAL_EVICTION_MS = 10 * 60 * 1000; // 10 minutes

export const WS_RECONNECT_INITIAL_MS = 1000;
export const WS_RECONNECT_MAX_MS = 30000;
export const WS_RECONNECT_MAX_ATTEMPTS = Infinity;

export const WS_PING_INTERVAL_MS = 25_000;
export const WS_STALENESS_CHECK_INTERVAL_MS = 35_000;
export const WS_STALENESS_TIMEOUT_MS = 45_000;

export const SESSION_HASH_LENGTH = 8;

export const DEFAULT_CLAUDE_DISPLAY_NAME = 'Claude';
export const DEFAULT_SHELL_DISPLAY_NAME = 'Shell';

export const FLEEX_DIR = '.fleex';
export const SESSIONS_FILE = 'sessions.json';
export const CONFIG_FILE = 'config.json';

// Repository dashboard
export const WS_REPOSITORY_PATH = '/ws/repositories';
export const REPO_REFRESH_INTERVALS = [60000, 120000, 300000, 600000, 1800000, 3600000, 0] as const;
export const REPO_REFRESH_LABELS: Record<number, string> = {
  60000: '1 min',
  120000: '2 min',
  300000: '5 min',
  600000: '10 min',
  1800000: '30 min',
  3600000: '1 hour',
  0: 'Disabled',
};
export const DEFAULT_REPO_REFRESH_INTERVAL = 0;

// Claude usage
export const CLAUDE_USAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Tickets
export const WS_TICKET_PATH = '/ws/tickets';
export const WS_AGENT_PATH = '/ws/agents';
export const TICKET_STATUSES = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'] as const;
export const TICKET_STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  reviewing: 'Reviewing',
  done: 'Done',
  cancelled: 'Cancelled',
};
export const TICKET_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;

export const TICKET_TYPES = [
  'build', 'fix', 'review', 'ops', 'lead', 'think',
] as const;

export const TICKET_TYPE_LABELS: Record<string, string> = {
  build: 'Build',
  fix: 'Fix',
  review: 'Review',
  ops: 'Ops',
  lead: 'Lead',
  think: 'Think',
};

export const TICKET_TYPE_EMOJIS: Record<string, string> = {
  build: '🔨',
  fix: '🐛',
  review: '👀',
  ops: '⚙️',
  lead: '👔',
  think: '💡',
};

// Agent Personas
export const WS_PERSONA_PATH = '/ws/personas';

// Agent Events
export const WS_AGENT_EVENTS_PATH = '/ws/agent-events';

// Skills
export const WS_SKILL_PATH = '/ws/skills';

// Timing — UI interactions
export const CONFIRM_KILL_TIMEOUT_MS = 3_000; // sidebar kill confirm dialog auto-reset
export const KILL_GRACE_MS = 3_000;           // grace window for recently-killed sessions
export const ADD_GRACE_MS = 3_000;            // grace window for recently-added sessions
export const EXECUTION_LOG_REFRESH_MS = 1_500; // silent reload delay after a log action
export const TOOLTIP_HIDE_DELAY_MS = 80;       // delay before hiding a hover tooltip

// Execution / terminate-button state machine
export const EXECUTION_STATES = {
  IDLE: 'idle',
  CONFIRMING: 'confirming',
  TERMINATING: 'terminating',
  DONE: 'done',
  ERROR: 'error',
} as const;
export type ExecutionState = (typeof EXECUTION_STATES)[keyof typeof EXECUTION_STATES];

// Named accessor for ticket statuses (TICKET_STATUSES tuple stays the source of column order)
export const TICKET_STATUS = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  DOING: 'doing',
  REVIEWING: 'reviewing',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const;

// Usage gauge color thresholds (remaining %)
export const USAGE_WARN_THRESHOLD_PCT = 50;   // above → success/green
export const USAGE_DANGER_THRESHOLD_PCT = 20; // below → danger/red

// Agent SDK loop cap — how many turns a plan/edit execution may take before the
// SDK stops it. Configurable per workspace via Settings › General
// (`agentMaxTurns`); this is the fallback when unset.
export const DEFAULT_AGENT_MAX_TURNS = 150;
export const AGENT_MAX_TURNS_MIN = 1;
export const AGENT_MAX_TURNS_MAX = 1000;

// Time conversion units
export const MS_IN_MINUTE = 60_000;
export const MINUTES_IN_HOUR = 60;
export const HOURS_IN_DAY = 24;

// Wall-clock budget for a single agent run (mention, skill, workflow step,
// panel). A TOTAL duration cap, not an inactivity timeout: a run that is still
// making progress is aborted just the same once it expires. Configurable per
// workspace via Settings › General (`agentExecutionTimeout`, stored in ms);
// this is the fallback when unset.
export const DEFAULT_AGENT_EXECUTION_TIMEOUT_MS = 30 * MS_IN_MINUTE;
export const AGENT_EXECUTION_TIMEOUT_MIN_MINUTES = 1;
export const AGENT_EXECUTION_TIMEOUT_MAX_MINUTES = 12 * MINUTES_IN_HOUR;

// Auto-review workflow activity actions
export const AUTO_REVIEW_ACTIVITY_ACTIONS = [
  'unclaimed_and_assigned_human_via_mention',
  'moved_to_review_auto',
  'moved_from_review_to_doing',
  'moved_to_qa_review_auto',
  'auto_blocked_waiting_for_info',
] as const;
