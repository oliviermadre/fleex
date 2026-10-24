import type { WorkflowDocument } from './types.js';

/**
 * The two examples served by `fleex workflow apply --documentation`.
 *
 * They are also the base every invariant's violating example is derived from,
 * and a test runs both through `validateWorkflow(…, 'apply')` expecting zero
 * errors and zero warnings — so the examples an agent copies are proven valid.
 *
 * Agent / skill names vary per workspace, so they are parameters: the doc
 * substitutes real names, the tests pass `EXAMPLE_REFS`.
 */

export interface ExampleRefs {
  agent: string;
  /** Absent when the workspace has no skill: the review step then runs on the agent. */
  skill?: string;
}

/** Names used by the tests and the violating examples (with matching fake capabilities). */
export const EXAMPLE_REFS: Required<ExampleRefs> = { agent: 'catalyst', skill: 'code-review' };

export function minimalExample(refs: ExampleRefs): WorkflowDocument {
  return {
    slug: 'hello',
    name: 'Hello',
    entryStepId: 'write',
    steps: [
      { id: 'write', name: 'Write', executorType: 'agent', executorRef: refs.agent, prompt: 'Summarise the ticket.' },
      { id: 'done', name: 'Done', executorType: 'route', executorRef: '' },
    ],
    edges: [{ id: 'write-done', source: 'write', target: 'done', isDefault: true }],
  };
}

/** ≥ 5 steps: agent, skill with an enum outputSchema, a conditional back-edge, a gate, a native step, a route. */
export function richExample(refs: ExampleRefs): WorkflowDocument {
  return {
    slug: 'spec-review',
    name: 'Spec then review',
    emoji: '📝',
    description: 'Write a spec, review it until it is ok, ask a human, then close the ticket.',
    entryStepId: 'spec',
    steps: [
      {
        id: 'spec',
        name: 'Spec',
        executorType: 'agent',
        executorRef: refs.agent,
        prompt: 'Write the spec of the ticket as a deliverable.',
      },
      {
        id: 'review',
        name: 'Review',
        executorType: refs.skill ? 'skill' : 'agent',
        executorRef: refs.skill ?? refs.agent,
        prompt: 'Review the spec. Set decision to ok or changes_requested.',
        outputSchema: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['ok', 'changes_requested'] },
          },
        },
      },
      {
        id: 'approve',
        name: 'Approve',
        executorType: 'human_gate',
        executorRef: '',
        humanGateOutcomes: ['approve', 'reject'],
      },
      {
        id: 'set-done',
        name: 'Set done',
        executorType: 'native',
        executorRef: 'ticket.actions',
        nativeActions: [
          { id: 'status', operationId: 'ticket.set_status', params: { status: 'done' } },
          { id: 'note', operationId: 'ticket.post_comment', params: { body: 'Spec approved for {{ ticket.title }}.' } },
        ],
      },
      { id: 'stop', name: 'Stop', executorType: 'route', executorRef: '' },
    ],
    edges: [
      { id: 'spec-review', source: 'spec', target: 'review', isDefault: true },
      {
        id: 'review-again',
        source: 'review',
        target: 'spec',
        isDefault: false,
        label: 'changes requested',
        conditionGroup: {
          match: 'all',
          clauses: [{ field: 'decision', operator: 'eq', value: 'changes_requested' }],
        },
      },
      { id: 'review-approve', source: 'review', target: 'approve', isDefault: true },
      {
        id: 'approve-done',
        source: 'approve',
        target: 'set-done',
        isDefault: false,
        conditionGroup: { match: 'all', clauses: [{ field: 'outcome', operator: 'eq', value: 'approve' }] },
      },
      {
        id: 'approve-stop',
        source: 'approve',
        target: 'stop',
        isDefault: false,
        conditionGroup: { match: 'all', clauses: [{ field: 'outcome', operator: 'eq', value: 'reject' }] },
      },
      { id: 'done-stop', source: 'set-done', target: 'stop', isDefault: true },
    ],
  };
}
