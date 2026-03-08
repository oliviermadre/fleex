export type {
  SessionType,
  SessionStatus,
  SessionId,
  TerminalDimensions,
  Session,
  CreateSessionRequest,
  RenameSessionRequest,
  SessionGroup,
  AgentWorktreeInfo,
  WorktreeSessionGroup,
} from './types/session.js';

export { slugify } from './slugify.js';

export type { ClaudeActivityStatus } from './types/claude-activity.js';

export type { ClaudeUsageMetric, ClaudeUsage } from './types/claude-usage.js';

export type {
  Repository,
  Worktree,
  GitRemoteInfo,
  CreateWorktreeRequest,
  PullRequest,
  DiffStats,
  GitHubIssue,
  GitHubIssueDetail,
} from './types/repository.js';

export type {
  RepositorySummary,
  RepositoryDashboardData,
  RefreshInterval,
  RepositoryWsMessage,
  RepositoryWsMessageType,
} from './types/repository-dashboard.js';

export type {
  PtyHandle,
  TerminalConfig,
  TerminalTheme,
} from './types/terminal.js';

export type { ClaudeConfigTreeEntry } from './types/claude-config.js';

export type {
  TicketStatus,
  TicketPriority,
  TicketLinkType,
  TicketLink,
  GitHubIssueMetadata,
  Ticket,
  Board,
  BoardWithCounts,
  CreateTicketRequest,
  UpdateTicketRequest,
  CreateBoardRequest,
  UpdateBoardRequest,
  TicketActivity,
  TicketActivitySummary,
  AgentToken,
  AgentTokenCreated,
  CommentVisibility,
  TicketComment,
  MentionStatus,
  MentionTargetType,
  TicketMention,
  TicketDeliverable,
  TicketContext,
  TicketWsMessageType,
  TicketWsMessage,
} from './types/ticket.js';

export type {
  AgentPersona,
  AgentStructuredOutput,
  CreateAgentPersonaRequest,
  UpdateAgentPersonaRequest,
  AgentExecutionStatus,
  AgentExecutionResult,
  PersonaWsMessageType,
  PersonaWsMessage,
} from './types/agent-persona.js';

export type {
  AgentExecution,
  AgentEventType,
  AgentEvent,
  AgentEventWsMessageType,
  AgentEventWsMessage,
} from './types/agent-event.js';

export type {
  Gateway,
  GatewayRegisterRequest,
  GatewayRegisterResponse,
  GatewayHeartbeatRequest,
} from './types/gateway.js';

export {
  TunnelMsgType,
  TUNNEL_HEADER_SIZE,
  TUNNEL_CONTROL_CHANNEL,
  WS_GATEWAY_TUNNEL_PATH,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PONG_TIMEOUT_MS,
  TUNNEL_RECONNECT_INITIAL_MS,
  TUNNEL_RECONNECT_MAX_MS,
} from './types/gateway-tunnel.js';

export type {
  TunnelHelloPayload,
  TunnelHelloAckPayload,
  TunnelChallengePayload,
  TunnelExecReqPayload,
  TunnelExecResPayload,
  TunnelFsReqPayload,
  TunnelFsResPayload,
  TunnelPtyOpenPayload,
  TunnelPtyOpenedPayload,
  TunnelPtyResizePayload,
  TunnelPtyExitPayload,
  TunnelPtyErrorPayload,
  TunnelErrorPayload,
} from './types/gateway-tunnel.js';

export {
  encodeTunnelJson,
  encodeTunnelRaw,
  encodeTunnelEmpty,
  decodeTunnelFrame,
  parseTunnelJson,
} from './tunnel-codec.js';

export type { TunnelFrame } from './tunnel-codec.js';

export type { DomainEventLog } from './types/domain-event-log.js';

export type {
  StatisticsTimeBucket,
  AgentLeaderboardEntry,
  StatisticsSummary,
  StatisticsResponse,
} from './types/statistics.js';

export {
  ClientMessageType,
  ServerMessageType,
} from './types/websocket.js';

export type {
  DashboardMessage,
  SessionsUpdatedMessage,
  SessionCreatedMessage,
  SessionRemovedMessage,
} from './types/websocket.js';

export {
  FLEEX_PREFIX,
  FLEEX_SHELL_PREFIX,
  FLEEX_CLAUDE_PREFIX,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  WS_TERMINAL_PATH,
  WS_DASHBOARD_PATH,
  API_BASE,
  DASHBOARD_BROADCAST_INTERVAL_MS,
  RESIZE_DEBOUNCE_MS,
  STALE_TERMINAL_EVICTION_MS,
  WS_RECONNECT_INITIAL_MS,
  WS_RECONNECT_MAX_MS,
  WS_RECONNECT_MAX_ATTEMPTS,
  SESSION_HASH_LENGTH,
  DEFAULT_CLAUDE_DISPLAY_NAME,
  DEFAULT_SHELL_DISPLAY_NAME,
  FLEEX_DIR,
  SESSIONS_FILE,
  CONFIG_FILE,
  WS_REPOSITORY_PATH,
  REPO_REFRESH_INTERVALS,
  REPO_REFRESH_LABELS,
  DEFAULT_REPO_REFRESH_INTERVAL,
  CLAUDE_USAGE_CACHE_TTL_MS,
  WS_TICKET_PATH,
  WS_AGENT_PATH,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_PRIORITIES,
  WS_PERSONA_PATH,
  WS_AGENT_EVENTS_PATH,
} from './constants.js';
