import { EdgeEvaluator } from '../services/edge-evaluator.js';
import {
  WorkflowRunNotFoundError, StepRunNotFoundError, InvalidGateOutcomeError,
} from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from '../ports/orchestrator.port.js';
import type { EventBus } from '../event-bus.js';

export class ResolveHumanGateUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(params: {
    workflowRunId: string;
    stepRunId: string;
    outcome: string;
    notes?: string;
  }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    const step = run.findStep(stepRun.stepId);
    if (!step || step.executorType !== 'human_gate') {
      throw new Error(`step "${stepRun.stepId}" is not a human_gate`);
    }

    const allowed = step.humanGateOutcomes ?? [];
    if (!allowed.includes(params.outcome)) {
      throw new InvalidGateOutcomeError(params.outcome, allowed);
    }

    stepRun.resolveGate(params.outcome, params.notes);

    const edges = run.outgoingEdges(step.id);
    const nextEdge = EdgeEvaluator.resolve(stepRun.output!, edges);
    stepRun.nextEdgeId = nextEdge?.id ?? null;
    await this.stepRunStore.save(stepRun);

    this.eventBus.emit({
      type: 'workflow.step_completed', workflowRunId: run.id, stepRunId: stepRun.id,
      stepId: step.id, ticketId: run.ticketId, nextEdgeId: nextEdge?.id ?? null, occurredAt: new Date(),
    });

    if (nextEdge) {
      run.advanceTo(nextEdge.target);
      await this.runStore.save(run);
      this.orchestrator.runStep(run.id, nextEdge.target);
    } else {
      run.complete();
      await this.runStore.save(run);
      this.eventBus.emit({
        type: 'workflow.run_completed', workflowRunId: run.id, ticketId: run.ticketId, occurredAt: new Date(),
      });
    }
  }
}
