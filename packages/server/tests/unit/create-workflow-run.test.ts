import { describe, it, expect, vi } from 'vitest';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import {
  WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError, WorkflowRunDepthExceededError,
} from '../../src/domain/errors.js';

const template = WorkflowTemplateEntity.create({
  id: 'tmpl-1', name: 'X', slug: 'x',
  steps: [{ id: 'triage', name: 'Triage', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } }],
  edges: [], entryStepId: 'triage',
});

describe('CreateWorkflowRunUseCase', () => {
  it('creates a run from a template by id and enqueues first step', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(template) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const postComment = { execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }) };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, orchestrator as never, eventBus as never, postComment as never);

    const run = await uc.execute({ ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: '@john', triggeredFrom: 'comment:c-1' });

    expect(run).toBeInstanceOf(WorkflowRunEntity);
    expect(run.status).toBe('running');
    expect(run.currentStepId).toBe('triage');
    expect(runStore.save).toHaveBeenCalledOnce();
    expect(orchestrator.runStep).toHaveBeenCalledWith(run.id, 'triage');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_created' }));
  });

  it('throws WorkflowRunAlreadyActiveError if a run is active', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(template) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue({ id: 'existing' }), save: vi.fn() };
    const postComment = { execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }) };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, { runStep: vi.fn() } as never, { emit: vi.fn() } as never, postComment as never);

    await expect(uc.execute({ ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: '@john', triggeredFrom: 'x' }))
      .rejects.toBeInstanceOf(WorkflowRunAlreadyActiveError);
  });

  describe('runaway-recursion guard', () => {
    // `workflow.trigger` lets a run spawn a run. Without a ceiling, a template
    // that (directly or through two others) triggers itself would spawn runs —
    // and tickets — until the database gave up. The chain of `parentRunId`s is
    // walked on every triggered run precisely so that cannot happen.
    const chain = (ids: string[]) => ({
      getActiveByTicket: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
      getById: vi.fn(async (id: string) => {
        const index = ids.indexOf(id);
        if (index < 0) return null;
        return { id, parentRunId: ids[index + 1] ?? null };
      }),
    });
    const make = (runStore: unknown) => new CreateWorkflowRunUseCase(
      { getById: vi.fn().mockResolvedValue(template) } as never,
      runStore as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      { execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }) } as never,
    );

    it('records which run spawned this one, so the chain can be walked at all', async () => {
      const runStore = chain([]);
      const run = await make(runStore).execute({
        ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: 'workflow:X',
        triggeredFrom: 'workflow', parentRunId: 'run-parent',
      });
      expect(run.parentRunId).toBe('run-parent');
    });

    it('allows a delegation chain up to the limit — composition is the feature', async () => {
      // parent → grandparent → great-grandparent = 3 ancestors, still legal.
      const runStore = chain(['r-1', 'r-2', 'r-3']);
      await expect(make(runStore).execute({
        ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: 'workflow:X',
        triggeredFrom: 'workflow', parentRunId: 'r-1',
      })).resolves.toBeInstanceOf(WorkflowRunEntity);
    });

    it('refuses one hop deeper, before creating anything', async () => {
      const runStore = chain(['r-1', 'r-2', 'r-3', 'r-4']);
      await expect(make(runStore).execute({
        ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: 'workflow:X',
        triggeredFrom: 'workflow', parentRunId: 'r-1',
      })).rejects.toBeInstanceOf(WorkflowRunDepthExceededError);
      expect(runStore.save).not.toHaveBeenCalled();
    });

    it('terminates on a corrupted chain that loops back on itself', async () => {
      // A cycle in `parentRunId` would hang the walk forever if it were not
      // bounded by the very limit it enforces — and hanging is a worse failure
      // than refusing, since the run would never report anything at all.
      const runStore = {
        getActiveByTicket: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
        getById: vi.fn(async () => ({ id: 'r-loop', parentRunId: 'r-loop' })),
      };
      await expect(make(runStore).execute({
        ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: 'workflow:X',
        triggeredFrom: 'workflow', parentRunId: 'r-loop',
      })).rejects.toBeInstanceOf(WorkflowRunDepthExceededError);
    });
  });

  it('throws WorkflowTemplateNotFoundError if template missing', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(null) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const postComment = { execute: vi.fn().mockResolvedValue({ comment: {}, createdMentions: [] }) };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, { runStep: vi.fn() } as never, { emit: vi.fn() } as never, postComment as never);

    await expect(uc.execute({ ticketId: 't-1', templateId: 'missing', triggeredBy: '@john', triggeredFrom: 'x' }))
      .rejects.toBeInstanceOf(WorkflowTemplateNotFoundError);
  });
});
