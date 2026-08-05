import type { RoutineEntity } from '../../domain/entities/routine.entity.js';

/**
 * A bid to fire one scheduled occurrence.
 *
 * `observedNextRunAt` is the witness: the value the caller read in
 * {@link RoutineStorePort.getDue}. The store applies the write only if the row
 * still carries it, which is what makes the claim a compare-and-swap and lets
 * exactly one instance out of N take the occurrence.
 */
export interface RoutineClaim {
  id: string;
  /** The `next_run_at` the caller observed. The CAS fails if it moved. */
  observedNextRunAt: Date;
  /** Where the occurrence is re-armed. Null disarms it (a spent one-shot). */
  nextRunAt: Date | null;
  /** Also flips `enabled` off, atomically — a `once` that has now been used. */
  disable?: boolean;
  /** Recorded on the row so the UI can say which machine took the occurrence. */
  claimedBy: string;
  claimedAt: Date;
}

export interface RoutineStorePort {
  getAll(): Promise<RoutineEntity[]>;
  getById(id: string): Promise<RoutineEntity | null>;
  /** Resolves a routine by its slug. Lets the CLI and URLs use `/routines/daily-recap`. */
  getBySlug(slug: string): Promise<RoutineEntity | null>;
  /**
   * Enabled routines whose `next_run_at` has come. Backed by the
   * `(enabled, next_run_at)` index so the 60 s tick stays a single index scan
   * instead of deserialising every routine row.
   *
   * A hit is a *candidate*, never a permission: several instances sharing this
   * storage all see the same due row. {@link claimDue} is what settles it.
   */
  getDue(now: Date): Promise<RoutineEntity[]>;
  /** Every enabled routine — used by the scheduler's boot recompute. */
  getEnabled(): Promise<RoutineEntity[]>;
  /**
   * Atomically take a due occurrence: advance `next_run_at` away from the
   * observed value and stamp the claimant. Returns true when this process won
   * — and only the winner may launch.
   *
   * This is deliberately not expressible as `save()`: `save()` is a full-row
   * upsert, so two instances writing concurrently would clobber each other's
   * `last_run_id`, and reading-then-writing could never be atomic anyway.
   */
  claimDue(claim: RoutineClaim): Promise<boolean>;
  /**
   * Narrow, unconditional write of `next_run_at` — the boot recompute's only
   * write. Narrow for the same reason as {@link claimDue}: a booting instance
   * must not push a whole row that a sibling has since moved on from.
   */
  rearm(id: string, nextRunAt: Date | null): Promise<void>;
  save(routine: RoutineEntity): Promise<void>;
  delete(id: string): Promise<void>;
}
