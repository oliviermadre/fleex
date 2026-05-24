import { describe, it, expect } from 'vitest';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';

describe('StepRunEntity', () => {
  it('creates with attempt=1 status=queued by default', () => {
    const sr = StepRunEntity.create({
      id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage',
    });
    expect(sr.attempt).toBe(1);
    expect(sr.status).toBe('queued');
    expect(sr.output).toBeNull();
  });

  it('start sets status=running and startedAt', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage' });
    sr.start();
    expect(sr.status).toBe('running');
    expect(sr.startedAt).not.toBeNull();
  });

  it('complete with output and result sets status=completed', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage' });
    sr.start();
    sr.complete({
      output: { schemaFields: { path: 'standard' }, result: 'ok' },
      nextEdgeId: 'e1',
      executionId: 'exec-1',
    });
    expect(sr.status).toBe('completed');
    expect(sr.result).toBe('ok');
    expect(sr.nextEdgeId).toBe('e1');
    expect(sr.executionId).toBe('exec-1');
    expect(sr.completedAt).not.toBeNull();
    expect(sr.output?.schemaFields.path).toBe('standard');
  });

  it('markNeedsReview sets status=needs_review and result=needs_review', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    sr.start();
    sr.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
    expect(sr.status).toBe('needs_review');
    expect(sr.result).toBe('needs_review');
  });

  it('fail sets status=failed and result=ko', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage' });
    sr.start();
    sr.fail();
    expect(sr.status).toBe('failed');
    expect(sr.result).toBe('ko');
    expect(sr.completedAt).not.toBeNull();
  });

  it('resolveGate writes outcome to output.schemaFields', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    sr.start();
    sr.markNeedsReview({ output: { schemaFields: { outcomes: ['approve'] }, result: 'needs_review' } });
    sr.resolveGate('approve', 'looks good');
    expect(sr.status).toBe('completed');
    expect(sr.result).toBe('ok');
    expect(sr.output?.schemaFields.outcome).toBe('approve');
    expect(sr.output?.schemaFields.notes).toBe('looks good');
  });
});
