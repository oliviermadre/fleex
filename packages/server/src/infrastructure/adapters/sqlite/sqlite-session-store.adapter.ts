import type { SessionType, SessionStatus, SessionHookStatus, WaitingReason } from '@fleex/shared';
import { SessionEntity } from '../../../domain/entities.js';
import type { SessionStorePort } from '../../../application/ports/session-store.port.js';
import type { SqliteConnection } from './connection.js';

interface SessionRow {
  id: string;
  tmux_name: string;
  type: string;
  status: string;
  cwd: string;
  created_at: string;
  last_attached_at: string | null;
  repository_org: string | null;
  repository_name: string | null;
  worktree_branch: string | null;
  git_remote: string | null;
  claude_prompt: string | null;
  display_name: string | null;
  hook_status: string | null;
  hook_waiting_reason: string | null;
  hook_last_message: string | null;
  hook_status_updated_at: string | null;
}

export class SqliteSessionStoreAdapter implements SessionStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async save(session: SessionEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, tmux_name, type, status, cwd, created_at, last_attached_at,
         repository_org, repository_name, worktree_branch, git_remote,
         claude_prompt, display_name,
         hook_status, hook_waiting_reason, hook_last_message, hook_status_updated_at)
      VALUES
        (@id, @tmux_name, @type, @status, @cwd, @created_at, @last_attached_at,
         @repository_org, @repository_name, @worktree_branch, @git_remote,
         @claude_prompt, @display_name,
         @hook_status, @hook_waiting_reason, @hook_last_message, @hook_status_updated_at)
    `);

    stmt.run({
      id: session.id,
      tmux_name: session.tmuxName,
      type: session.type,
      status: session.status,
      cwd: session.cwd,
      created_at: session.createdAt.toISOString(),
      last_attached_at: session.lastAttachedAt?.toISOString() ?? null,
      repository_org: session.repositoryOrg,
      repository_name: session.repositoryName,
      worktree_branch: session.worktreeBranch,
      git_remote: session.gitRemote,
      claude_prompt: session.claudePrompt ?? null,
      display_name: session.displayName,
      hook_status: session.hookStatus,
      hook_waiting_reason: session.hookWaitingReason,
      hook_last_message: session.hookLastMessage,
      hook_status_updated_at: session.hookStatusUpdatedAt?.toISOString() ?? null,
    });
  }

  async remove(sessionId: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  async getAll(): Promise<SessionEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM sessions').all() as SessionRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<SessionEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM sessions WHERE tmux_name = ?')
      .get(name) as SessionRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM sessions WHERE cwd = ?')
      .all(cwd) as SessionRow[];
    return rows.map((r) => this.toEntity(r));
  }

  private toEntity(row: SessionRow): SessionEntity {
    return new SessionEntity(
      row.id,
      row.tmux_name,
      row.type as SessionType,
      row.status as SessionStatus,
      row.cwd,
      new Date(row.created_at),
      row.last_attached_at ? new Date(row.last_attached_at) : null,
      row.repository_org,
      row.repository_name,
      row.worktree_branch,
      row.git_remote,
      row.claude_prompt ?? undefined,
      row.display_name ?? '',
      undefined,
      (row.hook_status as SessionHookStatus) ?? 'unknown',
      (row.hook_waiting_reason as WaitingReason | null) ?? null,
      row.hook_last_message ?? null,
      row.hook_status_updated_at ? new Date(row.hook_status_updated_at) : null,
    );
  }
}
