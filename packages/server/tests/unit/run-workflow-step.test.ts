import { describe, it, expect, vi } from 'vitest';
import { RunWorkflowStepUseCase } from '../../src/application/use-cases/run-workflow-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '🔧',
    steps: [
      { id: 'a', name: 'A', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } },
      { id: 'b', name: 'B', executorType: 'agent', executorRef: 'p2', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', isDefault: true }],
    entryStepId: 'a',
  },
  triggeredBy: '@john', triggeredFrom: 'x',
});

const makeArtifactStubs = () => ({
  submitDeliverable: { execute: vi.fn().mockResolvedValue({}) },
  postComment: { execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }) },
});

describe('RunWorkflowStepUseCase', () => {
  it('executes step, persists step_run with output, advances to next step', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({
      output: { schemaFields: {}, result: 'ok' }, executionId: 'exec-1',
    }) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never,
      stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never,
      eventBus: eventBus as never,
      executors: {
        agent: agentExecutor as never,
        skill: { execute: vi.fn() } as never,
        panel: { execute: vi.fn() } as never,
        human_gate: { execute: vi.fn() } as never,
      },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(agentExecutor.execute).toHaveBeenCalledOnce();
    expect(stepRunStore.save).toHaveBeenCalled();
    expect(run.currentStepId).toBe('b');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'b');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_started' }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_completed' }));
  });

  it('completes the run when no outgoing edges match', async () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
      templateSnapshot: { name: 'W', emoji: '', steps: [{ id: 'final', name: 'F', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } }], edges: [], entryStepId: 'final' },
      triggeredBy: '@john', triggeredFrom: 'x',
    });
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({ output: { schemaFields: {}, result: 'ok' }, executionId: 'e' }) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'final' });

    expect(run.status).toBe('completed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_completed' }));
  });

  it('marks run needs_review when step returns result=needs_review', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const humanGate = { execute: vi.fn().mockResolvedValue({ output: { schemaFields: { outcomes: ['approve'] }, result: 'needs_review' } }) };
    run.templateSnapshot.steps[0]!.executorType = 'human_gate';
    run.templateSnapshot.steps[0]!.humanGateOutcomes = ['approve'];

    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: {} as never, skill: {} as never, panel: {} as never, human_gate: humanGate as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('needs_review');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });

  it('fails the run when executor throws', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const failing = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: failing as never, skill: {} as never, panel: {} as never, human_gate: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('failed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_failed' }));
  });
});
