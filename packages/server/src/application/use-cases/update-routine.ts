import type { UpdateRoutineInput } from '@fleex/shared';
import type { RoutineEntity } from '../../domain/entities/routine.entity.js';
import { RoutineNotFoundError, WorkflowTemplateNotFoundError } from '../../domain/errors.js';
import { assertTriggerSupported } from './create-routine.js';
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
    if (changes.trigger !== undefined) assertTriggerSupported(changes.trigger.kind);

    // The slug is deliberately NOT recomputed on rename: it is the routine's
    // permalink and its workspace/branch prefix, so changing it would orphan
    // existing worktrees.
    routine.update(changes);
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
