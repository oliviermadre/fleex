/**
 * What a skin is: paint only, on a floor that does not change from one skin to another.
 *
 * The scene (`../scene.ts`) says what is shown and where; a skin paints it. Tile size, the geometry of parts, what
 * answers a click and the words of plates are not a skin's: it is given them. The colours that carry a meaning (a
 * ticket's type, a station's kind, the lights of a lamp) it may soften or brighten, never replace.
 *
 * A skin paints in three moments: what lies under everything (`ground`), the pieces of the scene, each on a layer and
 * at a depth that the view orders (`pieces`, see `order`), and what lies over everything (`top`: readings, the
 * selection, what is being placed, then the words).
 */
import type { FactoryLayout, FactoryTicket, MachineSpec } from '../types';
import type { Scene } from '../scene';
import type { ViewState } from '../renderer';

/** What a skin paints on: the view's canvas and where it looks from. Read only. */
export interface Surface {
  readonly ctx: CanvasRenderingContext2D;
  readonly cv: HTMLCanvasElement;
  /** Device pixels per CSS pixel. */
  readonly dpr: number;
  /** The view's size, in CSS pixels. */
  readonly w: number;
  readonly h: number;
  /** Where the view looks from (in tiles) and how close (pixels per tile). */
  readonly cam: { readonly x: number; readonly y: number; readonly z: number };
  toWorld(sx: number, sy: number): { x: number; y: number };
  floorOf(layout: FactoryLayout): { x: number; y: number; w: number; h: number };
  machine(id: string | null): MachineSpec | null;
}

/** How the minimap frames the floor: its size in CSS pixels, its scale and its origin, and the floor's rectangle. */
export interface MiniFrame { w: number; h: number; dpr: number; s: number; ox: number; oy: number; floor: { x: number; y: number; w: number; h: number } }

/**
 * The layers of a picture, painted in this order. Seen from three quarters, a single sort by depth is not enough:
 * what is on the floor is under everything, what is overhead (an arm's boom, a gantry's bar) over everything that
 * stands. A flat skin may put everything on one layer.
 */
export const LAYERS = ['floor', 'standing', 'overhead'] as const;
export type Layer = (typeof LAYERS)[number];

/** One thing to paint: its layer, its depth on that layer (higher is nearer, painted later), and how to paint it. */
export interface Piece {
  layer: Layer;
  depth: number;
  draw: () => void;
  /**
   * What carries it. A carried thing has no depth of its own: it is painted just after its carrier, whatever its
   * own layer and depth (a ticket on a belt, in a station). Several carried by one thing keep the order they came in.
   */
  on?: Piece;
}

/**
 * The order pieces are painted in: by layer, then by depth, then in the order they came in; each carried piece just
 * after its carrier (after what that one carries in turn). A piece whose carrier is not among them stands on its own.
 */
export function order(pieces: readonly Piece[]): Piece[] {
  const all = new Set(pieces), riders = new Map<Piece, Piece[]>(), free: Piece[] = [];
  for (const p of pieces) {
    if (p.on && all.has(p.on) && p.on !== p) { const r = riders.get(p.on); if (r) r.push(p); else riders.set(p.on, [p]); }
    else free.push(p);
  }
  const rank = (p: Piece) => LAYERS.indexOf(p.layer);
  free.sort((a, b) => rank(a) - rank(b) || a.depth - b.depth);
  const out: Piece[] = [], seen = new Set<Piece>();
  const put = (p: Piece) => { if (seen.has(p)) return; seen.add(p); out.push(p); for (const r of riders.get(p) ?? []) put(r); };
  for (const p of free) put(p);
  /* a ring of carriers carrying one another has no first piece: painted at the end rather than lost */
  for (const p of pieces) put(p);
  return out;
}

/** What the scene keeps that the minimap reads: where tickets are drawn, and the machines by id. */
export interface SceneLookup { readonly shown: ReadonlyMap<string, { x: number; y: number }>; machine(id: string | null): MachineSpec | null }

export interface Skin {
  readonly id: string;
  /** The zooms the view may rest on, in pixels per tile; it glides between them. None: the zoom is free. */
  readonly steps?: readonly number[];
  /**
   * How high a machine is painted, in tiles, for a skin seen from three quarters: its top is that much higher than its
   * tiles, its front face fills the gap. What is under the pointer is then what is seen there. None: flat.
   */
  liftOf?(m: MachineSpec, st: ViewState): number;
  /** What lies under everything: the floor, its light, what stands casts on it. Leaves the canvas in the floor's units. */
  ground(on: Surface, S: Scene, st: ViewState): void;
  /** The pieces of the scene. */
  pieces(S: Scene, st: ViewState, out: Piece[]): void;
  /** What lies over everything: readings, the selection, what is being placed, then the words. */
  top(S: Scene, st: ViewState): void;
  /** The minimap, framed as the view says. */
  minimap(c: CanvasRenderingContext2D, frame: MiniFrame, st: ViewState, scene: SceneLookup, on: Surface): void;
}

export type { FactoryTicket };
