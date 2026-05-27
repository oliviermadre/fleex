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

const makePostComment = () => ({
  execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }),
});

const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const makeResolvableStepRun = () => {
  const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
  stepRun.start();
  stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
  return stepRun;
};

describe('ResolveHumanGateUseCase', () => {
  it('writes outcome+notes, completes step_run, resumes orchestrator', async () => {
    const run = makeRun();
    run.block();
    const stepRun = makeResolvableStepRun();

    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const postComment = makePostComment();
    const logger = makeLogger();
    const uc = new ResolveHumanGateUseCase(
      runStore as never, stepRunStore as never, orchestrator as never, eventBus as never,
      postComment as never, logger as never,
    );

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM', authorName: 'alice' });

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
    const stepRun = makeResolvableStepRun();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      makePostComment() as never,
      makeLogger() as never,
    );
    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'unknown', authorName: 'alice' }))
      .rejects.toBeInstanceOf(InvalidGateOutcomeError);
  });

  it('completes the run when outcome matches no edge', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new ResolveHumanGateUseCase(
      runStore as never, stepRunStore as never, orchestrator as never, eventBus as never,
      makePostComment() as never, makeLogger() as never,
    );

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject', authorName: 'alice' });

    expect(run.status).toBe('completed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });

  // ── Decision Trail: persist the human gate comment ─────────────────────────

  it('posts a ticket comment authored by the user when notes are provided', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM', authorName: 'alice' });

    // WHY: the reviewer must be able to find their rationale later, in the ticket thread,
    // attributed to them, with the gate + outcome as context.
    expect(postComment.execute).toHaveBeenCalledTimes(1);
    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 't-1',
      authorType: 'user',
      authorName: 'alice',
      visibility: 'public',
      body: 'via workflow:Gate [approve] :\nLGTM',
    }));
  });

  it('does not post any comment when notes are absent or blank', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    // WHY: an outcome with no note carries no rationale — posting an empty comment is noise.
    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject', notes: '   ', authorName: 'alice' });

    expect(postComment.execute).not.toHaveBeenCalled();
    expect(run.status).toBe('completed');
  });

  it('resolves the gate even when posting the comment fails, and logs the error', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = { execute: vi.fn().mockRejectedValue(new Error('comment store down')) };
    const logger = makeLogger();
    const orchestrator = { runStep: vi.fn() };
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      orchestrator as never,
      { emit: vi.fn() } as never,
      postComment as never,
      logger as never,
    );

    // WHY: resolving the gate is the critical operation; the comment is a non-critical
    // side effect. A posting failure must never block the workflow.
    await expect(
      uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM', authorName: 'alice' }),
    ).resolves.toBeUndefined();

    expect(stepRun.status).toBe('completed');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'after');
    expect(logger.error).toHaveBeenCalled();
  });

  it('never drops the user words: falls back to a clear author when identity is blank', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    // WHY (OQ-3): the bug we fix is "the words disappear". If identity is unavailable we
    // still post — with a clear fallback author — rather than swallowing the comment.
    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM', authorName: '' });

    expect(postComment.execute).toHaveBeenCalledTimes(1);
    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      authorName: 'system',
      body: 'via workflow:Gate [approve] :\nLGTM',
    }));
  });
});
