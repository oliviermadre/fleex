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
}

export interface CreateSessionRequest {
  readonly cwd: string;
  readonly type: SessionType;
  readonly dimensions?: TerminalDimensions;
  readonly claudePrompt?: string;
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

export interface WorktreeSessionGroup {
  readonly branch: string;
  readonly path: string;
  readonly sessions: Session[];
  readonly agentWorktree?: AgentWorktreeInfo;
}
