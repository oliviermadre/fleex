import type { Session, SessionType, SessionStatus } from '@asm/shared';

export class SessionEntity {
  constructor(
    public readonly id: string,
    public readonly tmuxName: string,
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
  ) {}

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
      claudePrompt: this.claudePrompt,
    };
  }
}
