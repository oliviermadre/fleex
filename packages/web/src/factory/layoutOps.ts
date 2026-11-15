/** Pure edits of a Factory layout: every function returns a new layout, or null when the edit cannot be done. */
import { DX, DY, type Dir, type FactoryLayout, type MachineSpec, type StationExec } from './types';

export type Tool = 'select' | 'belt' | 'arm' | 'agent' | 'skill' | 'panel' | 'gate' | 'native' | 'zone' | 'exit' | 'label' | 'erase';

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export function machineAt(layout: FactoryLayout, x: number, y: number): MachineSpec | null {
  for (const m of layout.machines) if (x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) return m;
  return null;
}

/** The machine a tool would place with its top-left corner chosen so the cursor sits near its middle. */
export function specFor(tool: Tool, x: number, y: number, dir: Dir): MachineSpec | null {
  const id = newId();
  switch (tool) {
    case 'belt': return { id, kind: 'belt', x, y, w: 1, h: 1, dir };
    case 'arm': return { id, kind: 'arm', x, y, w: 1, h: 1, dir, filter: null };
    case 'agent': case 'skill': case 'panel':
      return { id, kind: 'station', x: x - 1, y: y - 1, w: 3, h: 3, name: tool === 'agent' ? 'Agent' : tool === 'skill' ? 'Skill' : 'Panel', exec: tool as StationExec, ref: '', mode: 'edit', outcomes: ['ok'], cap: 8 };
    case 'gate': return { id, kind: 'station', x: x - 1, y: y - 1, w: 3, h: 3, name: 'Gate', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 };
    case 'native': return { id, kind: 'station', x, y, w: 2, h: 2, name: 'Set status', exec: 'native', outcomes: ['ok'], cap: 3, sets: 'doing' };
    case 'zone': return { id, kind: 'zone', x: x - 1, y: y - 1, w: 4, h: 4, name: 'Zone', status: '', release: 'manual' };
    case 'exit': return { id, kind: 'exit', x: x - 1, y: y - 1, w: 3, h: 3, name: 'Exit' };
    case 'label': return { id, kind: 'label', x, y, w: 1, h: 1, text: 'Zone' };
    default: return null;
  }
}

/** A machine may land on belt tiles (it takes their place), on nothing else. `ignore` is the machine being moved. */
export function canPlace(layout: FactoryLayout, spec: Pick<MachineSpec, 'x' | 'y' | 'w' | 'h'>, ignore?: string): boolean {
  if (spec.x < 0 || spec.y < 0 || spec.x + spec.w > layout.w || spec.y + spec.h > layout.h) return false;
  for (const m of layout.machines) {
    if (m.id === ignore || m.kind === 'belt' || m.kind === 'label') continue;
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
  if (x < 0 || y < 0 || x >= layout.w || y >= layout.h) return layout;
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

export function rotate(layout: FactoryLayout, id: string): FactoryLayout {
  return { ...layout, machines: layout.machines.map((m) => (m.id === id && (m.kind === 'belt' || m.kind === 'arm') ? { ...m, dir: ((m.dir + 1) % 4) as Dir } : m)) };
}
