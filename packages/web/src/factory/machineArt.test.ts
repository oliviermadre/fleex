import { describe, expect, it } from 'vitest';
import { inRect, lampLines, lampOf, machineParts, placesOf, sortInto, type Rect } from './machineArt';
import type { FactoryTicket, StationSpec } from './types';

const station = (over: Partial<StationSpec> = {}): StationSpec => ({ id: 's', kind: 'station', x: 10, y: 20, w: 5, h: 4, name: 'Build', exec: 'agent', ref: 'builder', outcomes: ['ok'], cap: 2, ...over });
const t = (id: string, phase: FactoryTicket['phase'], since = '2026-01-01T00:00:00Z'): FactoryTicket => ({ ticketId: id, machineId: 's', info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since, runId: null, note: '', handedAt: '' });
const inside = (a: Rect, b: Rect) => a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;
const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9;

describe('the parts of a machine', () => {
  it('fit inside it and keep clear of one another, whatever its size and its places', () => {
    for (const [w, h] of [[5, 4], [3, 3], [8, 6]] as const) for (const cap of [1, 2, 3, 4, 6]) for (const exec of ['agent', 'human_gate'] as const) for (const tray of [false, true]) {
      const m = station({ w, h, cap, exec }), p = machineParts(m, tray), box: Rect = { x: m.x, y: m.y, w, h };
      const parts = [p.badge, p.lamp, ...(p.out ? [p.out] : []), ...(p.aside ? [p.aside] : []), ...(p.places.length ? p.places : [p.work])];
      for (const r of parts) { expect(inside(r, box), `${exec} ${w}x${h} cap ${cap}`).toBe(true); expect(r.w > 0 && r.h > 0).toBe(true); }
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(apart(parts[i]!, parts[j]!), `${exec} ${w}x${h} cap ${cap}: ${i} over ${j}`).toBe(true);
      for (const l of p.lights) expect(inRect(p.lamp, l.x, l.y)).toBe(true);
    }
  });

  it('has a tray only for what no arm takes: without one, the places take the whole width', () => {
    const m = station(), plain = machineParts(m), stuck = machineParts(m, true);
    expect(plain.out).toBeNull();
    expect(stuck.out).not.toBeNull();
    expect(plain.work.w).toBeGreaterThan(stuck.work.w);
    expect(plain.work.x + plain.work.w).toBeCloseTo(m.x + m.w - 0.22);
    /* the light is where it was whether there is a tray or not: it is a switch, it does not move under the pointer */
    expect(stuck.lamp).toEqual(plain.lamp);
  });

  it('a machine that runs something has as many places as it works on tickets, and a bay; a gate has neither', () => {
    expect(machineParts(station({ cap: 2 })).places).toHaveLength(2);
    expect(machineParts(station({ cap: 5 })).places).toHaveLength(5);
    expect(machineParts(station({ cap: 40 })).places).toHaveLength(6);             // as many as it can show
    expect(placesOf(station({ cap: 0 }))).toBe(1);
    expect(machineParts(station()).aside).not.toBeNull();
    const gate = machineParts(station({ exec: 'human_gate', cap: 8 }));
    expect(gate.places).toEqual([]);
    expect(gate.aside).toBeNull();
  });
});

describe('the light', () => {
  it('is red when the machine is off, amber when something in it is set aside, green otherwise', () => {
    expect(lampOf(station(), [])).toBe('on');
    expect(lampOf(station(), [t('a', 'running'), t('b', 'wait'), t('c', 'out')])).toBe('on');
    for (const p of ['question', 'failed', 'aside'] as const) expect(lampOf(station(), [t('a', 'running'), t('b', p)])).toBe('call');
    expect(lampOf(station({ off: true }), [t('b', 'failed')])).toBe('off');       // off says so first
  });

  it('on a gate, is amber while something is to decide: a gate has no switch', () => {
    const gate = station({ exec: 'human_gate', off: true });
    expect(lampOf(gate, [])).toBe('on');
    expect(lampOf(gate, [t('a', 'review')])).toBe('call');
    expect(lampOf(gate, [t('a', 'out')])).toBe('on');
  });

  it('says in words what runs, what is set aside and whether the exit is clear', () => {
    const lines = lampLines(station(), [t('a', 'running'), t('b', 'wait'), t('c', 'question'), t('d', 'aside'), t('e', 'out')]);
    expect(lines[0]).toBe('On, and it needs you');
    expect(lines).toContain('1 running of 2, 1 held');
    expect(lines).toContain('set aside: 1 question, 1 by you');
    expect(lines).toContain('exit: 1 done, waiting for an arm');
    expect(lampLines(station({ off: true }), [])).toEqual(['Off', '0 running of 2', 'exit clear', 'Click to switch it on: what it holds starts.']);
    expect(lampLines(station({ exec: 'human_gate' }), [t('a', 'review')])[0]).toBe('1 to decide');
  });
});

describe('where each ticket goes in a machine', () => {
  it('what runs and what is held take the places, what is done the tray, what is set aside the bay', () => {
    const s = sortInto(station({ cap: 2 }), [t('held', 'wait'), t('run', 'running'), t('done', 'out'), t('q', 'question'), t('f', 'failed'), t('mine', 'aside')]);
    expect(s.places.map((x) => x?.ticketId)).toEqual(['run', 'held']);
    expect(s.out.map((x) => x.ticketId)).toEqual(['done']);
    expect(s.aside.map((x) => x.ticketId).sort()).toEqual(['f', 'mine', 'q']);
    expect(s.extra).toEqual([]);
  });

  it('shows empty places, and counts what they cannot show', () => {
    expect(sortInto(station({ cap: 3 }), [t('a', 'running')]).places.map((x) => x?.ticketId ?? null)).toEqual(['a', null, null]);
    expect(sortInto(station({ cap: 1 }), [t('a', 'running'), t('b', 'wait')]).extra.map((x) => x.ticketId)).toEqual(['b']);
  });

  it('a gate has what is to decide and what was decided', () => {
    const s = sortInto(station({ exec: 'human_gate' }), [t('a', 'review'), t('b', 'out')]);
    expect([s.places, s.deciding.map((x) => x.ticketId), s.out.map((x) => x.ticketId)]).toEqual([[], ['a'], ['b']]);
  });
});
