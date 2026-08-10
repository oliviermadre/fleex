import type { UpdateRoutineInput } from '@fleex/shared';
import type { RoutineEntity } from '../../domain/entities/routine.entity.js';
import { RoutineNotFoundError } from '../../domain/errors.js';
import { assertTriggerValid, computeNextRunAt } from '../../domain/services/routine-schedule.js';
import { assertRoutineTargetExists, type RoutineTargetStores } from '../services/routine-target-validator.js';
import { mintWebhookSecret } from '../services/webhook-secret.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';

export class UpdateRoutineUseCase {
  constructor(
    private readonly routineStore: RoutineStorePort,
    private readonly targetStores: RoutineTargetStores,
  ) {}

  async execute(id: string, changes: UpdateRoutineInput): Promise<RoutineEntity> {
    const routine = await this.routineStore.getById(id);
    if (!routine) throw new RoutineNotFoundError(id);

    if (changes.target !== undefined) {
      await assertRoutineTargetExists(changes.target, this.targetStores);
    }
    if (changes.trigger !== undefined) assertTriggerValid(changes.trigger);

    // The slug is deliberately NOT recomputed on rename: it is the routine's
    // permalink and its workspace/branch prefix, so changing it would orphan
    // existing worktrees.
    routine.update(changes);

    if (changes.webhookEnabled !== undefined) {
      // Off keeps the secret dormant, so re-enabling never invalidates a URL a
      // sender already configured — see `RoutineEntity.disableWebhook`.
      if (changes.webhookEnabled) routine.enableWebhook(mintWebhookSecret);
      else routine.disableWebhook();
    }

    // Re-arm whenever the schedule *or* the enabled flag moved: re-enabling a
    // routine whose `next_run_at` is months old would otherwise fire it on the
    // very next tick, which is not what "resume" means.
    if (changes.trigger !== undefined || changes.enabled !== undefined) {
      routine.schedule(routine.enabled ? computeNextRunAt(routine.trigger, new Date()) : null);
    }

    await this.routineStore.save(routine);
    return routine;
  }
}

export class DeleteRoutineUseCase {
  constructor(private readonly routineStore: RoutineStorePort) {}

  async execute(id: string): Promise<void> {
    const routine = await this.routineStore.getById(id);
    if (!routine) throw new RoutineNotFoundError(id);
    await this.routineStore.delete(id);
  }
}
