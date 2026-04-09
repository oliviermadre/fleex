import type { SessionEntity } from '../../domain/entities.js';
import type { SessionStorePort } from '../../application/ports/session-store.port.js';

/**
 * Write-through in-memory cache over any SessionStorePort.
 * Hot path (getAll, getById, getByTmuxName) never touches the DB.
 */
export class CachedSessionStore implements SessionStorePort {
  private byId = new Map<string, SessionEntity>();
  private byTmux = new Map<string, SessionEntity>();
  private warmedUp = false;

  constructor(private readonly inner: SessionStorePort) {}

  async warmUp(): Promise<void> {
    const all = await this.inner.getAll();
    this.byId.clear();
    this.byTmux.clear();
    for (const s of all) {
      this.byId.set(s.id, s);
      this.byTmux.set(s.tmuxName, s);
    }
    this.warmedUp = true;
  }

  async save(session: SessionEntity): Promise<void> {
    await this.inner.save(session);
    this.byId.set(session.id, session);
    this.byTmux.set(session.tmuxName, session);
  }

  async remove(sessionId: string): Promise<void> {
    const session = this.byId.get(sessionId);
    await this.inner.remove(sessionId);
    this.byId.delete(sessionId);
    if (session) this.byTmux.delete(session.tmuxName);
  }

  async getAll(): Promise<SessionEntity[]> {
    if (!this.warmedUp) await this.warmUp();
    return [...this.byId.values()];
  }

  async getById(id: string): Promise<SessionEntity | null> {
    if (!this.warmedUp) await this.warmUp();
    return this.byId.get(id) ?? null;
  }

  async getByTmuxName(name: string): Promise<SessionEntity | null> {
    if (!this.warmedUp) await this.warmUp();
    return this.byTmux.get(name) ?? null;
  }

  async getByCwd(cwd: string): Promise<SessionEntity[]> {
    if (!this.warmedUp) await this.warmUp();
    return [...this.byId.values()].filter((s) => s.cwd === cwd);
  }
}
