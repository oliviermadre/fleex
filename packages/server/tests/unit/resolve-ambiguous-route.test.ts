import { describe, it, expect, vi } from 'vitest';
import { ResolveAmbiguousRouteUseCase } from '../../src/application/use-cases/resolve-ambiguous-route.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { InvalidRouteEdgeError, StepNotAwaitingRoutingError } from '../../src/domain/errors.js';

/**
 * Arbitrating an ambiguity is a decision only a human can make, and the run is
 * frozen until they do. These tests pin the three things that make that safe:
 * the choice is limited to what the engine actually offered, it can only happen
 * once, and the reasoning ends up in the thread.
 */

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '',
    steps: [
      { id: 'a', name: 'Triage', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } },
      { id: 'fix', name: 'Fix', executorType: 'agent', executorRef: 'p', position: { x: 200, y: 0 } },
      { id: 'spec', name: 'Spec', executorType: 'agent', executorRef: 'p', position: { x: 200, y: 100 } },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'fix', isDefault: false, condition: { field: 'x', operator: 'eq', value: 'a' } },
      { id: 'e2', source: 'a', target: 'spec', isDefault: false, condition: { field: 'y', operator: 'eq', value: 'b' } },
    ],
    entryStepId: 'a',
  },
  triggeredBy: '@x', triggeredFrom: 'x',
});

const makeParkedStepRun = () => {
  const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'a' });
  stepRun.start();
  stepRun.markAwaitingRouting({
    output: { schemaFields: { verdict: 'both' }, result: 'ok' },
    candidateEdgeIds: ['e1', 'e2'],
  });
  return stepRun;
};

const makePostComment = () => ({ execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }) });
const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const makeUseCase = (over: {
  run: WorkflowRunEntity;
  stepRun: StepRunEntity;
  orchestrator?: { runStep: ReturnType<typeof vi.fn> };
  eventBus?: { emit: ReturnType<typeof vi.fn> };
  postComment?: ReturnType<typeof makePostComment>;
  logger?: ReturnType<typeof makeLogger>;
}) => {
  const orchestrator = over.orchestrator ?? { runStep: vi.fn() };
  const eventBus = over.eventBus ?? { emit: vi.fn() };
  const postComment = over.postComment ?? makePostComment();
  const logger = over.logger ?? makeLogger();
  const uc = new ResolveAmbiguousRouteUseCase(
    { getById: vi.fn().mockResolvedValue(over.run), save: vi.fn() } as never,
    { getById: vi.fn().mockResolvedValue(over.stepRun), save: vi.fn() } as never,
    orchestrator as never, eventBus as never, postComment as never, logger as never,
  );
  return { uc, orchestrator, eventBus, postComment, logger };
};

describe('ResolveAmbiguousRouteUseCase', () => {
  it('takes the chosen edge, completes the step and resumes the run', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeParkedStepRun();
    const { uc, orchestrator, eventBus } = makeUseCase({ run, stepRun });

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', edgeId: 'e2', notes: 'spec first' });

    expect(stepRun.status).toBe('completed');
    expect(stepRun.nextEdgeId).toBe('e2');
    expect(stepRun.output?.routing?.chosenEdgeId).toBe('e2');
    expect(run.currentStepId).toBe('spec');
    expect(run.status).toBe('running');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'spec');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.step_completed', nextEdgeId: 'e2',
    }));
  });

  it('keeps the step result and schemaFields intact so later conditions still read them', async () => {
    // WHY: the step *succeeded* — only its exit was undecided. Overwriting
    // `result` (the trap `markNeedsReview` falls into) would silently change the
    // answer every downstream edge condition gets.
    const run = makeRun(); run.block();
    const stepRun = makeParkedStepRun();
    const { uc } = makeUseCase({ run, stepRun });

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', edgeId: 'e1' });

    expect(stepRun.result).toBe('ok');
    expect(stepRun.output?.result).toBe('ok');
    expect(stepRun.output?.schemaFields).toEqual({ verdict: 'both' });
  });

  it('refuses an edge the engine never offered', async () => {
    // WHY: candidates are read from what was persisted when the run paused, not
    // recomputed — otherwise editing the template mid-run would silently widen
    // (or invalidate) the set of branches a reviewer can take.
    const run = makeRun(); run.block();
    const stepRun = makeParkedStepRun();
    stepRun.output = { ...stepRun.output!, routing: { candidateEdgeIds: ['e1'] } };
    const { uc } = makeUseCase({ run, stepRun });

    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', edgeId: 'e2' }))
      .rejects.toBeInstanceOf(InvalidRouteEdgeError);
  });

  it('refuses to route a step that is not awaiting routing', async () => {
    // WHY: two reviewers clicking at once, or a stale card in an open tab. The
    // second resolve would advance the run a second time and fork it.
    const run = makeRun();
    const stepRun = makeParkedStepRun();
    stepRun.resolveRoute({ edgeId: 'e1', decidedBy: 'someone' });
    const { uc } = makeUseCase({ run, stepRun });

    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', edgeId: 'e2' }))
      .rejects.toBeInstanceOf(StepNotAwaitingRoutingError);
  });

  it('leaves a decision trail attributed to the workflow step', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeParkedStepRun();
    const { uc, postComment } = makeUseCase({ run, stepRun });

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', edgeId: 'e2', notes: 'spec first' });

    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 't-1',
      authorType: 'agent',
      authorName: 'workflow:W → Triage',
      body: expect.stringContaining('**Route chosen :**'),
    }));
    expect(postComment.execute.mock.calls[0]?.[0].body).toContain('spec first');
  });

  it('routes the run even when posting the comment fails', async () => {
    // WHY: the comment is a trace, the routing is the operation. A comment store
    // outage must not leave the run frozen forever.
    const run = makeRun(); run.block();
    const stepRun = makeParkedStepRun();
    const postComment = { execute: vi.fn().mockRejectedValue(new Error('down')) };
    const { uc, orchestrator, logger } = makeUseCase({ run, stepRun, postComment: postComment as never });

    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', edgeId: 'e1' }))
      .resolves.toBeUndefined();

    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'fix');
    expect(logger.error).toHaveBeenCalled();
  });
});
