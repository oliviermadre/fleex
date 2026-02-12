import type { SessionEntity } from '../../domain/entities.js';

export interface SessionStorePort {
  save(session: SessionEntity): Promise<void>;
  remove(sessionId: string): Promise<void>;
  getAll(): Promise<SessionEntity[]>;
  getById(id: string): Promise<SessionEntity | null>;
  getByTmuxName(name: string): Promise<SessionEntity | null>;
  getByCwd(cwd: string): Promise<SessionEntity[]>;
}
