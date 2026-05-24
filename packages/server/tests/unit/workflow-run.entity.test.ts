import { describe, it, expect } from 'vitest';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';

describe('WorkflowRunEntity', () => {
  const snapshot = {
    name: 'Feature Delivery',
    emoji: '🏭',
    steps: [
      { id: 'triage', name: 'Triage', executorType: 'agent' as const, executorRef: 'the-sentinel', position: { x: 0, y: 0 } },
      { id: 'dev', name: 'Dev', executorType: 'agent' as const, executorRef: 'jeff', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'triage', target: 'dev', isDefault: true }],
    entryStepId: 'triage',
  };

  it('creates with status=running and currentStepId=entryStepId', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    expect(run.status).toBe('running');
    expect(run.currentStepId).toBe('triage');
    expect(run.completedAt).toBeNull();
  });

  it('advanceTo updates currentStepId and bumps updatedAt', async () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    const before = run.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    run.advanceTo('dev');
    expect(run.currentStepId).toBe('dev');
    expect(run.status).toBe('running');
    expect(run.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('block sets status=needs_review without clearing currentStepId', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.block();
    expect(run.status).toBe('needs_review');
    expect(run.currentStepId).toBe('triage');
  });

  it('complete sets status=completed, currentStepId=null, completedAt', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.complete();
    expect(run.status).toBe('completed');
    expect(run.currentStepId).toBeNull();
    expect(run.completedAt).not.toBeNull();
  });

  it('fail sets status=failed and completedAt', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.fail();
    expect(run.status).toBe('failed');
    expect(run.completedAt).not.toBeNull();
  });

  it('cancel sets status=cancelled and completedAt', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.cancel();
    expect(run.status).toBe('cancelled');
    expect(run.completedAt).not.toBeNull();
  });

  it('isActive returns true for running|blocked|needs_review', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    expect(run.isActive()).toBe(true);
    run.block();
    expect(run.isActive()).toBe(true);
    run.complete();
    expect(run.isActive()).toBe(false);
  });
});
