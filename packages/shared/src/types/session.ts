export type SessionType = 'shell' | 'claude';
export type SessionStatus = 'running' | 'dead' | 'unknown' | 'pending_reconciliation';

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
  readonly claudePrompt?: string;
  readonly claudeActivity?: import('./claude-activity.js').ClaudeActivityStatus;
}

export interface CreateSessionRequest {
  readonly cwd: string;
  readonly type: SessionType;
  readonly dimensions?: TerminalDimensions;
  readonly claudePrompt?: string;
}

export interface SessionGroup {
  readonly repositoryOrg: string;
  readonly repositoryName: string;
  readonly worktrees: WorktreeSessionGroup[];
}

export interface WorktreeSessionGroup {
  readonly branch: string;
  readonly path: string;
  readonly sessions: Session[];
}
