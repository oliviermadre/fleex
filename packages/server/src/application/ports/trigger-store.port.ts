import type { TriggerEntity } from '../../domain/entities/trigger.entity.js';

export interface TriggerStorePort {
  getById(id: string): Promise<TriggerEntity | null>;
  getBySlug(slug: string): Promise<TriggerEntity | null>;
  getAll(): Promise<TriggerEntity[]>;
  save(trigger: TriggerEntity): Promise<void>;
  delete(id: string): Promise<void>;

  /**
   * Atomically claim all enabled triggers due at `now`, advancing each one's
   * next_run_at via `computeNext` so concurrent server instances never
   * double-fire the same occurrence. Returns the claimed triggers (with their
   * PREVIOUS next_run_at exposed as `scheduledFor` on the caller side).
   */
  claimDue(now: Date, computeNext: (t: TriggerEntity, from: Date) => Date | null): Promise<ClaimedTrigger[]>;
}

export interface ClaimedTrigger {
  trigger: TriggerEntity;
  /** The occurrence time that was claimed (the previous next_run_at). */
  scheduledFor: Date;
}
