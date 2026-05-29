import { TriggerNotFoundError } from '../../domain/errors.js';
import type { TriggerEntity } from '../../domain/entities/trigger.entity.js';
import type { TriggerStorePort } from '../ports/trigger-store.port.js';
import type { UpdateTriggerInput } from '@fleex/shared';

export class UpdateTriggerUseCase {
  constructor(private readonly store: TriggerStorePort) {}

  async execute(id: string, input: UpdateTriggerInput): Promise<TriggerEntity> {
    const trigger = await this.store.getById(id);
    if (!trigger) throw new TriggerNotFoundError(id);

    if (input.name !== undefined) trigger.name = input.name;
    if (input.emoji !== undefined) trigger.emoji = input.emoji;
    if (input.description !== undefined) trigger.description = input.description;
    if (input.descriptionMd !== undefined) trigger.descriptionMd = input.descriptionMd;
    if (input.targetType !== undefined) trigger.targetType = input.targetType;
    if (input.targetRef !== undefined) trigger.targetRef = input.targetRef;
    if (input.mode !== undefined) trigger.mode = input.mode;

    const scheduleChanged = input.config !== undefined;
    if (input.config !== undefined) trigger.config = input.config;

    const wasEnabled = trigger.enabled;
    if (input.enabled !== undefined) trigger.enabled = input.enabled;

    trigger.updatedAt = new Date();
    trigger.validate();

    // Re-seed next_run_at when the schedule changed or the trigger was just
    // (re-)enabled; clear it when disabled.
    if (!trigger.enabled) {
      trigger.nextRunAt = null;
    } else if (scheduleChanged || !wasEnabled || trigger.nextRunAt === null) {
      trigger.nextRunAt = trigger.computeNextRun(new Date());
    }

    await this.store.save(trigger);
    return trigger;
  }
}
