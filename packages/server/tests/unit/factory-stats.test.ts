/**
 * The Factory's statistics, from run rows alone: what each machine ran, how
 * long it took, how long a human was waited for, and what it cost.
 */
import { describe, it, expect } from 'vitest';
import { computeStats, type ExecutionCost } from '../../src/factory/stats.js';
import type { FactoryLayout, FactoryRunRow, MachineSpec } from '../../src/factory/types.js';

const at = (hhmm: string) => `2026-11-15T${hhmm}:00.000Z`;
const SINCE = '2026-11-08T12:00:00.000Z', UNTIL = at('12:00');
const run = (id: string, over: Partial<FactoryRunRow> = {}): FactoryRunRow => ({
  id, ticketId: 't1', floorId: 'default', machineId: 'spec', machineName: 'Spec', executor: 'agent', status: 'completed',
  outcome: 'ok', executionId: null, error: null, startedAt: at('09:00'), finishedAt: at('09:10'), ...over,
});
const exec = (id: string, costUsd: number | null, over: Partial<ExecutionCost> = {}): ExecutionCost => ({ id, ticketId: 't1', startedAt: at('09:00'), costUsd, ...over });
const layout: FactoryLayout = { w: 10, h: 10, machines: [{ id: 'spec', kind: 'station', x: 0, y: 0, w: 3, h: 3, name: 'Spec writer', exec: 'agent', outcomes: ['ok'], cap: 8 } as MachineSpec] };
const stats = (runs: FactoryRunRow[], executions: ExecutionCost[] = []) => computeStats({ runs, executions, layout, since: SINCE, until: UNTIL, days: 7 });
const of = (s: ReturnType<typeof stats>, id: string) => s.machines.find((m) => m.machineId === id)!;

describe('computeStats', () => {
  it('is empty on a floor that has not run', () => {
    const s = stats([]);
    expect(s.machines).toEqual([]);
    expect(s.totals).toEqual({ runs: 0, failed: 0, questions: 0, costUsd: 0, shipped: 0, avgLeadMs: null, humanMs: 0 });
  });

  it('counts runs, failures and outcomes per machine, and averages the time of finished runs', () => {
    const s = stats([
      run('r1', { finishedAt: at('09:10') }),
      run('r2', { ticketId: 't2', outcome: 'rework', startedAt: at('10:00'), finishedAt: at('10:30') }),
      run('r3', { ticketId: 't3', status: 'failed', outcome: null, error: 'boom', startedAt: at('11:00'), finishedAt: at('11:02') }),
      run('r4', { ticketId: 't4', status: 'running', outcome: null, startedAt: at('11:50'), finishedAt: null }),
    ]);
    const m = of(s, 'spec');
    expect(m).toMatchObject({ name: 'Spec writer', onFloor: true, runs: 4, completed: 2, failed: 1, questions: 0, outcomes: { ok: 1, rework: 1 } });
    expect(m.avgRunMs).toBe(14 * 60_000);   // (10 + 30 + 2) / 3, the run in flight does not count
    expect(m.avgHumanMs).toBeNull();
    expect(s.totals).toMatchObject({ runs: 4, failed: 1 });
  });

  it('prices a run by its execution, once', () => {
    const s = stats(
      [run('r1', { executionId: 'e1' }), run('r2', { ticketId: 't2', executionId: 'e2', startedAt: at('10:00'), finishedAt: at('10:05') }), run('r3', { ticketId: 't3', executionId: 'gone' })],
      [exec('e1', 0.4), exec('e2', 1.25, { ticketId: 't2' }), exec('other', 9, { startedAt: at('09:05') })],
    );
    expect(of(s, 'spec').costUsd).toBe(1.65);
    expect(s.totals.costUsd).toBe(1.65);
  });

  it('counts at an exit the items archived there with the tickets it shipped, not as shipped tickets', () => {
    const s = computeStats({ runs: [run('x1', { machineId: 'out', executor: 'exit', outcome: 'shipped' })], executions: [], layout, since: SINCE, until: UNTIL, days: 7, exitItems: [{ machineId: 'out' }, { machineId: 'out' }, { machineId: null }] });
    expect(s.exits).toEqual({ out: 3 });
    expect(s.totals.shipped).toBe(1);
  });

  it('prices a visit to an item by its execution, which has no ticket', () => {
    const s = stats([run('v1', { ticketId: 'item-1', executionId: 'e9' })], [exec('e9', 0.3, { ticketId: null })]);
    expect(of(s, 'spec')).toMatchObject({ runs: 1, costUsd: 0.3 });
  });

  it('a panel run also takes the executions its personas started while it ran', () => {
    const s = stats(
      [
        run('p1', { machineId: 'panel', machineName: 'Review panel', executor: 'panel', executionId: 'synth', startedAt: at('09:00'), finishedAt: at('09:20') }),
        run('r2', { executionId: 'later', startedAt: at('10:00'), finishedAt: at('10:05') }),
      ],
      [exec('synth', 0.5, { startedAt: at('09:15') }), exec('alice', 0.2, { startedAt: at('09:01') }), exec('bob', 0.3, { startedAt: at('09:02') }), exec('later', 2, { startedAt: at('10:00') }), exec('elsewhere', 7, { ticketId: 't9', startedAt: at('09:05') })],
    );
    expect(of(s, 'panel')).toMatchObject({ costUsd: 1, onFloor: false, name: 'Review panel' });
    expect(of(s, 'spec').costUsd).toBe(2);
    expect(s.machines.map((m) => m.machineId)).toEqual(['spec', 'panel']);   // costliest first
  });

  it('a gate’s human time is how long the decision took; an undecided one runs until now', () => {
    const gate = { machineId: 'gate', machineName: 'Go / no go', executor: 'human_gate' as const };
    const s = stats([
      run('g1', { ...gate, outcome: 'approve', startedAt: at('09:00'), finishedAt: at('10:00') }),
      run('g2', { ...gate, ticketId: 't2', status: 'needs_review', outcome: null, startedAt: at('11:30'), finishedAt: null }),
    ]);
    const m = of(s, 'gate');
    expect(m).toMatchObject({ runs: 2, humanWaits: 2, humanMs: 90 * 60_000, avgHumanMs: 45 * 60_000, avgRunMs: null, outcomes: { approve: 1 } });
    expect(s.totals.humanMs).toBe(90 * 60_000);
  });

  it('a question waits for a human from the moment it is asked to the next run of the ticket', () => {
    const s = stats([
      run('q1', { status: 'question', outcome: null, startedAt: at('09:00'), finishedAt: at('09:05') }),
      run('q2', { startedAt: at('09:35'), finishedAt: at('09:40') }),
      run('q3', { ticketId: 't2', status: 'question', outcome: null, startedAt: at('11:00'), finishedAt: at('11:10') }),
    ]);
    const m = of(s, 'spec');
    expect(m).toMatchObject({ runs: 3, questions: 2, humanWaits: 2 });
    expect(m.humanMs).toBe((30 + 50) * 60_000);   // answered after 30 min; the other still waits at 12:00
    expect(s.totals.questions).toBe(2);
  });

  it('counts shipments and their lead time apart from the machines', () => {
    const s = stats([
      run('x1', { machineId: 'out', machineName: 'Exit', executor: 'exit', outcome: 'shipped', startedAt: at('08:00'), finishedAt: at('10:00') }),
      run('x2', { ticketId: 't2', machineId: 'out', machineName: 'Exit', executor: 'exit', outcome: 'shipped', startedAt: at('07:00'), finishedAt: at('11:00') }),
      run('r1'),
    ]);
    expect(s.totals).toMatchObject({ shipped: 2, avgLeadMs: 3 * 3_600_000, runs: 1 });
    expect(s.machines.map((m) => m.machineId)).toEqual(['spec']);
  });

  it('says how many tickets left by each exit: the counter an exit carries on the floor', () => {
    const ship = (id: string, machineId: string) => run(id, { ticketId: id, machineId, machineName: 'Exit', executor: 'exit', outcome: 'shipped' });
    const s = stats([ship('x1', 'out'), ship('x2', 'out'), ship('x3', 'archive'), run('r1')]);
    expect(s.exits).toEqual({ out: 2, archive: 1 });
    expect(s.totals.shipped).toBe(3);
    expect(stats([run('r1')]).exits).toEqual({});
  });
});
