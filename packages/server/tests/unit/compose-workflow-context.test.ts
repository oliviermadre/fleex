import { describe, it, expect } from 'vitest';

import { composeWorkflowContextPrompt } from '../../src/application/utils/compose-workflow-context.js';

describe('composeWorkflowContextPrompt', () => {
  it('renders workflow name + step + outputSchema + branches', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'Feature Delivery',
      stepName: 'Triage',
      outputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            enum: ['standard', 'hotfix', 'doc_only'],
            description: 'Routing path',
          },
        },
        required: ['path'],
      },
      outgoingEdges: [
        {
          id: 'e1',
          label: 'standard',
          condition: { field: 'path', operator: 'eq', value: 'standard' },
          targetName: 'Product Spec',
        },
        {
          id: 'e2',
          label: 'hotfix',
          condition: { field: 'path', operator: 'eq', value: 'hotfix' },
          targetName: 'Development',
        },
      ],
      previousOutputs: {},
    });
    expect(out).toContain('Feature Delivery');
    expect(out).toContain('Triage');
    expect(out).toContain('path');
    expect(out).toContain('Routing path');
    expect(out).toContain('Product Spec');
    expect(out).toContain('Development');
  });

  it('renders previousOutputs when present', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X',
      stepName: 'Y',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: { triage: { path: 'standard', priority: 'high' } },
    });
    expect(out).toContain('triage');
    expect(out).toContain('standard');
  });

  it('injects stepPrompt after the step identification when provided', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'Auto Review',
      stepName: 'Review PR',
      stepPrompt: 'Focus on security issues and backward compatibility.',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: {},
    });
    // The prompt must appear, and after the step identification line so the
    // agent reads its custom instruction in context, before output/branching.
    expect(out).toContain('Focus on security issues and backward compatibility.');
    const idIdx = out.indexOf('Review PR');
    const promptIdx = out.indexOf('Focus on security issues');
    expect(promptIdx).toBeGreaterThan(idIdx);
  });

  it('omits stepPrompt when undefined or blank (treated as absent)', () => {
    const baseline = composeWorkflowContextPrompt({
      workflowName: 'X',
      stepName: 'Y',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: {},
    });
    const blank = composeWorkflowContextPrompt({
      workflowName: 'X',
      stepName: 'Y',
      stepPrompt: '   ',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: {},
    });
    expect(blank).toBe(baseline);
  });

  it('passes markdown in stepPrompt through unescaped', () => {
    const md = '## Be careful\n- check `null` cases';
    const out = composeWorkflowContextPrompt({
      workflowName: 'X',
      stepName: 'Y',
      stepPrompt: md,
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: {},
    });
    expect(out).toContain(md);
  });

  it('handles no outgoing edges (terminal step)', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X',
      stepName: 'Final',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: {},
    });
    expect(out).toContain('terminal');
  });
});
