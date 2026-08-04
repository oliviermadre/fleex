import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import { RoutineNotFoundError } from '../../domain/errors.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { CreateWorkflowRunUseCase } from './create-workflow-run.js';

/**
 * Launches a routine: creates the workflow run anchored to the routine (never
 * to a ticket) and records it on the routine so the list view can show
 * "last run".
 *
 * The subject is snapshotted into the run rather than read back from the
 * routine at each step: editing a routine while it runs must not retarget the
 * run mid-flight.
 */
export class RunRoutineUseCase {
  constructor(
    private readonly routineStore: RoutineStorePort,
    private readonly createWorkflowRun: CreateWorkflowRunUseCase,
  ) {}

  async execute(params: {
    routineId: string;
    triggeredBy: string;
    triggeredFrom: string;
  }): Promise<WorkflowRunEntity> {
    const routine = await this.routineStore.getById(params.routineId);
    if (!routine) throw new RoutineNotFoundError(params.routineId);

    const run = await this.createWorkflowRun.execute({
      routineId: routine.id,
      subjectSnapshot: routine.subject,
      templateId: routine.templateId,
      triggeredBy: params.triggeredBy,
      triggeredFrom: params.triggeredFrom,
    });

    routine.recordRun(run.id);
    await this.routineStore.save(routine);

    return run;
  }
}
