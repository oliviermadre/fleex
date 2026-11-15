import { describe, it, expect } from 'vitest';
import { lensLayer, standing } from './lens';
import type { FactoryLayout, FactoryStats, FactoryTicket, MachineSpec, MachineStats } from './types';

const NOW = '2026-11-15T12:00:00.000Z';
const ago = (minutes: number) => new Date(new Date(NOW).getTime() - minutes * 60_000).toISOString();
const ticket = (id: string, machineId: string, phase: FactoryTicket['phase'], minutes: number, over: Partial<FactoryTicket> = {}): FactoryTicket => ({
  ticketId: id, machineId, info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: ago(minutes), runId: null, note: '', ...over,
} as FactoryTicket);
const station = (id: string, over: Partial<MachineSpec> = {}): MachineSpec => ({ id, kind: 'station', x: 0, y: 0, w: 3, h: 3, name: id, exec: 'agent', outcomes: ['ok'], cap: 8, ...over } as MachineSpec);
const zone = (id: string, over: Partial<MachineSpec> = {}): MachineSpec => ({ id, kind: 'zone', x: 0, y: 0, w: 4, h: 4, name: id, release: 'manual', ...over } as MachineSpec);
const layout: FactoryLayout = { w: 30, h: 20, machines: [station('spec'), station('gate', { exec: 'human_gate' } as Partial<MachineSpec>), zone('inbound', { inbound: true } as Partial<MachineSpec>), zone('ready'), station('idle')] };
const machine = (machineId: string, over: Partial<MachineStats> = {}): MachineStats => ({
  machineId, name: machineId, executor: 'agent', onFloor: true, runs: 1, completed: 1, failed: 0, questions: 0, avgRunMs: null, avgHumanMs: null, humanWaits: 0, humanMs: 0, costUsd: 0, outcomes: {}, ...over,
});
const stats = (machines: MachineStats[]): FactoryStats => ({ since: ago(7 * 1440), until: NOW, days: 7, machines, totals: { runs: 0, failed: 0, questions: 0, costUsd: 3.5, shipped: 0, avgLeadMs: null, humanMs: 5_400_000 } });

describe('standing', () => {
  it('ranks machines by the ticket-time standing in them, and says what they wait for', () => {
    const rows = standing(layout, [
      ticket('a', 'gate', 'review', 120), ticket('b', 'gate', 'review', 30),
      ticket('c', 'spec', 'running', 5), ticket('d', 'spec', 'wait', 20), ticket('e', 'spec', 'wait', 10),
      ticket('f', 'ready', 'zone', 60),
    ], NOW);
    expect(rows.map((r) => [r.machineId, r.count, r.oldestMs / 60_000, r.why, r.human])).toEqual([
      ['gate', 2, 120, 'waiting for your decision', true],
      ['ready', 1, 60, 'waiting to be released', true],
      ['spec', 3, 20, 'queueing to run', false],
    ]);
  });

  it('leaves out the Inbound zone and whatever is not in a station or a zone', () => {
    expect(standing(layout, [ticket('a', 'inbound', 'zone', 600), ticket('b', 'belt-1', 'belt', 1), { ...ticket('c', '', 'loose', 50), machineId: null }], NOW)).toEqual([]);
  });

  it('tells a jam at the way out from a queue at the way in', () => {
    expect(standing(layout, [ticket('a', 'spec', 'out', 40), ticket('b', 'spec', 'out', 30), ticket('c', 'spec', 'running', 2)], NOW)[0]?.why).toBe('done, but nothing takes them out');
    expect(standing(layout, [ticket('a', 'ready', 'zone', 40, { released: true })], NOW)[0]).toMatchObject({ why: 'released, but no arm takes them', human: false });
  });
});

describe('lensLayer', () => {
  it('is nothing when no lens is on', () => {
    expect(lensLayer('none', layout, [], null, NOW)).toBeNull();
  });

  it('shows what each station spent, and skips machines no longer on the floor', () => {
    const layer = lensLayer('cost', layout, [], stats([machine('spec', { costUsd: 2.5 }), machine('gone', { costUsd: 1, onFloor: false }), machine('idle')]), NOW)!;
    expect([...layer.text]).toEqual([['spec', '$2.50']]);
    expect(layer.max).toBe(2.5);
    expect(layer.legend).toContain('last 7 days');
    expect(layer.legend).toContain('$3.50 in all');
  });

  it('shows the average run time and the time spent waiting for a human', () => {
    const s = stats([machine('spec', { avgRunMs: 420_000, humanMs: 1_800_000, humanWaits: 1 }), machine('gate', { executor: 'human_gate', humanMs: 3_600_000, humanWaits: 3 })]);
    expect([...lensLayer('time', layout, [], s, NOW)!.text]).toEqual([['spec', '7m']]);
    const human = lensLayer('human', layout, [], s, NOW)!;
    expect([...human.text]).toEqual([['spec', '30m'], ['gate', '1h 00m · 3×']]);
    expect(human.max).toBe(3_600_000);
  });

  it('shows what stands on the floor right now without needing the stats', () => {
    const layer = lensLayer('load', layout, [ticket('a', 'gate', 'review', 90), ticket('b', 'gate', 'review', 10)], null, NOW)!;
    expect([...layer.text]).toEqual([['gate', '2 · 1h 30m']]);
    expect(layer.max).toBe(100 * 60_000);
    expect(lensLayer('load', layout, [], null, NOW)!.legend).toBe('Nothing stands anywhere right now');
  });

  it('says it is loading while the stats are not there yet', () => {
    const layer = lensLayer('cost', layout, [], null, NOW)!;
    expect(layer.values.size).toBe(0);
    expect(layer.legend).toContain('loading');
  });
});
