import { SessionEntity } from '../../domain/entities.js';
import type { SessionStorePort } from '../../application/ports/session-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SessionType, SessionStatus } from '@asm/shared';
import type { DbPool } from '../database/db.js';

interface SessionRow {
  id: string;
  user_id: string;
  gateway_id: string | null;
  data: {
    tmuxName: string;
    type: SessionType;
    status: SessionStatus;
    cwd: string;
    lastAttachedAt: string | null;
    repositoryOrg: string | null;
    repositoryName: string | null;
    worktreeBranch: string | null;
    gitRemote: string | null;
    claudePrompt?: string;
    displayName?: string;
  };
  created_at: string;
  updated_at: string;
}

export class PgSessionStore implements SessionStorePort {
  /** In-memory cache kept in sync with Postgres for fast reads. */
  private readonly sessions = new Map<string, SessionEntity>();

  constructor(
    private readonly pool: DbPool,
    private readonly userId: string,
    private readonly logger: LoggerPort,
  ) {}

  async init(): Promise<void> {
    const { rows } = await this.pool.query<SessionRow>(
      'SELECT * FROM sessions WHERE user_id = $1',
      [this.userId],
    );
    for (const row of rows) {
      const entity = this.rowToEntity(row);
      this.sessions.set(entity.id, entity);
    }
    this.logger.info('PgSessionStore loaded', { count: this.sessions.size });
  }

  async save(session: SessionEntity): Promise<void> {
    const data = {
      tmuxName: session.tmuxName,
      type: session.type,
      status: session.status,
      cwd: session.cwd,
      lastAttachedAt: session.lastAttachedAt?.toISOString() ?? null,
      repositoryOrg: session.repositoryOrg,
      repositoryName: session.repositoryName,
      worktreeBranch: session.worktreeBranch,
      gitRemote: session.gitRemote,
      claudePrompt: session.claudePrompt,
      displayName: session.displayName,
    };
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = now()`,
      [session.id, this.userId, JSON.stringify(data), session.createdAt.toISOString()],
    );
    this.sessions.set(session.id, session);
  }

  async remove(sessionId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, this.userId],
    );
    this.sessions.delete(sessionId);
  }

  getAll(): SessionEntity[] {
    return Array.from(this.sessions.values());
  }

  getById(id: string): SessionEntity | null {
    return this.sessions.get(id) ?? null;
  }

  getByTmuxName(name: string): SessionEntity | null {
    for (const session of this.sessions.values()) {
      if (session.tmuxName === name) return session;
    }
    return null;
  }

  getByCwd(cwd: string): SessionEntity[] {
    return this.getAll().filter((s) => s.cwd === cwd);
  }

  private rowToEntity(row: SessionRow): SessionEntity {
    const d = row.data;
    return new SessionEntity(
      row.id,
      d.tmuxName,
      d.type,
      d.status,
      d.cwd,
      new Date(row.created_at),
      d.lastAttachedAt ? new Date(d.lastAttachedAt) : null,
      d.repositoryOrg,
      d.repositoryName,
      d.worktreeBranch,
      d.gitRemote,
      d.claudePrompt,
      d.displayName ?? '',
    );
  }
}
