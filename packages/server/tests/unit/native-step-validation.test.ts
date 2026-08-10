import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowEdge, NativeAction } from '@fleex/shared';
import { validateNativeSteps, nativeReferenceSuggestions } from '@fleex/shared';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';

/**
 * A misconfigured native step must be caught at save time, not at run time: a
 * workflow that only fails once it has already moved a ticket is worse than one
 * that refuses to save. These tests pin that boundary — what blocks a save
 * (errors) versus what merely warns the author (warnings).
 */

const agentStep = (id: string, fields: Record<string, { type: 'string'; enum?: string[] }> | null): WorkflowStep => ({
  id,
  name: id.toUpperCase(),
  executorType: 'agent',
  executorRef: 'p1',
  position: { x: 0, y: 0 },
  ...(fields ? { outputSchema: { type: 'object' as const, properties: fields } } : {}),
});

const nativeStep = (id: string, actions: NativeAction[]): WorkflowStep => ({
  id,
  name: id.toUpperCase(),
  executorType: 'native',
  executorRef: 'ticket.actions',
  position: { x: 200, y: 0 },
  nativeActions: actions,
});

const act = (operationId: string, params: Record<string, unknown> = {}): NativeAction =>
  ({ id: `a-${operationId}`, operationId, params });

const edge = (id: string, source: string, target: string): WorkflowEdge =>
  ({ id, source, target, isDefault: true });

const save = (steps: WorkflowStep[], edges: WorkflowEdge[], entryStepId = steps[0]?.id ?? 'a') =>
  () => WorkflowTemplateEntity.create({
    id: 'w-1', name: 'W', slug: 'w', steps, edges, entryStepId,
  });

describe('native step validation', () => {
  describe('shape', () => {
    it('refuses to save a native step with no action', () => {
      // Such a step would run, do nothing, and quietly advance — a silent no-op
      // in the middle of a workflow is the hardest kind of bug to notice.
      expect(save([nativeStep('n', [])], [])).toThrow(/at least one action/);
    });

    it('refuses an unknown operation', () => {
      expect(save([nativeStep('n', [act('ticket.launch_missiles')])], []))
        .toThrow(/unknown operation/);
    });

    it('refuses a missing required parameter', () => {
      expect(save([nativeStep('n', [act('ticket.set_status')])], []))
        .toThrow(/"Status" is required/);
    });

    it('refuses a literal outside the parameter enum', () => {
      expect(save([nativeStep('n', [act('ticket.set_status', { status: 'wibble' })])], []))
        .toThrow(/must be one of/);
    });

    it('accepts a well-formed single-action step', () => {
      expect(save([nativeStep('n', [act('ticket.set_status', { status: 'doing' })])], []))
        .not.toThrow();
    });

    it('accepts several actions writing different fields', () => {
      expect(save([nativeStep('n', [
        act('ticket.set_status', { status: 'doing' }),
        act('ticket.set_priority', { priority: 'high' }),
        act('ticket.post_comment', { body: 'on it' }),
      ])], [])).not.toThrow();
    });

    it('refuses two actions writing the same field', () => {
      // Otherwise the outcome depends on list order, and the step stops being
      // deterministic — the reason native steps exist.
      expect(save([nativeStep('n', [
        act('ticket.add_tags', { tags: ['a'] }),
        act('ticket.remove_tags', { tags: ['b'] }),
      ])], [])).toThrow(/both write "tags"/);
    });

    it('allows repeating an operation that claims no field', () => {
      expect(save([nativeStep('n', [
        act('ticket.post_comment', { body: 'first' }),
        act('ticket.post_comment', { body: 'second' }),
      ])], [])).not.toThrow();
    });
  });

  describe('ticket.create placement', () => {
    const create = act('ticket.create', { boardId: 'b-1', title: 'T' });

    it('accepts it as the first action', () => {
      expect(save([nativeStep('n', [create, act('ticket.set_priority', { priority: 'high' })])], []))
        .not.toThrow();
    });

    it('refuses it anywhere else, where "which ticket?" becomes ambiguous', () => {
      expect(save([nativeStep('n', [act('ticket.set_priority', { priority: 'high' }), create])], []))
        .toThrow(/must be the first action/);
    });

    it('refuses two creations in one step', () => {
      expect(save([nativeStep('n', [create, { ...create, id: 'a2' }])], []))
        .toThrow(/only one subject-creating action/);
    });
  });

  describe('references', () => {
    it('accepts a reference to an upstream step that declares the field', () => {
      expect(save(
        [agentStep('a', { priority: { type: 'string' } }), nativeStep('n', [
          act('ticket.set_priority', { priority: '{{ steps.a.priority }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).not.toThrow();
    });

    it('refuses a reference to a step that runs after this one', () => {
      // Nothing would be in `previousOutputs` at run time — better to say so now.
      expect(save(
        [nativeStep('n', [act('ticket.set_priority', { priority: '{{ steps.a.priority }}' })]),
          agentStep('a', { priority: { type: 'string' } })],
        [edge('e1', 'n', 'a')],
        'n',
      )).toThrow(/does not run before this step/);
    });

    it('refuses a reference to an unknown step', () => {
      expect(save(
        [agentStep('a', { priority: { type: 'string' } }), nativeStep('n', [
          act('ticket.set_priority', { priority: '{{ steps.ghost.priority }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).toThrow(/unknown step "ghost"/);
    });

    it('refuses a reference to a step that declares no output schema', () => {
      expect(save(
        [agentStep('a', null), nativeStep('n', [
          act('ticket.set_priority', { priority: '{{ steps.a.priority }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).toThrow(/declares no output schema/);
    });

    it('refuses a field the upstream schema does not declare, and lists what it has', () => {
      expect(save(
        [agentStep('a', { verdict: { type: 'string' } }), nativeStep('n', [
          act('ticket.set_priority', { priority: '{{ steps.a.priority }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).toThrow(/no output field "priority" \(available: verdict\)/);
    });

    it('refuses malformed reference syntax', () => {
      expect(save(
        [nativeStep('n', [act('ticket.set_priority', { priority: '{{ steps.a }}' })])],
        [],
      )).toThrow(/must be \{\{ steps\.<stepId>\.<field> \}\}/);
    });

    it('refuses an unknown ticket field', () => {
      expect(save(
        [nativeStep('n', [act('ticket.set_title', { title: '{{ ticket.salary }}' })])],
        [],
      )).toThrow(/unknown ticket field "salary"/);
    });

    it('accepts {{ output.* }} with exactly one incoming edge', () => {
      expect(save(
        [agentStep('a', { priority: { type: 'string' } }), nativeStep('n', [
          act('ticket.set_priority', { priority: '{{ output.priority }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).not.toThrow();
    });

    it('refuses {{ output.* }} when several edges converge, since "previous" is ambiguous', () => {
      expect(save(
        [
          agentStep('a', { priority: { type: 'string' } }),
          agentStep('b', { priority: { type: 'string' } }),
          nativeStep('n', [act('ticket.set_priority', { priority: '{{ output.priority }}' })]),
        ],
        [edge('e1', 'a', 'n'), edge('e2', 'b', 'n')],
      )).toThrow(/needs exactly one incoming edge/);
    });

    it('refuses a reference embedded in text on a non-textual parameter', () => {
      // "urgent-{{ output.x }}" can only ever be a string; an enum field cannot
      // take it, so the author is told at save time rather than at run time.
      expect(save(
        [agentStep('a', { p: { type: 'string' } }), nativeStep('n', [
          act('ticket.set_priority', { priority: 'very {{ output.p }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).toThrow(/must be the whole value/);
    });

    it('accepts a reference embedded in text on a textual parameter', () => {
      expect(save(
        [agentStep('a', { summary: { type: 'string' } }), nativeStep('n', [
          act('ticket.post_comment', { body: 'Verdict: {{ output.summary }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).not.toThrow();
    });

    it('refuses a reference on a parameter declared as not accepting one', () => {
      expect(save(
        [agentStep('a', { mode: { type: 'string' } }), nativeStep('n', [
          act('ticket.set_description', { description: 'x', mode: '{{ output.mode }}' }),
        ])],
        [edge('e1', 'a', 'n')],
      )).toThrow(/does not accept \{\{ … \}\} references/);
    });
  });

  describe('warnings — surfaced to the author, never blocking a save', () => {
    it('warns when the referenced step sits on a branch that may not run', () => {
      // `a` branches to `x` or to `n`; on the `x` path, `a`'s sibling never ran.
      const steps = [
        agentStep('entry', null),
        agentStep('left', { priority: { type: 'string' } }),
        nativeStep('n', [act('ticket.set_priority', { priority: '{{ steps.left.priority }}' })]),
      ];
      const edges = [
        // `entry` forks, so exactly one of its two edges can be the default —
        // two would be rejected at save time for being unarbitrable.
        { ...edge('e1', 'entry', 'left'), isDefault: false,
          conditionGroup: { match: 'all' as const, clauses: [{ field: 'result', operator: 'eq' as const, value: 'ok' }] } },
        edge('e2', 'entry', 'n'),
        edge('e3', 'left', 'n'),
      ];

      const { errors, warnings } = validateNativeSteps(steps, edges, 'entry');
      expect(errors).toEqual([]);
      expect(warnings.join('\n')).toMatch(/may not run/);
      expect(save(steps, edges, 'entry')).not.toThrow();
    });

    it('warns when an upstream enum can produce values the parameter rejects', () => {
      const steps = [
        { ...agentStep('a', null), outputSchema: {
          type: 'object' as const,
          properties: { priority: { type: 'string' as const, enum: ['high', 'P0'] } },
        } },
        nativeStep('n', [act('ticket.set_priority', { priority: '{{ steps.a.priority }}' })]),
      ];
      const edges = [edge('e1', 'a', 'n')];

      const { errors, warnings } = validateNativeSteps(steps, edges, 'a');
      expect(errors).toEqual([]);
      expect(warnings.join('\n')).toMatch(/can produce P0/);
    });

    it('errors — not warns — when the upstream type is plainly wrong', () => {
      const steps = [
        { ...agentStep('a', null), outputSchema: {
          type: 'object' as const,
          properties: { count: { type: 'number' as const } },
        } },
        nativeStep('n', [act('ticket.set_priority', { priority: '{{ steps.a.count }}' })]),
      ];
      const { errors } = validateNativeSteps(steps, [edge('e1', 'a', 'n')], 'a');
      expect(errors.join('\n')).toMatch(/is number, but "Priority" expects enum/);
    });
  });

  describe('issue grouping', () => {
    it('attributes each issue to its own step, so the editor shows the right panel', () => {
      const steps = [nativeStep('n1', []), { ...nativeStep('n2', [act('ticket.nope')]), id: 'n2' }];
      const { byStep, errors } = validateNativeSteps(steps, [], 'n1');
      expect(byStep['n1']?.errors).toHaveLength(1);
      expect(byStep['n2']?.errors).toHaveLength(1);
      expect(errors).toHaveLength(2);
    });

    it('reports nothing when the template has no native step', () => {
      expect(validateNativeSteps([agentStep('a', null)], [], 'a'))
        .toEqual({ errors: [], warnings: [], byStep: {} });
    });
  });
});

describe('nativeReferenceSuggestions', () => {
  const steps = [
    agentStep('step-uuid-1', { priority: { type: 'string' }, verdict: { type: 'string' } }),
    nativeStep('n', [act('ticket.set_priority', { priority: 'high' })]),
  ];
  const edges = [edge('e1', 'step-uuid-1', 'n')];

  it('labels a suggestion with the step name but inserts its id', () => {
    // Renaming a step must not break the references pointing at it, so the
    // token can never contain the name.
    const suggestions = nativeReferenceSuggestions(steps[1]!, steps, edges, 'step-uuid-1');
    const priority = suggestions.find((s) => s.token === '{{ steps.step-uuid-1.priority }}');
    expect(priority?.label).toBe('STEP-UUID-1 → priority');
  });

  it('offers the {{ output.* }} shorthand only when there is a single predecessor', () => {
    const single = nativeReferenceSuggestions(steps[1]!, steps, edges, 'step-uuid-1');
    expect(single.some((s) => s.token === '{{ output.priority }}')).toBe(true);

    const forked = [...steps, agentStep('other', { priority: { type: 'string' } })];
    const forkedEdges = [...edges, edge('e2', 'other', 'n')];
    const many = nativeReferenceSuggestions(steps[1]!, forked, forkedEdges, 'step-uuid-1');
    expect(many.some((s) => s.token.startsWith('{{ output.'))).toBe(false);
  });

  it('never offers a step that does not run before the current one', () => {
    const suggestions = nativeReferenceSuggestions(steps[0]!, steps, edges, 'step-uuid-1');
    expect(suggestions.some((s) => s.group === 'Steps')).toBe(false);
  });

  it('always offers the ticket fields and the workflow name', () => {
    const suggestions = nativeReferenceSuggestions(steps[1]!, steps, edges, 'step-uuid-1');
    expect(suggestions.some((s) => s.token === '{{ ticket.boardId }}')).toBe(true);
    expect(suggestions.some((s) => s.token === '{{ workflow }}')).toBe(true);
  });

  it('offers exactly what the validator accepts', () => {
    // The picker and the validator must not drift: every suggested token, put
    // into a compatible field, has to save cleanly.
    const suggestions = nativeReferenceSuggestions(steps[1]!, steps, edges, 'step-uuid-1');
    for (const suggestion of suggestions) {
      const probe = [steps[0]!, nativeStep('n', [act('ticket.post_comment', { body: suggestion.token })])];
      const { errors } = validateNativeSteps(probe, edges, 'step-uuid-1');
      expect(errors, `${suggestion.token} was suggested but rejected`).toEqual([]);
    }
  });
});

/**
 * Fan-out (`forEach`) and the two references it makes possible.
 *
 * These are the checks that keep a fan-out honest at save time: a `{{ item }}`
 * with nothing to bind, or a `{{ created.* }}` with nothing created, would
 * otherwise only fail once the step had already started mutating tickets — once
 * per element, N times over.
 */
describe('forEach and its references', () => {
  const arrayStep = (id: string, itemProperties?: Record<string, { type: 'string' }>): WorkflowStep => ({
    id,
    name: id.toUpperCase(),
    executorType: 'agent',
    executorRef: 'p1',
    position: { x: 0, y: 0 },
    outputSchema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          ...(itemProperties ? { items: { type: 'object', properties: itemProperties } } : {}),
        },
        summary: { type: 'string' },
      },
    },
  });

  const fanOut = (actions: NativeAction[], forEach?: string): WorkflowStep => ({
    ...nativeStep('n', actions),
    ...(forEach ? { forEach } : {}),
  });

  const validate = (steps: WorkflowStep[]) =>
    validateNativeSteps(steps, [edge('e1', 'scan', 'n')], 'scan');

  it('refuses {{ item.* }} on a step with no forEach', () => {
    // Nothing would bind it at runtime, and by then the step's other actions
    // have already run — the author has to hear about it while editing.
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([act('ticket.set_title', { title: '{{ item.title }}' })]),
    ]);
    expect(errors.join('\n')).toMatch(/this step has no forEach/);
  });

  it('accepts the same reference once the step iterates', () => {
    const { errors } = validate([
      arrayStep('scan', { title: { type: 'string' } }),
      fanOut([act('ticket.set_title', { title: '{{ item.title }}' })], '{{ steps.scan.findings }}'),
    ]);
    expect(errors).toEqual([]);
  });

  it('refuses to iterate something that is not an array', () => {
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([act('ticket.set_title', { title: 'x' })], '{{ steps.scan.summary }}'),
    ]);
    expect(errors.join('\n')).toMatch(/only an array can be iterated/);
  });

  it('refuses a forEach pointing at a step that does not run first', () => {
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([act('ticket.set_title', { title: 'x' })], '{{ steps.elsewhere.findings }}'),
    ]);
    expect(errors.join('\n')).toMatch(/unknown step "elsewhere"/);
  });

  it('refuses a forEach that is not a single reference', () => {
    // "items: {{ … }}" would be interpolated into a string, and a string is not
    // iterable in any way the author meant.
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([act('ticket.set_title', { title: 'x' })], 'items: {{ steps.scan.findings }}'),
    ]);
    expect(errors.join('\n')).toMatch(/must be a single reference/);
  });

  it('refuses {{ created.* }} when the step creates no ticket', () => {
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([act('ticket.post_comment', { body: '{{ created.id }}' })]),
    ]);
    expect(errors.join('\n')).toMatch(/creates no ticket/);
  });

  it('refuses {{ created.* }} inside the create action itself', () => {
    // A ticket cannot be named after the id it does not have yet.
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([act('ticket.create', { boardId: 'b-1', title: '{{ created.id }}' })]),
    ]);
    expect(errors.join('\n')).toMatch(/cannot reference the ticket it is about to create/);
  });

  it('accepts {{ created.* }} in an action that follows the create', () => {
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([
        act('ticket.create', { boardId: 'b-1', title: 'Spun off' }),
        act('ticket.post_comment', { body: 'Created #{{ created.displayId }}' }),
      ]),
    ]);
    expect(errors).toEqual([]);
  });

  it('refuses an unknown created field rather than resolving it to nothing', () => {
    const { errors } = validate([
      arrayStep('scan'),
      fanOut([
        act('ticket.create', { boardId: 'b-1', title: 'Spun off' }),
        act('ticket.post_comment', { body: '{{ created.title }}' }),
      ]),
    ]);
    expect(errors.join('\n')).toMatch(/unknown created field "title"/);
  });

  it('offers item.* only on an iterating step, and only the fields the element declares', () => {
    const steps = [
      arrayStep('scan', { title: { type: 'string' }, file: { type: 'string' } }),
      fanOut([act('ticket.set_title', { title: 'x' })], '{{ steps.scan.findings }}'),
    ];
    const edges = [edge('e1', 'scan', 'n')];
    const tokens = nativeReferenceSuggestions(steps[1]!, steps, edges, 'scan').map((s) => s.token);

    expect(tokens).toContain('{{ item }}');
    expect(tokens).toContain('{{ item.title }}');
    expect(tokens).toContain('{{ item.file }}');
    expect(tokens).not.toContain('{{ item.nonexistent }}');

    const plain = [steps[0]!, nativeStep('n', [act('ticket.set_title', { title: 'x' })])];
    expect(nativeReferenceSuggestions(plain[1]!, plain, edges, 'scan').some((s) => s.group === 'Item'))
      .toBe(false);
  });

  it('offers created.* only on a step that creates a ticket', () => {
    const steps = [
      arrayStep('scan'),
      fanOut([act('ticket.create', { boardId: 'b-1', title: 'x' })]),
    ];
    const edges = [edge('e1', 'scan', 'n')];
    expect(nativeReferenceSuggestions(steps[1]!, steps, edges, 'scan').map((s) => s.token))
      .toContain('{{ created.id }}');

    const plain = [steps[0]!, nativeStep('n', [act('ticket.set_title', { title: 'x' })])];
    expect(nativeReferenceSuggestions(plain[1]!, plain, edges, 'scan').some((s) => s.group === 'Created'))
      .toBe(false);
  });
});
