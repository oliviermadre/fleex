import { describe, expect, it } from 'vitest';
import { walkSet } from './FactoryWorkbench';
import type { Need } from './needs';
import type { FactoryTicket } from './types';

const t = (id: string, machineId: string, since = '2026-01-01T10:00:00Z'): FactoryTicket => ({ ticketId: id, machineId, info: null, x: 0, y: 0, phase: 'wait', p: 0, fx: 1, fy: 0, outcome: '', released: false, since, runId: null, note: '', handedAt: '' });
const need = (ticket: FactoryTicket): Need => ({ ticket, kind: 'decision', where: 'Gate', waitMs: 0 });

describe('what the arrows walk on the workbench', () => {
  const a = t('a', 'gate'), b = t('b', 'gate'), c = t('c', 'build', '2026-01-01T09:00:00Z'), d = t('d', 'build'), all = [a, b, c, d];

  it('the tickets that wait for someone, in their order', () => {
    expect(walkSet('needs', a, [need(b), need(a)], all).map((x) => x.ticketId)).toEqual(['b', 'a']);
  });

  it('with the open ticket first when it is not one of them, so there is always a way back to it', () => {
    expect(walkSet('needs', c, [need(a), need(b)], all).map((x) => x.ticketId)).toEqual(['c', 'a', 'b']);
  });

  it('or the tickets of the same machine, oldest there first', () => {
    expect(walkSet('station', d, [need(a)], all).map((x) => x.ticketId)).toEqual(['c', 'd']);
    expect(walkSet('station', a, [], all).map((x) => x.ticketId)).toEqual(['a', 'b']);
  });

  it('a ticket that left the floor still leaves the others to walk', () => {
    expect(walkSet('needs', null, [need(a)], all).map((x) => x.ticketId)).toEqual(['a']);
  });
});
