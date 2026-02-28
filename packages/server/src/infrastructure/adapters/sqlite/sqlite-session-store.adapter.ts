import type { SessionType, SessionStatus } from '@asm/shared';
import { SessionEntity } from '../../../domain/entities.js';
import type { SessionStorePort } from '../../../application/ports/session-store.port.js';
import type { SqliteConnection } from './connection.js';
import { getCurrentUserId } from '../../request-context.js';

interface SessionRow {
  id: string;
  user_id: string;
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
}

export class SqliteSessionStoreAdapter implements SessionStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async save(session: SessionEntity): Promise<void> {
    const userId = getCurrentUserId();
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, user_id, tmux_name, type, status, cwd, created_at, last_attached_at,
         repository_org, repository_name, worktree_branch, git_remote,
         claude_prompt, display_name)
      VALUES
        (@id, @user_id, @tmux_name, @type, @status, @cwd, @created_at, @last_attached_at,
         @repository_org, @repository_name, @worktree_branch, @git_remote,
         @claude_prompt, @display_name)
    `);

    stmt.run({
      id: session.id,
      user_id: userId,
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
    });
  }

  async remove(sessionId: string): Promise<void> {
    const userId = getCurrentUserId();
    this.conn.db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  }

  async getAll(): Promise<SessionEntity[]> {
    const userId = getCurrentUserId();
    const rows = this.conn.db
      .prepare('SELECT * FROM sessions WHERE user_id = ?')
      .all(userId) as SessionRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<SessionEntity | null> {
    const userId = getCurrentUserId();
    const row = this.conn.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(id, userId) as SessionRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    const userId = getCurrentUserId();
    const row = this.conn.db
      .prepare('SELECT * FROM sessions WHERE tmux_name = ? AND user_id = ?')
      .get(name, userId) as SessionRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    const userId = getCurrentUserId();
    const rows = this.conn.db
      .prepare('SELECT * FROM sessions WHERE cwd = ? AND user_id = ?')
      .all(cwd, userId) as SessionRow[];
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
    );
  }
}
