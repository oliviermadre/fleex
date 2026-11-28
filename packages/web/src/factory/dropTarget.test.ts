import { describe, expect, it } from 'vitest';
import { dropAt, type FloorReader } from './dropTarget';
import type { FactoryTicket, MachineSpec } from './types';

const machines: MachineSpec[] = [
  { id: 'build', kind: 'station', x: 8, y: 4, w: 5, h: 5, name: 'Build', exec: 'agent', outcomes: ['done'], cap: 2 },
  { id: 'belt', kind: 'belt', x: 5, y: 6, w: 3, h: 1, dir: 0 },
  { id: 'dead', kind: 'belt', x: 5, y: 12, w: 1, h: 1, dir: 3 },
  { id: 'arm', kind: 'arm', x: 14, y: 6, w: 1, h: 1, dir: 0 },
  { id: 'zone', kind: 'zone', x: 0, y: 4, w: 5, h: 5, release: 'manual' },
  { id: 'desk', kind: 'desk', x: 0, y: 0, w: 3, h: 3 },
  { id: 'intake', kind: 'intake', x: 4, y: 0, w: 3, h: 3, source: 'gmail' },
  { id: 'exit', kind: 'exit', x: 20, y: 5, w: 3, h: 3, name: 'Shipped' },
  { id: 'dep', kind: 'teleporter', x: 30, y: 0, w: 1, h: 1, role: 'departure', to: 'arr' },
  { id: 'arr', kind: 'teleporter', x: 32, y: 0, w: 1, h: 1, role: 'arrival' },
];
const floor: FloorReader = {
  at: (x, y) => machines.find((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) ?? null,
  machine: (id) => machines.find((m) => m.id === id) ?? null,
  leadsTo: (m) => (m?.id === 'belt' ? machines[0]! : null),
};
const held = (machineId: string): FactoryTicket => ({ ticketId: 'x', machineId, info: null, x: 0, y: 0, phase: 'port', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '' });

describe('where a ticket taken in hand may be put', () => {
  it('in a station, a zone or an exit, by the machine', () => {
    expect(dropAt(floor, [], 10.4, 6.7)).toEqual({ target: { machineId: 'build' }, ok: true, can: true, text: 'Drop in Build' });
    expect(dropAt(floor, [], 1, 5)).toMatchObject({ target: { machineId: 'zone' }, ok: true, text: 'Drop in zone' });
    expect(dropAt(floor, [], 21, 6)).toMatchObject({ target: { machineId: 'exit' }, ok: true, text: 'Ship: sets it to done' });
  });

  it('on a belt, which says where it leads', () => {
    expect(dropAt(floor, [], 6.5, 6.5)).toMatchObject({ target: { machineId: 'belt' }, ok: true, text: 'Belt → towards Build' });
    expect(dropAt(floor, [], 5.5, 12.5).text).toBe('Belt ↑: leads nowhere');
  });

  it('on the bare floor, where it may lie but will not move by itself', () => {
    expect(dropAt(floor, [], 40.7, 18.2)).toEqual({ target: { x: 40, y: 18 }, ok: false, can: true, text: 'On the floor: it will not move by itself' });
  });

  it('not on an arm, a desk or an intake', () => {
    for (const [x, y, why] of [[14.5, 6.5, 'arm'], [1, 1, 'desk'], [5, 1, 'intake']] as const) {
      const d = dropAt(floor, [], x, y);
      expect([d.can, d.ok, d.target]).toEqual([false, false, {}]);
      expect(d.text).toContain(why);
    }
  });

  it('in a departure that is free, never in an arrival', () => {
    expect(dropAt(floor, [], 30.5, 0.5)).toMatchObject({ target: { machineId: 'dep' }, ok: true, can: true });
    expect(dropAt(floor, [held('dep')], 30.5, 0.5).can).toBe(false);
    expect(dropAt(floor, [], 32.5, 0.5).can).toBe(false);
  });
});
