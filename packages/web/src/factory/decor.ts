/**
 * The decor of the floor, generated, never placed: a hall with its walls, what hangs on the top wall, and props on the
 * free tiles. Picked on `docs/factory/decor.html` (the options it uses are in `DECOR`, `skins/index.ts`).
 *
 * Everything here follows from the layout and a seed per tile, so it does not change from one frame or one visit to
 * the next, and it moves when the floor does: a column of machines built further out pushes the wall out with it.
 * Nothing here is kept, nothing takes a tile, nothing answers a click. Pure functions; the skins paint.
 */
import { hash } from './skins/pixelArt';
import type { FactoryLayout, MachineSpec } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
/**
 * What the owner chooses on the mock-up:
 * - `wall`: the hall's walls stand at the edge of the floor (`map`), or round what is built, a few tiles off, with a
 *   yard outside (`built`);
 * - `props`: how many props stand on the free tiles (none, a few, many);
 * - `build`: in build mode the props fade, so that the tiles read as free, or they are not drawn.
 */
export interface DecorOptions { wall: 'map' | 'built'; props: 0 | 1 | 2; build?: 'fade' | 'hide' }

/** How high the top wall is, in tiles, and how thick the others are. Free tiles kept between what is built and a wall that follows it. */
export const WALL_H = 3, WALL_T = 1, ROOM = 4;

/** The inside of the hall: the floor less its walls. */
export function hallOf(layout: FactoryLayout, floor: Rect, wall: DecorOptions['wall']): Rect {
  if (wall === 'map' || !layout.machines.length) return { x: floor.x + WALL_T, y: floor.y + WALL_H, w: floor.w - 2 * WALL_T, h: floor.h - WALL_H - WALL_T };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of layout.machines) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
  return { x: x0 - ROOM, y: y0 - ROOM, w: x1 - x0 + 2 * ROOM, h: y1 - y0 + 2 * ROOM };
}

/** A number between 0 and 1, the same each time for a tile and a purpose. */
export const seed = (x: number, y: number, k = 0): number => hash(`${x},${y},${k}`) / 0xffffffff;

export type Fixture = 'window' | 'door' | 'clock' | 'sign' | 'board' | 'extinguisher' | 'vent';
/** What hangs on the top wall, column by column: from its left end, at fixed steps chosen by the seed. */
export interface WallThing { kind: Fixture; x: number; w: number }
export function wallThings(hall: Rect, built: Rect | null): WallThing[] {
  const out: WallThing[] = [], x0 = hall.x, x1 = hall.x + hall.w;
  /* the sign over the middle of what is built, the clock beside it, the door further right */
  const mid = Math.round(built ? built.x + built.w / 2 : x0 + hall.w / 2);
  const sign = { kind: 'sign' as const, x: mid - 3, w: 6 }, clock = { kind: 'clock' as const, x: mid + 4, w: 1 };
  const door = { kind: 'door' as const, x: Math.min(x1 - 4, mid + 7 + Math.floor(seed(mid, hall.y, 1) * 4)), w: 2 };
  const taken = [sign, clock, door].filter((t) => t.x >= x0 && t.x + t.w <= x1);
  out.push(...taken);
  const free = (x: number, w: number) => x >= x0 + 1 && x + w <= x1 - 1 && !out.some((t) => x < t.x + t.w + 1 && t.x < x + w + 1);
  /* windows every six tiles; between them, now and then, a notice board, an extinguisher or a vent */
  for (let x = x0 + 2; x + 2 <= x1 - 1; x += 6) if (free(x, 2)) out.push({ kind: 'window', x, w: 2 });
  for (let x = x0 + 1; x < x1 - 1; x++) {
    const r = seed(x, hall.y, 2);
    if (r < 0.06 && free(x, 1)) out.push({ kind: 'extinguisher', x, w: 1 });
    else if (r > 0.96 && free(x, 2)) out.push({ kind: 'board', x, w: 2 });
    else if (r > 0.93 && r <= 0.96 && free(x, 1)) out.push({ kind: 'vent', x, w: 1 });
  }
  return out.sort((a, b) => a.x - b.x);
}

export type PropKind = 'plant' | 'crates' | 'barrel' | 'pallet' | 'cone' | 'cooler' | 'shelf';
export interface Prop { kind: PropKind; x: number; y: number }
/** How likely a free tile is to hold a prop, against a wall and in the open, for each density. */
const ODDS: Record<1 | 2, { wall: number; open: number }> = { 1: { wall: 0.1, open: 0.006 }, 2: { wall: 0.28, open: 0.02 } };

/**
 * The props on the tiles of `view` that are free: inside the hall, on no machine, no area and no label, with a tile of
 * room round every machine, so a prop never hides something and is never in the way. More of them against the walls,
 * as in a real hall: shelves and water coolers there, plants, crates, barrels, pallets and cones anywhere.
 */
export function propsIn(layout: FactoryLayout, hall: Rect, view: Rect, density: DecorOptions['props']): Prop[] {
  if (!density) return [];
  /* worked out once for a layout and a view on whole tiles: a frame that moves less than a tile reuses it */
  const key = `${hall.x},${hall.y},${hall.w},${hall.h}|${Math.floor(view.x)},${Math.floor(view.y)},${Math.ceil(view.x + view.w)},${Math.ceil(view.y + view.h)}|${density}`, last = lastProps.get(layout);
  if (last?.key === key) return last.out;
  const { solid, kept } = tilesOf(layout);
  const near = (i: number, j: number) => { for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (solid.has(`${i + a},${j + b}`)) return true; return false; };
  const odds = ODDS[density], out: Prop[] = [];
  const i0 = Math.max(hall.x, Math.floor(view.x)), j0 = Math.max(hall.y, Math.floor(view.y)), i1 = Math.min(hall.x + hall.w, Math.ceil(view.x + view.w)), j1 = Math.min(hall.y + hall.h, Math.ceil(view.y + view.h));
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const top = j === hall.y, wall = top || i === hall.x || i === hall.x + hall.w - 1 || j === hall.y + hall.h - 1;
    if (seed(i, j) >= (wall ? odds.wall : odds.open) || kept.has(`${i},${j}`) || near(i, j)) continue;
    const k = seed(i, j, 3);
    const kind: PropKind = top ? (k < 0.45 ? 'shelf' : k < 0.65 ? 'cooler' : k < 0.85 ? 'plant' : 'crates')
      : k < 0.3 ? 'plant' : k < 0.55 ? 'crates' : k < 0.72 ? 'barrel' : k < 0.88 ? 'pallet' : 'cone';
    out.push({ kind, x: i, y: j });
  }
  lastProps.set(layout, { key, out });
  return out;
}
const lastProps = new WeakMap<FactoryLayout, { key: string; out: Prop[] }>();
const tiles = new WeakMap<FactoryLayout, { solid: Set<string>; kept: Set<string> }>();
/** The tiles machines take, and those of areas, once for a layout. */
function tilesOf(layout: FactoryLayout): { solid: Set<string>; kept: Set<string> } {
  const had = tiles.get(layout);
  if (had) return had;
  const solid = new Set<string>(), kept = new Set<string>();
  for (const m of layout.machines) {
    if (m.kind === 'label') continue;
    for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) (m.kind === 'area' ? kept : solid).add(`${i},${j}`);
  }
  tiles.set(layout, { solid, kept });
  return { solid, kept };
}

/** The trees of the yard, outside a hall that follows what is built: on the floor, off the walls, a few to the tile. */
export function treesIn(hall: Rect, floor: Rect, view: Rect): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const i0 = Math.max(floor.x, Math.floor(view.x)), j0 = Math.max(floor.y, Math.floor(view.y)), i1 = Math.min(floor.x + floor.w, Math.ceil(view.x + view.w)), j1 = Math.min(floor.y + floor.h, Math.ceil(view.y + view.h));
  const off = (i: number, j: number) => i < hall.x - WALL_T - 1 || i > hall.x + hall.w + WALL_T || j < hall.y - WALL_H - 1 || j > hall.y + hall.h + WALL_T;
  /* one tree at most in each square of three tiles, set a tile in or not by the seed: their crowns of two tiles never meet */
  const s0 = (v: number) => v - (((v % 3) + 3) % 3);
  for (let j = s0(j0 - 3); j < j1; j += 3) for (let i = s0(i0 - 3); i < i1; i += 3) {
    if (seed(i, j, 5) >= 0.16) continue;
    const x = i + (seed(i, j, 6) < 0.5 ? 0 : 1), y = j + (seed(i, j, 4) < 0.5 ? 0 : 1);
    if (off(x, y) && off(x + 1, y + 1) && off(x + 1, y) && off(x, y + 1) && x >= floor.x && y >= floor.y && x + 2 <= floor.x + floor.w && y + 2 <= floor.y + floor.h) out.push({ x, y });
  }
  return out;
}

/** What is built, in tiles: the middle of the wall's sign. */
export function builtBox(machines: readonly MachineSpec[]): Rect | null {
  const solid = machines.filter((m) => m.kind !== 'area' && m.kind !== 'label');
  if (!solid.length) return null;
  const x0 = Math.min(...solid.map((m) => m.x)), y0 = Math.min(...solid.map((m) => m.y));
  return { x: x0, y: y0, w: Math.max(...solid.map((m) => m.x + m.w)) - x0, h: Math.max(...solid.map((m) => m.y + m.h)) - y0 };
}
