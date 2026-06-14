import { describe, it, expect, vi } from 'vitest';
import { RunWorkflowStepUseCase } from '../../src/application/use-cases/run-workflow-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { ExecutionCancelledError } from '../../src/domain/errors.js';

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
  submitDeliverable: { execute: vi.fn().mockResolvedValue({ id: 'd-1' }) },
  postComment: { execute: vi.fn().mockResolvedValue({ comment: { id: 'c-1' }, createdMentions: [] }) },
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

  it('emits comment.posted and deliverable.created for real-time UI broadcast when a step produces artifacts', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({
      output: {
        schemaFields: {}, result: 'ok',
        comment: 'Step done',
        deliverable: { type: 'report', title: 'T', markdown: '# T', status: 'final' },
      },
      executionId: 'exec-1',
    }) };
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

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'comment.posted', commentId: 'c-1', ticketId: 't-1', authorType: 'agent', createdMentions: [],
    }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deliverable.created', deliverableId: 'd-1', ticketId: 't-1', status: 'final',
    }));
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

  // WHY: a user-initiated Terminate/cancel/force-restart surfaces as
  // ExecutionCancelledError. That is NOT a failure — failing the run here would
  // emit a spurious `workflow.run_failed` after a deliberate cancel (AC7) and
  // could clobber a `cancelled` run status with `failed`.
  it('does NOT fail the run when the step execution is cancelled (interruption ≠ failure)', async () => {
    const run = makeRun();
    const savedStepRuns: { status: string }[] = [];
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = {
      save: vi.fn().mockImplementation((sr) => { savedStepRuns.push({ status: sr.status }); }),
      getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]),
    };
    const cancelled = { execute: vi.fn().mockRejectedValue(new ExecutionCancelledError('exec-1')) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: cancelled as never, skill: {} as never, panel: {} as never, human_gate: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).not.toBe('failed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_failed' }));
    // The step_run is left `cancelled`, never `running`.
    expect(savedStepRuns.at(-1)?.status).toBe('cancelled');
    // WHY (#320 follow-up): a `workflow.step_cancelled` event MUST be emitted so
    // the Workflow view refreshes live. Without it the UI stays on "running"
    // until a manual page refresh.
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.step_cancelled', workflowRunId: 'run-1', stepId: 'a',
    }));
  });

  // WHY: cancel/terminate of an in-flight step needs the live executionId. If we
  // only persisted it at completion, there would be nothing to abort mid-run
  // (AC5). The executor must receive an onExecutionStarted callback that the
  // orchestrator uses to save step_run.executionId immediately.
  it('persists step_run.executionId live via onExecutionStarted before completion', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const executionIdAtStart: (string | null)[] = [];
    const stepRunStore = {
      save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]),
    };
    const agentExecutor = {
      execute: vi.fn().mockImplementation(async (input) => {
        await input.onExecutionStarted?.('exec-live');
        return { output: { schemaFields: {}, result: 'ok' }, executionId: 'exec-live' };
      }),
    };
    // Capture what executionId the step_run carried at the moment onExecutionStarted saved it.
    stepRunStore.save.mockImplementation((sr) => { executionIdAtStart.push(sr.executionId); });
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

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(agentExecutor.execute).toHaveBeenCalledOnce();
    // The executionId was persisted while the step was still running (before the
    // completion save), i.e. at least one save saw the live id.
    expect(executionIdAtStart).toContain('exec-live');
  });
});
