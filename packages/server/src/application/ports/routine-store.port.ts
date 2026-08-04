import type { RoutineEntity } from '../../domain/entities/routine.entity.js';

export interface RoutineStorePort {
  getAll(): Promise<RoutineEntity[]>;
  getById(id: string): Promise<RoutineEntity | null>;
  /** Resolves a routine by its slug. Lets the CLI and URLs use `/routines/daily-recap`. */
  getBySlug(slug: string): Promise<RoutineEntity | null>;
  save(routine: RoutineEntity): Promise<void>;
  delete(id: string): Promise<void>;
}
