import { describe, it, expect } from 'vitest';
import type { MarketplaceWorkflow, WorkflowStep } from '@fleex/shared';
import { deriveWorkflowDeps, orderByInclusion } from '../../src/core/marketplace.ts';

/**
 * A workflow that includes another one is useless without it: the export must
 * record the dependency so an install pulls it in, and the install must create
 * the included workflow first — the server refuses a sub-workflow it can't find.
 */

const step = (id: string, executorType: WorkflowStep['executorType'], executorRef: string): WorkflowStep => ({
  id, name: id, executorType, executorRef, position: { x: 0, y: 0 },
});
const wf = (slug: string, steps: WorkflowStep[]): MarketplaceWorkflow => ({
  slug, name: slug, emoji: '', description: '', steps, edges: [], entryStepId: steps[0]!.id, enabled: true,
});

describe('sub-workflows in the marketplace', () => {
  it('records an included workflow as a dependency, next to its personas', () => {
    const full = wf('full', [step('a', 'agent', 'builder'), step('b', 'workflow', 'build-pr')]);
    expect(deriveWorkflowDeps(full)).toEqual([
      { kind: 'persona', slug: 'builder' },
      { kind: 'workflow', slug: 'build-pr' },
    ]);
  });

  it('installs included workflows before the workflows including them, whatever the manifest order', () => {
    const leaf = wf('leaf', [step('x', 'agent', 'p')]);
    const mid = wf('mid', [step('m', 'workflow', 'leaf')]);
    const top = wf('top', [step('t', 'workflow', 'mid'), step('u', 'workflow', 'leaf')]);
    expect(orderByInclusion([top, mid, leaf], (w) => w).map((w) => w.slug)).toEqual(['leaf', 'mid', 'top']);
  });

  it('terminates on a corrupt manifest with an inclusion cycle', () => {
    const a = wf('a', [step('s', 'workflow', 'b')]);
    const b = wf('b', [step('s', 'workflow', 'a')]);
    expect(orderByInclusion([a, b], (w) => w).map((w) => w.slug).sort()).toEqual(['a', 'b']);
  });
});
