import { describe, it, expect } from 'vitest';
import { EdgeEvaluator, type EdgeEvaluationContext } from '../../src/application/services/edge-evaluator.js';
import type { WorkflowEdge, StepOutput, EdgeConditionClause } from '@fleex/shared';

const edge = (overrides: Partial<WorkflowEdge> & { id: string; source: string; target: string }): WorkflowEdge => ({
  isDefault: false, ...overrides,
});

/** Legacy call shape: only the step that just ran is in scope. */
const ctx = (output: StepOutput): EdgeEvaluationContext => ({ current: output, steps: {} });

/**
 * The edge a run would actually follow, or null when there is none. An
 * ambiguity is a distinct outcome with its own tests below, so it throws here
 * rather than silently reading as "no edge".
 */
const taken = (context: EdgeEvaluationContext, edges: WorkflowEdge[]): string | null => {
  const resolution = EdgeEvaluator.resolve(context, edges);
  if (resolution.kind === 'ambiguous') {
    throw new Error(`unexpected ambiguity: ${resolution.edges.map((e) => e.id).join(', ')}`);
  }
  return resolution.kind === 'single' ? resolution.edge.id : null;
};

/** Evaluate a single clause through the public API, so the wiring is covered too. */
const check = (
  clause: EdgeConditionClause,
  output: StepOutput,
  steps: Record<string, Record<string, unknown>> = {},
): boolean => {
  const edges = [edge({ id: 'e1', source: 's', target: 't', conditionGroup: { match: 'all', clauses: [clause] } })];
  return taken({ current: output, steps }, edges) === 'e1';
};

const out = (schemaFields: Record<string, unknown>): StepOutput => ({ schemaFields, result: 'ok' });

describe('EdgeEvaluator', () => {
  it('returns null when no edges', () => {
    expect(taken(ctx({ schemaFields: {}, result: 'ok' }), [])).toBeNull();
  });

  // ── Backwards compatibility: templates saved before condition groups ────────

  describe('legacy single-condition edges', () => {
    it('returns the matching conditional edge (eq)', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
        edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'path', operator: 'eq', value: 'hotfix' } }),
      ];
      expect(taken(ctx(out({ path: 'hotfix' })), edges)).toBe('e2');
    });

    it('returns the default edge when no condition matches', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
        edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
      ];
      expect(taken(ctx(out({ path: 'unknown' })), edges)).toBe('e2');
    });

    it('returns null when no condition matches and no default', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
      ];
      expect(taken(ctx(out({ path: 'other' })), edges)).toBeNull();
    });

    it('handles dotted paths (deliverable.status)', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'deliverable.status', operator: 'eq', value: 'final' } }),
      ];
      const output: StepOutput = {
        deliverable: { status: 'final', title: 'x', markdown: 'y', type: 'report' },
        schemaFields: {}, result: 'ok',
      };
      expect(taken(ctx(output), edges)).toBe('e1');
    });

    it('outcome shorthand: edges can match on the outcome top-level field', () => {
      const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'outcome', operator: 'eq', value: 'approve' } })];
      expect(taken(ctx({ schemaFields: {}, outcome: 'approve', result: 'ok' }), edges)).toBe('e1');
    });

    it('two matching conditionals are ambiguous — the engine no longer picks the oldest', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'eq', value: 'a' } }),
        edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'x', operator: 'eq', value: 'a' } }),
      ];
      const resolution = EdgeEvaluator.resolve(ctx(out({ x: 'a' })), edges);
      expect(resolution.kind).toBe('ambiguous');
      expect(resolution.kind === 'ambiguous' && resolution.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    });

    it('a conditionGroup takes precedence over a leftover legacy condition', () => {
      const edges = [edge({
        id: 'e1', source: 's', target: 't1',
        condition: { field: 'x', operator: 'eq', value: 'stale' },
        conditionGroup: { match: 'all', clauses: [{ field: 'x', operator: 'eq', value: 'fresh' }] },
      })];
      expect(taken(ctx(out({ x: 'fresh' })), edges)).toBe('e1');
      expect(taken(ctx(out({ x: 'stale' })), edges)).toBeNull();
    });
  });

  // ── AND / OR ───────────────────────────────────────────────────────────────

  describe('condition groups', () => {
    const group = (match: 'all' | 'any'): WorkflowEdge[] => [edge({
      id: 'e1', source: 's', target: 't1',
      conditionGroup: {
        match,
        clauses: [
          { field: 'status', operator: 'eq', value: 'Doing' },
          { field: 'priority', operator: 'eq', value: 'High' },
        ],
      },
    })];

    it('match "all" needs every clause to hold', () => {
      expect(taken(ctx(out({ status: 'Doing', priority: 'High' })), group('all'))).toBe('e1');
      expect(taken(ctx(out({ status: 'Doing', priority: 'Low' })), group('all'))).toBeNull();
    });

    it('match "any" needs a single clause to hold', () => {
      expect(taken(ctx(out({ status: 'Doing', priority: 'Low' })), group('any'))).toBe('e1');
      expect(taken(ctx(out({ status: 'Todo', priority: 'Low' })), group('any'))).toBeNull();
    });

    it('an empty clause list never routes — the run falls through to the default', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', conditionGroup: { match: 'all', clauses: [] } }),
        edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
      ];
      expect(taken(ctx(out({})), edges)).toBe('e2');
    });
  });

  // ── Reading an earlier step ────────────────────────────────────────────────

  describe('multi-step references', () => {
    it('reads the output of a step further back in the run', () => {
      const clause: EdgeConditionClause = { stepId: 'compute-status', field: 'status', operator: 'eq', value: 'Doing' };
      expect(check(clause, out({}), { 'compute-status': { status: 'Doing' } })).toBe(true);
      expect(check(clause, out({}), { 'compute-status': { status: 'Todo' } })).toBe(false);
    });

    it('combines fields computed by three different steps', () => {
      const edges = [edge({
        id: 'e1', source: 'compute-type', target: 'hotfix',
        conditionGroup: {
          match: 'all',
          clauses: [
            { stepId: 'compute-status', field: 'status', operator: 'eq', value: 'Doing' },
            { stepId: 'compute-priority', field: 'priority', operator: 'eq', value: 'High' },
            { field: 'type', operator: 'eq', value: 'Fix' },
          ],
        },
      })];
      const steps = {
        'compute-status': { status: 'Doing' },
        'compute-priority': { priority: 'High' },
      };
      expect(taken({ current: out({ type: 'Fix' }), steps }, edges)).toBe('e1');
      expect(taken({ current: out({ type: 'Chore' }), steps }, edges)).toBeNull();
    });

    it('a step that never ran makes the clause false rather than throwing', () => {
      const clause: EdgeConditionClause = { stepId: 'never-ran', field: 'status', operator: 'eq', value: 'Doing' };
      expect(check(clause, out({}), {})).toBe(false);
    });

    it('a stepId pointing back at the edge source reads the merged current output', () => {
      const clause: EdgeConditionClause = { stepId: 's', field: 'outcome', operator: 'eq', value: 'approve' };
      expect(check(clause, { schemaFields: {}, outcome: 'approve', result: 'ok' })).toBe(true);
    });
  });

  // ── Operators ──────────────────────────────────────────────────────────────

  describe('operators', () => {
    it('eq / neq', () => {
      expect(check({ field: 'x', operator: 'eq', value: '1' }, out({ x: 1 }))).toBe(true);
      expect(check({ field: 'x', operator: 'neq', value: '1' }, out({ x: '2' }))).toBe(true);
      expect(check({ field: 'x', operator: 'neq', value: '1' }, out({ x: '1' }))).toBe(false);
    });

    it('in / not_in', () => {
      expect(check({ field: 'p', operator: 'in', value: ['a', 'b'] }, out({ p: 'b' }))).toBe(true);
      expect(check({ field: 'p', operator: 'in', value: ['a', 'b'] }, out({ p: 'c' }))).toBe(false);
      expect(check({ field: 'p', operator: 'not_in', value: ['a', 'b'] }, out({ p: 'c' }))).toBe(true);
      expect(check({ field: 'p', operator: 'not_in', value: ['a', 'b'] }, out({ p: 'a' }))).toBe(false);
    });

    it('gt / gte / lt / lte, including the boundaries', () => {
      expect(check({ field: 'n', operator: 'gt', value: '5' }, out({ n: 10 }))).toBe(true);
      expect(check({ field: 'n', operator: 'gt', value: '5' }, out({ n: 5 }))).toBe(false);
      expect(check({ field: 'n', operator: 'gte', value: '5' }, out({ n: 5 }))).toBe(true);
      expect(check({ field: 'n', operator: 'lt', value: '5' }, out({ n: 5 }))).toBe(false);
      expect(check({ field: 'n', operator: 'lte', value: '5' }, out({ n: 5 }))).toBe(true);
    });

    it('numeric operators need two finite numbers', () => {
      expect(check({ field: 'n', operator: 'gt', value: '5' }, out({ n: 'NaN' }))).toBe(false);
      expect(check({ field: 'n', operator: 'gt', value: 'abc' }, out({ n: 10 }))).toBe(false);
    });

    it('contains / not_contains on a string', () => {
      expect(check({ field: 's', operator: 'contains', value: 'foo' }, out({ s: 'hello foobar' }))).toBe(true);
      expect(check({ field: 's', operator: 'contains', value: 'foo' }, out({ s: 'bye' }))).toBe(false);
      expect(check({ field: 's', operator: 'not_contains', value: 'foo' }, out({ s: 'bye' }))).toBe(true);
    });

    it('contains reads an array as membership', () => {
      expect(check({ field: 'tags', operator: 'contains', value: 'urgent' }, out({ tags: ['urgent', 'bug'] }))).toBe(true);
      expect(check({ field: 'tags', operator: 'contains', value: 'urgent' }, out({ tags: ['bug'] }))).toBe(false);
    });

    it('starts_with / ends_with', () => {
      expect(check({ field: 's', operator: 'starts_with', value: 'feat' }, out({ s: 'feature/x' }))).toBe(true);
      expect(check({ field: 's', operator: 'starts_with', value: 'fix' }, out({ s: 'feature/x' }))).toBe(false);
      expect(check({ field: 's', operator: 'ends_with', value: '.md' }, out({ s: 'README.md' }))).toBe(true);
    });

    it('matches applies a regex, and an invalid pattern is simply false', () => {
      expect(check({ field: 's', operator: 'matches', value: '^AB-[0-9]+$' }, out({ s: 'AB-123' }))).toBe(true);
      expect(check({ field: 's', operator: 'matches', value: '^AB-[0-9]+$' }, out({ s: 'CD-123' }))).toBe(false);
      expect(check({ field: 's', operator: 'matches', value: '[unclosed' }, out({ s: 'anything' }))).toBe(false);
    });

    it('is_empty / is_not_empty on undefined, empty string and empty array', () => {
      expect(check({ field: 'missing', operator: 'is_empty' }, out({}))).toBe(true);
      expect(check({ field: 's', operator: 'is_empty' }, out({ s: '  ' }))).toBe(true);
      expect(check({ field: 's', operator: 'is_empty' }, out({ s: [] }))).toBe(true);
      expect(check({ field: 's', operator: 'is_empty' }, out({ s: 'x' }))).toBe(false);
      expect(check({ field: 's', operator: 'is_not_empty' }, out({ s: 'x' }))).toBe(true);
      expect(check({ field: 'missing', operator: 'is_not_empty' }, out({}))).toBe(false);
    });

    it('is_true / is_false accept booleans and their string spellings', () => {
      expect(check({ field: 'b', operator: 'is_true' }, out({ b: true }))).toBe(true);
      expect(check({ field: 'b', operator: 'is_true' }, out({ b: 'true' }))).toBe(true);
      expect(check({ field: 'b', operator: 'is_false' }, out({ b: false }))).toBe(true);
      expect(check({ field: 'b', operator: 'is_false' }, out({ b: 'false' }))).toBe(true);
      // Not boolean-ish at all: neither true nor false, so both are false.
      expect(check({ field: 'b', operator: 'is_true' }, out({ b: 'yes' }))).toBe(false);
      expect(check({ field: 'b', operator: 'is_false' }, out({ b: 'yes' }))).toBe(false);
    });

    it('caseInsensitive folds eq, contains, starts_with and ends_with', () => {
      expect(check({ field: 's', operator: 'eq', value: 'doing', caseInsensitive: true }, out({ s: 'DOING' }))).toBe(true);
      expect(check({ field: 's', operator: 'eq', value: 'doing' }, out({ s: 'DOING' }))).toBe(false);
      expect(check({ field: 's', operator: 'contains', value: 'FOO', caseInsensitive: true }, out({ s: 'foobar' }))).toBe(true);
      expect(check({ field: 's', operator: 'starts_with', value: 'FEAT', caseInsensitive: true }, out({ s: 'feature' }))).toBe(true);
      expect(check({ field: 's', operator: 'ends_with', value: '.MD', caseInsensitive: true }, out({ s: 'readme.md' }))).toBe(true);
    });

    it('missing data never routes — not even through a negative operator', () => {
      // Branching *because* a value is absent is almost always an accident.
      expect(check({ field: 'missing', operator: 'neq', value: 'x' }, out({}))).toBe(false);
      expect(check({ field: 'missing', operator: 'not_in', value: ['x'] }, out({}))).toBe(false);
      expect(check({ field: 'missing', operator: 'not_contains', value: 'x' }, out({}))).toBe(false);
    });
  });

  // ── Ambiguity ──────────────────────────────────────────────────────────────

  describe('ambiguous routing', () => {
    it('reports every matching edge, not just the first two', () => {
      const edges = ['e1', 'e2', 'e3'].map((id, i) => edge({
        id, source: 's', target: `t${i}`,
        condition: { field: 'x', operator: 'eq', value: 'a' },
      }));
      const resolution = EdgeEvaluator.resolve(ctx(out({ x: 'a' })), edges);
      expect(resolution.kind === 'ambiguous' && resolution.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    });

    it('a default never competes with a condition that matched', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'eq', value: 'a' } }),
        edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
      ];
      expect(taken(ctx(out({ x: 'a' })), edges)).toBe('e1');
    });

    it('two defaults with nothing else matching are ambiguous too', () => {
      // Blocked at save time, but a template saved before that check still has to
      // be handled: ask rather than pick one at random.
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', isDefault: true }),
        edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
      ];
      const resolution = EdgeEvaluator.resolve(ctx(out({})), edges);
      expect(resolution.kind === 'ambiguous' && resolution.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    });
  });
});
