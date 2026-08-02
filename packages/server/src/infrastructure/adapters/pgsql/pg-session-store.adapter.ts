import type { SessionType, SessionStatus, SessionHookStatus, WaitingReason } from '@fleex/shared';

import { SessionEntity } from '../../../domain/entities.js';

import type { PgConnection } from './connection.js';
import type { SessionStorePort } from '../../../application/ports/session-store.port.js';

export class PgSessionStore implements SessionStorePort {
  constructor(private readonly db: PgConnection) {}

  async save(session: SessionEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (
        id, tmux_name, type, status, cwd, created_at,
        last_attached_at, repository_org, repository_name,
        worktree_branch, git_remote, claude_prompt, display_name,
        hook_status, hook_waiting_reason, hook_last_message, hook_status_updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        tmux_name = $2,
        type = $3,
        status = $4,
        cwd = $5,
        created_at = $6,
        last_attached_at = $7,
        repository_org = $8,
        repository_name = $9,
        worktree_branch = $10,
        git_remote = $11,
        claude_prompt = $12,
        display_name = $13,
        hook_status = $14,
        hook_waiting_reason = $15,
        hook_last_message = $16,
        hook_status_updated_at = $17`,
      [
        session.id,
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
        session.hookStatus,
        session.hookWaitingReason,
        session.hookLastMessage,
        session.hookStatusUpdatedAt?.toISOString() ?? null,
      ],
    );
  }

  async remove(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  async getAll(): Promise<SessionEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM sessions');
    return rows.map(rowToSession);
  }

  async getById(id: string): Promise<SessionEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows.length > 0 ? rowToSession(rows[0]) : null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM sessions WHERE tmux_name = $1', [name]);
    return rows.length > 0 ? rowToSession(rows[0]) : null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM sessions WHERE cwd = $1', [cwd]);
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
    undefined,
    (row.hook_status as string as SessionHookStatus) ?? 'unknown',
    (row.hook_waiting_reason as string | null as WaitingReason | null) ?? null,
    (row.hook_last_message as string | null) ?? null,
    row.hook_status_updated_at ? new Date(row.hook_status_updated_at as string) : null,
  );
}
