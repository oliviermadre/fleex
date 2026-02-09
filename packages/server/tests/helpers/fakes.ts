import type { TmuxPort, TmuxSessionInfo } from '../../src/application/ports/tmux.port.js';
import type { SessionStorePort } from '../../src/application/ports/session-store.port.js';
import type { GitPort } from '../../src/application/ports/git.port.js';
import type { ConfigPort, AppConfig } from '../../src/application/ports/config.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { DiffStats, GitRemoteInfo, Worktree } from '@asm/shared';
import { SessionEntity } from '../../src/domain/entities.js';

export class FakeTmuxPort implements TmuxPort {
  sessions = new Map<string, { cwd: string; command?: string }>();
  sentKeys: Array<{ name: string; keys: string }> = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(opts: { name: string; cwd: string; command?: string }): Promise<void> {
    this.sessions.set(opts.name, { cwd: opts.cwd, command: opts.command });
  }

  async killSession(name: string): Promise<void> {
    this.sessions.delete(name);
  }

  async hasSession(name: string): Promise<boolean> {
    return this.sessions.has(name);
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    return Array.from(this.sessions.entries()).map(([name]) => ({
      name,
      created: new Date().toISOString(),
      attached: false,
      width: 120,
      height: 30,
    }));
  }

  async listManagedSessions(): Promise<TmuxSessionInfo[]> {
    return (await this.listSessions()).filter((s) => s.name.startsWith('asm_'));
  }

  async sendKeys(name: string, keys: string): Promise<void> {
    this.sentKeys.push({ name, keys });
  }
}

export class FakeSessionStore implements SessionStorePort {
  private sessions = new Map<string, SessionEntity>();

  save(session: SessionEntity): void {
    this.sessions.set(session.id, session);
  }

  remove(sessionId: string): void {
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
}

export class FakeGitPort implements GitPort {
  private infoByPath = new Map<string, GitRemoteInfo>();

  setInfo(cwd: string, info: GitRemoteInfo): void {
    this.infoByPath.set(cwd, info);
  }

  async getInfo(cwd: string): Promise<GitRemoteInfo> {
    const info = this.infoByPath.get(cwd);
    if (!info) throw new Error(`No git info for ${cwd}`);
    return info;
  }

  async listBranches(): Promise<string[]> {
    return ['main', 'feature/test'];
  }

  async listWorktrees(): Promise<Worktree[]> {
    return [];
  }

  async createWorktree(): Promise<void> {}
  async removeWorktree(): Promise<void> {}
  async getDefaultBranch(): Promise<string> {
    return 'main';
  }
  async fetch(): Promise<void> {}
  async getDiffStats(): Promise<DiffStats> {
    return { commitsAhead: 0, commitsBehind: 0, filesChanged: 0, additions: 0, deletions: 0 };
  }
  async copyIgnoredFiles(): Promise<void> {}
}

export class FakeConfigPort implements ConfigPort {
  private config: AppConfig = {
    basePath: '/tmp/repos',
    defaultShell: '/bin/zsh',
    repositoryRefreshIntervalMs: 0,
  };

  get(): AppConfig {
    return this.config;
  }

  getClaudeCommand(): string {
    return 'claude';
  }

  update(partial: Partial<AppConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}

export class FakeLoggerPort implements LoggerPort {
  logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];

  info(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'info', msg, data });
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'error', msg, data });
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'warn', msg, data });
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.logs.push({ level: 'debug', msg, data });
  }
}
