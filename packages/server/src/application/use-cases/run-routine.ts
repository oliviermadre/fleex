import type { WorkflowTemplateSnapshot } from '@fleex/shared';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { RoutineEntity } from '../../domain/entities/routine.entity.js';
import { RoutineNotFoundError } from '../../domain/errors.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { EventBus } from '../event-bus.js';
import type { CreateWorkflowRunUseCase } from './create-workflow-run.js';

/**
 * Launches a routine: creates the workflow run anchored to the routine (never
 * to a ticket) and records it on the routine so the list view can show
 * "last run".
 *
 * The subject is snapshotted into the run rather than read back from the
 * routine at each step: editing a routine while it runs must not retarget the
 * run mid-flight.
 *
 * A routine may target a workflow template *or* a single agentic primitive
 * (agent / skill / panel). The primitive case is not a separate execution
 * pipeline: the routine fabricates a one-step template snapshot at launch and
 * everything downstream — orchestrator, step executors, run history,
 * deliverable attribution, needs_review — applies unchanged.
 *
 * `routine.run_started` is emitted here rather than in the scheduler: this is
 * the single door every launch goes through (scheduler, Launch button, API,
 * CLI). Emitting it from the scheduler only — as it used to be — meant the
 * audit trail recorded `routine.run_completed` for manual launches but never
 * the matching `run_started`, leaving half of every routine's history missing.
 */
export class RunRoutineUseCase {
  constructor(
    private readonly routineStore: RoutineStorePort,
    private readonly createWorkflowRun: CreateWorkflowRunUseCase,
    private readonly eventBus?: EventBus,
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
      ...(routine.target.kind === 'workflow'
        ? { templateId: routine.target.ref }
        : { templateId: null, templateSnapshot: synthesizePrimitiveSnapshot(routine) }),
      triggeredBy: params.triggeredBy,
      triggeredFrom: params.triggeredFrom,
    });

    routine.recordRun(run.id);
    await this.routineStore.save(routine);

    // A scheduled launch reports the schedule that fired it; anything else is a
    // human pressing Launch, whatever the routine's own trigger says.
    this.eventBus?.emit({
      type: 'routine.run_started',
      routineId: routine.id,
      routineSlug: routine.slug,
      workflowRunId: run.id,
      triggerKind: params.triggeredFrom === 'schedule' ? routine.trigger.kind : 'manual',
      occurredAt: new Date(),
    });

    return run;
  }
}

/**
 * The one-step "template" a primitive-target routine runs. The step's
 * `executorRef` is the primitive's name — exactly how a hand-authored workflow
 * step would reference it — so the existing step executors resolve it with no
 * special casing. The brief keeps flowing through the run's subject snapshot,
 * composing with the primitive's own prompts (persona soul, skill markdown,
 * panel member prompts) downstream.
 */
export function synthesizePrimitiveSnapshot(routine: RoutineEntity): WorkflowTemplateSnapshot {
  return {
    name: routine.name,
    emoji: routine.emoji,
    steps: [{
      id: 'primitive',
      name: routine.target.ref,
      executorType: routine.target.kind as 'agent' | 'skill' | 'panel',
      executorRef: routine.target.ref,
      position: { x: 0, y: 0 },
    }],
    edges: [],
    entryStepId: 'primitive',
  };
}
