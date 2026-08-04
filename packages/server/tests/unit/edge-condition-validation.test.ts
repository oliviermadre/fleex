import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowEdge, EdgeConditionClause } from '@fleex/shared';
import { validateEdgeConditions, edgeConditionSuggestions } from '@fleex/shared';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';

/**
 * An edge condition that can never be true is a workflow that silently takes
 * the wrong branch — the run "succeeds" while doing the opposite of what the
 * author meant. These tests pin where that gets caught: what blocks a save
 * (errors, because the condition is unreadable at runtime) versus what merely
 * warns (warnings, because the author may know something the schema doesn't).
 */

const step = (
  id: string,
  fields?: Record<string, { type: 'string' | 'number' | 'boolean'; enum?: string[] }>,
): WorkflowStep => ({
  id,
  name: id.toUpperCase(),
  executorType: 'agent',
  executorRef: 'p1',
  position: { x: 0, y: 0 },
  ...(fields ? { outputSchema: { type: 'object' as const, properties: fields } } : {}),
});

const edge = (
  id: string,
  source: string,
  target: string,
  clauses?: EdgeConditionClause[],
  match: 'all' | 'any' = 'all',
): WorkflowEdge => ({
  id,
  source,
  target,
  isDefault: clauses === undefined,
  ...(clauses ? { conditionGroup: { match, clauses } } : {}),
});

/** Fields the ambiguity fixtures read, declared so schema warnings don't mask them. */
const routingFields = {
  status: { type: 'string' as const },
  priority: { type: 'string' as const },
};

const validate = (steps: WorkflowStep[], edges: WorkflowEdge[], entryStepId = steps[0]?.id) =>
  validateEdgeConditions(steps, edges, entryStepId);

const save = (steps: WorkflowStep[], edges: WorkflowEdge[], entryStepId = steps[0]?.id ?? 'a') =>
  () => WorkflowTemplateEntity.create({
    id: 'w-1', name: 'W', slug: 'w', steps, edges, entryStepId,
  });

describe('edge condition validation', () => {
  describe('shape', () => {
    it('accepts a well-formed condition', () => {
      const steps = [step('a', { status: { type: 'string', enum: ['ok', 'ko'] } }), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'status', operator: 'eq', value: 'ok' }])];
      const result = validate(steps, edges);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('refuses a non-default edge with no condition at all', () => {
      // Such an edge is unreachable: the evaluator skips it and falls through to
      // the default, so the branch the author drew would never be taken.
      const steps = [step('a'), step('b')];
      const edges: WorkflowEdge[] = [{ id: 'e1', source: 'a', target: 'b', isDefault: false }];
      expect(validate(steps, edges).errors).toEqual([
        expect.stringMatching(/needs at least one condition/),
      ]);
    });

    it('leaves a default edge alone', () => {
      const steps = [step('a'), step('b')];
      expect(validate(steps, [edge('e1', 'a', 'b')]).errors).toEqual([]);
    });

    it('refuses an empty field', () => {
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: '   ', operator: 'eq', value: 'x' }])];
      expect(validate(steps, edges).errors).toEqual([expect.stringMatching(/a field is required/)]);
    });

    it('refuses a binary operator with no value', () => {
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'result', operator: 'eq' }])];
      expect(validate(steps, edges).errors).toEqual([expect.stringMatching(/needs a value/)]);
    });

    it('refuses a list operator with an empty list', () => {
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'result', operator: 'in', value: [] }])];
      expect(validate(steps, edges).errors).toEqual([
        expect.stringMatching(/needs a non-empty list/),
      ]);
    });

    it('lets a unary operator carry no value', () => {
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'outcome', operator: 'is_empty' }])];
      expect(validate(steps, edges).errors).toEqual([]);
    });
  });

  describe('regular expressions', () => {
    it('refuses a pattern that does not compile', () => {
      // Better to reject it here than to have `matches` silently evaluate to
      // false forever at runtime.
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'outcome', operator: 'matches', value: '([' }])];
      expect(validate(steps, edges).errors).toEqual([
        expect.stringMatching(/not a valid regular expression/),
      ]);
    });

    it('refuses a pattern longer than the cap', () => {
      // A long pattern is where catastrophic backtracking lives; the cap keeps
      // an author from wedging a run's evaluator.
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [
        { field: 'outcome', operator: 'matches', value: 'a'.repeat(201) },
      ])];
      expect(validate(steps, edges).errors).toEqual([expect.stringMatching(/at most 200 characters/)]);
    });

    it('accepts a valid pattern', () => {
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [
        { field: 'outcome', operator: 'matches', value: '^fix/', caseInsensitive: true },
      ])];
      expect(validate(steps, edges).errors).toEqual([]);
    });
  });

  describe('cross-step references', () => {
    // a → b → c, so `a` runs before edge c→d and `x` never does.
    const graph = () => ({
      steps: [
        step('a', { status: { type: 'string' } }),
        step('b'),
        step('c'),
        step('d'),
        step('x', { other: { type: 'string' } }),
      ],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    });

    it('accepts reading a step that runs earlier on the path', () => {
      const { steps, edges } = graph();
      const target = edge('e3', 'c', 'd', [{ stepId: 'a', field: 'status', operator: 'eq', value: 'ok' }]);
      expect(validate(steps, [...edges, target]).errors).toEqual([]);
    });

    it('refuses reading a step that never runs before the edge', () => {
      // Its output is simply absent from the run, so the condition could only
      // ever be false — an author almost certainly meant a different step.
      const { steps, edges } = graph();
      const target = edge('e3', 'c', 'd', [{ stepId: 'x', field: 'other', operator: 'eq', value: 'ok' }]);
      expect(validate(steps, [...edges, target]).errors).toEqual([
        expect.stringMatching(/does not run before this edge/),
      ]);
    });

    it('refuses an unknown step id', () => {
      const { steps, edges } = graph();
      const target = edge('e3', 'c', 'd', [{ stepId: 'ghost', field: 'f', operator: 'eq', value: 'ok' }]);
      expect(validate(steps, [...edges, target]).errors).toEqual([
        expect.stringMatching(/unknown step "ghost"/),
      ]);
    });

    it('only warns when the referenced step sits on a branch that may be skipped', () => {
      // entry → left → join and entry → right → join: reading `left` from an
      // edge leaving `join` is legal but false whenever the run went right.
      const steps = [
        step('entry'),
        step('left', { verdict: { type: 'string' } }),
        step('right'),
        step('join'),
        step('out'),
      ];
      const edges = [
        // One conditional + one default: two defaults from `entry` would be a
        // save-time error of its own, which is not what this test is about.
        edge('e1', 'entry', 'left', [{ field: 'result', operator: 'eq', value: 'ok' }]),
        edge('e2', 'entry', 'right'),
        edge('e3', 'left', 'join'),
        edge('e4', 'right', 'join'),
        edge('e5', 'join', 'out', [{ stepId: 'left', field: 'verdict', operator: 'eq', value: 'ok' }]),
      ];
      const result = validate(steps, edges, 'entry');
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([expect.stringMatching(/may not run/)]);
    });
  });

  describe('schema awareness', () => {
    it('warns — but does not block — on a field the step never declares', () => {
      // An author may legitimately read a nested path, or a field a step forgot
      // to declare; refusing the save would make the schema mandatory.
      const steps = [step('a', { status: { type: 'string' } }), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'typo', operator: 'eq', value: 'x' }])];
      const result = validate(steps, edges);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([expect.stringMatching(/declares no output field "typo"/)]);
    });

    it('warns on a value the declared enum can never produce', () => {
      const steps = [step('a', { status: { type: 'string', enum: ['ok', 'ko'] } }), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'status', operator: 'eq', value: 'maybe' }])];
      expect(validate(steps, edges).warnings).toEqual([
        expect.stringMatching(/never produces maybe/),
      ]);
    });

    it('stays quiet on the standard fields of the source step', () => {
      // `result`, `outcome`, `deliverable.*` are published by every step, so
      // they are readable even though no output schema mentions them.
      const steps = [step('a'), step('b')];
      const edges = [
        edge('e1', 'a', 'b', [{ field: 'result', operator: 'eq', value: 'ok' }]),
        edge('e2', 'a', 'b', [{ field: 'deliverable.status', operator: 'eq', value: 'final' }]),
      ];
      const result = validate(steps, edges);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('warns when a standard field is read from an *earlier* step', () => {
      // Only `schemaFields` travel forward in a run, so `result` of a step two
      // hops back is not readable — this is exactly the trap the warning exists for.
      const steps = [step('a'), step('b'), step('c')];
      const edges = [
        edge('e1', 'a', 'b'),
        edge('e2', 'b', 'c', [{ stepId: 'a', field: 'result', operator: 'eq', value: 'ok' }]),
      ];
      const result = validate(steps, edges);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([expect.stringMatching(/declares no output field "result"/)]);
    });
  });

  // ── Ambiguity prevention ───────────────────────────────────────────────────

  describe('competing edges', () => {
    it('refuses to save two default edges leaving the same step', () => {
      // Nothing at runtime can tell two defaults apart, so every single run would
      // stop on an unanswerable routing question. It's a config mistake: catch it
      // where the author can still fix it cheaply.
      const steps = [step('a'), step('b'), step('c')];
      const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')];
      const result = validate(steps, edges);
      expect(result.byEdge['e1']?.errors).toEqual([expect.stringMatching(/2 default edges/)]);
      expect(result.byEdge['e2']?.errors).toEqual([expect.stringMatching(/2 default edges/)]);
      expect(save(steps, edges, 'a')).toThrow(/default edges/);
    });

    it('allows one default per source step, on several sources', () => {
      const steps = [step('a'), step('b'), step('c')];
      const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
      expect(validate(steps, edges).errors).toEqual([]);
    });

    it('warns when one edge\'s conditions are a subset of another\'s', () => {
      // `status = Doing` matches every time `status = Doing AND priority = High`
      // does, so the run *will* pause and ask. A warning, not an error: the author
      // may want exactly that, and the engine now handles it gracefully.
      const steps = [step('a', routingFields), step('b', routingFields), step('c')];
      const edges = [
        edge('e1', 'a', 'b', [{ field: 'status', operator: 'eq', value: 'Doing' }]),
        edge('e2', 'a', 'c', [
          { field: 'status', operator: 'eq', value: 'Doing' },
          { field: 'priority', operator: 'eq', value: 'High' },
        ]),
      ];
      const result = validate(steps, edges);
      expect(result.errors).toEqual([]);
      expect(result.byEdge['e1']?.warnings).toEqual([expect.stringMatching(/can match at the same time/)]);
      expect(result.byEdge['e2']?.warnings).toEqual([expect.stringMatching(/can match at the same time/)]);
    });

    it('stays quiet on edges that read different fields', () => {
      // No inclusion, no guaranteed overlap — guessing further would need a SAT
      // solver and would drown the author in false positives.
      const steps = [step('a', routingFields), step('b', routingFields), step('c')];
      const edges = [
        edge('e1', 'a', 'b', [{ field: 'status', operator: 'eq', value: 'Doing' }]),
        edge('e2', 'a', 'c', [{ field: 'priority', operator: 'eq', value: 'High' }]),
      ];
      expect(validate(steps, edges).warnings).toEqual([]);
    });

    it('does not compare edges leaving different steps', () => {
      const steps = [step('a', routingFields), step('b', routingFields), step('c')];
      const edges = [
        edge('e1', 'a', 'b', [{ field: 'status', operator: 'eq', value: 'Doing' }]),
        edge('e2', 'b', 'c', [{ field: 'status', operator: 'eq', value: 'Doing' }]),
      ];
      expect(validate(steps, edges).warnings).toEqual([]);
    });
  });

  describe('grouping by edge', () => {
    it('reports each edge separately so the editor can point at one', () => {
      const steps = [step('a'), step('b')];
      const edges = [
        edge('e1', 'a', 'b', [{ field: 'result', operator: 'eq', value: 'ok' }]),
        edge('e2', 'a', 'b', [{ field: '', operator: 'eq', value: 'ok' }]),
      ];
      const result = validate(steps, edges);
      expect(result.byEdge['e1']?.errors).toEqual([]);
      expect(result.byEdge['e2']?.errors).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
    });

    it('validates every clause of a multi-condition group', () => {
      const steps = [step('a'), step('b')];
      const edges = [edge('e1', 'a', 'b', [
        { field: 'result', operator: 'eq', value: 'ok' },
        { field: '', operator: 'eq', value: 'x' },
        { field: 'outcome', operator: 'in', value: [] },
      ], 'any')];
      expect(validate(steps, edges).errors).toHaveLength(2);
    });
  });

  describe('save boundary', () => {
    it('a template with an unreadable condition cannot be saved', () => {
      // The whole point of sharing the validator with the entity: the API
      // refuses what the editor flags in red.
      const steps = [step('a'), step('b'), step('x', { f: { type: 'string' } })];
      const edges = [
        edge('e1', 'a', 'b', [{ stepId: 'x', field: 'f', operator: 'eq', value: 'ok' }]),
      ];
      expect(save(steps, edges, 'a')).toThrow(/does not run before this edge/);
    });

    it('a template whose conditions only warn saves fine', () => {
      const steps = [step('a', { status: { type: 'string' } }), step('b')];
      const edges = [edge('e1', 'a', 'b', [{ field: 'undeclared', operator: 'eq', value: 'ok' }])];
      expect(save(steps, edges, 'a')).not.toThrow();
    });
  });
});

describe('edge condition suggestions', () => {
  it('offers the source step first, then its ancestors nearest-first', () => {
    // The dropdown reads like walking back up the graph — the field an author
    // wants nine times out of ten is the one at the top.
    const steps = [
      step('a', { alpha: { type: 'string' } }),
      step('b', { beta: { type: 'string' } }),
      step('c', { gamma: { type: 'string' } }),
      step('d'),
    ];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')];
    const target = edge('e3', 'c', 'd', [{ field: 'gamma', operator: 'eq', value: 'x' }]);

    const fields = edgeConditionSuggestions(target, steps, [...edges, target], 'a')
      .map((s) => `${s.stepId ?? '(source)'}.${s.field}`);

    expect(fields[0]).toBe('(source).gamma');
    expect(fields.indexOf('b.beta')).toBeLessThan(fields.indexOf('a.alpha'));
  });

  it('leaves stepId undefined for the source step so the clause survives re-parenting', () => {
    const steps = [step('a', { status: { type: 'string' } }), step('b')];
    const target = edge('e1', 'a', 'b', [{ field: 'status', operator: 'eq', value: 'x' }]);
    const own = edgeConditionSuggestions(target, steps, [target], 'a')
      .filter((s) => s.stepName === 'A');
    expect(own.every((s) => s.stepId === undefined)).toBe(true);
  });

  it('offers the standard fields of the source step only', () => {
    // Reading `result` of an earlier step is a runtime dead end (only
    // `schemaFields` travel forward), so it must never appear in the dropdown.
    const steps = [step('a'), step('b'), step('c')];
    const edges = [edge('e1', 'a', 'b')];
    const target = edge('e2', 'b', 'c', [{ field: 'result', operator: 'eq', value: 'ok' }]);

    const suggestions = edgeConditionSuggestions(target, steps, [...edges, target], 'a');
    expect(suggestions.filter((s) => s.standard).every((s) => s.stepId === undefined)).toBe(true);
    expect(suggestions.some((s) => s.field === 'result' && s.stepId === undefined)).toBe(true);
  });

  it('never offers a step that does not run before the edge', () => {
    const steps = [step('a'), step('b'), step('x', { hidden: { type: 'string' } })];
    const target = edge('e1', 'a', 'b', [{ field: 'result', operator: 'eq', value: 'ok' }]);
    const suggestions = edgeConditionSuggestions(target, steps, [target], 'a');
    expect(suggestions.some((s) => s.stepId === 'x')).toBe(false);
  });

  it('flags an ancestor that may be skipped, matching the validator warning', () => {
    const steps = [
      step('entry'),
      step('left', { verdict: { type: 'string' } }),
      step('right'),
      step('join'),
      step('out'),
    ];
    const edges = [
      edge('e1', 'entry', 'left'),
      edge('e2', 'entry', 'right'),
      edge('e3', 'left', 'join'),
      edge('e4', 'right', 'join'),
    ];
    const target = edge('e5', 'join', 'out', [{ field: 'result', operator: 'eq', value: 'ok' }]);
    const suggestions = edgeConditionSuggestions(target, steps, [...edges, target], 'entry');
    expect(suggestions.find((s) => s.stepId === 'left')?.conditional).toBe(true);
  });

  it('carries the declared type and enum through so the editor can narrow the operators', () => {
    const steps = [step('a', { score: { type: 'number' }, status: { type: 'string', enum: ['ok', 'ko'] } }), step('b')];
    const target = edge('e1', 'a', 'b', [{ field: 'score', operator: 'gt', value: '3' }]);
    const suggestions = edgeConditionSuggestions(target, steps, [target], 'a');
    expect(suggestions.find((s) => s.field === 'score')?.type).toBe('number');
    expect(suggestions.find((s) => s.field === 'status')?.enum).toEqual(['ok', 'ko']);
  });
});
