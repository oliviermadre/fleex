import { describe, expect, it } from 'vitest';
import { dispatch, entryOf, QUAY_IN, QUAY_SIZE, quayOf, quayRect, quaySpot, reachOf, REACH_QUAY, REACH_TILE } from './quays';
import type { ArmCondition, ArmSpec, FactoryTicket, MachineSpec, StationSpec, ZoneSpec } from './types';

const box: StationSpec = { id: 's', kind: 'station', x: 10, y: 20, w: 5, h: 4, name: 'Build', exec: 'agent', ref: 'builder', outcomes: ['ok', 'ko'], cap: 2 };
const zone: ZoneSpec = { id: 'z', kind: 'zone', x: 0, y: 0, w: 4, h: 3, name: 'Todo', release: 'manual' };
const is = (v: string): ArmCondition[] => [{ field: 'outcome', op: 'is', values: [v] }];
const arm = (id: string, x: number, y: number, dir: 0 | 1 | 2 | 3, when: ArmCondition[] = []): ArmSpec => ({ id, kind: 'arm', x, y, w: 1, h: 1, dir, when });
const t = (id: string, phase: FactoryTicket['phase'], outcome = '', over: Partial<FactoryTicket> = {}): FactoryTicket => ({ ticketId: id, machineId: 's', info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome, released: false, since: '2026-01-01T00:00:00Z', runId: null, note: '', handedAt: '', ...over });
/* one arm on each side of the box, each pointing away from it */
const right = arm('r', 15, 21, 0), below = arm('b', 11, 24, 1), left = arm('l', 9, 22, 2), above = arm('a', 13, 19, 3);

describe('the quay of an arm', () => {
  it('is on the tile behind the arm, just inside the edge it faces, whichever side the arm stands on', () => {
    expect(quayOf(right)).toEqual({ x: 15 - QUAY_IN, y: 21.5 });
    expect(quayOf(below)).toEqual({ x: 11.5, y: 24 - QUAY_IN });
    expect(quayOf(left)).toEqual({ x: 10 + QUAY_IN, y: 22.5 });
    expect(quayOf(above)).toEqual({ x: 13.5, y: 20 + QUAY_IN });
    for (const a of [right, below, left, above]) {
      const q = quayRect(a);
      /* inside the box, against its edge */
      expect(q.x).toBeGreaterThanOrEqual(box.x - 1e-9); expect(q.x + q.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(box.y - 1e-9); expect(q.y + q.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
      expect(q.w).toBe(QUAY_SIZE);
    }
  });

  it('is where the cup of the arm is when it picks: the arm lifts what it is on', () => {
    for (const a of [right, below, left, above]) {
      const q = quayOf(a);
      expect(Math.hypot(q.x - (a.x + 0.5), q.y - (a.y + 0.5))).toBeCloseTo(reachOf(box, null).from);
    }
    expect(reachOf(box, null)).toEqual({ from: REACH_QUAY, to: REACH_TILE });
    /* a belt holds its ticket in the middle of its tile, and that is where the cup goes */
    const belt: MachineSpec = { id: 'c', kind: 'belt', x: 0, y: 0, w: 1, h: 1, dir: 0 };
    expect(reachOf(belt, box)).toEqual({ from: REACH_TILE, to: REACH_QUAY });
    expect(reachOf(null, { id: 'e', kind: 'exit', x: 0, y: 0, w: 2, h: 2, name: 'Exit' })).toEqual({ from: REACH_TILE, to: REACH_QUAY });
  });

  it('lines up what waits behind the first ticket, further into the box, and no further than it shows', () => {
    const q = quayOf(right);
    expect(quaySpot(right, 0)).toEqual(q);
    expect(quaySpot(right, 1).x).toBeLessThan(q.x); expect(quaySpot(right, 1).y).toBe(q.y);
    expect(quaySpot(below, 1).y).toBeLessThan(quayOf(below).y);
    expect(quaySpot(right, 9)).toEqual(quaySpot(right, 2));
  });
});

describe('which arm a ticket leaves by', () => {
  const ok = arm('ok', 15, 21, 0, is('ok')), ko = arm('ko', 11, 24, 1, is('ko')), other = arm('else', 9, 22, 2);

  it('what is done goes to the arm that asks for its outcome; a plain arm gets what the others leave', () => {
    const d = dispatch(box, [ok, ko, other], [t('a', 'out', 'ok'), t('b', 'out', 'ko'), t('c', 'out', 'later'), t('d', 'running')]);
    expect(d.quay).toEqual(new Map([['a', 'ok'], ['b', 'ko'], ['c', 'else']]));
    expect(d.byArm.get('ok')!.map((x) => x.ticketId)).toEqual(['a']);
    expect(d.stuck).toEqual([]);
  });

  it('what no arm takes is stuck, and says so: it will not leave by itself', () => {
    const d = dispatch(box, [ok], [t('a', 'out', 'ok'), t('b', 'out', 'ko')]);
    expect(d.quay.get('a')).toBe('ok');
    expect(d.stuck.map((x) => x.ticketId)).toEqual(['b']);
    expect(dispatch(box, [], [t('a', 'out', 'ok')]).stuck).toHaveLength(1);
  });

  it('a question leaves only by an arm that asks for questions; otherwise it is set aside, not stuck', () => {
    const q = arm('q', 13, 19, 3, is('question'));
    expect(dispatch(box, [ok, q], [t('a', 'question', 'question')]).quay.get('a')).toBe('q');
    const none = dispatch(box, [ok, other], [t('a', 'question', 'question')]);
    expect(none.quay.size).toBe(0); expect(none.stuck).toEqual([]);
  });

  it('a zone lets out what was released, and nothing else', () => {
    const a = arm('a', 4, 1, 0);
    const d = dispatch(zone, [a], [t('x', 'zone', '', { machineId: 'z' }), t('y', 'zone', '', { machineId: 'z', released: true })]);
    expect([...d.quay]).toEqual([['y', 'a']]);
    expect(d.stuck).toEqual([]);
  });

  it('between arms that take the same ticket: the shortest line, the one at rest first, and a ticket does not change quay', () => {
    const one = arm('one', 15, 21, 0), two = arm('two', 15, 22, 0), out = [t('a', 'out', 'ok'), t('b', 'out', 'ok'), t('c', 'out', 'ok')];
    expect([...dispatch(box, [one, two], out).quay.values()]).toEqual(['one', 'two', 'one']);
    expect(dispatch(box, [one, two], [out[0]!], { busy: (id) => id === 'one' }).quay.get('a')).toBe('two');
    expect(dispatch(box, [one, two], [out[0]!], { keep: new Map([['a', 'two']]) }).quay.get('a')).toBe('two');
    /* kept only while that arm still takes it */
    expect(dispatch(box, [one], [out[0]!], { keep: new Map([['a', 'two']]) }).quay.get('a')).toBe('one');
  });
});

describe('where something crosses into a box', () => {
  const exit = { x: 10, y: 10, w: 3, h: 3 };
  it('is the point of its edge nearest to where it comes from, with the side it is on', () => {
    expect(entryOf(exit, { x: 9.2, y: 11.5 })).toEqual({ x: 10, y: 11.5, ax: 0, ay: 1 });      // by a belt on the left
    expect(entryOf(exit, { x: 11.5, y: 13.6 })).toEqual({ x: 11.5, y: 13, ax: 1, ay: 0 });     // from underneath
    expect(entryOf(exit, { x: 13.4, y: 10.5 })).toEqual({ x: 13, y: 10.5, ax: 0, ay: 1 });
  });
  it('counts what an arm has already put just inside as on the side it is nearest to', () => {
    expect(entryOf(exit, { x: 10.26, y: 11.5 })).toEqual({ x: 10, y: 11.5, ax: 0, ay: 1 });
    expect(entryOf(exit, { x: 11.5, y: 10.26 })).toEqual({ x: 11.5, y: 10, ax: 1, ay: 0 });
  });
});
