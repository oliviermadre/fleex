import { describe, it, expect } from 'vitest';
import type { WorkflowEdge, WorkflowStep, WorkflowTemplate } from '@fleex/shared';
import { conditionsOf } from './armRules';
import { canPaste, pasteAt } from './layoutOps';
import { planFromWorkflow } from './workflowPlan';
import { DX, DY, type ArmSpec, type MachineSpec, type StationSpec } from './types';

const step = (id: string, over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, name: id, executorType: 'agent', executorRef: 'builder', position: { x: 0, y: 0 }, ...over });
const edge = (source: string, target: string, over: Partial<WorkflowEdge> = {}): WorkflowEdge => ({ id: `${source}>${target}`, source, target, isDefault: false, ...over });
const when = (field: string, value: string | string[], operator: 'eq' | 'neq' | 'in' | 'not_in' = 'eq') => ({ conditionGroup: { match: 'all' as const, clauses: [{ field, operator, value }] } });
const workflow = (steps: WorkflowStep[], edges: WorkflowEdge[], over: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
  id: 'w', name: 'Feature', slug: 'feature', emoji: '', description: '', steps, edges, entryStepId: steps[0]?.id ?? '', enabled: true, createdAt: '', updatedAt: '', ...over,
});

/** The floor a plan makes, read the way the engine reads one. */
function floorOf(machines: MachineSpec[]) {
  const grid = new Map<string, MachineSpec>(), taken: string[] = [];
  for (const m of machines) {
    if (m.kind === 'label') continue;
    for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) { const k = `${i},${j}`; if (grid.has(k)) taken.push(k); grid.set(k, m); }
  }
  const at = (x: number, y: number) => grid.get(`${x},${y}`) ?? null;
  const named = (name: string) => machines.find((m) => m.name === name)!;
  /** Where a ticket dropped by this arm ends up: follow the belts, straight across the bridges. */
  const reach = (arm: ArmSpec): string => {
    let dir: number = arm.dir, x = arm.x + DX[arm.dir], y = arm.y + DY[arm.dir];
    for (let guard = 0; guard < 5000; guard++) {
      const m = at(x, y);
      if (!m) return `nowhere (${x},${y})`;
      if (m.kind === 'belt') dir = m.dir;
      else if (m.kind !== 'bridge') return m.name ?? m.kind;
      x += DX[dir as 0]; y += DY[dir as 0];
    }
    return 'a loop of belts';
  };
  const armsOf = (name: string) => { const s = named(name); return machines.filter((m): m is ArmSpec => m.kind === 'arm' && at(m.x - DX[m.dir], m.y - DY[m.dir]) === s); };
  /** For a station: what each of its arms asks, and where it leads. */
  const ways = (name: string) => armsOf(name).map((a) => [conditionsOf(a).map((c) => `${c.op === 'is_not' ? 'not ' : ''}${c.values.join('|')}`).join(' & ') || 'else', reach(a)]).sort();
  return { at, named, ways, taken };
}

describe('a workflow as a plan', () => {
  it('lays a chain of steps in a line, between a zone to come in by and a zone to gather in', () => {
    const plan = planFromWorkflow(workflow([step('Spec'), step('Build'), step('Review')], [edge('Spec', 'Build'), edge('Build', 'Review')]));
    const f = floorOf(plan.clip.machines);
    expect(plan.warnings).toEqual([]);
    expect(f.taken).toEqual([]);
    expect([f.ways('Feature · in'), f.ways('Spec'), f.ways('Build'), f.ways('Review')]).toEqual([[['else', 'Spec']], [['else', 'Build']], [['else', 'Review']], [['else', 'Feature · out']]]);
    /* a straight line: every station on the same row, no bridge needed */
    expect(new Set(['Spec', 'Build', 'Review'].map((n) => f.named(n).y)).size).toBe(1);
    expect(plan.counts).toMatchObject({ stations: 3, arms: 4, bridges: 0 });
    expect(f.named('Feature · in')).toMatchObject({ kind: 'zone', release: 'auto' });
    expect(plan.clip.machines.some((m) => m.kind === 'label' && m.text === 'Feature')).toBe(true);
  });

  it('carries each step over as the station that runs it', () => {
    const plan = planFromWorkflow(workflow([
      step('Write', { executorType: 'agent', executorRef: 'catalyst', mode: 'plan', prompt: 'Write the spec.' }),
      step('Lint', { executorType: 'skill', executorRef: 'lint' }),
      step('Council', { executorType: 'panel', executorRef: 'architects' }),
      step('Go', { executorType: 'human_gate', humanGateOutcomes: ['ship', 'hold'] }),
      step('Doing', { executorType: 'native', nativeActions: [{ id: 'a', operationId: 'ticket.set_status', params: { status: 'doing' } }] }),
    ], [edge('Write', 'Lint'), edge('Lint', 'Council'), edge('Council', 'Go'), edge('Go', 'Doing')]));
    const f = floorOf(plan.clip.machines);
    expect(f.named('Write')).toMatchObject({ kind: 'station', exec: 'agent', ref: 'catalyst', mode: 'plan', prompt: 'Write the spec.', outcomes: ['ok'] });
    expect(f.named('Lint')).toMatchObject({ exec: 'skill', ref: 'lint' });
    expect(f.named('Council')).toMatchObject({ exec: 'panel', ref: 'architects' });
    expect(f.named('Go')).toMatchObject({ exec: 'human_gate', outcomes: ['ship', 'hold'] });
    expect(f.named('Doing')).toMatchObject({ exec: 'native', sets: 'doing', w: 2, h: 2 });
    expect(f.ways('Go')).toEqual([['else', 'Doing']]);
    expect(plan.warnings).toEqual([]);
  });

  it('keeps the values a step branches on as outcomes, each leaving by its own arm, loops back included', () => {
    const plan = planFromWorkflow(workflow([
      step('Triage', { outputSchema: { type: 'object', properties: { path: { type: 'string', enum: ['fast', 'standard', 'reject'] } } } }),
      step('Quick fix', { position: { x: 0, y: 0 } }), step('Spec', { position: { x: 0, y: 200 } }),
      step('Check', { executorType: 'human_gate', humanGateOutcomes: ['approve', 'rework'] }),
      step('Build'),
    ], [
      edge('Triage', 'Quick fix', when('path', 'fast')), edge('Triage', 'Spec', { isDefault: true }),
      edge('Spec', 'Check'), edge('Check', 'Build', when('decision', 'approve')), edge('Check', 'Spec', when('decision', 'rework')),
      edge('Quick fix', 'Build'),
    ]));
    const f = floorOf(plan.clip.machines);
    expect(plan.warnings).toEqual([]);
    expect(f.taken).toEqual([]);
    expect((f.named('Triage') as StationSpec).outcomes).toEqual(['fast', 'standard', 'reject']);
    expect(f.ways('Triage')).toEqual([['else', 'Spec'], ['fast', 'Quick fix']]);
    expect((f.named('Check') as StationSpec).outcomes).toEqual(['approve', 'rework']);
    expect(f.ways('Check')).toEqual([['approve', 'Build'], ['rework', 'Spec']]);   // the rework arm runs back to an earlier column
    expect(f.ways('Spec')).toEqual([['else', 'Check']]);
    expect(f.ways('Quick fix')).toEqual([['else', 'Build']]);
    expect(f.ways('Build')).toEqual([['else', 'Feature · out']]);
    expect(f.named('Spec').x).toBeLessThan(f.named('Check').x);
  });

  it('reads "is not" and "one of" too, and names a way out taken otherwise', () => {
    const plan = planFromWorkflow(workflow([step('Sort'), step('A'), step('B'), step('C')], [
      edge('Sort', 'A', { conditionGroup: { match: 'any', clauses: [{ field: 'kind', operator: 'eq', value: 'bug' }, { field: 'kind', operator: 'in', value: ['crash', 'regression'] }] } }),
      edge('Sort', 'B', when('kind', 'docs', 'neq')),
      edge('Sort', 'C', { condition: { field: 'kind', operator: 'eq', value: 'chore' } }),   // the older single condition
    ]));
    const f = floorOf(plan.clip.machines);
    expect(f.ways('Sort')).toEqual([['bug|crash|regression', 'A'], ['chore', 'C'], ['not docs', 'B']]);
    expect((f.named('Sort') as StationSpec).outcomes).toEqual(['bug', 'crash', 'regression', 'chore', 'other']);
    expect(plan.warnings).toEqual([]);
  });

  it('names the outcomes after the ways out when the conditions say more than one word can, and says so', () => {
    const plan = planFromWorkflow(workflow([step('Assess'), step('Fast lane'), step('Deep dive')], [
      edge('Assess', 'Fast lane', { label: 'Small & safe', conditionGroup: { match: 'all', clauses: [{ field: 'size', operator: 'lt', value: '3' }, { field: 'risk', operator: 'eq', value: 'low' }] } }),
      edge('Assess', 'Deep dive', { isDefault: true }),
    ]));
    const f = floorOf(plan.clip.machines);
    expect((f.named('Assess') as StationSpec).outcomes).toEqual(['small-safe', 'to-deep-dive']);
    expect(f.ways('Assess')).toEqual([['else', 'Deep dive'], ['small-safe', 'Fast lane']]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('“Assess” chooses its way out on conditions the floor cannot evaluate');
  });

  it('says what it could not carry over: other actions, sub-workflows, routing steps, too many ways out', () => {
    const plan = planFromWorkflow(workflow([
      step('Tag it', { executorType: 'native', nativeActions: [{ id: 'a', operationId: 'ticket.add_tags', params: { tags: ['x'] } }] }),
      step('Release train', { executorType: 'workflow', executorRef: 'release' }),
      step('Fan', { executorType: 'route' }),
      step('A'), step('B'), step('C'), step('D'),
    ], [
      edge('Tag it', 'Release train'), edge('Release train', 'Fan'),
      edge('Fan', 'A', { label: 'a' }), edge('Fan', 'B', { label: 'b' }), edge('Fan', 'C', { label: 'c' }), edge('Fan', 'D', { label: 'd' }),
    ]));
    const f = floorOf(plan.clip.machines);
    expect(f.named('Tag it')).toMatchObject({ exec: 'native', sets: undefined });
    expect(f.named('Sub-workflow: release')).toMatchObject({ kind: 'zone', release: 'manual' });
    expect(f.named('Route: Fan')).toMatchObject({ exec: 'human_gate', outcomes: ['a', 'b', 'c', 'd'] });
    expect(f.ways('Route: Fan')).toHaveLength(3);
    expect(plan.warnings.join('\n')).toMatch(/“Tag it” runs ticket\.add_tags/);
    expect(plan.warnings.join('\n')).toMatch(/sub-workflow release/);
    expect(plan.warnings.join('\n')).toMatch(/“Fan” is a routing step/);
    expect(plan.warnings.join('\n')).toMatch(/“Route: Fan” has 4 ways out and room for 3 arms/);
    expect(f.taken).toEqual([]);
  });

  it('wires every way out of a tangled workflow to the right step, with bridges where belts cross', () => {
    /* two rows of steps, crossing connections, two loops back and three steps that end the workflow */
    const names = ['S', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const steps = names.map((n, i) => step(n, { position: { x: 0, y: i % 2 ? 0 : 100 } }));
    const plan = planFromWorkflow(workflow(steps, [
      edge('S', 'A1', when('go', 'a1')), edge('S', 'A2', when('go', 'a2')), edge('S', 'B2', when('go', 'b2')),
      edge('A1', 'B2', when('next', 'cross')), edge('A1', 'B1', when('next', 'straight')),
      edge('A2', 'B1', when('next', 'cross')), edge('A2', 'B2', when('next', 'straight')), edge('A2', 'S', when('next', 'again')),
      edge('B1', 'C1'), edge('B2', 'C2', when('ok', 'yes')), edge('B2', 'A1', when('ok', 'no')),
    ]));
    const f = floorOf(plan.clip.machines);
    expect(plan.warnings).toEqual([]);
    expect(f.taken).toEqual([]);
    expect(f.ways('S')).toEqual([['a1', 'A1'], ['a2', 'A2'], ['b2', 'B2']]);
    expect(f.ways('A1')).toEqual([['cross', 'B2'], ['straight', 'B1']]);
    expect(f.ways('A2')).toEqual([['again', 'S'], ['cross', 'B1'], ['straight', 'B2']]);
    expect(f.ways('B1')).toEqual([['else', 'C1']]);
    expect(f.ways('B2')).toEqual([['no', 'A1'], ['yes', 'C2']]);
    expect(f.ways('C1')).toEqual([['else', 'Feature · out']]);
    expect(f.ways('C2')).toEqual([['else', 'Feature · out']]);
    expect(plan.counts.bridges).toBeGreaterThan(0);
  });

  it('is a clip like any other: it fits on an empty floor and is put down under new ids', () => {
    const plan = planFromWorkflow(workflow([step('Spec'), step('Build')], [edge('Spec', 'Build')]));
    const empty = { w: 0, h: 0, machines: [] };
    expect(canPaste(empty, plan.clip, 40, 20)).toBe(true);
    const put = pasteAt(empty, plan.clip, 40, 20)!;
    expect(put.layout.machines).toHaveLength(plan.clip.machines.length);
    expect(Math.min(...plan.clip.machines.map((m) => m.x))).toBe(0);
    expect(Math.min(...plan.clip.machines.map((m) => m.y))).toBe(0);
    expect(new Set(plan.clip.machines.map((m) => m.id)).size).toBe(plan.clip.machines.length);
  });

  it('copes with a workflow that has no step, or whose entry is gone', () => {
    expect(planFromWorkflow(workflow([], [])).warnings).toContain('This workflow has no step.');
    const plan = planFromWorkflow(workflow([step('Only')], [edge('Only', 'Ghost')], { entryStepId: 'nope' }));
    expect(floorOf(plan.clip.machines).ways('Feature · in')).toEqual([['else', 'Only']]);
    expect(plan.warnings.join(' ')).toMatch(/lead nowhere/);
  });
});
