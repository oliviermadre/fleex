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
  agentEventStore: { setExecutionOutputs: vi.fn() },
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
        native: { execute: vi.fn() } as never,
      },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(agentExecutor.execute).toHaveBeenCalledOnce();
    expect(stepRunStore.save).toHaveBeenCalled();
    expect(run.currentStepId).toBe('b');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'b');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_started' }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_completed' }));
  });

  it('tells the executor which steps feed it, so {{ output.* }} can be resolved', async () => {
    // A native step resolving `{{ output.priority }}` has to know its direct
    // predecessor, and only the engine holds the graph. Without this the
    // shorthand could not be implemented anywhere but the engine itself.
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({ output: { schemaFields: {}, result: 'ok' } }) };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: { runStep: vi.fn() } as never, eventBus: { emit: vi.fn() } as never,
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'b' });

    const input = agentExecutor.execute.mock.calls[0]?.[0] as {
      workflowContext: { predecessorStepIds: string[] };
    };
    expect(input.workflowContext.predecessorStepIds).toEqual(['a']);
  });

  it('reports no predecessor for the entry step', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({ output: { schemaFields: {}, result: 'ok' } }) };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: { runStep: vi.fn() } as never, eventBus: { emit: vi.fn() } as never,
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    const input = agentExecutor.execute.mock.calls[0]?.[0] as {
      workflowContext: { predecessorStepIds: string[] };
    };
    expect(input.workflowContext.predecessorStepIds).toEqual([]);
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
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'comment.posted', commentId: 'c-1', ticketId: 't-1', authorType: 'agent', createdMentions: [],
    }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deliverable.created', deliverableId: 'd-1', ticketId: 't-1', status: 'final',
    }));
  });

  // WHY: the read-side (Comments tab deliverable chips + inline Human Gate card)
  // derives artifacts from an explicit execution→comment/deliverable FK instead of
  // pattern-matching on agentName. The orchestrator MUST stamp that FK with the
  // ids it just produced; if it stops doing so, chips silently vanish from the UI.
  it('links the execution to the comment/deliverable it produced via setExecutionOutputs', async () => {
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
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(artifacts.agentEventStore.setExecutionOutputs).toHaveBeenCalledWith('exec-1', {
      commentId: 'c-1', deliverableId: 'd-1',
    });
  });

  // WHY: a human_gate step is deterministic and has no execution row, so there is
  // no FK to stamp. Calling setExecutionOutputs with an undefined executionId would
  // be a no-op at best and a crash at worst — the orchestrator must skip it.
  it('does NOT call setExecutionOutputs when the step produced no execution (deterministic step)', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn(), getLatestForStep: vi.fn().mockResolvedValue(null), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    // No executionId, but the step still emits a comment (e.g. a gate summary).
    const deterministic = { execute: vi.fn().mockResolvedValue({
      output: { schemaFields: {}, result: 'ok', comment: 'Gate note' },
    }) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const artifacts = makeArtifactStubs();
    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: deterministic as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(artifacts.agentEventStore.setExecutionOutputs).not.toHaveBeenCalled();
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
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
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
      agentEventStore: artifacts.agentEventStore as never,
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
      executors: { agent: failing as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
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
      executors: { agent: cancelled as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
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
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(agentExecutor.execute).toHaveBeenCalledOnce();
    // The executionId was persisted while the step was still running (before the
    // completion save), i.e. at least one save saw the live id.
    expect(executionIdAtStart).toContain('exec-live');
  });

  // ── Ambiguous routing ──────────────────────────────────────────────────────

  /** Two edges out of `a`, both matching whatever the step returns. */
  const makeAmbiguousRun = () => WorkflowRunEntity.create({
    id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
    templateSnapshot: {
      name: 'W', emoji: '🔧',
      steps: [
        { id: 'a', name: 'A', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } },
        { id: 'b', name: 'B', executorType: 'agent', executorRef: 'p2', position: { x: 200, y: 0 } },
        { id: 'c', name: 'C', executorType: 'agent', executorRef: 'p3', position: { x: 200, y: 100 } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', isDefault: false, condition: { field: 'result', operator: 'eq', value: 'ok' } },
        { id: 'e2', source: 'a', target: 'c', isDefault: false, condition: { field: 'x', operator: 'eq', value: '1' } },
      ],
      entryStepId: 'a',
    },
    triggeredBy: '@john', triggeredFrom: 'x',
  });

  const runAmbiguous = async () => {
    const run = makeAmbiguousRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const saved: { status: string; output: unknown }[] = [];
    const stepRunStore = {
      save: vi.fn().mockImplementation((sr) => { saved.push({ status: sr.status, output: sr.output }); }),
      getLatestForStep: vi.fn().mockResolvedValue(null),
      getByWorkflowRun: vi.fn().mockResolvedValue([]),
    };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({
      output: { schemaFields: { x: '1' }, result: 'ok', comment: 'done' }, executionId: 'exec-1',
    }) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const artifacts = makeArtifactStubs();

    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never, native: {} as never },
      submitDeliverable: artifacts.submitDeliverable as never,
      postComment: artifacts.postComment as never,
      agentEventStore: artifacts.agentEventStore as never,
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });
    return { run, orchestrator, eventBus, artifacts, saved };
  };

  // WHY: silently taking the oldest matching edge means the run does the opposite
  // of what the author meant, with nothing in the UI to say so. Parking the run
  // makes the config mistake visible exactly once, then resolvable by hand.
  it('parks the run instead of guessing when several edges match', async () => {
    const { run, orchestrator, eventBus, saved } = await runAmbiguous();

    // The run reuses the existing "waiting on a human" status rather than
    // introducing a new one — it is blocked in exactly the same way as a gate.
    expect(run.status).toBe('needs_review');
    expect(run.currentStepId).toBe('a');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.awaiting_routing', candidateEdgeIds: ['e1', 'e2'],
    }));
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_completed' }));

    const parked = saved.at(-1);
    expect(parked?.status).toBe('awaiting_routing');
    // WHY: the candidates are what the engine saw, persisted so the resolve
    // endpoint never has to re-derive them from a template that may have changed.
    expect((parked?.output as { routing?: { candidateEdgeIds: string[] } })?.routing?.candidateEdgeIds)
      .toEqual(['e1', 'e2']);
    // WHY: the step itself succeeded — only its exit is undecided.
    expect((parked?.output as { result: string })?.result).toBe('ok');
  });

  // WHY: the human arbitrating the branch needs to read what the step produced.
  // Holding the artifacts back until the route is picked would make the decision
  // blind.
  it('persists the step artifacts before parking on an ambiguity', async () => {
    const { artifacts } = await runAmbiguous();
    expect(artifacts.postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      body: 'done',
    }));
  });
});
