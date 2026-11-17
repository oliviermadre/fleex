/** Pure edits of a Factory layout: every function returns a new layout, or null when the edit cannot be done. */
import { DX, DY, type Dir, type FactoryLayout, type MachineSpec, type StationExec } from './types';

export type Tool = 'select' | 'belt' | 'bridge' | 'arm' | 'agent' | 'skill' | 'panel' | 'gate' | 'native' | 'zone' | 'exit' | 'label' | 'erase' | 'paste';

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export function machineAt(layout: FactoryLayout, x: number, y: number): MachineSpec | null {
  for (const m of layout.machines) if (x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) return m;
  return null;
}

/** The machine a tool would place with its top-left corner chosen so the cursor sits near its middle. */
/** A station is a machine of 5 by 4 tiles: room for its places, its tray and its bay. A status station stays 2 by 2. */
export const STATION_W = 5, STATION_H = 4;
/** How many tickets a machine can be asked to work on at once: as many places as it can show. */
export const MAX_PLACES = 6;

export function specFor(tool: Tool, x: number, y: number, dir: Dir): MachineSpec | null {
  const id = newId();
  switch (tool) {
    case 'belt': return { id, kind: 'belt', x, y, w: 1, h: 1, dir };
    case 'arm': return { id, kind: 'arm', x, y, w: 1, h: 1, dir, when: [] };
    case 'bridge': return { id, kind: 'bridge', x, y, w: 1, h: 1 };
    case 'agent': case 'skill': case 'panel':
      return { id, kind: 'station', x: x - 2, y: y - 1, w: STATION_W, h: STATION_H, name: tool === 'agent' ? 'Agent' : tool === 'skill' ? 'Skill' : 'Panel', exec: tool as StationExec, ref: '', mode: 'edit', outcomes: ['ok'], cap: 2 };
    case 'gate': return { id, kind: 'station', x: x - 2, y: y - 1, w: STATION_W, h: STATION_H, name: 'Gate', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 };
    case 'native': return { id, kind: 'station', x, y, w: 2, h: 2, name: 'Set status', exec: 'native', outcomes: ['ok'], cap: 3, sets: 'doing' };
    case 'zone': return { id, kind: 'zone', x: x - 1, y: y - 1, w: 4, h: 4, name: 'Zone', status: '', release: 'manual' };
    case 'exit': return { id, kind: 'exit', x: x - 1, y: y - 1, w: 3, h: 3, name: 'Exit' };
    case 'label': return { id, kind: 'label', x, y, w: 1, h: 1, text: 'Zone' };
    default: return null;
  }
}

/** A machine may land on belt tiles (it takes their place), on nothing else. The floor has no edge. `ignore`: machines being moved. */
export function canPlace(layout: FactoryLayout, spec: Pick<MachineSpec, 'x' | 'y' | 'w' | 'h'>, ignore?: string | ReadonlySet<string>): boolean {
  const skip = (id: string) => (typeof ignore === 'string' ? ignore === id : !!ignore && ignore.has(id));
  for (const m of layout.machines) {
    if (skip(m.id) || m.kind === 'belt' || m.kind === 'label') continue;
    if (m.x < spec.x + spec.w && spec.x < m.x + m.w && m.y < spec.y + spec.h && spec.y < m.y + m.h) return false;
  }
  return true;
}

const overlaps = (m: MachineSpec, s: Pick<MachineSpec, 'x' | 'y' | 'w' | 'h'>) => m.x < s.x + s.w && s.x < m.x + m.w && m.y < s.y + s.h && s.y < m.y + m.h;

export function place(layout: FactoryLayout, spec: MachineSpec): FactoryLayout | null {
  if (!canPlace(layout, spec)) return null;
  const kept = spec.kind === 'label' ? layout.machines : layout.machines.filter((m) => !(m.kind === 'belt' && overlaps(m, spec)));
  return { ...layout, machines: [...kept, spec] };
}

/** Lay or re-aim one belt tile; leaves any other machine alone. */
export function setBelt(layout: FactoryLayout, x: number, y: number, dir: Dir): FactoryLayout {
  const there = layout.machines.find((m) => m.kind !== 'label' && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
  if (there && there.kind !== 'belt') return layout;
  if (there) return there.dir === dir ? layout : { ...layout, machines: layout.machines.map((m) => (m === there ? { ...there, dir } : m)) };
  return { ...layout, machines: [...layout.machines, { id: newId(), kind: 'belt', x, y, w: 1, h: 1, dir }] };
}

/** Belts from one tile to another, each pointing at the next: what a drag paints. */
export function paintBelts(layout: FactoryLayout, from: { x: number; y: number }, to: { x: number; y: number }): { layout: FactoryLayout; dir: Dir | null } {
  let l = layout, x = from.x, y = from.y, dir: Dir | null = null, guard = 0;
  while ((x !== to.x || y !== to.y) && guard++ < 400) {
    const d: Dir = x < to.x ? 0 : x > to.x ? 2 : y < to.y ? 1 : 3;
    l = setBelt(l, x, y, d); x += DX[d]; y += DY[d]; l = setBelt(l, x, y, d); dir = d;
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
  return { ...layout, machines: layout.machines.filter((q) => q.id === id || q.kind !== 'belt' || m.kind === 'label' || !overlaps(q, target)).map((q) => (q.id === id ? ({ ...q, x, y } as MachineSpec) : q)) };
}

/** Move several machines by the same offset, all or none. Belts under where they land give way; the moved ones keep their tickets. */
export function moveMany(layout: FactoryLayout, ids: ReadonlySet<string>, dx: number, dy: number): FactoryLayout | null {
  if (!dx && !dy) return layout;
  const moved = layout.machines.filter((m) => ids.has(m.id)).map((m) => ({ ...m, x: m.x + dx, y: m.y + dy }) as MachineSpec);
  for (const m of moved) if (m.kind !== 'label' && !canPlace(layout, m, ids)) return null;
  const solid = moved.filter((m) => m.kind !== 'label');
  const rest = layout.machines.filter((m) => !ids.has(m.id) && !(m.kind === 'belt' && solid.some((q) => overlaps(m, q))));
  return { ...layout, machines: [...rest, ...moved] };
}
export const eraseMany = (layout: FactoryLayout, ids: ReadonlySet<string>): FactoryLayout => ({ ...layout, machines: layout.machines.filter((m) => !ids.has(m.id)) });
/** Ids of the machines that touch a rectangle given in world units. */
export function machinesIn(layout: FactoryLayout, x0: number, y0: number, x1: number, y1: number): string[] {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
  return layout.machines.filter((m) => m.x < bx && ax < m.x + m.w && m.y < by && ay < m.y + m.h).map((m) => m.id);
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
export const canPaste = (layout: FactoryLayout, clip: Clip, x: number, y: number): boolean => clipAt(clip, x, y).every((m) => m.kind === 'label' || canPlace(layout, m));

/**
 * Put a clip down centred on a tile, all or none. The copies get new ids (returned, to select them);
 * belts under where they land give way; a copied Inbound zone is an ordinary zone, since a floor has one.
 */
export function pasteAt(layout: FactoryLayout, clip: Clip, x: number, y: number): { layout: FactoryLayout; ids: string[] } | null {
  if (!canPaste(layout, clip, x, y)) return null;
  const copies = clipAt(clip, x, y).map((m) => ({ ...structuredClone(m), id: newId(), ...(m.kind === 'zone' ? { inbound: false } : {}) }) as MachineSpec);
  const solid = copies.filter((m) => m.kind !== 'label');
  const rest = layout.machines.filter((m) => !(m.kind === 'belt' && solid.some((q) => overlaps(m, q))));
  return { layout: { ...layout, machines: [...rest, ...copies] }, ids: copies.map((m) => m.id) };
}

export function rotate(layout: FactoryLayout, id: string): FactoryLayout {
  return { ...layout, machines: layout.machines.map((m) => (m.id === id && (m.kind === 'belt' || m.kind === 'arm') ? { ...m, dir: ((m.dir + 1) % 4) as Dir } : m)) };
}
