import { describe, expect, it } from 'vitest';
import { arrivalOf, arrivalsOn, departuresOf, PORT_COLOR, portBad, portColor, portDrop, portLine, portName, portOwnColor, portState, relink } from './teleport';
import { pasteAt, specFor, type Clip } from './layoutOps';
import type { ArmCondition, ArmSpec, FactoryLayout, FactoryTicket, MachineSpec, TeleporterSpec } from './types';

const port = (id: string, role: 'departure' | 'arrival', over: Partial<TeleporterSpec> = {}): TeleporterSpec => ({ id, kind: 'teleporter', x: 0, y: 0, w: 1, h: 1, name: id, role, ...over });
const land = port('land', 'arrival', { color: '#f472b6', x: 9, y: 4 }), other = port('other', 'arrival', { x: 9, y: 8 });
const go = port('go', 'departure', { to: 'land', x: 4, y: 2 }), qa = port('qa', 'departure', { to: 'land', x: 4, y: 6 }), lost = port('lost', 'departure', { to: 'gone' }), plain = port('plain', 'departure', { to: 'other' });
const machines: MachineSpec[] = [land, other, go, qa, lost, plain, { id: 'b', kind: 'belt', x: 1, y: 1, w: 1, h: 1, dir: 0 }];
const find = (id: string) => machines.find((m) => m.id === id);
const arm = (id: string, when: ArmCondition[] = []): ArmSpec => ({ id, kind: 'arm', x: 10, y: 4, w: 1, h: 1, dir: 0, when });
const ticket = (id: string, machineId: string, outcome = ''): FactoryTicket => ({ ticketId: id, machineId, info: null, x: 0, y: 0, phase: 'port', p: 0, fx: 1, fy: 0, outcome, released: false, since: '', runId: null, note: '', handedAt: '' });

describe('where a departure leads', () => {
  it('to the arrival it is set to, while that one is on the floor and is an arrival', () => {
    expect(arrivalOf(go, find)).toBe(land);
    expect(arrivalOf(lost, find)).toBeNull();                               // the arrival was removed
    expect(arrivalOf(port('x', 'departure', { to: 'go' }), find)).toBeNull(); // not to another departure
    expect(arrivalOf(land, find)).toBeNull();                               // an arrival leads nowhere
    expect(departuresOf(land, machines).map((m) => m.id)).toEqual(['go', 'qa']);
    expect(arrivalsOn(machines).map((m) => m.id)).toEqual(['land', 'other']);
    expect(portName(port('', 'departure', { name: '' }))).toBe('Departure');
    expect(portName(port('', 'arrival', { name: '' }))).toBe('Arrival');
  });
});

describe('the colour of a teleporter', () => {
  it('is the one it was given; without one, a departure takes that of its arrival, so the two read as a pair', () => {
    expect(portColor(land, find)).toBe('#f472b6');
    expect(portColor(go, find)).toBe('#f472b6');
    expect(portColor({ ...go, color: '#ef4444' }, find)).toBe('#ef4444');
    expect(portColor(plain, find)).toBe(PORT_COLOR);                         // its arrival has none either
    expect(portColor(lost, find)).toBe(PORT_COLOR);
    expect(portColor({ ...go, color: 'red' }, find)).toBe('#f472b6');        // what is not a colour is not taken for one
    /* what "Automatic" shows in the popup, whatever was picked */
    expect(portOwnColor({ ...go, color: '#ef4444' }, find)).toBe('#f472b6');
  });
});

describe('what a teleporter is doing', () => {
  const none = { arrival: null, arrivalHolds: false, holds: null, takers: [] as ArmSpec[] };
  it('a departure waits while its arrival holds a ticket, and says when it leads nowhere', () => {
    expect(portState(go, { ...none, arrival: land })).toBe('ok');
    expect(portState(go, { ...none, arrival: land, holds: ticket('a', 'go') })).toBe('ok');                       // about to go
    expect(portState(go, { ...none, arrival: land, holds: ticket('a', 'go'), arrivalHolds: true })).toBe('waiting');
    expect(portState(go, { ...none, arrival: land, arrivalHolds: true })).toBe('ok');                             // nothing of its own to hold back
    expect(portState(lost, none)).toBe('no-destination');
    expect(portBad('no-destination')).toBe(true); expect(portBad('waiting')).toBe(false);
  });
  it('an arrival is stuck when it holds a ticket no arm takes', () => {
    const ok = arm('ok', [{ field: 'outcome', op: 'is', values: ['ok'] }]);
    expect(portState(land, none)).toBe('ok');                                                                     // empty: nothing to say yet
    expect(portState(land, { ...none, holds: ticket('a', 'land') })).toBe('no-arm');
    expect(portState(land, { ...none, holds: ticket('a', 'land'), takers: [arm('any')] })).toBe('ok');
    expect(portState(land, { ...none, holds: ticket('a', 'land', 'ko'), takers: [ok] })).toBe('no-arm');          // an arm, but not for this one
    expect(portBad('no-arm')).toBe(true);
  });
  it('says it in a line under its name', () => {
    expect(portLine(go, 'ok', land, 0)).toBe('→ land');
    expect(portLine(go, 'waiting', land, 0)).toBe('waits · arrival busy');
    expect(portLine(lost, 'no-destination', null, 0)).toBe('no destination');
    expect(portLine(land, 'ok', null, 2)).toBe('← 2 departures');
    expect(portLine(land, 'ok', null, 1)).toBe('← 1 departure');
    expect(portLine(land, 'ok', null, 0)).toBe('no departure leads here');
    expect(portLine(land, 'no-arm', null, 2)).toBe('no arm takes from it');
  });
});

describe('dropping a ticket on a teleporter by hand', () => {
  it('a departure takes one, an arrival none', () => {
    expect(portDrop(go, false, land)).toEqual({ ok: true, text: 'Send to land' });
    expect(portDrop(go, true, land).ok).toBe(false);
    expect(portDrop(lost, false, null)).toMatchObject({ ok: true });
    expect(portDrop(lost, false, null).text).toMatch(/leads nowhere/);
    expect(portDrop(land, false, null)).toMatchObject({ ok: false });
    expect(portDrop(land, false, null).text).toMatch(/Nothing enters an arrival/);
  });
});

describe('building with teleporters', () => {
  it('a new one is a departure on one tile, with nothing set', () => {
    expect(specFor('teleporter', 3, 4, 0)).toMatchObject({ kind: 'teleporter', x: 3, y: 4, w: 1, h: 1, role: 'departure', name: '' });
  });
  it('pasted with its arrival, a departure leads to the copy; pasted alone, to the arrival it led to', () => {
    const layout: FactoryLayout = { w: 30, h: 30, machines: [land, go] };
    const both: Clip = { machines: [{ ...go, x: 0, y: 0 }, { ...land, x: 2, y: 0 }], w: 3, h: 1 } as unknown as Clip;
    const pasted = pasteAt(layout, both, 15, 15)!, copies = pasted.layout.machines.filter((m) => pasted.ids.includes(m.id)) as TeleporterSpec[];
    const d = copies.find((m) => m.role === 'departure')!, a = copies.find((m) => m.role === 'arrival')!;
    expect(d.to).toBe(a.id); expect(a.id).not.toBe('land');
    const alone: Clip = { machines: [{ ...go, x: 0, y: 0 }], w: 1, h: 1 } as unknown as Clip;
    const again = pasteAt(layout, alone, 20, 20)!;
    expect((again.layout.machines.find((m) => again.ids.includes(m.id)) as TeleporterSpec).to).toBe('land');
    expect(relink([go], new Map([['nothing', 'x']]))[0]).toBe(go);
  });
});
