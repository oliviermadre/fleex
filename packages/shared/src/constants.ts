export const FLEEX_PREFIX = 'fleex_';
export const FLEEX_SHELL_PREFIX = 'fleex_shell_';
export const FLEEX_CLAUDE_PREFIX = 'fleex_claude_';

export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;

export const WS_TERMINAL_PATH = '/ws/terminal';
export const WS_DASHBOARD_PATH = '/ws/dashboard';

export const API_BASE = '/api';

export const DASHBOARD_BROADCAST_INTERVAL_MS = 1000;
export const RESIZE_DEBOUNCE_MS = 100;
export const STALE_TERMINAL_EVICTION_MS = 10 * 60 * 1000; // 10 minutes

export const WS_RECONNECT_INITIAL_MS = 1000;
export const WS_RECONNECT_MAX_MS = 30000;
export const WS_RECONNECT_MAX_ATTEMPTS = 10;

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
export const TICKET_STATUSES = ['backlog', 'todo', 'doing', 'reviewing', 'done'] as const;
export const TICKET_STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  reviewing: 'Reviewing',
  done: 'Done',
};
export const TICKET_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;

// Agent Personas
export const WS_PERSONA_PATH = '/ws/personas';

// Agent Events
export const WS_AGENT_EVENTS_PATH = '/ws/agent-events';

// Skills
export const WS_SKILL_PATH = '/ws/skills';

// Auto-review workflow activity actions
export const AUTO_REVIEW_ACTIVITY_ACTIONS = [
  'moved_to_review_via_human_mention',
  'moved_to_review_auto',
  'moved_from_review_to_doing',
  'moved_to_qa_review_auto',
  'auto_blocked_waiting_for_info',
] as const;
