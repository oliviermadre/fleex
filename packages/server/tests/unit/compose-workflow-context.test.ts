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
          path: { type: 'string', enum: ['standard','hotfix','doc_only'], description: 'Routing path' },
        },
        required: ['path'],
      },
      outgoingEdges: [
        { id: 'e1', label: 'standard', condition: { field: 'path', operator: 'eq', value: 'standard' }, targetName: 'Product Spec' },
        { id: 'e2', label: 'hotfix', condition: { field: 'path', operator: 'eq', value: 'hotfix' }, targetName: 'Development' },
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
      workflowName: 'X', stepName: 'Y',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: { triage: { path: 'standard', priority: 'high' } },
    });
    expect(out).toContain('triage');
    expect(out).toContain('standard');
  });

  it('handles no outgoing edges (terminal step)', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Final',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(out).toContain('terminal');
  });
});
