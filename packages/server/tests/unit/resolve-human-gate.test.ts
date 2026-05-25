import { describe, it, expect, vi } from 'vitest';
import { ResolveHumanGateUseCase } from '../../src/application/use-cases/resolve-human-gate.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { InvalidGateOutcomeError } from '../../src/domain/errors.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '',
    steps: [
      { id: 'gate', name: 'Gate', executorType: 'human_gate', executorRef: '', humanGateOutcomes: ['approve','reject'], position: { x: 0, y: 0 } },
      { id: 'after', name: 'After', executorType: 'agent', executorRef: 'p', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'gate', target: 'after', isDefault: false, condition: { field: 'outcome', operator: 'eq', value: 'approve' } }],
    entryStepId: 'gate',
  },
  triggeredBy: '@x', triggeredFrom: 'x',
});

describe('ResolveHumanGateUseCase', () => {
  it('writes outcome+notes, completes step_run, resumes orchestrator', async () => {
    const run = makeRun();
    run.block();
    const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    stepRun.start();
    stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });

    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new ResolveHumanGateUseCase(runStore as never, stepRunStore as never, orchestrator as never, eventBus as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM' });

    expect(stepRun.status).toBe('completed');
    expect(stepRun.output?.schemaFields.outcome).toBe('approve');
    expect(stepRun.output?.schemaFields.notes).toBe('LGTM');
    expect(stepRun.nextEdgeId).toBe('e1');
    expect(run.currentStepId).toBe('after');
    expect(run.status).toBe('running');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'after');
  });

  it('rejects unknown outcome', async () => {
    const run = makeRun(); run.block();
    const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
    );
    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'unknown' }))
      .rejects.toBeInstanceOf(InvalidGateOutcomeError);
  });

  it('completes the run when outcome matches no edge', async () => {
    const run = makeRun(); run.block();
    const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new ResolveHumanGateUseCase(runStore as never, stepRunStore as never, orchestrator as never, eventBus as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject' });

    expect(run.status).toBe('completed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });
});
