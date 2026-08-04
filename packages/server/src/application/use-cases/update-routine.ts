import type { UpdateRoutineInput } from '@fleex/shared';
import type { RoutineEntity } from '../../domain/entities/routine.entity.js';
import { RoutineNotFoundError, WorkflowTemplateNotFoundError } from '../../domain/errors.js';
import { assertTriggerValid, computeNextRunAt } from '../../domain/services/routine-schedule.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';

export class UpdateRoutineUseCase {
  constructor(
    private readonly routineStore: RoutineStorePort,
    private readonly templateStore: WorkflowTemplateStorePort,
  ) {}

  async execute(id: string, changes: UpdateRoutineInput): Promise<RoutineEntity> {
    const routine = await this.routineStore.getById(id);
    if (!routine) throw new RoutineNotFoundError(id);

    if (changes.templateId !== undefined) {
      const template = await this.templateStore.getById(changes.templateId);
      if (!template) throw new WorkflowTemplateNotFoundError(changes.templateId);
    }
    if (changes.trigger !== undefined) assertTriggerValid(changes.trigger);

    // The slug is deliberately NOT recomputed on rename: it is the routine's
    // permalink and its workspace/branch prefix, so changing it would orphan
    // existing worktrees.
    routine.update(changes);

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
