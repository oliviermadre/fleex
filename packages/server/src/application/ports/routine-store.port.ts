import type { RoutineEntity } from '../../domain/entities/routine.entity.js';

export interface RoutineStorePort {
  getAll(): Promise<RoutineEntity[]>;
  getById(id: string): Promise<RoutineEntity | null>;
  /** Resolves a routine by its slug. Lets the CLI and URLs use `/routines/daily-recap`. */
  getBySlug(slug: string): Promise<RoutineEntity | null>;
  /**
   * Enabled routines whose `next_run_at` has come. Backed by the
   * `(enabled, next_run_at)` index so the 60 s tick stays a single index scan
   * instead of deserialising every routine row.
   */
  getDue(now: Date): Promise<RoutineEntity[]>;
  /** Every enabled routine — used by the scheduler's boot recompute. */
  getEnabled(): Promise<RoutineEntity[]>;
  save(routine: RoutineEntity): Promise<void>;
  delete(id: string): Promise<void>;
}
