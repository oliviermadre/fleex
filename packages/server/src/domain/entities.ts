import type { Session, SessionType, SessionStatus, ClaudeActivityStatus } from '@asm/shared';

export class SessionEntity {
  constructor(
    public readonly id: string,
    public tmuxName: string,
    public readonly type: SessionType,
    public status: SessionStatus,
    public readonly cwd: string,
    public readonly createdAt: Date,
    public lastAttachedAt: Date | null,
    public readonly repositoryOrg: string | null,
    public readonly repositoryName: string | null,
    public readonly worktreeBranch: string | null,
    public readonly gitRemote: string | null,
    public readonly claudePrompt?: string,
    public displayName: string = '',
  ) {}

  /** Mutable, not persisted — set each broadcast cycle by enrichment. */
  public claudeActivity?: ClaudeActivityStatus;

  rename(newTmuxName: string, newDisplayName: string): void {
    this.tmuxName = newTmuxName;
    this.displayName = newDisplayName;
  }

  markAttached(): void {
    this.lastAttachedAt = new Date();
  }

  markDead(): void {
    this.status = 'dead';
  }

  isManaged(): boolean {
    return this.tmuxName.startsWith('asm_');
  }

  toDTO(): Session {
    return {
      id: this.id,
      tmuxName: this.tmuxName,
      type: this.type,
      status: this.status,
      cwd: this.cwd,
      createdAt: this.createdAt.toISOString(),
      lastAttachedAt: this.lastAttachedAt?.toISOString() ?? null,
      repositoryOrg: this.repositoryOrg,
      repositoryName: this.repositoryName,
      worktreeBranch: this.worktreeBranch,
      gitRemote: this.gitRemote,
      displayName: this.displayName,
      claudePrompt: this.claudePrompt,
      claudeActivity: this.claudeActivity,
    };
  }
}
