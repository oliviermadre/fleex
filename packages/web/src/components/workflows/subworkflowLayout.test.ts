import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowTemplateSnapshot } from '@fleex/shared';
import { layoutRun, subworkflowGroups, NODE_WIDTH } from './subworkflowLayout';

/**
 * A run of composed workflows is one flat DAG. Without a fresh layout the
 * children's own canvas positions pile on top of each other, and without the
 * frames the reader can no longer tell which step belongs to Spec, Build or QA.
 */

const step = (id: string, x = 0): WorkflowStep => ({
  id, name: id, executorType: 'agent', executorRef: 'p', position: { x, y: 0 },
});
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target, isDefault: true });

describe('layoutRun', () => {
  it('keeps authored positions when the run has no sub-workflow', () => {
    const snap: WorkflowTemplateSnapshot = { name: 'n', emoji: '', steps: [step('a', 42)], edges: [], entryStepId: 'a' };
    expect(layoutRun(snap).get('a')).toEqual({ x: 42, y: 0 });
  });

  it('lays an expanded run out by hops from the entry, ignoring back edges', () => {
    const snap: WorkflowTemplateSnapshot = {
      name: 'n', emoji: '', entryStepId: 'b::impl',
      steps: [step('b'), step('b::impl'), step('q'), step('q::review')],
      edges: [edge('b::impl', 'b'), edge('b', 'q::review'), edge('q::review', 'q'), edge('q', 'b::impl')],
      subworkflows: [{ stepId: 'b', templateSlug: 'build', name: 'Build', emoji: '' }, { stepId: 'q', templateSlug: 'qa', name: 'QA', emoji: '' }],
    };
    const pos = layoutRun(snap);
    expect(['b::impl', 'b', 'q::review', 'q'].map((id) => pos.get(id)!.x)).toEqual([0, 1, 2, 3].map((c) => c * (NODE_WIDTH + 80)));
  });
});

describe('subworkflowGroups', () => {
  const snap: WorkflowTemplateSnapshot = {
    name: 'n', emoji: '', entryStepId: 'd::b::impl',
    steps: [step('d'), step('d::b'), step('d::b::impl'), step('d::ship')],
    edges: [edge('d::b::impl', 'd::b'), edge('d::b', 'd::ship'), edge('d::ship', 'd')],
    subworkflows: [
      { stepId: 'd', templateSlug: 'delivery', name: 'Delivery', emoji: '📦' },
      { stepId: 'd::b', parentStepId: 'd', templateSlug: 'build', name: 'Build', emoji: '' },
    ],
  };

  it('frames each sub-workflow, the nested one inside its parent', () => {
    const [outer, inner] = subworkflowGroups(snap, layoutRun(snap), () => 'pending');
    expect(outer!.label).toBe('📦 Delivery');
    expect(inner!.depth).toBe(1);
    expect(inner!.x).toBeGreaterThan(outer!.x);
    expect(inner!.x + inner!.width).toBeLessThan(outer!.x + outer!.width);
  });

  it('is completed once its exit completed, needs you while a step waits on a human', () => {
    const done = subworkflowGroups(snap, layoutRun(snap), (id) => (id === 'd::b' || id === 'd::b::impl' ? 'completed' : 'pending'));
    expect(done[1]!.status).toBe('completed');
    expect(done[0]!.status).toBe('running');
    const waiting = subworkflowGroups(snap, layoutRun(snap), (id) => (id === 'd::b::impl' ? 'needs_review' : 'pending'));
    expect(waiting.map((g) => g.status)).toEqual(['needs_you', 'needs_you']);
  });
});
