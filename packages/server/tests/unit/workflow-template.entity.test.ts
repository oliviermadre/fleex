import { describe, it, expect } from 'vitest';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';

describe('WorkflowTemplateEntity', () => {
  const validStep = {
    id: 'triage',
    name: 'Triage',
    executorType: 'agent' as const,
    executorRef: 'the-sentinel',
    position: { x: 0, y: 0 },
  };

  it('creates with required fields', () => {
    const t = WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'Feature Delivery', slug: 'feature-delivery',
      steps: [validStep], edges: [], entryStepId: 'triage',
    });
    expect(t.name).toBe('Feature Delivery');
    expect(t.slug).toBe('feature-delivery');
    expect(t.enabled).toBe(true);
    expect(t.emoji).toBe('');
    expect(t.description).toBe('');
  });

  it('rejects when entryStepId is not in steps[]', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], edges: [], entryStepId: 'nonexistent',
    })).toThrow(/entryStepId/);
  });

  it('rejects empty steps[]', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [], edges: [], entryStepId: '',
    })).toThrow(/at least one step/);
  });

  it('rejects invalid slug', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'INVALID Slug!',
      steps: [validStep], edges: [], entryStepId: 'triage',
    })).toThrow(/slug/);
  });

  it('rejects edges referencing nonexistent steps', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], entryStepId: 'triage',
      edges: [{ id: 'e1', source: 'triage', target: 'missing', isDefault: true }],
    })).toThrow(/edge .* target/);
  });

  const humanGateStep = (humanGateOutcomes?: string[]) => ({
    id: 'gate',
    name: 'Check Spec',
    executorType: 'human_gate' as const,
    executorRef: '',
    position: { x: 0, y: 0 },
    humanGateOutcomes,
  });

  it('rejects a human_gate with fewer than two outcomes', () => {
    // A gate with a single (or zero) outcome has no real branch to decide on,
    // so it must offer at least two outcomes (e.g. approve / reject).
    for (const outcomes of [undefined, [], ['approve']]) {
      expect(() => WorkflowTemplateEntity.create({
        id: 'wf-1', name: 'X', slug: 'x',
        steps: [humanGateStep(outcomes)], edges: [], entryStepId: 'gate',
      })).toThrow(/at least two outcomes/);
    }
  });

  it('accepts a human_gate with two or more outcomes', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [humanGateStep(['approve', 'reject'])], edges: [], entryStepId: 'gate',
    })).not.toThrow();
  });

  it('toDTO returns serializable shape', () => {
    const t = WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], edges: [], entryStepId: 'triage',
    });
    const dto = t.toDTO();
    expect(dto.id).toBe('wf-1');
    expect(typeof dto.createdAt).toBe('string');
  });

  it('update mutates and bumps updatedAt', async () => {
    const t = WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], edges: [], entryStepId: 'triage',
    });
    const before = t.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    t.update({ name: 'Y' });
    expect(t.name).toBe('Y');
    expect(t.updatedAt.getTime()).toBeGreaterThan(before);
  });
});
