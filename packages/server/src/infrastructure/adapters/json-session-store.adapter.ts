import { join } from 'node:path';
import { SESSIONS_FILE } from '@fleex/shared';
import { SessionEntity } from '../../domain/entities.js';
import type { SessionStorePort } from '../../application/ports/session-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SessionType, SessionStatus } from '@fleex/shared';
import type { HostFs } from '../host/types.js';

interface SerializedSession {
  id: string;
  tmuxName: string;
  type: SessionType;
  status: SessionStatus;
  cwd: string;
  createdAt: string;
  lastAttachedAt: string | null;
  repositoryOrg: string | null;
  repositoryName: string | null;
  worktreeBranch: string | null;
  gitRemote: string | null;
  claudePrompt?: string;
  displayName?: string;
}

export class JsonSessionStore implements SessionStorePort {
  private readonly sessions = new Map<string, SessionEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    const dir = this.homedir;
    this.filePath = join(dir, SESSIONS_FILE);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const dir = this.homedir;
    if (!(await this.hostFs.exists(dir))) {
      await this.hostFs.mkdir(dir);
    }
    await this.loadFromDisk();
    this.initialized = true;
  }

  async save(session: SessionEntity): Promise<void> {
    await this.init();
    this.sessions.set(session.id, session);
    await this.syncToDisk();
  }

  async remove(sessionId: string): Promise<void> {
    await this.init();
    this.sessions.delete(sessionId);
    await this.syncToDisk();
  }

  async getAll(): Promise<SessionEntity[]> {
    return Array.from(this.sessions.values());
  }

  async getById(id: string): Promise<SessionEntity | null> {
    return this.sessions.get(id) ?? null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    for (const session of this.sessions.values()) {
      if (session.tmuxName === name) return session;
    }
    return null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    return Array.from(this.sessions.values()).filter((s) => s.cwd === cwd);
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;

    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedSession[];

      for (const s of data) {
        const entity = new SessionEntity(
          s.id,
          s.tmuxName,
          s.type,
          s.status,
          s.cwd,
          new Date(s.createdAt),
          s.lastAttachedAt ? new Date(s.lastAttachedAt) : null,
          s.repositoryOrg,
          s.repositoryName,
          s.worktreeBranch,
          s.gitRemote,
          s.claudePrompt,
          s.displayName ?? '',
        );
        this.sessions.set(entity.id, entity);
      }

      this.logger.info('Session store loaded', { count: this.sessions.size });
    } catch (err) {
      this.logger.warn('Failed to load session store from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedSession[] = Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        tmuxName: s.tmuxName,
        type: s.type,
        status: s.status,
        cwd: s.cwd,
        createdAt: s.createdAt.toISOString(),
        lastAttachedAt: s.lastAttachedAt?.toISOString() ?? null,
        repositoryOrg: s.repositoryOrg,
        repositoryName: s.repositoryName,
        worktreeBranch: s.worktreeBranch,
        gitRemote: s.gitRemote,
        claudePrompt: s.claudePrompt,
        displayName: s.displayName,
      }));

      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync session store to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
