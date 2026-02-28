import type { SessionType, SessionStatus } from '@asm/shared';
import { SessionEntity } from '../../../domain/entities.js';
import type { SessionStorePort } from '../../../application/ports/session-store.port.js';
import type { PgConnection } from './connection.js';
import { getCurrentUserId } from '../../request-context.js';

export class PgSessionStore implements SessionStorePort {
  constructor(private readonly db: PgConnection) {}

  async save(session: SessionEntity): Promise<void> {
    const userId = getCurrentUserId();
    await this.db.query(
      `INSERT INTO sessions (
        id, user_id, tmux_name, type, status, cwd, created_at,
        last_attached_at, repository_org, repository_name,
        worktree_branch, git_remote, claude_prompt, display_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        tmux_name = $3,
        type = $4,
        status = $5,
        cwd = $6,
        created_at = $7,
        last_attached_at = $8,
        repository_org = $9,
        repository_name = $10,
        worktree_branch = $11,
        git_remote = $12,
        claude_prompt = $13,
        display_name = $14
      WHERE sessions.user_id = $2`,
      [
        session.id,
        userId,
        session.tmuxName,
        session.type,
        session.status,
        session.cwd,
        session.createdAt.toISOString(),
        session.lastAttachedAt?.toISOString() ?? null,
        session.repositoryOrg,
        session.repositoryName,
        session.worktreeBranch,
        session.gitRemote,
        session.claudePrompt ?? null,
        session.displayName,
      ],
    );
  }

  async remove(sessionId: string): Promise<void> {
    const userId = getCurrentUserId();
    await this.db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, userId]);
  }

  async getAll(): Promise<SessionEntity[]> {
    const userId = getCurrentUserId();
    const { rows } = await this.db.query('SELECT * FROM sessions WHERE user_id = $1', [userId]);
    return rows.map(rowToSession);
  }

  async getById(id: string): Promise<SessionEntity | null> {
    const userId = getCurrentUserId();
    const { rows } = await this.db.query(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows.length > 0 ? rowToSession(rows[0]) : null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    const userId = getCurrentUserId();
    const { rows } = await this.db.query(
      'SELECT * FROM sessions WHERE tmux_name = $1 AND user_id = $2',
      [name, userId],
    );
    return rows.length > 0 ? rowToSession(rows[0]) : null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    const userId = getCurrentUserId();
    const { rows } = await this.db.query(
      'SELECT * FROM sessions WHERE cwd = $1 AND user_id = $2',
      [cwd, userId],
    );
    return rows.map(rowToSession);
  }
}

function rowToSession(row: Record<string, unknown>): SessionEntity {
  return new SessionEntity(
    row.id as string,
    row.tmux_name as string,
    row.type as SessionType,
    row.status as SessionStatus,
    row.cwd as string,
    new Date(row.created_at as string),
    row.last_attached_at ? new Date(row.last_attached_at as string) : null,
    (row.repository_org as string) ?? null,
    (row.repository_name as string) ?? null,
    (row.worktree_branch as string) ?? null,
    (row.git_remote as string) ?? null,
    (row.claude_prompt as string) ?? undefined,
    (row.display_name as string) ?? '',
  );
}
