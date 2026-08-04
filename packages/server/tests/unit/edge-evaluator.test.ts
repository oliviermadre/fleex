import { describe, it, expect } from 'vitest';
import { EdgeEvaluator, type EdgeEvaluationContext } from '../../src/application/services/edge-evaluator.js';
import type { WorkflowEdge, StepOutput, EdgeConditionClause } from '@fleex/shared';

const edge = (overrides: Partial<WorkflowEdge> & { id: string; source: string; target: string }): WorkflowEdge => ({
  isDefault: false, ...overrides,
});

/** Legacy call shape: only the step that just ran is in scope. */
const ctx = (output: StepOutput): EdgeEvaluationContext => ({ current: output, steps: {} });

/** Evaluate a single clause through the public API, so the wiring is covered too. */
const check = (
  clause: EdgeConditionClause,
  output: StepOutput,
  steps: Record<string, Record<string, unknown>> = {},
): boolean => {
  const edges = [edge({ id: 'e1', source: 's', target: 't', conditionGroup: { match: 'all', clauses: [clause] } })];
  return EdgeEvaluator.resolve({ current: output, steps }, edges)?.id === 'e1';
};

const out = (schemaFields: Record<string, unknown>): StepOutput => ({ schemaFields, result: 'ok' });

describe('EdgeEvaluator', () => {
  it('returns null when no edges', () => {
    expect(EdgeEvaluator.resolve(ctx({ schemaFields: {}, result: 'ok' }), [])).toBeNull();
  });

  // ── Backwards compatibility: templates saved before condition groups ────────

  describe('legacy single-condition edges', () => {
    it('returns the matching conditional edge (eq)', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
        edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'path', operator: 'eq', value: 'hotfix' } }),
      ];
      expect(EdgeEvaluator.resolve(ctx(out({ path: 'hotfix' })), edges)?.id).toBe('e2');
    });

    it('returns the default edge when no condition matches', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
        edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
      ];
      expect(EdgeEvaluator.resolve(ctx(out({ path: 'unknown' })), edges)?.id).toBe('e2');
    });

    it('returns null when no condition matches and no default', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
      ];
      expect(EdgeEvaluator.resolve(ctx(out({ path: 'other' })), edges)).toBeNull();
    });

    it('handles dotted paths (deliverable.status)', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'deliverable.status', operator: 'eq', value: 'final' } }),
      ];
      const output: StepOutput = {
        deliverable: { status: 'final', title: 'x', markdown: 'y', type: 'report' },
        schemaFields: {}, result: 'ok',
      };
      expect(EdgeEvaluator.resolve(ctx(output), edges)?.id).toBe('e1');
    });

    it('outcome shorthand: edges can match on the outcome top-level field', () => {
      const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'outcome', operator: 'eq', value: 'approve' } })];
      expect(EdgeEvaluator.resolve(ctx({ schemaFields: {}, outcome: 'approve', result: 'ok' }), edges)?.id).toBe('e1');
    });

    it('stable order: first matching conditional wins', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'eq', value: 'a' } }),
        edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'x', operator: 'eq', value: 'a' } }),
      ];
      expect(EdgeEvaluator.resolve(ctx(out({ x: 'a' })), edges)?.id).toBe('e1');
    });

    it('a conditionGroup takes precedence over a leftover legacy condition', () => {
      const edges = [edge({
        id: 'e1', source: 's', target: 't1',
        condition: { field: 'x', operator: 'eq', value: 'stale' },
        conditionGroup: { match: 'all', clauses: [{ field: 'x', operator: 'eq', value: 'fresh' }] },
      })];
      expect(EdgeEvaluator.resolve(ctx(out({ x: 'fresh' })), edges)?.id).toBe('e1');
      expect(EdgeEvaluator.resolve(ctx(out({ x: 'stale' })), edges)).toBeNull();
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
      expect(EdgeEvaluator.resolve(ctx(out({ status: 'Doing', priority: 'High' })), group('all'))?.id).toBe('e1');
      expect(EdgeEvaluator.resolve(ctx(out({ status: 'Doing', priority: 'Low' })), group('all'))).toBeNull();
    });

    it('match "any" needs a single clause to hold', () => {
      expect(EdgeEvaluator.resolve(ctx(out({ status: 'Doing', priority: 'Low' })), group('any'))?.id).toBe('e1');
      expect(EdgeEvaluator.resolve(ctx(out({ status: 'Todo', priority: 'Low' })), group('any'))).toBeNull();
    });

    it('an empty clause list never routes — the run falls through to the default', () => {
      const edges = [
        edge({ id: 'e1', source: 's', target: 't1', conditionGroup: { match: 'all', clauses: [] } }),
        edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
      ];
      expect(EdgeEvaluator.resolve(ctx(out({})), edges)?.id).toBe('e2');
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
      expect(EdgeEvaluator.resolve({ current: out({ type: 'Fix' }), steps }, edges)?.id).toBe('e1');
      expect(EdgeEvaluator.resolve({ current: out({ type: 'Chore' }), steps }, edges)?.id).toBeUndefined();
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
});
