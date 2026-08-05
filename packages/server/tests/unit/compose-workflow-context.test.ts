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

  it('injects stepPrompt after the step identification when provided', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'Auto Review', stepName: 'Review PR',
      stepPrompt: 'Focus on security issues and backward compatibility.',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
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
      workflowName: 'X', stepName: 'Y',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    const blank = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Y', stepPrompt: '   ',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(blank).toBe(baseline);
  });

  it('passes markdown in stepPrompt through unescaped', () => {
    const md = '## Be careful\n- check `null` cases';
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Y', stepPrompt: md,
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(out).toContain(md);
  });

  // WHY: the run history says everything previousOutputs says (by step NAME
  // rather than opaque id) plus the comments/deliverables/human answers it
  // drops. Emitting both would duplicate the same data in the prompt, so the
  // history takes over when the caller provides one.
  it('renders the run history instead of the raw previousOutputs dump', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Y',
      outputSchema: undefined, outgoingEdges: [],
      previousOutputs: { 'step-abc': { path: 'standard' } },
      runHistory: [{
        stepName: 'Triage', attempt: 1, status: 'completed',
        isEarlierAttemptOfCurrentStep: false,
        fields: { path: 'standard' }, comment: 'routed to standard',
      }],
    });
    expect(out).toContain('Triage');
    expect(out).toContain('routed to standard');
    expect(out).not.toContain('step-abc');
  });

  // WHY: the instruction used to promise the answer would come back "as a ticket
  // comment". A routine run has no ticket, so that sentence was a lie exactly
  // where the feature was already broken.
  it('describes the waiting_for_info answer channel without assuming a ticket', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Y',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(out).toContain('waiting_for_info');
    expect(out).not.toContain('posted as a ticket comment');
  });

  it('handles no outgoing edges (terminal step)', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Final',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(out).toContain('terminal');
  });
});

describe('composeWorkflowContextPrompt — step identity', () => {
  // WHY: a step that produced a 70k-char artifact used to fail outright on the
  // output token limit, because `structuredOutput` was the only way to emit a
  // deliverable. Knowing its own ids lets the agent write the content to disk
  // and attach it with `--file`, so it never passes through the model.
  it('gives the step its own ids and the CLI escape hatch for bulky artifacts', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'Veille', stepName: 'Résumé',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
      workflowRunId: 'run-abc', stepRunId: 'sr-def',
    });
    expect(out).toContain('run-abc');
    expect(out).toContain('fleex workflow step deliverable add run-abc sr-def');
    expect(out).toContain('--file');
  });

  it('says nothing about identity when the caller has no ids to give', () => {
    // Callers outside a workflow run (tests, one-off compositions) must not get
    // a CLI command with holes in it.
    const out = composeWorkflowContextPrompt({
      workflowName: 'Veille', stepName: 'Résumé',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(out).not.toContain('fleex workflow step deliverable add');
  });

  // The CLI path skips the structured-output schema, so nothing constrains
  // `--type` at the point of use. Naming the workspace's own types here is what
  // stops an agent from copying the example type out of the snippet — which is
  // how a Fireflies transcript ended up filed as a generic `report`.
  it('names the workspace deliverable types next to the CLI command', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'Veille', stepName: 'Résumé',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
      workflowRunId: 'run-abc', stepRunId: 'sr-def',
      deliverableTypeIds: ['fireflies', 'report'],
    });
    expect(out).toContain('`fireflies`');
    expect(out).toContain('`report`');
    // No type is presented as the safe default: the example is a placeholder.
    expect(out).toContain('--type <TYPE>');
  });
});
