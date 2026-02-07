import type { SessionEntity } from '../../domain/entities.js';

export interface SessionStorePort {
  save(session: SessionEntity): void;
  remove(sessionId: string): void;
  getAll(): SessionEntity[];
  getById(id: string): SessionEntity | null;
  getByTmuxName(name: string): SessionEntity | null;
  getByCwd(cwd: string): SessionEntity[];
}
