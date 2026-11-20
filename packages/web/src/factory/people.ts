/**
 * The people of the floor: cosmetic, the page's own. They carry no ticket, take no tile, answer no click, and nothing
 * of them is kept: after a reload they are somewhere else. They say what the floor is doing. DRAFT for the people
 * mock-up (`docs/factory/people.html`): off in the app until the owner picks.
 * `hands`: a worker raises a hand at a station whose run failed, and a "?" over one that asked a question.
 *
 * - Walkers go about the hall on the free tiles (no machine, no area, no prop), from one far point to another along a
 *   path found on the grid, and stop a moment where they arrive.
 * - When a gate waits for a decision, a reviewer walks to its foot and waits there, clipboard in hand, until nothing
 *   is left to decide; then goes back to walking.
 *
 * What is told at a station (a worker raising a hand on a failed run, a "?" on a question) is drawn by the skins from
 * the scene: it needs no one to walk.
 */
import { seed, type Rect } from './decor';
import type { FactoryLayout, MachineSpec } from './types';

/**
 * What the owner chooses on the mock-up: how many walk (none, a few, more), and which events bring someone (a gate
 * that waits). `still`: the reader asked for less motion (`prefers-reduced-motion`): no one walks, what tells
 * something stays.
 */
export interface PeopleOptions { walkers: 0 | 1 | 2; gate: boolean; hands: boolean; still?: boolean; /** In build mode they fade, or leave the floor. */ build?: 'fade' | 'hide' }

export interface Person {
  id: number; role: 'walker' | 'reviewer';
  /** Where they are, in tiles (their feet), and which way they face: 0 east, 1 south, 2 west, 3 north. */
  x: number; y: number; dir: number;
  /** The tiles left to walk, the next first. */
  path: { x: number; y: number }[];
  /** Seconds left to stand where they are. */
  wait: number;
  /** How far into their stride (for the legs), and the colour of their shirt (an index). */
  stride: number; shirt: number;
  /** A reviewer's gate. */
  gate?: string;
}

/** Tiles a second a walker covers, and a reviewer, who is called; how many walk for each density, by free tiles of the hall, and at most. */
const PACE = 1.4, HURRY = 3, ODDS = { 1: { per: 140, max: 5 }, 2: { per: 50, max: 14 } } as const;

/** The tiles one can walk on: in the hall, free of machines, areas and props. */
export function walkable(layout: FactoryLayout, hall: Rect, blocked: ReadonlySet<string> = new Set()): Set<string> {
  const taken = new Set<string>(blocked);
  for (const m of layout.machines) {
    if (m.kind === 'label') continue;
    for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) taken.add(`${i},${j}`);
  }
  const out = new Set<string>();
  for (let j = hall.y; j < hall.y + hall.h; j++) for (let i = hall.x; i < hall.x + hall.w; i++) if (!taken.has(`${i},${j}`)) out.add(`${i},${j}`);
  return out;
}

/** The shortest way on the grid from one tile to another, the start left out; null when there is none. */
export function pathOn(free: ReadonlySet<string>, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] | null {
  const key = (x: number, y: number) => `${x},${y}`, start = key(from.x, from.y), goal = key(to.x, to.y);
  if (!free.has(goal)) return null;
  const back = new Map<string, string>([[start, '']]), queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const at = queue[q]!;
    if (at === goal) break;
    const [x, y] = at.split(',').map(Number) as [number, number];
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const n = key(x + dx, y + dy);
      if (!back.has(n) && free.has(n)) { back.set(n, at); queue.push(n); }
    }
  }
  if (!back.has(goal)) return null;
  const out: { x: number; y: number }[] = [];
  for (let at = goal; at && at !== start; at = back.get(at)!) { const [x, y] = at.split(',').map(Number) as [number, number]; out.unshift({ x, y }); }
  return out;
}

/** Where a reviewer stands to wait at a gate: the first free tile along its bottom edge, else along its sides. */
export function spotAt(gate: MachineSpec, free: ReadonlySet<string>): { x: number; y: number } | null {
  const tries: [number, number][] = [];
  for (let i = 0; i < gate.w; i++) tries.push([gate.x + gate.w - 1 - i, gate.y + gate.h]);
  for (let j = gate.h - 1; j >= 0; j--) tries.push([gate.x - 1, gate.y + j], [gate.x + gate.w, gate.y + j]);
  for (let i = 0; i < gate.w; i++) tries.push([gate.x + i, gate.y - 1]);
  const t = tries.find(([x, y]) => free.has(`${x},${y}`));
  return t ? { x: t[0], y: t[1] } : null;
}

/**
 * The people of one view of the floor, moved at each frame. Kept by the skin that paints them: a new skin, a new crowd.
 * The free tiles are worked out again when the layout changes.
 */
export class Crowd {
  people: Person[] = [];
  private freeFor: FactoryLayout | null = null;
  private free = new Set<string>();
  private tiles: { x: number; y: number }[] = [];
  private next = 1;
  private rnd = 0;

  /** A number between 0 and 1, the next of a sequence that depends on nothing but how many were drawn. */
  private random(): number { this.rnd++; return seed(this.rnd, 7, 31); }

  /**
   * One frame: who walks, where to. `waiting`: the gates that wait for a decision. `dt`: seconds, the floor's (a floor
   * that is stopped stops its people too).
   */
  update(dt: number, layout: FactoryLayout, hall: Rect, blocked: ReadonlySet<string>, waiting: readonly MachineSpec[], opts: PeopleOptions, entry?: { x: number; y: number }): Person[] {
    if (this.freeFor !== layout) {
      this.freeFor = layout; this.free = walkable(layout, hall, blocked); this.tiles = [...this.free].map((k) => { const [x, y] = k.split(',').map(Number) as [number, number]; return { x, y }; });
      /* anyone left standing on a tile that is no longer free is put back on one */
      for (const p of this.people) if (!this.free.has(`${Math.round(p.x)},${Math.round(p.y)}`)) { const t = this.near(p.x, p.y); if (t) { p.x = t.x; p.y = t.y; } p.path = []; }
    }
    if (!this.tiles.length) { this.people = []; return this.people; }
    /* as many walkers as the hall calls for */
    const odds = opts.walkers ? ODDS[opts.walkers] : null, want = odds ? Math.max(1, Math.min(odds.max, Math.round(this.tiles.length / odds.per))) : 0;
    const walkers = this.people.filter((p) => p.role === 'walker');
    for (let k = walkers.length; k < want; k++) { const t = this.tiles[Math.floor(this.random() * this.tiles.length)]!; this.people.push({ id: this.next++, role: 'walker', x: t.x, y: t.y, dir: 1, path: [], wait: this.random() * 2, stride: 0, shirt: Math.floor(this.random() * 6) }); }
    if (walkers.length > want) { const drop = new Set(walkers.slice(want).map((p) => p.id)); this.people = this.people.filter((p) => !drop.has(p.id)); }
    /* a reviewer for each gate that waits, and none for one that no longer does */
    const gates = new Map(opts.gate ? waiting.map((g) => [g.id, g]) : []);
    this.people = this.people.filter((p) => p.role !== 'reviewer' || gates.has(p.gate!));
    for (const [id, g] of gates) {
      if (this.people.some((p) => p.gate === id)) continue;
      const spot = spotAt(g, this.free); if (!spot) continue;
      /* in by the door, or from the top of the hall above the gate */
      const top = Math.min(...this.tiles.map((q) => q.y)), at = entry ?? { x: g.x, y: top };
      const from = this.near(at.x, at.y) ?? spot;
      this.people.push({ id: this.next++, role: 'reviewer', gate: id, x: from.x, y: from.y, dir: 1, path: pathOn(this.free, from, spot) ?? [], wait: 0, stride: 0, shirt: 6 });
    }
    if (opts.still) return this.people;
    for (const p of this.people) this.step(p, dt, gates.get(p.gate ?? ''));
    return this.people;
  }

  private near(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null, d = Infinity;
    for (const t of this.tiles) { const e = Math.abs(t.x - x) + Math.abs(t.y - y); if (e < d) { d = e; best = t; } }
    return best;
  }

  private step(p: Person, dt: number, gate: MachineSpec | undefined): void {
    if (!p.path.length) {
      if (p.role === 'reviewer') { p.stride = 0; if (gate) p.dir = gate.y + gate.h <= p.y ? 3 : gate.x > p.x ? 0 : gate.x + gate.w <= p.x ? 2 : 1; return; }
      p.wait -= dt;
      if (p.wait > 0) { p.stride = 0; return; }
      /* somewhere far enough to cross the hall */
      for (let k = 0; k < 6 && !p.path.length; k++) {
        const t = this.tiles[Math.floor(this.random() * this.tiles.length)]!;
        if (Math.abs(t.x - p.x) + Math.abs(t.y - p.y) < 6) continue;
        p.path = pathOn(this.free, { x: Math.round(p.x), y: Math.round(p.y) }, t) ?? [];
      }
      p.wait = 1 + this.random() * 3;
      return;
    }
    let left = (p.role === 'reviewer' ? HURRY : PACE) * dt;
    while (left > 0 && p.path.length) {
      const t = p.path[0]!, dx = t.x - p.x, dy = t.y - p.y, d = Math.abs(dx) + Math.abs(dy);
      if (d > 1e-6) p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
      if (d <= left) { p.x = t.x; p.y = t.y; p.path.shift(); left -= d; }
      else { p.x += (dx / d) * left; p.y += (dy / d) * left; left = 0; }
    }
    p.stride += dt * 6;
  }
}
