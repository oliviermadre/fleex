import { describe, it, expect } from 'vitest';
import type { WorkflowEdge, WorkflowStep } from '@fleex/shared';
import { orderStepsByFlow } from './orderSteps';

const step = (id: string): WorkflowStep => ({
  id,
  name: id,
  executorType: 'agent',
  executorRef: 'x',
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string): WorkflowEdge => ({ id: `${source}-${target}`, source, target, isDefault: false });
const ids = (steps: WorkflowStep[]) => steps.map((s) => s.id);

describe('orderStepsByFlow', () => {
  it('puts a step added last in the editor where it runs, not at the bottom (ticket: Artifact listed last)', () => {
    // Template order = creation order; Artifact was added last but runs right after Spec.
    const steps = ['spec', 'build', 'check', 'review', 'artifact'].map(step);
    const edges = [edge('spec', 'artifact'), edge('artifact', 'check'), edge('check', 'build'), edge('build', 'review')];
    expect(ids(orderStepsByFlow(steps, edges, 'spec'))).toEqual(['spec', 'artifact', 'check', 'build', 'review']);
  });

  it('ranks a step by its shortest path from the entry, so a short-cut branch is not pushed down by a long one', () => {
    const steps = ['entry', 'a', 'b', 'end'].map(step);
    const edges = [edge('entry', 'a'), edge('a', 'b'), edge('b', 'end'), edge('entry', 'end')];
    expect(ids(orderStepsByFlow(steps, edges, 'entry'))).toEqual(['entry', 'a', 'end', 'b']);
  });

  it('ignores reject loops back to an earlier step', () => {
    const steps = ['spec', 'gate', 'build'].map(step);
    const edges = [edge('spec', 'gate'), edge('gate', 'spec'), edge('gate', 'build')];
    expect(ids(orderStepsByFlow(steps, edges, 'spec'))).toEqual(['spec', 'gate', 'build']);
  });

  it('keeps template order for same-depth steps and lists unreachable steps last', () => {
    const steps = ['orphan', 'entry', 'right', 'left'].map(step);
    const edges = [edge('entry', 'left'), edge('entry', 'right')];
    expect(ids(orderStepsByFlow(steps, edges, 'entry'))).toEqual(['entry', 'right', 'left', 'orphan']);
  });
});
