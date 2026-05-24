import { describe, it, expect, vi } from 'vitest';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError } from '../../src/domain/errors.js';

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
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, orchestrator as never, eventBus as never);

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
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, { runStep: vi.fn() } as never, { emit: vi.fn() } as never);

    await expect(uc.execute({ ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: '@john', triggeredFrom: 'x' }))
      .rejects.toBeInstanceOf(WorkflowRunAlreadyActiveError);
  });

  it('throws WorkflowTemplateNotFoundError if template missing', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(null) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, { runStep: vi.fn() } as never, { emit: vi.fn() } as never);

    await expect(uc.execute({ ticketId: 't-1', templateId: 'missing', triggeredBy: '@john', triggeredFrom: 'x' }))
      .rejects.toBeInstanceOf(WorkflowTemplateNotFoundError);
  });
});
