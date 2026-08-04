import { randomUUID } from 'node:crypto';
import type { CreateRoutineInput } from '@fleex/shared';
import { RoutineEntity } from '../../domain/entities/routine.entity.js';
import {
  RoutineSlugConflictError,
  RoutineTriggerNotSupportedError,
  WorkflowTemplateNotFoundError,
} from '../../domain/errors.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Scheduling is not wired yet (Lot 3). Accepting a `once` / `cron` trigger here
 * would persist a routine that silently never fires — worse than a rejection,
 * because the user would believe it is armed.
 */
export function assertTriggerSupported(kind: string): void {
  if (kind !== 'manual') throw new RoutineTriggerNotSupportedError(kind);
}

export class CreateRoutineUseCase {
  constructor(
    private readonly routineStore: RoutineStorePort,
    private readonly templateStore: WorkflowTemplateStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: CreateRoutineInput): Promise<RoutineEntity> {
    const template = await this.templateStore.getById(input.templateId);
    if (!template) throw new WorkflowTemplateNotFoundError(input.templateId);

    assertTriggerSupported(input.trigger?.kind ?? 'manual');

    const routine = RoutineEntity.create({ id: randomUUID(), ...input });

    // The slug is what the URL and the CLI resolve on, so a collision would
    // silently make one of the two routines unreachable.
    const clash = await this.routineStore.getBySlug(routine.slug);
    if (clash) throw new RoutineSlugConflictError(routine.slug);

    await this.routineStore.save(routine);
    this.logger.info('Routine created', { id: routine.id, slug: routine.slug });
    return routine;
  }
}
