import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowEdge, WorkflowTemplateSnapshot } from '@fleex/shared';
import {
  expandSubworkflows, validateSubworkflows, SubworkflowExpansionError,
  MAX_SUBWORKFLOW_DEPTH, MAX_EXPANDED_STEPS,
} from '@fleex/shared';
import type { SubworkflowSource } from '@fleex/shared';

/**
 * Sub-workflows only exist in the editor: at launch they are flattened into a
 * plain DAG the engine already knows how to run. If the flattening is wrong the
 * run silently does something else than what was composed — a step skipped, a
 * parent branch unreachable, a reference reading nothing — so every rewrite
 * rule is pinned here, together with the guards that keep a composition from
 * looping forever.
 */

const step = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id, name: id.toUpperCase(), executorType: 'agent', executorRef: 'builder', position: { x: 0, y: 0 }, ...extra,
});
const wf = (id: string, slug: string): WorkflowStep => step(id, { executorType: 'workflow', executorRef: slug });
const edge = (source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge => ({
  id: `${source}->${target}`, source, target, isDefault: true, ...extra,
});
const tpl = (slug: string, steps: WorkflowStep[], edges: WorkflowEdge[], extra: Partial<SubworkflowSource> = {}): SubworkflowSource => ({
  slug, name: slug.toUpperCase(), emoji: '📦', enabled: true, steps, edges, entryStepId: steps[0]!.id, ...extra,
});
const resolver = (...templates: SubworkflowSource[]) => (slug: string) => templates.find((t) => t.slug === slug);
const snap = (steps: WorkflowStep[], edges: WorkflowEdge[], entryStepId = steps[0]!.id): WorkflowTemplateSnapshot => ({
  name: 'Parent', emoji: '', steps, edges, entryStepId,
});
const run = (s: WorkflowTemplateSnapshot, ...templates: SubworkflowSource[]) =>
  expandSubworkflows(s, 'parent', resolver(...templates), { requireEnabled: true });

const build = tpl('build', [step('implement'), step('pr')], [edge('implement', 'pr')]);
const targets = (s: WorkflowTemplateSnapshot, source: string) =>
  s.edges.filter((e) => e.source === source).map((e) => e.target);

describe('expandSubworkflows — rewriting', () => {
  it('leaves a snapshot without sub-workflows untouched (no subworkflows key)', () => {
    const s = snap([step('a')], []);
    expect(run(s)).toBe(s);
  });

  it('E1: copies the child steps under a prefixed id and name, tagged with their origin', () => {
    const out = run(snap([wf('b', 'build')], []), build);
    const copied = out.steps.find((x) => x.id === 'b::implement');
    expect(copied?.name).toBe('BUILD › IMPLEMENT');
    expect(copied?.executorType).toBe('agent');
    expect(copied?.origin).toEqual({ subworkflowStepId: 'b' });
  });

  it('E3 + E4: incoming edges enter the child, the workflow step stays as exit and keeps its outgoing edges', () => {
    const out = run(snap([step('spec'), wf('b', 'build'), step('done')], [edge('spec', 'b'), edge('b', 'done')]), build);
    expect(targets(out, 'spec')).toEqual(['b::implement']);
    expect(targets(out, 'b')).toEqual(['done']);
    expect(out.steps.find((x) => x.id === 'b')?.executorType).toBe('workflow');
  });

  it('E3: a workflow step used as entry hands the entry over to the child entry', () => {
    expect(run(snap([wf('b', 'build')], []), build).entryStepId).toBe('b::implement');
  });

  it('E5: a child step with no default edge rejoins the exit instead of ending the run', () => {
    const gated = tpl('qa', [step('review'), step('verdict', { executorType: 'route' })], [
      edge('review', 'verdict'),
      // only a conditional edge: in the child alone, "ko" would have ended the run
      edge('verdict', 'review', { isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'verdict', operator: 'eq', value: 'retry' }] } }),
    ]);
    const out = run(snap([wf('q', 'qa'), step('done')], [edge('q', 'done')]), gated);
    expect(targets(out, 'q::verdict').sort()).toEqual(['q', 'q::review']);
    expect(targets(out, 'q::review')).toEqual(['q::verdict']); // already had a default: untouched
  });

  it('E2: rewrites clause stepIds and {{ steps.* }} references to the child steps only', () => {
    const child = tpl('child', [
      step('compute'),
      step('apply', {
        executorType: 'native', executorRef: 'ticket_actions',
        nativeActions: [{ id: 'a1', operationId: 'ticket.update', params: { title: '{{ steps.compute.title }} / {{ steps.outer.x }}', tags: ['{{steps.compute.tag}}'] } }],
        forEach: '{{ steps.compute.items }}',
      }),
    ], [edge('compute', 'apply', { isDefault: false, conditionGroup: { match: 'all', clauses: [{ stepId: 'compute', field: 'ok', operator: 'is_true' }, { stepId: 'outer', field: 'x', operator: 'is_true' }] } })]);
    const out = run(snap([step('outer'), wf('c', 'child')], [edge('outer', 'c')]), child);

    const apply = out.steps.find((x) => x.id === 'c::apply')!;
    expect(apply.nativeActions?.[0]?.params).toEqual({
      title: '{{ steps.c::compute.title }} / {{ steps.outer.x }}',
      tags: ['{{steps.c::compute.tag}}'],
    });
    expect(apply.forEach).toBe('{{ steps.c::compute.items }}');
    const inner = out.edges.find((e) => e.source === 'c::compute' && e.target === 'c::apply')!;
    expect(inner.conditionGroup?.clauses.map((c) => c.stepId)).toEqual(['c::compute', 'outer']);
  });

  it('a parent back-edge into a sub-workflow re-enters at its entry (QA ko → Build)', () => {
    const qa = tpl('qa', [step('review')], []);
    const out = run(snap([wf('b', 'build'), wf('q', 'qa'), step('done')], [
      edge('b', 'q'),
      edge('q', 'done', { id: 'ok' }),
      edge('q', 'b', { id: 'ko', isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'verdict', operator: 'eq', value: 'ko' }] } }),
    ]), build, qa);
    expect(out.edges.find((e) => e.id === 'ko')?.target).toBe('b::implement');
    expect(targets(out, 'b')).toEqual(['q::review']);
  });

  it('E6 + E8: nests recursively, stacking prefixes and recording the group tree', () => {
    const delivery = tpl('delivery', [wf('b', 'build'), step('ship')], [edge('b', 'ship')]);
    const out = run(snap([wf('d', 'delivery')], []), delivery, build);
    expect(out.entryStepId).toBe('d::b::implement');
    expect(out.steps.find((x) => x.id === 'd::b::implement')?.name).toBe('DELIVERY › BUILD › IMPLEMENT');
    expect(out.steps.find((x) => x.id === 'd::b::implement')?.origin).toEqual({ subworkflowStepId: 'd::b' });
    expect(out.steps.find((x) => x.id === 'd::ship')?.origin).toEqual({ subworkflowStepId: 'd' });
    expect(targets(out, 'd::b')).toEqual(['d::ship']);
    expect(out.subworkflows).toEqual([
      { stepId: 'd', templateSlug: 'delivery', name: 'DELIVERY', emoji: '📦' },
      { stepId: 'd::b', parentStepId: 'd', templateSlug: 'build', name: 'BUILD', emoji: '📦' },
    ]);
  });

  it('the same child twice in a row is not a cycle: distinct prefixes, no collision', () => {
    const out = run(snap([wf('s1', 'build'), wf('s2', 'build')], [edge('s1', 's2')]), build);
    expect(targets(out, 's1')).toEqual(['s2::implement']);
    expect(new Set(out.steps.map((x) => x.id)).size).toBe(out.steps.length);
    expect(new Set(out.edges.map((x) => x.id)).size).toBe(out.edges.length);
  });
});

describe('expandSubworkflows — guards', () => {
  const expectRefusal = (fn: () => unknown, message: RegExp) => {
    expect(fn).toThrow(SubworkflowExpansionError);
    expect(fn).toThrow(message);
  };

  it('G1: refuses a template including itself', () => {
    expectRefusal(() => run(snap([wf('x', 'parent')], []), tpl('parent', [step('a')], [])), /cannot include itself/);
  });

  it('G2: refuses an inclusion cycle and names its path', () => {
    const a = tpl('a', [wf('to-b', 'b')], []);
    const b = tpl('b', [wf('to-a', 'a')], []);
    expectRefusal(() => run(snap([wf('x', 'a')], []), a, b), /inclusion cycle a → b → a/);
  });

  it(`G3: refuses nesting deeper than ${MAX_SUBWORKFLOW_DEPTH} levels`, () => {
    const l3 = tpl('l3', [step('leaf')], []);
    const l2 = tpl('l2', [wf('n', 'l3')], []);
    const l1 = tpl('l1', [wf('n', 'l2')], []);
    expect(() => run(snap([wf('n', 'l1')], []), l1, l2, l3)).not.toThrow();
    const l4 = tpl('l4', [wf('n', 'l1')], []);
    expectRefusal(() => run(snap([wf('n', 'l4')], []), l4, l1, l2, l3), /nested more than 3 levels/);
  });

  it(`G4: refuses more than ${MAX_EXPANDED_STEPS} steps once expanded`, () => {
    const big = tpl('big', Array.from({ length: 30 }, (_, i) => step(`s${i}`)), []);
    const four = [0, 1, 2, 3].map((i) => wf(`w${i}`, 'big'));
    expectRefusal(() => run(snap(four, []), big), /124 steps .* \(max 100\)/);
  });

  it('G5: at launch, refuses a missing or disabled child; at save, a disabled child is allowed', () => {
    expectRefusal(() => run(snap([wf('b', 'build')], [])), /"build" not found/);
    const disabled = { ...build, enabled: false };
    expectRefusal(() => run(snap([wf('b', 'build')], []), disabled), /"build" is disabled/);
    expect(validateSubworkflows({ slug: 'parent', steps: [wf('b', 'build')], edges: [], entryStepId: 'b' }, resolver(disabled))).toEqual([]);
  });
});

describe('validateSubworkflows (save time)', () => {
  it('reports self-inclusion, a missing ref and a cycle closing through the candidate', () => {
    const cand = (steps: WorkflowStep[]) => ({ slug: 'a', steps, edges: [], entryStepId: steps[0]!.id });
    expect(validateSubworkflows(cand([wf('x', 'a')]), resolver())).toEqual(['step "X": a workflow cannot include itself']);
    expect(validateSubworkflows(cand([wf('x', '')]), resolver())).toEqual(['step "X": choose the workflow to include']);
    // b already includes a: saving a with a node towards b must be refused.
    const b = tpl('b', [wf('to-a', 'a')], []);
    const a = tpl('a', [wf('x', 'b')], []);
    expect(validateSubworkflows(cand([wf('x', 'b')]), resolver(a, b))[0]).toMatch(/cycle a → b → a/);
  });
});
