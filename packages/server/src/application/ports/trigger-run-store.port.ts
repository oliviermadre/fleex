import type { TriggerRunEntity } from '../../domain/entities/trigger-run.entity.js';

export interface TriggerRunStorePort {
  getById(id: string): Promise<TriggerRunEntity | null>;
  getByTrigger(triggerId: string, limit?: number): Promise<TriggerRunEntity[]>;
  /** All runs currently in the 'running' state — used for crash recovery. */
  getRunning(): Promise<TriggerRunEntity[]>;
  save(run: TriggerRunEntity): Promise<void>;
}
