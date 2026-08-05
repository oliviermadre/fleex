import { randomUUID } from 'node:crypto';
import type { CreateRoutineInput } from '@fleex/shared';
import { RoutineEntity } from '../../domain/entities/routine.entity.js';
import { RoutineSlugConflictError } from '../../domain/errors.js';
import { assertTriggerValid, computeNextRunAt } from '../../domain/services/routine-schedule.js';
import { assertRoutineTargetExists, type RoutineTargetStores } from '../services/routine-target-validator.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreateRoutineUseCase {
  constructor(
    private readonly routineStore: RoutineStorePort,
    private readonly targetStores: RoutineTargetStores,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: CreateRoutineInput): Promise<RoutineEntity> {
    await assertRoutineTargetExists(input.target, this.targetStores);

    const trigger = input.trigger ?? { kind: 'manual' as const };
    assertTriggerValid(trigger);

    const routine = RoutineEntity.create({ id: randomUUID(), ...input });
    // Armed at creation, not at the first tick: the scheduler's due query reads
    // `next_run_at`, so a routine without one would never be picked up.
    routine.schedule(computeNextRunAt(trigger, new Date()));

    // The slug is what the URL and the CLI resolve on, so a collision would
    // silently make one of the two routines unreachable.
    const clash = await this.routineStore.getBySlug(routine.slug);
    if (clash) throw new RoutineSlugConflictError(routine.slug);

    await this.routineStore.save(routine);
    this.logger.info('Routine created', { id: routine.id, slug: routine.slug });
    return routine;
  }
}
