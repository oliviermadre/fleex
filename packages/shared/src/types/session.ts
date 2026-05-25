export type SessionType = 'shell' | 'claude';
export type SessionStatus = 'running' | 'dead' | 'unknown';

export interface SessionId {
  readonly value: string;
}

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
}

export interface Session {
  readonly id: string;
  readonly tmuxName: string;
  readonly type: SessionType;
  readonly status: SessionStatus;
  readonly cwd: string;
  readonly createdAt: string;
  readonly lastAttachedAt: string | null;
  readonly repositoryOrg: string | null;
  readonly repositoryName: string | null;
  readonly worktreeBranch: string | null;
  readonly gitRemote: string | null;
  readonly displayName: string;
  readonly claudePrompt?: string;
  readonly claudeActivity?: import('./claude-activity.js').ClaudeActivityStatus;
  readonly foregroundProcess?: string;
  /** Set when this session is a sidebar terminal attached to a parent tmux session tab. */
  readonly parentSessionId?: string;
  /** Semantic status derived from Claude Code hooks (UserPromptSubmit/Notification/Stop…). */
  readonly hookStatus?: import('./hook-events.js').SessionHookStatus;
  /** Sub-reason when hookStatus === 'waiting'. */
  readonly hookWaitingReason?: import('./hook-events.js').WaitingReason;
  /** Free-form tooltip text from the last hook (notification message, error type, etc.). */
  readonly hookLastMessage?: string | null;
  /** ISO timestamp of the last hook-driven status change. */
  readonly hookStatusUpdatedAt?: string | null;
}

export interface CreateSessionRequest {
  readonly cwd: string;
  readonly type: SessionType;
  readonly dimensions?: TerminalDimensions;
  readonly claudePrompt?: string;
  /** Override git-derived metadata (e.g. from workspace manifest) */
  readonly repositoryOrg?: string;
  readonly repositoryName?: string;
  readonly worktreeBranch?: string;
  readonly displayName?: string;
  /**
   * When both fields are provided, the new tmux session is named as a
   * "sidebar terminal" attached to a parent tmux session tab, using the
   * `fleex_sidebar_` prefix instead of the default shell/claude prefix.
   * Used by the right sidebar bottom panel.
   */
  readonly parentSessionId?: string;
  readonly ticketDisplayId?: number;
}

export interface RenameSessionRequest {
  readonly displayName: string;
}

export interface SessionGroup {
  readonly repositoryOrg: string;
  readonly repositoryName: string;
  readonly worktrees: WorktreeSessionGroup[];
}

export interface AgentWorktreeInfo {
  readonly ticketId: string;
  readonly ticketDisplayId: number;
  readonly ticketTitle: string;
  readonly agentPersonaId: string;
  readonly agentName: string;
  readonly agentDisplayName: string;
  readonly executionStatus: 'idle' | 'running' | 'completed' | 'failed';
  readonly latestExecutionId: string | null;
}

export interface WorktreeDiffStats {
  readonly additions: number;
  readonly deletions: number;
}

export interface WorktreeSessionGroup {
  readonly branch: string;
  readonly path: string;
  readonly sessions: Session[];
  readonly ticketId?: string;
  readonly agentWorktree?: AgentWorktreeInfo;
  readonly worktreeStatus?: 'ready' | 'reconciling' | 'repo_missing' | 'unavailable';
  readonly diffStats?: WorktreeDiffStats;
}
