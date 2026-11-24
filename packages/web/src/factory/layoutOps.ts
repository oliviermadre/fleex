/** Pure edits of a Factory layout: every function returns a new layout, or null when the edit cannot be done. */
import { DX, DY, type Dir, type FactoryLayout, type MachineSpec, type StationExec, type ArmCondition } from './types';
import { relink } from './teleport';
import { areasOf, fits } from './areas';

/** What takes no tile: a label and an area are written or laid on the floor, machines stand on them. */
export const decor = (m: Pick<MachineSpec, 'kind'>): boolean => m.kind === 'label' || m.kind === 'area';

export type Tool = 'select' | 'belt' | 'fastbelt' | 'bridge' | 'arm' | 'agent' | 'skill' | 'panel' | 'script' | 'gate' | 'native' | 'zone' | 'exit' | 'label' | 'area' | 'teleporter' | 'desk' | 'intake' | 'set' | 'toll' | 'erase' | 'paste';

export const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export function machineAt(layout: FactoryLayout, x: number, y: number): MachineSpec | null {
  for (const m of layout.machines) if (m.kind !== 'area' && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) return m;
  return null;
}

/**
 * Which way an arm put down here should work, read from what is round it (an arm takes from the tile behind it and
 * drops on the tile in front). It takes from what gives: a station, a zone, a desk, an intake, an arrival, or a belt
 * that ends on it; and drops away from it. With nothing that gives, it drops into what takes only: an exit, a
 * departure. When several ways fit, the one asked for (`dir`) if it is one of them, else one that drops onto
 * something; when nothing tells, `dir`.
 */
export function armFacing(layout: FactoryLayout, x: number, y: number, dir: Dir): Dir {
  const at = (d: number) => machineAt(layout, x + DX[d]!, y + DY[d]!);
  const gives = (d: number) => {
    const m = at(d);
    if (!m) return false;
    if (m.kind === 'station' || m.kind === 'zone' || m.kind === 'desk' || m.kind === 'intake') return true;
    if (m.kind === 'teleporter') return m.role === 'arrival';
    /* a belt that ends on this tile: it points back here */
    return m.kind === 'belt' && m.dir === (d + 2) % 4;
  };
  const takes = (d: number) => { const m = at(d); return !!m && m.kind !== 'label' && !(m.kind === 'belt' && m.dir === (d + 2) % 4); };
  /* facing f, it takes from the side opposite f */
  const fits = ([0, 1, 2, 3] as Dir[]).filter((f) => gives((f + 2) % 4));
  if (fits.length === 1) return fits[0]!;
  if (fits.length > 1) return fits.includes(dir) ? dir : fits.find((f) => takes(f)) ?? fits[0]!;
  const sinks = ([0, 1, 2, 3] as Dir[]).filter((f) => { const m = at(f); return !!m && (m.kind === 'exit' || (m.kind === 'teleporter' && m.role !== 'arrival')); });
  return sinks.length === 1 ? sinks[0]! : dir;
}

/** The machine a tool would place with its top-left corner chosen so the cursor sits near its middle. */
/** A station is a machine of 5 by 4 tiles: room for its places, its tray and its bay. A status station stays 2 by 2. */
export const STATION_W = 5, STATION_H = 4;
/** How many tickets a machine can be asked to work on at once: as many places as it can show. */
export const MAX_PLACES = 6;
/** A desk is a dock of 3 by 2 tiles, whatever it is set to. */
export const DESK_W = 3, DESK_H = 2;

export function specFor(tool: Tool, x: number, y: number, dir: Dir): MachineSpec | null {
  const id = newId();
  switch (tool) {
    case 'belt': return { id, kind: 'belt', x, y, w: 1, h: 1, dir };
    case 'fastbelt': return { id, kind: 'belt', x, y, w: 1, h: 1, dir, fast: true };
    case 'arm': return { id, kind: 'arm', x, y, w: 1, h: 1, dir, when: [] };
    case 'bridge': return { id, kind: 'bridge', x, y, w: 1, h: 1 };
    case 'agent': case 'skill': case 'panel':
      return { id, kind: 'station', x: x - 2, y: y - 1, w: STATION_W, h: STATION_H, name: tool === 'agent' ? 'Agent' : tool === 'skill' ? 'Skill' : 'Panel', exec: tool as StationExec, ref: '', mode: 'edit', outcomes: ['ok'], cap: 2 };
    case 'script': return { id, kind: 'station', x: x - 2, y: y - 1, w: STATION_W, h: STATION_H, name: 'Script', exec: 'script', outcomes: ['ok', 'ko'], cap: 2, script: { lines: [], missing: 'ignore', onFail: 'all' } };
    case 'gate': return { id, kind: 'station', x: x - 2, y: y - 1, w: STATION_W, h: STATION_H, name: 'Gate', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 };
    case 'native': return { id, kind: 'station', x, y, w: 2, h: 2, name: 'Set status', exec: 'native', outcomes: ['ok'], cap: 3, sets: 'doing' };
    case 'zone': return { id, kind: 'zone', x: x - 1, y: y - 1, w: 4, h: 4, name: 'Zone', status: '', release: 'manual' };
    case 'exit': return { id, kind: 'exit', x: x - 1, y: y - 1, w: 3, h: 3, name: 'Exit' };
    case 'label': return { id, kind: 'label', x, y, w: 1, h: 1, text: 'Zone' };
    /* a departure until its popup says otherwise: that is the one that has something to set */
    /* a gantry is carried by a belt: on bare floor it comes with its own, see `gantryAt` for a belt that is already there */
    case 'set': return { id, kind: 'belt', x, y, w: 1, h: 1, dir, set: [] };
    /* a toll rejects to its right, as one goes along the belt, until its popup says otherwise */
    case 'toll': return { id, kind: 'belt', x, y, w: 1, h: 1, dir, set: [], toll: { when: [], out: ((dir + 1) % 4) as Dir } };
    case 'teleporter': return { id, kind: 'teleporter', x, y, w: 1, h: 1, name: '', role: 'departure' };
    /* a dock of three by two, its mouth on the right: where a ticket created at it waits for an arm */
    case 'desk': return { id, kind: 'desk', x: x - 1, y, w: DESK_W, h: DESK_H, name: 'Desk' };
    /* Slack until its popup says otherwise; a conversation must be quiet two minutes before its item leaves */
    case 'intake': return { id, kind: 'intake', x: x - 1, y, w: DESK_W, h: DESK_H, name: '', source: 'slack', quietSec: 120, drop: [] };
    default: return null;
  }
}

/** A machine may land on belt tiles (it takes their place), on nothing else. The floor has no edge. `ignore`: machines being moved. */
export function canPlace(layout: FactoryLayout, spec: Pick<MachineSpec, 'x' | 'y' | 'w' | 'h'>, ignore?: string | ReadonlySet<string>): boolean {
  const skip = (id: string) => (typeof ignore === 'string' ? ignore === id : !!ignore && ignore.has(id));
  for (const m of layout.machines) {
    if (skip(m.id) || m.kind === 'belt' || decor(m)) continue;
    if (m.x < spec.x + spec.w && spec.x < m.x + m.w && m.y < spec.y + spec.h && spec.y < m.y + m.h) return false;
  }
  return true;
}

const overlaps = (m: MachineSpec, s: Pick<MachineSpec, 'x' | 'y' | 'w' | 'h'>) => m.x < s.x + s.w && s.x < m.x + m.w && m.y < s.y + s.h && s.y < m.y + m.h;

export function place(layout: FactoryLayout, spec: MachineSpec): FactoryLayout | null {
  if (!canPlace(layout, spec)) return null;
  const kept = decor(spec) ? layout.machines : layout.machines.filter((m) => !(m.kind === 'belt' && overlaps(m, spec)));
  return { ...layout, machines: [...kept, spec] };
}

/**
 * Put a Set gantry on a tile: on the belt that is there, which keeps its direction and its speed, or on bare floor
 * with a belt of its own. Null where something else stands, or where the belt already has one.
 */
export function gantryAt(layout: FactoryLayout, x: number, y: number, dir: Dir, toll = false): { layout: FactoryLayout; id: string } | null {
  const there = layout.machines.find((m) => !decor(m) && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
  if (!there) { const spec = specFor(toll ? 'toll' : 'set', x, y, dir)!; return { layout: { ...layout, machines: [...layout.machines, spec] }, id: spec.id }; }
  /* a gantry becomes a toll, keeping what it sets; a toll is already both */
  if (there.kind !== 'belt' || there.toll || (there.set !== undefined && !toll)) return null;
  const next = { ...there, set: there.set ?? [], ...(toll ? { toll: { when: [], out: ((there.dir + 1) % 4) as Dir } } : {}) };
  return { layout: { ...layout, machines: layout.machines.map((m) => (m === there ? next : m)) }, id: there.id };
}
/** A belt's fields once it points another way: the arm of a toll turns with its belt, so it still reaches across it. */
const turned = <T extends { dir: Dir; toll?: { when: ArmCondition[]; out: Dir } }>(m: T, dir: Dir): T => ({ ...m, dir, ...(m.toll ? { toll: { ...m.toll, out: ((m.toll.out + dir - m.dir + 4) % 4) as Dir } } : {}) });

/** A belt's own fields for a speed: a fast belt carries the flag, a plain one does not. */
const speedOf = (fast: boolean): { fast?: true } => (fast ? { fast: true } : {});

/** Lay one belt tile, or re-aim the one that is there and give it this speed; leaves any other machine alone. */
export function setBelt(layout: FactoryLayout, x: number, y: number, dir: Dir, fast = false): FactoryLayout {
  const there = layout.machines.find((m) => !decor(m) && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
  if (there && there.kind !== 'belt') return layout;
  if (there) {
    if (there.dir === dir && !!there.fast === fast) return layout;
    const { fast: _was, ...rest } = there;
    return { ...layout, machines: layout.machines.map((m) => (m === there ? { ...turned(rest, dir), ...speedOf(fast) } : m)) };
  }
  return { ...layout, machines: [...layout.machines, { id: newId(), kind: 'belt', x, y, w: 1, h: 1, dir, ...speedOf(fast) }] };
}

/** Make belts fast, or plain again; what is not a belt is left alone. */
export function setSpeed(layout: FactoryLayout, ids: ReadonlySet<string>, fast: boolean): FactoryLayout {
  return { ...layout, machines: layout.machines.map((m) => {
    if (m.kind !== 'belt' || !ids.has(m.id) || !!m.fast === fast) return m;
    const { fast: _was, ...rest } = m;
    return { ...rest, ...speedOf(fast) };
  }) };
}

/** Belts from one tile to another, each pointing at the next: what a drag paints. Painted over belts, it re-aims them and gives them the speed painted with. */
export function paintBelts(layout: FactoryLayout, from: { x: number; y: number }, to: { x: number; y: number }, fast = false): { layout: FactoryLayout; dir: Dir | null } {
  let l = layout, x = from.x, y = from.y, dir: Dir | null = null, guard = 0;
  while ((x !== to.x || y !== to.y) && guard++ < 400) {
    const d: Dir = x < to.x ? 0 : x > to.x ? 2 : y < to.y ? 1 : 3;
    l = setBelt(l, x, y, d, fast); x += DX[d]; y += DY[d]; l = setBelt(l, x, y, d, fast); dir = d;
  }
  return { layout: l, dir };
}

export const erase = (layout: FactoryLayout, id: string): FactoryLayout => ({ ...layout, machines: layout.machines.filter((m) => m.id !== id) });
export const update = (layout: FactoryLayout, id: string, patch: Partial<MachineSpec>): FactoryLayout =>
  ({ ...layout, machines: layout.machines.map((m) => (m.id === id ? ({ ...m, ...patch } as MachineSpec) : m)) });

export function move(layout: FactoryLayout, id: string, x: number, y: number): FactoryLayout | null {
  const m = layout.machines.find((q) => q.id === id);
  if (!m || !canPlace(layout, { x, y, w: m.w, h: m.h }, id)) return null;
  const target = { x, y, w: m.w, h: m.h };
  return { ...layout, machines: layout.machines.filter((q) => q.id === id || q.kind !== 'belt' || decor(m) || !overlaps(q, target)).map((q) => (q.id === id ? ({ ...q, x, y } as MachineSpec) : q)) };
}

/** Move several machines by the same offset, all or none. Belts under where they land give way; the moved ones keep their tickets. */
export function moveMany(layout: FactoryLayout, ids: ReadonlySet<string>, dx: number, dy: number): FactoryLayout | null {
  if (!dx && !dy) return layout;
  const moved = layout.machines.filter((m) => ids.has(m.id)).map((m) => ({ ...m, x: m.x + dx, y: m.y + dy }) as MachineSpec);
  for (const m of moved) if (!decor(m) && !canPlace(layout, m, ids)) return null;
  if (!areasFit(layout, moved.filter((m) => m.kind === 'area'), ids)) return null;
  const solid = moved.filter((m) => !decor(m));
  const rest = layout.machines.filter((m) => !ids.has(m.id) && !(m.kind === 'belt' && solid.some((q) => overlaps(m, q))));
  return { ...layout, machines: [...rest, ...moved] };
}
export const eraseMany = (layout: FactoryLayout, ids: ReadonlySet<string>): FactoryLayout => ({ ...layout, machines: layout.machines.filter((m) => !ids.has(m.id)) });
/** Ids of the machines that touch a rectangle given in world units. Areas are not taken: a frame selects machines, an area is selected by itself. */
export function machinesIn(layout: FactoryLayout, x0: number, y0: number, x1: number, y1: number): string[] {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
  return layout.machines.filter((m) => m.kind !== 'area' && m.x < bx && ax < m.x + m.w && m.y < by && ay < m.y + m.h).map((m) => m.id);
}

/** Machines lifted off the floor to be put down elsewhere: positions are relative to the group's top-left corner. */
export interface Clip { w: number; h: number; machines: MachineSpec[] }

/** Copy machines, settings included, tickets not. Null when none of the ids is on the floor. */
export function copyOf(layout: FactoryLayout, ids: ReadonlySet<string>): Clip | null {
  const picked = layout.machines.filter((m) => ids.has(m.id));
  if (!picked.length) return null;
  const x0 = Math.min(...picked.map((m) => m.x)), y0 = Math.min(...picked.map((m) => m.y));
  return {
    w: Math.max(...picked.map((m) => m.x + m.w)) - x0, h: Math.max(...picked.map((m) => m.y + m.h)) - y0,
    machines: picked.map((m) => ({ ...structuredClone(m), x: m.x - x0, y: m.y - y0 }) as MachineSpec),
  };
}

/** Where each machine of a clip lands when the group is centred on a tile. */
export function clipAt(clip: Clip, x: number, y: number): MachineSpec[] {
  const ox = x - Math.floor(clip.w / 2), oy = y - Math.floor(clip.h / 2);
  return clip.machines.map((m) => ({ ...m, x: m.x + ox, y: m.y + oy }) as MachineSpec);
}
export const canPaste = (layout: FactoryLayout, clip: Clip, x: number, y: number): boolean => {
  const at = clipAt(clip, x, y);
  return at.every((m) => decor(m) || canPlace(layout, m)) && areasFit(layout, at.filter((m) => m.kind === 'area'));
};
/** Whether areas may stand where they are given, among those of the floor (but `ignore`) and one another: they nest or keep apart, never cross. */
export function areasFit(layout: FactoryLayout, areas: readonly MachineSpec[], ignore?: ReadonlySet<string>): boolean {
  const others = areasOf(layout.machines).filter((a) => !ignore?.has(a.id));
  return areas.every((a, i) => fits(a, [...others, ...areas.slice(0, i)], 'nest'));
}

/**
 * Put a clip down centred on a tile, all or none. The copies get new ids (returned, to select them);
 * belts under where they land give way; a copied Inbound zone is an ordinary zone, since a floor has one.
 */
export function pasteAt(layout: FactoryLayout, clip: Clip, x: number, y: number): { layout: FactoryLayout; ids: string[] } | null {
  if (!canPaste(layout, clip, x, y)) return null;
  const ids = new Map<string, string>();
  const copies = relink(clipAt(clip, x, y).map((m) => { const id = newId(); ids.set(m.id, id); return { ...structuredClone(m), id, ...(m.kind === 'zone' ? { inbound: false } : {}) } as MachineSpec; }), ids);
  const solid = copies.filter((m) => !decor(m));
  const rest = layout.machines.filter((m) => !(m.kind === 'belt' && solid.some((q) => overlaps(m, q))));
  return { layout: { ...layout, machines: [...rest, ...copies] }, ids: copies.map((m) => m.id) };
}

export function rotate(layout: FactoryLayout, id: string): FactoryLayout {
  return { ...layout, machines: layout.machines.map((m) => (m.id === id && m.kind === 'belt' ? turned(m, ((m.dir + 1) % 4) as Dir) : m.id === id && m.kind === 'arm' ? { ...m, dir: ((m.dir + 1) % 4) as Dir } : m)) };
}
