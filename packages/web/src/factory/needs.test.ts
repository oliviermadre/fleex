import { describe, expect, it } from 'vitest';
import { needKind, needsOf, standing, stepNeed } from './needs';
import type { FactoryTicket, MachineSpec } from './types';

const now = '2026-01-01T12:00:00.000Z';
const t = (id: string, phase: FactoryTicket['phase'], minutesAgo: number, over: Partial<FactoryTicket> = {}): FactoryTicket =>
  ({ ticketId: id, machineId: 'build', info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: new Date(Date.parse(now) - minutesAgo * 60_000).toISOString(), runId: null, note: '', handedAt: '', ...over });
const machines: MachineSpec[] = [
  { id: 'build', kind: 'station', x: 0, y: 0, w: 5, h: 4, name: 'Build', exec: 'agent', outcomes: ['ok'], cap: 2 },
  { id: 'gate', kind: 'station', x: 9, y: 0, w: 5, h: 4, exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 },
  { id: 'belt', kind: 'belt', x: 6, y: 1, w: 1, h: 1, dir: 0 },
];

describe('the tickets that wait for someone', () => {
  it('says what each one waits for, and leaves out the ones the floor is dealing with', () => {
    expect(needKind(t('a', 'review', 1))).toBe('decision');
    expect(needKind(t('a', 'question', 1))).toBe('question');
    expect(needKind(t('a', 'failed', 1))).toBe('failed');
    expect(needKind(t('a', 'aside', 1))).toBe('aside');
    expect(needKind(t('a', 'loose', 1))).toBe('floor');
    expect(needKind(t('a', 'belt', 1, { outcome: 'question' }))).toBe('question');     // an unanswered question travels with its ticket
    for (const p of ['wait', 'running', 'out', 'zone', 'belt', 'arm'] as const) expect(needKind(t('a', p, 1))).toBeNull();
  });

  it('lists them longest wait first, with where they are', () => {
    const list = needsOf([
      t('run', 'running', 90), t('q', 'question', 5), t('g', 'review', 40, { machineId: 'gate' }), t('f', 'failed', 12),
      t('trav', 'belt', 2, { machineId: 'belt', outcome: 'question' }), t('lost', 'loose', 1, { machineId: null }),
    ], machines, now);
    expect(list.map((n) => [n.ticket.ticketId, n.kind, n.where])).toEqual([
      ['g', 'decision', 'Gate'], ['f', 'failed', 'Build'], ['q', 'question', 'Build'], ['trav', 'question', 'On a belt'], ['lost', 'floor', 'Floor'],
    ]);
    expect(list[0]!.waitMs).toBe(40 * 60_000);
  });

  it('walks them round and round, starting at an end when the current ticket is not one of them', () => {
    const list = needsOf([t('a', 'review', 3), t('b', 'failed', 2), t('c', 'aside', 1)], machines, now);
    expect(stepNeed(list, 'a', 1)).toBe('b');
    expect(stepNeed(list, 'c', 1)).toBe('a');
    expect(stepNeed(list, 'a', -1)).toBe('c');
    expect(stepNeed(list, null, 1)).toBe('a');
    expect(stepNeed(list, 'elsewhere', -1)).toBe('c');
    expect(stepNeed([], 'a', 1)).toBeNull();
  });
});

describe('standing', () => {
  const build = machines[0]!, gate = machines[1]!, belt = machines[2]!;
  it('names the machine and what happens to the ticket there', () => {
    expect(standing(t('a', 'running', 1), build)).toEqual({ where: 'Build', state: 'Running' });
    expect(standing(t('a', 'out', 1, { outcome: 'ok' }), build)).toEqual({ where: 'Build', state: 'Done as ok, waiting to be taken' });
    expect(standing(t('a', 'review', 1), gate)).toEqual({ where: 'Gate', state: 'Waiting for your decision' });
    expect(standing(t('a', 'aside', 1), build).state).toBe('Set aside by you');
    expect(standing(t('a', 'belt', 1), belt)).toEqual({ where: 'On a belt', state: 'On its way' });
    expect(standing(t('a', 'loose', 1), null).where).toBe('Floor');
  });
  it('says why a ticket waits when its station says so, and that a travelling question is still open', () => {
    expect(standing(t('a', 'wait', 1, { note: 'Dev is switched off' }), build).state).toBe('Dev is switched off');
    expect(standing(t('a', 'wait', 1), build).state).toBe('Waiting to start');
    expect(standing(t('a', 'belt', 1, { outcome: 'question' }), belt).state).toBe('Carries a question for you');
  });
});
