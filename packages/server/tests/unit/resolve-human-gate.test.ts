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
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const postComment = makePostComment();
    const logger = makeLogger();
    const uc = new ResolveHumanGateUseCase(
      runStore as never, stepRunStore as never, orchestrator as never, eventBus as never,
      postComment as never, logger as never,
    );

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
    const stepRun = makeResolvableStepRun();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      makePostComment() as never,
      makeLogger() as never,
    );
    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'unknown' }))
      .rejects.toBeInstanceOf(InvalidGateOutcomeError);
  });

  it('completes the run when outcome matches no edge', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new ResolveHumanGateUseCase(
      runStore as never, stepRunStore as never, orchestrator as never, eventBus as never,
      makePostComment() as never, makeLogger() as never,
    );

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject' });

    expect(run.status).toBe('completed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });

  // ── Decision Trail: persist the human gate comment ─────────────────────────

  it('posts a ticket comment attributed to the workflow step when notes are provided', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM' });

    // WHY: the reviewer must find their rationale later in the thread, rendered like every
    // other workflow step comment (workflow:<workflow> → <step>) with the decision spelled out.
    // Agent authorship is deliberate: it harmonizes the rendering AND keeps any @mention a
    // reviewer types inside their notes inert (agent comments don't create actionable mentions).
    // WHY (body): bold titles, the outcome in italics, and the reason dropped in as-is so the
    // reviewer's own markdown renders. Blocks are blank-line separated because the renderer is
    // GFM without `breaks` (a single newline would collapse onto the previous line — the bug).
    expect(postComment.execute).toHaveBeenCalledTimes(1);
    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 't-1',
      authorType: 'agent',
      authorName: 'workflow:W → Gate',
      visibility: 'public',
      body: '**User decision :** *approve*\n\n**Reason :**\n\nLGTM',
    }));
  });

  it('posts a comment with a fallback reason when notes are absent or blank', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    // WHY: every gate decision must leave a trace in the thread, even with no rationale —
    // otherwise a silent resolve (e.g. a reject loop-back) is impossible to reconstruct later.
    // When the reviewer leaves the reason empty/blank we still post the decision, substituting
    // a "no reason provided" placeholder so the comment renders identically to the with-notes case.
    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject', notes: '   ' });

    expect(postComment.execute).toHaveBeenCalledTimes(1);
    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      authorName: 'workflow:W → Gate',
      body: '**User decision :** *reject*\n\n**Reason :**\n\nno reason provided',
    }));
    expect(run.status).toBe('completed');
  });

  it('posts the fallback reason when notes are entirely omitted', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    // WHY: the `notes` field is optional — an omitted reason must behave exactly like a blank one.
    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve' });

    expect(postComment.execute).toHaveBeenCalledTimes(1);
    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      body: '**User decision :** *approve*\n\n**Reason :**\n\nno reason provided',
    }));
  });

  it('resolves the gate even when posting the comment fails, and logs the error', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = { execute: vi.fn().mockRejectedValue(new Error('comment store down')) };
    const logger = makeLogger();
    const orchestrator = { runStep: vi.fn() };
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      orchestrator as never,
      { emit: vi.fn() } as never,
      postComment as never,
      logger as never,
    );

    // WHY: resolving the gate is the critical operation; the comment is a non-critical
    // side effect. A posting failure must never block the workflow.
    await expect(
      uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM' }),
    ).resolves.toBeUndefined();

    expect(stepRun.status).toBe('completed');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'after');
    expect(logger.error).toHaveBeenCalled();
  });

  it('trims surrounding whitespace from notes so it never leaks into the comment body', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    // WHY: the emptiness check trims, so the body must use the same trimmed value — otherwise
    // leading/trailing newlines from the textarea leak into the rendered comment as blank lines.
    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: '\n\nLGTM\n\n' });

    expect(postComment.execute).toHaveBeenCalledTimes(1);
    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      authorName: 'workflow:W → Gate',
      body: '**User decision :** *approve*\n\n**Reason :**\n\nLGTM',
    }));
  });

  it('passes the reason through untransformed so the reviewer\'s markdown is rendered', async () => {
    const run = makeRun(); run.block();
    const stepRun = makeResolvableStepRun();
    const postComment = makePostComment();
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn(), getByWorkflowRun: vi.fn().mockResolvedValue([]) } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
      makeLogger() as never,
    );

    // WHY: "raw" means untransformed, NOT escaped — the reviewer must be able to write markdown
    // (lists, bold, links) in their reason and see it rendered in the comments view. So the
    // notes are dropped in verbatim, with no code fence or escaping wrapped around them.
    const reason = '**must** fix:\n- one\n- two';
    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject', notes: reason });

    expect(postComment.execute).toHaveBeenCalledWith(expect.objectContaining({
      body: `**User decision :** *reject*\n\n**Reason :**\n\n${reason}`,
    }));
  });
});
