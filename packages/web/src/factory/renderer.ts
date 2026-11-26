/**
 * The Factory floor's view: where it looks from (camera, zoom, the floor that bounds it), what is under the pointer,
 * and the frame loop. World units are floor tiles.
 *
 * What is shown and where is the scene's (`scene.ts`), rebuilt at every frame. How it looks is the skin's
 * (`skins/`): the view hands the scene to it, orders the pieces it paints (`order` in `skins/skin.ts`), and keeps no
 * paint of its own.
 */
import type { LensLayer } from './lens';
import { inRect, machineParts } from './machineArt';
import { FloorScene, isBox, type Scene } from './scene';
import { CHEVRON_PACE, FleexSkin } from './skins/fleex';
import { LAYERS, order, paintPieces, type Piece, type Skin, type Surface } from './skins/skin';
import type { ArmSpec, FactoryLayout, FactoryTicket, IntakeState, MachineSpec, StationSpec } from './types';

/** A ticket's colour on the floor: the hue Fleex gives its type everywhere else. */
export { TYPE_COLORS } from './skins/fleex';
export { isBox };
export interface Ghost { cells: { x: number; y: number; w: number; h: number; dir?: number; /** An arm about to be placed: where it would take from and drop on is shown. */ arm?: boolean }[]; ok: boolean; erase?: boolean; text?: string }
export interface DragState { ticketId: string; x: number; y: number; ok: boolean; text: string }
export interface ViewState {
  layout: FactoryLayout;
  tickets: FactoryTicket[];
  /** Arm id → how far it had swung (0..1) and which way it was going when the last snapshot was taken. */
  arms: Map<string, { p: number; state: 'rest' | 'carry' | 'back' }>;
  /** Seconds since that snapshot, and seconds a swing takes: an arm keeps turning between two snapshots. */
  armAge?: number;
  armSwing?: number;
  /** Tiles a belt carries a ticket per second, and how many times faster a fast belt does (from the server). */
  beltSpeed?: number;
  fastBelt?: number;
  /** Board id → name, for the tag of an arm that sorts by board. */
  boardName?: (id: string) => string;
  /** The model a station runs on (see `stationModel.ts`), written under it; null for what calls none. */
  modelOf?: (m: StationSpec) => string | null;
  selMachine: string | null;
  /** Build mode: several machines selected at once. */
  selMany: string[];
  /** Build mode: the rectangle being dragged to select, in world units. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  selTicket: string | null;
  /** Several tickets selected together. */
  selTickets?: ReadonlySet<string> | null;
  /** The tickets inside the frame being dragged: what the selection will be if it is let go now. */
  pickTickets?: ReadonlySet<string> | null;
  hoverMachine: string | null;
  edit: boolean;
  ghost: Ghost | null;
  drag: DragState | null;
  /** A reading of the floor painted over stations and zones (cost, time, human wait, what stands there). */
  lens?: LensLayer | null;
  /** Tickets a filter leaves out: drawn faded, never hidden. */
  dim?: ReadonlySet<string> | null;
  /** Build mode: the area selected (its handles show), and the one being drawn, moved or resized (and whether it may be there). */
  areaSel?: string | null;
  areaGhost?: { x: number; y: number; w: number; h: number; ok: boolean } | null;
  /** Tickets a filter keeps: ringed, and named when `named` says so. */
  found?: ReadonlySet<string> | null;
  /** Tickets that carry their name on the floor, on top of favourites and the selected one. */
  named?: ReadonlySet<string> | null;
  /** Every ticket carries its name. */
  allNames?: boolean;
  /** What an arm takes is written next to it (on by default). Off, only the arm selected or pointed at says it. */
  armTags?: boolean;
  /** Every token carries its number, not only when the view is close. */
  numbers?: boolean;
  /** The lines of the grid (on by default). */
  grid?: boolean;
  /** The machine whose light the pointer is on. */
  hoverLamp?: string | null;
  /** The emergency stop is on: belts stand still, arms stay where they are, nothing pulses. */
  halted?: boolean;
  /** Exit id → how many tickets left by it over the last `exitDays` days. */
  exits?: Readonly<Record<string, number>> | null;
  /** What each intake dropped over the last 24 hours, by its id (the snapshot's `intakes`). */
  intakes?: Readonly<Record<string, IntakeState>> | null;
  exitDays?: number;
  /** Stations that are not set up (no persona, skill or panel, a script with nothing to run): outlined, with a "!". */
  unset?: ReadonlySet<string> | null;
}
/** What is under the pointer: a ticket, a machine, or the light of a machine (its switch). */
export type Hit = { ticketId: string } | { machineId: string } | { lamp: string } | null;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** The same value, or two empty lists: a state is often given a fresh `[]` for "none". */
const alike = (a: unknown, b: unknown): boolean => Object.is(a, b) || (Array.isArray(a) && Array.isArray(b) && !a.length && !b.length);
/** Empty tiles kept around what is built, so there is always room to extend it. */
/** The amber of a station that is not set up. */
const UNSET_INK = '#facc15';
/** The blue of what is fast: fast belts, fast arms. */
const FAST_INK = '#60a5fa';
export const FLOOR_MARGIN = 8;
/** The smallest floor, in tiles: a new factory starts on it, its Inbound in the middle. */
export const FLOOR_MIN_W = 300, FLOOR_MIN_H = 150;
/** The smallest area the view frames around what is built, so that a lone Inbound is not seen from too close. */
const FRAME_MIN_W = 40, FRAME_MIN_H = 24;
/**
 * The floor: what is built plus the margin, never smaller than a starting floor. Given the shape of the view
 * (`aspect`, its width over its height), it is widened or heightened to that shape, so that seen whole it fills the
 * view: the floor is the map, and nothing shows beyond it. Its sides stay on whole tiles.
 */
/** What is built on the floor, with a tile of room round it: what the minimap frames. Null on an empty floor. */
export function builtRect(layout: FactoryLayout): { x: number; y: number; w: number; h: number } | null {
  if (!layout.machines.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of layout.machines) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
  return { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, h: y1 - y0 + 2 };
}
export function floorRect(layout: FactoryLayout, aspect = 0): { x: number; y: number; w: number; h: number } {
  return around(layout, FLOOR_MIN_W, FLOOR_MIN_H, aspect);
}
/** What is built plus the margin, grown evenly to at least `minW` by `minH`, then to the shape `aspect`. */
function around(layout: FactoryLayout, minW: number, minH: number, aspect = 0): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of layout.machines) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
  if (!layout.machines.length) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  x0 -= FLOOR_MARGIN; y0 -= FLOOR_MARGIN; x1 += FLOOR_MARGIN; y1 += FLOOR_MARGIN;
  const growX = Math.max(0, minW - (x1 - x0)), growY = Math.max(0, minH - (y1 - y0));
  let x = x0 - Math.floor(growX / 2), y = y0 - Math.floor(growY / 2), w = x1 - x0 + growX, h = y1 - y0 + growY;
  if (aspect > 0 && Number.isFinite(aspect)) {
    if (w / h < aspect) { const wide = Math.ceil(h * aspect), by = wide - w; x -= Math.floor(by / 2); w = wide; }
    else { const high = Math.ceil(w / aspect), by = high - h; y -= Math.floor(by / 2); h = high; }
  }
  return { x, y, w, h };
}
/** The closest and the farthest the floor is ever seen from, in pixels per tile. The farthest is also bounded by the floor: see `FactoryView.constrain`. */
const Z_MAX = 80, Z_MIN = 3;
/** How long the layers of a picture are kept before they are painted again, nothing having changed; and while something on them pulses or blinks. */
const KEEP_MS = 500, PULSE_MS = 100;
/** The moments of the chevrons' run that the light kept with a picture is worked out from, and the seconds a chevron takes to come where the one before it was. */
const GLOW_MOMENTS = 4, GLOW_RUN_S = 0.5 / CHEVRON_PACE;
/** What of a view's state changes at every frame without changing the picture of a floor where nothing moves: how its arms were last told to be. */
const PASSING = new Set(['arms', 'armAge']);
/** The wheel's travel that makes a notch, for a skin whose zoom goes by steps; and how fast the zoom glides to a step. */
const NOTCH = 40, GLIDE = 14;

export class FactoryView {
  cam = { x: 24, y: 15, z: 18 };
  w = 0; h = 0;
  dpr = 1;
  /** What the floor shows, and what it remembers from one frame to the next. */
  private readonly scene = new FloorScene();
  readonly ctx: CanvasRenderingContext2D;

  /** Each view has its own skin: a skin keeps pictures it painted once, for this canvas. */
  constructor(readonly cv: HTMLCanvasElement, private skin: Skin = new FleexSkin()) { this.ctx = cv.getContext('2d')!; }
  /** Paint with another skin from the next frame on. What the floor shows, and where, is kept. */
  setSkin(skin: Skin): void { this.skin = skin; this.glideTo = null; this.notch = 0; }

  resize(): void {
    const d = Math.min(window.devicePixelRatio || 1, 2), w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (w === this.w && h === this.h && d === this.dpr) return;
    this.w = w; this.h = h; this.dpr = d;
    this.cv.width = Math.max(1, Math.round(w * d)); this.cv.height = Math.max(1, Math.round(h * d));
  }
  toWorld(sx: number, sy: number): { x: number; y: number } { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  /** The view's shape, for the floor to take. */
  private get aspect(): number { return this.h > 0 ? this.w / this.h : 0; }
  /** The floor as this view sees it: shaped like the view. */
  floorOf(layout: FactoryLayout): { x: number; y: number; w: number; h: number } { return floorRect(layout, this.aspect); }
  /** The farthest zoom: the one at which the floor just covers the view. Kept from the last frame, for what zooms between two. */
  private zMin = Z_MIN;
  /**
   * The floor is the map, and the view never leaves it: it cannot zoom out past the point where the floor covers it,
   * nor move so that anything beyond the floor would show. Called at every frame, so whatever moves the view (a drag,
   * the keys, the edges, the minimap, a jump to a ticket) is held to it.
   */
  constrain(layout: FactoryLayout): void {
    if (!this.w || !this.h) return;
    const F = this.floorOf(layout);
    this.zMin = Math.max(Z_MIN, this.w / F.w, this.h / F.h);
    this.cam.z = clamp(this.cam.z, this.zMin, Z_MAX);
    const hw = this.w / 2 / this.cam.z, hh = this.h / 2 / this.cam.z;
    this.cam.x = hw * 2 >= F.w ? F.x + F.w / 2 : clamp(this.cam.x, F.x + hw, F.x + F.w - hw);
    this.cam.y = hh * 2 >= F.h ? F.y + F.h / 2 : clamp(this.cam.y, F.y + hh, F.y + F.h - hh);
  }
  /** Zoom by that factor round that point of the view; for a skin with steps, to the next step that way. */
  zoomAt(sx: number, sy: number, factor: number): void {
    if (this.skin.steps) { if (factor !== 1) this.step(factor > 1 ? 1 : -1, sx, sy); return; }
    this.zoomTo(sx, sy, this.cam.z * factor);
  }
  /** The wheel, round that point: free for most skins; for one with steps, a notch (or a trackpad's worth) is a step. */
  wheel(sx: number, sy: number, deltaY: number, fine = false, lines = false): void {
    if (!this.skin.steps) { this.zoomTo(sx, sy, this.cam.z * Math.exp(-Math.max(-120, Math.min(120, deltaY)) * (fine ? 0.012 : 0.0022))); return; }
    this.notch += lines ? deltaY * 30 : deltaY;
    if (Math.abs(this.notch) >= NOTCH) { this.step(this.notch < 0 ? 1 : -1, sx, sy); this.notch = 0; }
  }
  private zoomTo(sx: number, sy: number, z: number): void {
    const before = this.toWorld(sx, sy);
    this.cam.z = clamp(z, this.zMin, Z_MAX);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
  }

  /*
   * A skin with steps (the pixel skin: its pixels are whole only there) rests on them only. The zoom glides from one to
   * the next and never stops between two; whatever puts it elsewhere (a jump to a ticket, a paste) is glided to the
   * nearest step at the next frames.
   */
  /** Where the zoom is gliding to, round which point, and the wheel's travel towards the next notch. */
  private glideTo: number | null = null;
  private glideAt = { x: 0, y: 0 };
  private notch = 0;
  /** The steps the zoom can rest on here: those the floor allows. */
  private stepsHere(): number[] {
    const all = (this.skin.steps ?? []).filter((s) => s >= this.zMin - 1e-6 && s <= Z_MAX);
    return all.length ? all : [clamp(this.skin.steps?.[this.skin.steps.length - 1] ?? Z_MAX, this.zMin, Z_MAX)];
  }
  private step(dir: 1 | -1, sx = this.w / 2, sy = this.h / 2): void {
    const from = this.glideTo ?? this.cam.z, all = this.stepsHere();
    const next = dir > 0 ? all.find((s) => s > from + 1e-3) : [...all].reverse().find((s) => s < from - 1e-3);
    if (next != null) { this.glideTo = next; this.glideAt = { x: sx, y: sy }; }
  }
  private nearestStep(z: number): number { return this.stepsHere().reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a)); }
  /** One frame of the glide: fast at first, slower as it comes, landing exactly on the step. The draw loop calls it. */
  glide(dt: number): void {
    if (!this.skin.steps) { this.glideTo = null; return; }
    const z = this.cam.z;
    if (this.glideTo == null && !this.stepsHere().some((s) => Math.abs(s - z) < 1e-6)) { this.glideTo = this.nearestStep(z); this.glideAt = { x: this.w / 2, y: this.h / 2 }; }
    if (this.glideTo == null) return;
    /* a step the floor no longer allows (the view grew): the nearest it does */
    if (!this.stepsHere().includes(this.glideTo)) this.glideTo = this.nearestStep(this.glideTo);
    const to = this.glideTo, next = Math.abs(to - z) < 0.05 ? to : z + (to - z) * (1 - Math.exp(-dt * GLIDE));
    this.zoomTo(this.glideAt.x, this.glideAt.y, next);
    if (next === to) { this.cam.z = to; this.glideTo = null; }
  }
  /** Is the zoom resting where its skin lets it (always, for a skin without steps)? */
  get resting(): boolean { return !this.skin.steps || (this.glideTo == null && this.stepsHere().some((s) => Math.abs(s - this.cam.z) < 1e-6)); }
  /** Frame what is built (at least a starting area round it: a lone Inbound fills it), or the whole floor when it is being edited. */
  fit(layout: FactoryLayout, whole: boolean): void {
    this.resize();
    const f = whole ? this.floorOf(layout) : around(layout, FRAME_MIN_W, FRAME_MIN_H), pad = whole || layout.machines.length <= 1 ? 0 : FLOOR_MARGIN - 1.5;
    const x0 = f.x + pad, y0 = f.y + pad, x1 = f.x + f.w - pad, y1 = f.y + f.h - pad;
    const bw = x1 - x0, bh = y1 - y0;
    this.cam.z = clamp(Math.min(this.w / bw, this.h / bh), Z_MIN, 60);
    this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2;
    this.constrain(layout);
    /* with steps: the closest step that still frames it all (at once: framing is not zooming) */
    if (this.skin.steps) { const all = this.stepsHere(), z = this.cam.z; this.cam.z = [...all].reverse().find((s) => s <= z + 1e-6) ?? all[0]!; this.glideTo = null; this.constrain(layout); }
  }

  /**
   * Read the floor from this layout. The draw loop does it at every frame; whoever asks the view a question about a
   * layout it holds (the side panel) says so first, since the page gets a fresh copy of the layout at every poll.
   */
  use(layout: FactoryLayout): void { this.scene.index(layout); }
  at(x: number, y: number): MachineSpec | null { return this.scene.at(x, y); }
  machine(id: string | null): MachineSpec | null { return this.scene.machine(id); }
  takersOf(m: MachineSpec): ArmSpec[] { return this.scene.takersOf(m); }
  /** The first machine a belt leads to, following the belts as they point. */
  leadsTo(m: MachineSpec | null, dir = 0): MachineSpec | null { return this.scene.leadsTo(m, dir); }

  /** The state of the last frame drawn: what a skin seen from three quarters needs to say how high a ticket is. */
  private lastState: ViewState | null = null;
  /** How high a machine stands, as the skin paints it (0 on a flat skin). */
  private raised(m: MachineSpec | null): number { const st = this.lastState, f = this.skin.liftOf; return m && st && f ? f.call(this.skin, m, st) : 0; }
  /** Where a ticket is seen: where it is drawn, as high as what carries it. */
  ticketPos(ticketId: string): { x: number; y: number } | null {
    const p = this.scene.shown.get(ticketId);
    if (!p || !this.skin.liftOf) return p ?? null;
    const t = this.lastState?.tickets.find((q) => q.ticketId === ticketId);
    return { x: p.x, y: p.y - this.raised(this.machine(t?.machineId ?? null)) };
  }
  /** Where every ticket is seen, for a frame to be laid over them. */
  ticketPlaces(): Iterable<[string, { x: number; y: number }]> {
    if (!this.skin.liftOf || !this.lastState) return this.scene.shown;
    const on = new Map(this.lastState.tickets.map((t) => [t.ticketId, t.machineId])), out: [string, { x: number; y: number }][] = [];
    for (const [id, p] of this.scene.shown) out.push([id, { x: p.x, y: p.y - this.raised(this.machine(on.get(id) ?? null)) }]);
    return out;
  }
  /** Where a ticket's machine is on screen (the ticket itself, when it stands on no box), in the canvas's own pixels: what a card about the ticket sits beside. */
  anchorOf(ticketId: string, st: ViewState): { x: number; y: number; w: number; h: number } | null {
    const t = st.tickets.find((q) => q.ticketId === ticketId); if (!t) return null;
    const z = this.cam.z, sx = (wx: number) => (wx - this.cam.x) * z + this.w / 2, sy = (wy: number) => (wy - this.cam.y) * z + this.h / 2;
    this.use(st.layout);
    const m = this.machine(t.machineId);
    if (m && isBox(m)) { const L = this.raised(m); return { x: sx(m.x), y: sy(m.y - L), w: m.w * z, h: (m.h + L) * z }; }
    const p = this.ticketPos(ticketId);
    return p ? { x: sx(p.x - 0.7), y: sy(p.y - 0.7), w: 1.4 * z, h: 1.4 * z } : null;
  }

  /** What failed to be painted, told once per message: the floor is painted without it (`paintPieces`). */
  private readonly told = new Set<string>();
  private readonly failed = (err: unknown, p: Piece): void => {
    const msg = err instanceof Error ? err.message : String(err);
    if (this.told.has(msg)) return;
    this.told.add(msg);
    console.error(`Factory: a piece of the floor could not be painted (layer ${p.layer}, depth ${p.depth}); the rest is painted without it.`, err);
  };

  /*
   * The picture kept in layers. Painting the whole floor costs, and on a floor where nothing moves the only thing
   * that changes from one frame to the next is the chevrons of its belts. So, with a skin that can (`Skin.layered`),
   * what lies under the chevrons, what lies over them, and the words are each painted on a canvas of their own, and
   * kept: a frame is then the first laid down, the chevrons painted anew, the two others laid over. They are painted
   * again when what they show changes (the state, the view), every `KEEP_MS` in case something changed that nothing
   * says (the theme, a font come late, a count). What moves by itself over the chevrons (a ticket that calls for
   * someone, one at work, a lamp) is painted at every frame too, between two layers (`live`); only when such a thing
   * lies where that cannot be are the layers painted again every `PULSE_MS`. While something moves, or the view does,
   * the floor is painted straight on the canvas as it always was.
   */
  private layers: { under: HTMLCanvasElement; over: HTMLCanvasElement; /** Over what moves by itself. */ last: HTMLCanvasElement; words: HTMLCanvasElement; mid: Piece[]; /** What moves by itself, painted at every frame between `over` and `last`. */ run: Piece[]; at: number; /** The skin's light, kept too, and the picture it was worked out from. */ glow: { cv: HTMLCanvasElement; alpha: number } | null; lit: HTMLCanvasElement | null } | null = null;
  /** The state and the view of the last frame: the picture is kept only from the second frame that shows the same. */
  private seen: { st: ViewState; x: number; y: number; z: number; w: number; h: number; dpr: number; skin: Skin } | null = null;
  private unchanged(st: ViewState): boolean {
    const p = this.seen, c = this.cam, same = this.sameState(st);
    this.seen = { st, x: c.x, y: c.y, z: c.z, w: this.w, h: this.h, dpr: this.dpr, skin: this.skin };
    return same && !!p && p.x === c.x && p.y === c.y && p.z === c.z && p.w === this.w && p.h === this.h && p.dpr === this.dpr && p.skin === this.skin;
  }
  /** Is this the state of the last frame, but for what passes (`PASSING`)? */
  private sameState(st: ViewState): boolean {
    const p = this.seen;
    if (!p) return false;
    const a = st as unknown as Record<string, unknown>, b = p.st as unknown as Record<string, unknown>;
    for (const k in a) if (!PASSING.has(k) && !alike(a[k], b[k])) return false;
    for (const k in b) if (!(k in a)) return false;
    return true;
  }
  /** How the last frame was painted: for the checks, and for whoever measures. */
  painted: 'straight' | 'layers' | 'kept' = 'straight';
  /** How many frames were painted each way, since the view was made. */
  readonly tally = { straight: 0, layers: 0, kept: 0 };

  draw(st: ViewState, dtReal: number): void {
    this.resize();
    const now = performance.now(), fresh = !!this.layers && now - this.layers.at < (this.pulse ? PULSE_MS : KEEP_MS);
    /* the same state as at the last frame, on a picture still kept, nothing moving: the same scene, a moment later */
    const lasting = this.resting && !this.moving && fresh && this.sameState(st) ? this.scene.again(dtReal) : null;
    const S = lasting ?? this.scene.build(st, dtReal);
    this.lastState = st;
    this.glide(dtReal);
    this.constrain(st.layout);
    let trailing = false;
    for (const t of this.trails.values()) if (t.length > 1) { trailing = true; break; }
    const moving = S.moving || trailing || !this.resting, same = this.unchanged(st);
    if (moving || !same || !this.skin.layered || !this.skin.aim) { this.layers = null; this.straight(S, st); this.painted = 'straight'; }
    else if (!fresh) { this.layered(S, st, now); this.painted = 'layers'; }
    else { this.compose(S); this.painted = 'kept'; }
    this.moving = moving; this.tally[this.painted]++;
  }
  /** The whole floor, straight on the canvas. */
  private straight(S: Scene, st: ViewState): void {
    const skin = this.skin;
    skin.ground(this, S, st);
    const pieces: Piece[] = [];
    skin.pieces(S, st, pieces);
    const all = order(pieces), live = new Array<boolean>(all.length).fill(false);
    let any = !!skin.animated;
    skin.animated = false;
    paintPieces(all, this.ctx, this.failed, true, (i) => { if (skin.animated) { live[i] = true; any = true; skin.animated = false; } });
    skin.top(S, st);
    this.fastArms(S, this.ctx);
    this.unsetMarks(st, this.ctx);
    this.live = live;
    this.ambient = !st.halted && (any || !!skin.animated);
  }
  /**
   * Which pieces of the last list painted whole moved by themselves (a pulse, a blink, an arc that turns), by their
   * place in its order: the same state lists the same pieces in the same order. Those are painted at every frame
   * when the rest of the picture is kept, so a ticket that calls for someone does not have the whole floor painted
   * ten times a second for its halo.
   */
  private live: boolean[] | null = null;
  /** Something of a picture kept moves by itself and is not among what is painted at every frame: its layers are painted again often. */
  private pulse = false;
  /** The view, on another canvas of the same size. */
  private surface(cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Surface {
    return { ctx, cv, dpr: this.dpr, w: this.w, h: this.h, cam: this.cam, toWorld: (x, y) => this.toWorld(x, y), floorOf: (l) => this.floorOf(l), machine: (id) => this.machine(id) };
  }
  /** The floor painted on its layers, then the frame made of them. */
  private layered(S: Scene, st: ViewState, now: number): void {
    const skin = this.skin, make = () => document.createElement('canvas');
    const L = this.layers ?? { under: make(), over: make(), last: make(), words: make(), mid: [], run: [], at: 0, glow: null, lit: null };
    const sheet = (cv: HTMLCanvasElement, clear: boolean): Surface | null => {
      if (cv.width !== this.cv.width || cv.height !== this.cv.height) { cv.width = this.cv.width; cv.height = this.cv.height; }
      const ctx = cv.getContext('2d'); if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      if (clear) ctx.clearRect(0, 0, cv.width, cv.height);
      return this.surface(cv, ctx);
    };
    const U = sheet(L.under, false), O = sheet(L.over, true), Z = sheet(L.last, true), W = sheet(L.words, true);
    if (!U || !O || !Z || !W) { this.layers = null; this.straight(S, st); return; }
    skin.ground(U, S, st);
    const pieces: Piece[] = [];
    skin.pieces(S, st, pieces);
    const all = order(pieces), known = this.live && this.live.length === all.length ? this.live : null, live = new Array<boolean>(all.length).fill(false);
    /* what moves by itself and is on a layer all the same: the layers are then painted again often (`pulse`) */
    let missed = !!skin.animated;
    skin.animated = false;
    /* from the first piece that runs with the belts to the last: painted at every frame; before and after: kept */
    let first = all.findIndex((p) => p.turns), last = first;
    if (first < 0) first = last = all.length; else { for (let i = all.length - 1; i > first; i--) if (all[i]!.turns) { last = i; break; } last++; }
    /*
     * After them, what moves by itself is painted at every frame too, between two layers: what comes before it, what
     * comes after. At one depth nothing lies over anything else (boxes each have their tiles), so what moves there
     * is taken last of its depth: a station whose ticket pulses does not split the boxes in two.
     */
    let rest = all.slice(last).map((p, n) => ({ p, i: last + n, live: !!known?.[last + n] }));
    if (!all.some((p) => p.on)) rest = rest.sort((a, b) => LAYERS.indexOf(a.p.layer) - LAYERS.indexOf(b.p.layer) || a.p.depth - b.p.depth || Number(a.live) - Number(b.live));
    let from = rest.findIndex((r) => r.live), to = from;
    if (from < 0) from = to = rest.length; else { for (let n = rest.length - 1; n > from; n--) if (rest[n]!.live) { to = n; break; } to++; }
    const before = rest.slice(0, from), run = rest.slice(from, to), after = rest.slice(to);
    const kept = (i: number) => { if (skin.animated) { live[i] = true; missed = true; skin.animated = false; } };
    paintPieces(all.slice(0, first), U.ctx, this.failed, true, kept);
    skin.aim!(O, S);
    paintPieces(before.map((r) => r.p), O.ctx, this.failed, true, (n) => kept(before[n]!.i));
    skin.aim!(Z, S);
    paintPieces(after.map((r) => r.p), Z.ctx, this.failed, true, (n) => kept(after[n]!.i));
    skin.readings?.(S, st);
    skin.aim!(W, S);
    skin.words?.(S, st);
    this.fastArms(S, W.ctx);
    this.unsetMarks(st, W.ctx);
    if (skin.animated) missed = true;
    for (const r of run) live[r.i] = true;
    this.live = live; this.pulse = missed;
    this.ambient = !st.halted && (missed || run.length > 0);
    L.mid = all.slice(first, last); L.run = run.map((r) => r.p); L.at = now;
    this.layers = L;
    L.glow = this.glowOf(L, S);
    this.compose(S);
  }
  /**
   * The skin's light for the layers kept, when it can give it alone (`Skin.bloomOf`): worked out once from the picture,
   * not at every frame. The chevrons run under it: they are in that picture at four moments of their run at once,
   * each at a quarter of its strength, so the light along a belt is the one it has on average and does not stay behind them.
   */
  private glowOf(L: NonNullable<FactoryView['layers']>, S: Scene): { cv: HTMLCanvasElement; alpha: number } | null {
    const skin = this.skin;
    if (!skin.bloomOf) return null;
    const cv = L.lit ?? (L.lit = document.createElement('canvas'));
    if (cv.width !== this.cv.width || cv.height !== this.cv.height) { cv.width = this.cv.width; cv.height = this.cv.height; }
    const ctx = cv.getContext('2d'); if (!ctx) return null;
    const on = this.surface(cv, ctx), flat = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; };
    flat(); ctx.drawImage(L.under, 0, 0);
    for (let n = 0; n < GLOW_MOMENTS; n++) {
      skin.aim!(on, { ...S, turn: S.turn + n * GLOW_RUN_S / GLOW_MOMENTS });
      ctx.globalAlpha = 1 / GLOW_MOMENTS;
      paintPieces(L.mid, ctx, this.failed, true);
    }
    flat(); ctx.drawImage(L.over, 0, 0);
    if (L.run.length) { skin.aim!(on, S); paintPieces(L.run, ctx, this.failed, true); flat(); }
    ctx.drawImage(L.last, 0, 0);
    /* the words these pieces asked for are not of the picture that glows */
    skin.forget?.();
    return skin.bloomOf(cv);
  }
  /** A frame from the layers kept: what is under, the chevrons as they now are, what is over, what moves by itself, what is over that, the skin's light, the words. */
  private compose(S: Scene): void {
    const L = this.layers!, c = this.ctx, skin = this.skin, flat = () => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; };
    flat(); c.drawImage(L.under, 0, 0);
    skin.aim!(this, S);
    paintPieces(L.mid, c, this.failed, true);
    flat(); c.drawImage(L.over, 0, 0);
    if (L.run.length) { skin.aim!(this, S); paintPieces(L.run, c, this.failed, true); flat(); }
    c.drawImage(L.last, 0, 0);
    if (L.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = L.glow.alpha; c.imageSmoothingEnabled = true; c.drawImage(L.glow.cv, 0, 0, this.cv.width, this.cv.height); }
    else skin.light?.();
    flat(); c.drawImage(L.words, 0, 0);
    /* the words of what was just painted (the name of a station whose ticket pulses) */
    skin.aim!(this, S); skin.words?.(null, null);
  }

  /**
   * What the last frame drawn showed. `moving`: something moves
   * on the floor (a ticket, an arm, a fast arm's trail fading, the zoom gliding to a step). `ambient`: nothing moves,
   * but something painted pulses, blinks or walks with the floor's clock.
   */
  moving = false;
  ambient = false;

  /** Where the cup of each fast arm was over the last frames: its trail. */
  private readonly trails = new Map<string, { x: number; y: number }[]>();
  /**
   * A fast arm, whatever the skin (picked on `docs/factory/fast-arm.html`, C): a double ring in the fast belts' blue
   * round its pivot, and a blue trail behind its cup while it swings. Its own colour is left as it is.
   */
  private fastArms(S: Scene, c: CanvasRenderingContext2D): void {
    const fast = S.arms.filter((v) => v.m.fast);
    if (!fast.length) { this.trails.clear(); return; }
    const z = this.cam.z, sx = (x: number) => (x - this.cam.x) * z + this.w / 2, sy = (y: number) => (y - this.cam.y) * z + this.h / 2;
    const seen = new Set<string>();
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.strokeStyle = FAST_INK; c.lineCap = 'round';
    for (const v of fast) {
      seen.add(v.m.id);
      const lift = this.raised(v.m), bx = sx(v.bx), by = sy(v.by - lift);
      if (bx < -z || by < -z || bx > this.w + z || by > this.h + z) continue;
      const trail = this.trails.get(v.m.id) ?? [], last = trail[0];
      if (!last || Math.hypot(last.x - v.hx, last.y - v.hy) > 0.01) trail.unshift({ x: v.hx, y: v.hy }); else trail.pop();
      if (trail.length > 7) trail.length = 7;
      this.trails.set(v.m.id, trail);
      /* the trail: the cup's last places, fading, while it moves */
      c.lineWidth = Math.max(1.5, z * 0.09);
      for (let i = 1; i < trail.length; i++) {
        c.globalAlpha = 0.5 * (1 - i / trail.length);
        c.beginPath(); c.moveTo(sx(trail[i - 1]!.x), sy(trail[i - 1]!.y - lift)); c.lineTo(sx(trail[i]!.x), sy(trail[i]!.y - lift)); c.stroke();
      }
      c.globalAlpha = 1;
      /* the pivot: two blue rings, as a fast belt has blue rails */
      c.lineWidth = Math.max(1, z * 0.05);
      c.beginPath(); c.arc(bx, by, z * 0.34, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(bx, by, z * 0.16, 0, Math.PI * 2); c.stroke();
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
    c.restore();
  }

  /**
   * A station that is not set up, whatever the skin: a dashed amber outline round it (its front face too, on a skin
   * seen from three quarters) and a "!" on its corner. Painted last, in the page's pixels, so no skin hides it.
   */
  private unsetMarks(st: ViewState, c: CanvasRenderingContext2D): void {
    if (!st.unset?.size) return;
    const z = this.cam.z;
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const m of st.layout.machines) {
      if (!st.unset.has(m.id)) continue;
      const lift = this.raised(m), x = (m.x - this.cam.x) * z + this.w / 2, y = (m.y - lift - this.cam.y) * z + this.h / 2, w = m.w * z, h = (m.h + lift) * z;
      if (x > this.w || y > this.h || x + w < 0 || y + h < 0) continue;
      c.setLineDash([Math.max(3, z * 0.35), Math.max(2, z * 0.25)]); c.lineWidth = Math.max(1.5, z * 0.08); c.strokeStyle = UNSET_INK;
      c.strokeRect(x + 1, y + 1, w - 2, h - 2);
      c.setLineDash([]);
      const r = Math.max(7, Math.min(16, z * 0.45)), cx = x + w - r * 0.4, cy = y + r * 0.4;
      c.fillStyle = UNSET_INK; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#18181b'; c.font = `700 ${Math.round(r * 1.3)}px Inter, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('!', cx, cy + r * 0.06);
    }
    c.restore();
  }

  // ---------- minimap ----------
  private mini: { s: number; ox: number; oy: number } | null = null;
  minimap(cv: HTMLCanvasElement, st: ViewState): void {
    const d = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight, L = st.layout;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const c = cv.getContext('2d'); if (!c) return;
    /* what is built fills the screen (the floor's margins do not); around it is terrain, a faint quadrille */
    /* and so does the view's own rectangle, kept on the floor: zoomed out, the view is never off the screen */
    const F = this.floorOf(L), hw0 = this.w / 2 / this.cam.z, hh0 = this.h / 2 / this.cam.z;
    const V = { x0: Math.max(F.x, this.cam.x - hw0), y0: Math.max(F.y, this.cam.y - hh0), x1: Math.min(F.x + F.w, this.cam.x + hw0), y1: Math.min(F.y + F.h, this.cam.y + hh0) };
    const b0 = builtRect(L) ?? F, bx0 = Math.min(b0.x, V.x0), by0 = Math.min(b0.y, V.y0), B = { x: bx0, y: by0, w: Math.max(b0.x + b0.w, V.x1) - bx0, h: Math.max(b0.y + b0.h, V.y1) - by0 }, room = 6, s = Math.min((w - room * 2) / B.w, (h - room * 2) / B.h), ox = (w - B.w * s) / 2 - B.x * s, oy = (h - B.h * s) / 2 - B.y * s;
    this.mini = { s, ox, oy };
    this.skin.minimap(c, { w, h, dpr: d, s, ox, oy, floor: F }, st, this.scene, this);
  }

  /** The machine seen at that point when things stand: its top or its front face, the nearest first (the lowest on screen). */
  private seenAt(x: number, y: number, layout: FactoryLayout, raise: (m: MachineSpec) => number): MachineSpec | null {
    let best: MachineSpec | null = null;
    for (const m of layout.machines) {
      if (m.kind === 'label' || m.kind === 'area' || x < m.x || x >= m.x + m.w || y >= m.y + m.h || y < m.y - raise(m)) continue;
      if (!best || m.y + m.h > best.y + best.h) best = m;
    }
    return best;
  }
  miniToWorld(mx: number, my: number): { x: number; y: number } | null { const m = this.mini; return m ? { x: (mx - m.ox) / m.s, y: (my - m.oy) / m.s } : null; }

  pick(sx: number, sy: number, st: ViewState, withTickets: boolean): Hit {
    const p = this.toWorld(sx, sy);
    this.use(st.layout);
    /* seen from three quarters, things stand higher than their tiles: a ticket is where it is drawn, a machine where it is seen */
    const raise = this.skin.liftOf ? (m: MachineSpec | null) => (m ? this.skin.liftOf!(m, st) : 0) : null;
    if (withTickets) {
      let best: string | null = null, bd = Math.max(0.3, 9 / this.cam.z);
      for (const t of st.tickets) { const q = this.scene.shown.get(t.ticketId); if (!q) continue; const dd = Math.hypot(q.x - p.x, q.y - (raise ? raise(this.machine(t.machineId)) : 0) - p.y); if (dd < bd) { bd = dd; best = t.ticketId; } }
      if (best) return { ticketId: best };
    }
    const m = raise ? this.seenAt(p.x, p.y, st.layout, raise) : this.at(Math.floor(p.x), Math.floor(p.y)), up = raise ? raise(m) : 0;
    /* out of build mode, the light of a machine is its own target: its switch, and what it has to say */
    if (m && withTickets && m.kind === 'station' && m.exec !== 'native' && inRect(machineParts(m).lamp, p.x, p.y + up)) return { lamp: m.id };
    if (m) return { machineId: m.id };
    for (const l of st.layout.machines) if (l.kind === 'label' && Math.floor(p.x) === l.x && Math.floor(p.y) === l.y) return { machineId: l.id };
    return null;
  }
}
