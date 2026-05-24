import { describe, it, expect } from 'vitest';
import { EdgeEvaluator } from '../../src/application/services/edge-evaluator.js';
import type { WorkflowEdge } from '@fleex/shared';

const edge = (overrides: Partial<WorkflowEdge> & { id: string; source: string; target: string }): WorkflowEdge => ({
  isDefault: false, ...overrides,
});

describe('EdgeEvaluator', () => {
  it('returns null when no edges', () => {
    expect(EdgeEvaluator.resolve({ schemaFields: {}, result: 'ok' }, [])).toBeNull();
  });

  it('returns the matching conditional edge (eq)', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
      edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'path', operator: 'eq', value: 'hotfix' } }),
    ];
    const out = { schemaFields: { path: 'hotfix' }, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e2');
  });

  it('returns the default edge when no condition matches', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
      edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
    ];
    const out = { schemaFields: { path: 'unknown' }, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e2');
  });

  it('returns null when no condition matches and no default', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
    ];
    const out = { schemaFields: { path: 'other' }, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)).toBeNull();
  });

  it('handles dotted paths (deliverable.status)', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'deliverable.status', operator: 'eq', value: 'final' } }),
    ];
    const out = { deliverable: { status: 'final' as const, title: 'x', markdown: 'y', type: 'report' as const }, schemaFields: {}, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e1');
  });

  it('operator neq', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'neq', value: '1' } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { x: '2' }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { x: '1' }, result: 'ok' }, edges)).toBeNull();
  });

  it('operator in', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'p', operator: 'in', value: ['a','b'] } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { p: 'b' }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { p: 'c' }, result: 'ok' }, edges)).toBeNull();
  });

  it('operator gt/lt', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'n', operator: 'gt', value: '5' } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { n: 10 }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { n: 3 }, result: 'ok' }, edges)).toBeNull();
    expect(EdgeEvaluator.resolve({ schemaFields: { n: 'NaN' }, result: 'ok' }, edges)).toBeNull();
  });

  it('operator contains', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 's', operator: 'contains', value: 'foo' } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { s: 'hello foobar' }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { s: 'bye' }, result: 'ok' }, edges)).toBeNull();
  });

  it('outcome shorthand: edges can match on outcome top-level field', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'outcome', operator: 'eq', value: 'approve' } })];
    const out = { schemaFields: {}, outcome: 'approve', result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e1');
  });

  it('stable order: first matching conditional wins', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'eq', value: 'a' } }),
      edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'x', operator: 'eq', value: 'a' } }),
    ];
    expect(EdgeEvaluator.resolve({ schemaFields: { x: 'a' }, result: 'ok' }, edges)?.id).toBe('e1');
  });
});
