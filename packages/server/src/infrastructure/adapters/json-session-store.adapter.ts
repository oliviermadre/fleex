import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ASM_DIR, SESSIONS_FILE } from '@asm/shared';
import { SessionEntity } from '../../domain/entities.js';
import type { SessionStorePort } from '../../application/ports/session-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SessionType, SessionStatus } from '@asm/shared';

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
}

export class JsonSessionStore implements SessionStorePort {
  private readonly sessions = new Map<string, SessionEntity>();
  private readonly filePath: string;

  constructor(private readonly logger: LoggerPort) {
    const dir = join(homedir(), ASM_DIR);
    this.filePath = join(dir, SESSIONS_FILE);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.loadFromDisk();
  }

  save(session: SessionEntity): void {
    this.sessions.set(session.id, session);
    this.syncToDisk();
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.syncToDisk();
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

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
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

  private syncToDisk(): void {
    try {
      const data: SerializedSession[] = this.getAll().map((s) => ({
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
      }));

      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error('Failed to sync session store to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
