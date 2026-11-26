import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FactoryView, type ViewState } from './renderer';
import type { Piece, Skin } from './skins/skin';
import type { FactoryLayout, FactoryTicket, MachineSpec } from './types';

/** A canvas context that takes anything and does nothing. */
const ink = (): CanvasRenderingContext2D => new Proxy({}, { get: (_t, k) => (k === 'getTransform' ? () => ({}) : () => undefined), set: () => true }) as CanvasRenderingContext2D;
const canvas = (): HTMLCanvasElement => ({ getContext: () => ink(), clientWidth: 800, clientHeight: 600, width: 0, height: 0 }) as unknown as HTMLCanvasElement;

const station: MachineSpec = { id: 's', kind: 'station', x: 2, y: 0, w: 5, h: 4, name: 'Build', exec: 'agent', outcomes: ['ok'], cap: 2 };
const layout: FactoryLayout = { version: 2, w: 0, h: 0, machines: [station, { id: 'b', kind: 'belt', x: 0, y: 6, w: 1, h: 1, dir: 0 }] };
const ticket = (more: Partial<FactoryTicket> = {}): FactoryTicket => ({ ticketId: 't', machineId: 's', info: null, x: 0, y: 0, phase: 'wait', p: 0.5, fx: 1, fy: 0, outcome: '', released: false, since: '2026-01-01T00:00:00Z', runId: null, note: '', handedAt: '2026-01-01T00:00:00Z', ...more });
const base: ViewState = { layout, tickets: [ticket()], arms: new Map(), selMachine: null, selMany: [], marquee: null, selTicket: null, hoverMachine: null, edit: false, ghost: null, drag: null };
/** As the page gives it: a fresh object at every frame, its arms told anew, the rest the same. */
const state = (more: Partial<ViewState> = {}): ViewState => ({ ...base, arms: new Map(), armAge: Math.random(), ...more });

/** A skin that counts what it is asked to paint: a floor piece, the chevrons, a piece over them. */
function counting(layered: boolean) {
  const n = { ground: 0, under: 0, chevrons: 0, over: 0, top: 0, readings: 0, words: 0, light: 0 };
  const skin: Skin = {
    id: 'count', layered,
    ground: () => { n.ground++; },
    pieces: (_S, _st, out: Piece[]) => {
      out.push({ layer: 'standing', depth: 3, draw: () => { n.over++; } }, { layer: 'standing', depth: 1, draw: () => { n.chevrons++; }, turns: true }, { layer: 'standing', depth: 0, draw: () => { n.under++; } });
    },
    top: () => { n.top++; },
    aim: () => undefined, readings: () => { n.readings++; }, light: () => { n.light++; }, words: () => { n.words++; },
    minimap: () => undefined,
  };
  return { skin, n };
}

describe('the picture kept in layers', () => {
  beforeEach(() => { vi.spyOn(document, 'createElement').mockImplementation(() => canvas() as unknown as HTMLElement); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('paints the floor straight at first, then on its layers, then only the chevrons anew', () => {
    const { skin, n } = counting(true), v = new FactoryView(canvas(), skin);
    v.draw(state(), 0); expect(v.painted).toBe('straight');
    v.draw(state(), 1 / 30); expect(v.painted).toBe('layers');
    const kept = { ...n };
    for (let k = 0; k < 5; k++) { v.draw(state(), 1 / 30); expect(v.painted).toBe('kept'); }
    expect(n.chevrons).toBe(kept.chevrons + 5);
    expect([n.ground, n.under, n.over, n.readings]).toEqual([kept.ground, kept.under, kept.over, kept.readings]);
  });

  it('paints what is under the chevrons, what is over them and the words once each on the layers', () => {
    const { skin, n } = counting(true), v = new FactoryView(canvas(), skin);
    v.draw(state(), 0); v.draw(state(), 1 / 30);
    expect([n.ground, n.under, n.over, n.top, n.readings]).toEqual([2, 2, 2, 1, 1]);
    expect(n.words).toBeGreaterThanOrEqual(1);
  });

  it('paints the layers again after a while, in case something changed that nothing says', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { skin } = counting(true), v = new FactoryView(canvas(), skin);
    v.draw(state(), 0); v.draw(state(), 1 / 30); v.draw(state(), 1 / 30);
    expect(v.painted).toBe('kept');
    now.mockReturnValue(1600);
    v.draw(state(), 1 / 30); expect(v.painted).toBe('layers');
    v.draw(state(), 1 / 30); expect(v.painted).toBe('kept');
  });

  it('keeps nothing of a picture whose state changes: a selection, a ticket that comes, the view that moves', () => {
    const { skin } = counting(true), v = new FactoryView(canvas(), skin), settle = () => { v.draw(state(), 1 / 30); v.draw(state(), 1 / 30); expect(v.painted).toBe('kept'); };
    v.draw(state(), 0); settle();
    v.draw(state({ selMachine: 's' }), 1 / 30); expect(v.painted).toBe('straight');
    v.draw(state({ selMachine: 's' }), 1 / 30); expect(v.painted).toBe('layers');
    v.draw(state(), 1 / 30); expect(v.painted).toBe('straight');
    settle();
    v.cam.x += 0.5; v.draw(state(), 1 / 30); expect(v.painted).toBe('straight');
    settle();
    v.draw(state({ tickets: [ticket()] }), 1 / 30); expect(v.painted).toBe('straight');
  });

  it('paints straight while something moves on the floor, and keeps the picture again once it has come to rest', () => {
    const { skin } = counting(true), v = new FactoryView(canvas(), skin);
    const there = state({ tickets: [ticket({ machineId: null, phase: 'loose', x: 30, y: 20 })] }).tickets;
    v.draw(state(), 0); v.draw(state(), 1 / 30); v.draw(state(), 1 / 30);
    v.draw(state({ tickets: there }), 1 / 30);
    for (let k = 0; k < 10; k++) { v.draw(state({ tickets: there }), 1 / 30); expect(v.painted).toBe('straight'); expect(v.moving).toBe(true); }
    for (let k = 0; k < 200; k++) v.draw(state({ tickets: there }), 1 / 30);
    expect(v.moving).toBe(false);
    expect(v.painted).not.toBe('straight');
  });

  it('paints straight, always, with a skin that cannot be kept in layers', () => {
    const { skin, n } = counting(false), v = new FactoryView(canvas(), skin);
    for (let k = 0; k < 4; k++) { v.draw(state(), 1 / 30); expect(v.painted).toBe('straight'); }
    expect(n.top).toBe(4);
  });
});
