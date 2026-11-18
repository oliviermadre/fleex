import { describe, it, expect } from 'vitest';
import { addTo } from './pick';
import { groupOf, ticketsIn } from './pick';
import type { FactoryTicket, MachineSpec, TicketPhase } from './types';

const station: MachineSpec = { id: 'dev', kind: 'station', x: 0, y: 0, w: 5, h: 4, name: 'Dev', exec: 'agent', outcomes: ['ok'], cap: 2 };
const gate: MachineSpec = { id: 'qa', kind: 'station', x: 8, y: 0, w: 5, h: 4, name: 'QA', exec: 'human_gate', outcomes: ['approve'], cap: 8 };
const zone: MachineSpec = { id: 'z', kind: 'zone', x: 0, y: 6, w: 2, h: 2, name: 'Zone', release: 'manual' };
const t = (id: string, machineId: string, phase: TicketPhase, over: Partial<FactoryTicket> = {}): FactoryTicket =>
  ({ ticketId: id, machineId, info: { id, displayId: 1, title: id, type: 'build', priority: 'medium', status: 'todo', tags: [], boardId: 'b', complexity: null, favorite: false, blocked: false }, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '', ...over });

describe('a frame dragged over the floor', () => {
  const places: [string, { x: number; y: number }][] = [['a', { x: 1, y: 1 }], ['b', { x: 4.5, y: 2 }], ['c', { x: 9, y: 9 }], ['d', { x: 4.5, y: 6 }]];

  it('takes the tickets inside it, whichever way it was dragged', () => {
    expect(ticketsIn(places, { x0: 0, y0: 0, x1: 5, y1: 3 })).toEqual(['a', 'b']);
    expect(ticketsIn(places, { x0: 5, y0: 3, x1: 0, y1: 0 })).toEqual(['a', 'b']);
    expect(ticketsIn(places, { x0: 4, y0: 7, x1: 5, y1: 1 })).toEqual(['b', 'd']);
  });

  it('takes none when none is in it, and one on its edge', () => {
    expect(ticketsIn(places, { x0: 6, y0: 0, x1: 8, y1: 5 })).toEqual([]);
    expect(ticketsIn(places, { x0: 1, y0: 1, x1: 1, y1: 1 })).toEqual(['a']);
  });
});

describe('picking with Shift held', () => {
  it('replaces the selection without Shift', () => {
    expect(addTo(['a', 'b'], ['c'], false)).toEqual(['c']);
    expect(addTo(['a', 'b'], [], false)).toEqual([]);
  });

  it('adds what was not there, in the order picked, and never twice', () => {
    expect(addTo(['a'], ['b'], true, true)).toEqual(['a', 'b']);
    expect(addTo(['a', 'b'], ['b', 'c', 'd'], true)).toEqual(['a', 'b', 'c', 'd']);
    expect(addTo([], ['a'], true, true)).toEqual(['a']);
  });

  it('takes out the one thing clicked that was already there; a frame only adds', () => {
    expect(addTo(['a', 'b', 'c'], ['b'], true, true)).toEqual(['a', 'c']);
    expect(addTo(['a', 'b', 'c'], ['b'], true)).toEqual(['a', 'b', 'c']);
    expect(addTo(['a'], ['a'], true, true)).toEqual([]);
  });

  it('keeps the selection when Shift is held and nothing was picked', () => {
    expect(addTo(['a', 'b'], [], true)).toEqual(['a', 'b']);
  });
});

describe('what a group of tickets can do together', () => {
  it('counts what each command would act on', () => {
    const g = groupOf([
      t('a', 'z', 'zone'), t('b', 'z', 'zone', { released: true }),
      t('c', 'dev', 'failed'), t('d', 'dev', 'aside'), t('e', 'dev', 'question'),
      t('f', 'dev', 'running'), t('g', 'dev', 'out'), t('h', 'qa', 'review'),
    ], [station, gate, zone]);
    expect(g).toEqual({ count: 8, release: 1, retry: 2, aside: 2, starred: false });
  });

  it('removes the star only when every ticket has one', () => {
    const fav = (id: string, favorite: boolean) => { const x = t(id, 'z', 'zone'); return { ...x, info: { ...x.info!, favorite } }; };
    expect(groupOf([fav('a', true), fav('b', true)], [zone]).starred).toBe(true);
    expect(groupOf([fav('a', true), fav('b', false)], [zone]).starred).toBe(false);
    expect(groupOf([], [zone])).toEqual({ count: 0, release: 0, retry: 0, aside: 0, starred: false });
  });
});
