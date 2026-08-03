import type {
  Session,
  SessionType,
  SessionStatus,
  ClaudeActivityStatus,
  SessionHookStatus,
  WaitingReason,
  HookStatusUpdate,
} from '@fleex/shared';

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
    public readonly parentSessionId?: string,
    // ── Persisted hook-driven status (set by hook events) ──
    public hookStatus: SessionHookStatus = 'unknown',
    public hookWaitingReason: WaitingReason | null = null,
    public hookLastMessage: string | null = null,
    public hookStatusUpdatedAt: Date | null = null,
  ) {}

  /** Mutable, not persisted — set each broadcast cycle by enrichment. */
  public claudeActivity?: ClaudeActivityStatus;

  /** Mutable, not persisted — set each broadcast cycle from tmux pane_current_command. */
  public foregroundProcess?: string;

  /** Mutable, not persisted — set each broadcast cycle from tmux pane_current_path. */
  public paneCwd?: string;

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
    return this.tmuxName.startsWith('fleex_');
  }

  /**
   * Apply a mapped hook event to the session.
   * Returns `true` when the status changed (caller should persist + broadcast),
   * `false` when no transition occurred (idempotent or guarded).
   *
   * Guards:
   *   - `idle` does NOT override `complete` or `error` (terminal-by-PTY-exit is silent
   *     if the agent already produced a semantic outcome).
   */
  applyHookUpdate(update: HookStatusUpdate): boolean {
    // Guard: `idle` (PTY exit / sessionEnd) must not override an agent-driven outcome.
    if (
      update.status === 'idle' &&
      (this.hookStatus === 'complete' || this.hookStatus === 'error')
    ) {
      return false;
    }
    // Guard: `notification/idle_prompt` is the sibling Notification of `Stop` — Claude fires
    // both within ~1s when a turn ends. Once we've recorded `complete`/`error`, the idle_prompt
    // is semantically redundant and must not regress the state back to `waiting`.
    // (permission_prompt and elicitation_dialog after complete are legitimate — user re-engaged.)
    if (
      update.status === 'waiting' &&
      update.waitingReason === 'idle' &&
      (this.hookStatus === 'complete' || this.hookStatus === 'error')
    ) {
      return false;
    }
    // De-dup: same status + same reason + same message → no event
    const sameStatus = this.hookStatus === update.status;
    const sameReason = (this.hookWaitingReason ?? null) === (update.waitingReason ?? null);
    const sameMessage = (this.hookLastMessage ?? null) === (update.message ?? null);
    if (sameStatus && sameReason && sameMessage) {
      return false;
    }
    this.hookStatus = update.status;
    this.hookWaitingReason = update.waitingReason ?? null;
    this.hookLastMessage = update.message ?? null;
    this.hookStatusUpdatedAt = new Date();
    return true;
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
      foregroundProcess: this.foregroundProcess,
      parentSessionId: this.parentSessionId,
      hookStatus: this.hookStatus,
      hookWaitingReason: this.hookWaitingReason ?? undefined,
      hookLastMessage: this.hookLastMessage,
      hookStatusUpdatedAt: this.hookStatusUpdatedAt?.toISOString() ?? null,
    };
  }
}
