/**
 * Areas in build mode: the geometry of drawing one, of its handles, of resizing it, and of where it may be. Pure
 * functions on rectangles of tiles; the page and the skins do the rest.
 *
 * An Area is decor (`AreaSpec`): a rectangle of the floor with a name and a colour, independent of the machines that
 * stand on it. It is drawn by dragging from one tile to another, resized by its sides and corners, always on whole
 * tiles and never smaller than one. Whether two may overlap is a rule (`Overlap`), to be chosen.
 */
import { PALETTE, type AreaSpec, type MachineSpec } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
/** A side or a corner of an area, by compass. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
/** What two areas may do: never meet, overlap freely, or one sit wholly inside another. */
export type Overlap = 'never' | 'free' | 'nest';

export const isArea = (m: MachineSpec | null | undefined): m is AreaSpec => !!m && m.kind === 'area';
export const areasOf = (machines: readonly MachineSpec[]): AreaSpec[] => machines.filter(isArea);

/** The rectangle of tiles dragged from one point of the floor to another, both tiles included. */
export function spanOf(ax: number, ay: number, bx: number, by: number): Rect {
  const x0 = Math.floor(Math.min(ax, bx)), y0 = Math.floor(Math.min(ay, by)), x1 = Math.floor(Math.max(ax, bx)), y1 = Math.floor(Math.max(ay, by));
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The handle of an area at a point of the floor, within `reach` tiles of its edge: a corner before a side. */
export function handleAt(a: Rect, px: number, py: number, reach: number): Handle | null {
  const L = Math.abs(px - a.x) <= reach, R = Math.abs(px - (a.x + a.w)) <= reach, T = Math.abs(py - a.y) <= reach, B = Math.abs(py - (a.y + a.h)) <= reach;
  const alongX = px >= a.x - reach && px <= a.x + a.w + reach, alongY = py >= a.y - reach && py <= a.y + a.h + reach;
  if (T && L) return 'nw'; if (T && R) return 'ne'; if (B && L) return 'sw'; if (B && R) return 'se';
  if (T && alongX) return 'n'; if (B && alongX) return 's'; if (L && alongY) return 'w'; if (R && alongY) return 'e';
  return null;
}

/** The area with that handle dragged to a point: on whole tiles, the opposite side staying where it is, never under a tile. */
export function resize(a: Rect, h: Handle, px: number, py: number): Rect {
  let x0 = a.x, y0 = a.y, x1 = a.x + a.w, y1 = a.y + a.h;
  const X = Math.round(px), Y = Math.round(py);
  if (h.includes('w')) x0 = Math.min(X, x1 - 1);
  if (h.includes('e')) x1 = Math.max(X, x0 + 1);
  if (h.includes('n')) y0 = Math.min(Y, y1 - 1);
  if (h.includes('s')) y1 = Math.max(Y, y0 + 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The area moved by a whole number of tiles. */
export const moved = (a: Rect, dx: number, dy: number): Rect => ({ x: a.x + Math.round(dx), y: a.y + Math.round(dy), w: a.w, h: a.h });

const meet = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const holds = (o: Rect, i: Rect) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
/** Whether an area may be there, given the others, under that rule. */
export function fits(a: Rect, others: readonly Rect[], rule: Overlap): boolean {
  if (rule === 'free') return true;
  return others.every((o) => !meet(a, o) || (rule === 'nest' && (holds(o, a) || holds(a, o))));
}

/** The area at a point of the floor: the smallest that holds it (the innermost of nested ones), the last laid among equals. */
export function areaAt(areas: readonly AreaSpec[], px: number, py: number): AreaSpec | null {
  let best: AreaSpec | null = null;
  for (const a of areas) if (px >= a.x && px < a.x + a.w && py >= a.y && py < a.y + a.h && (!best || a.w * a.h <= best.w * best.h)) best = a;
  return best;
}

/** A new area's name and colour: the next number, the next colour of the palette that no area has yet. */
export function freshArea(areas: readonly AreaSpec[], r: Rect, id: string): AreaSpec {
  let n = areas.length + 1;
  while (areas.some((a) => a.name === `Area ${n}`)) n++;
  const used = new Set(areas.map((a) => a.color)), colors = PALETTE.filter((c) => c.name !== 'Grey' && c.name !== 'White').map((c) => c.hex);
  return { id, kind: 'area', ...r, name: `Area ${n}`, color: colors.find((c) => !used.has(c)) ?? colors[areas.length % colors.length]!, label: 'bl' };
}
