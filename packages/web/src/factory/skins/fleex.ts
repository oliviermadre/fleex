/**
 * The Fleex skin: the Factory as it has always been drawn. Dark and sober on a dark theme, light on a light one, a hue
 * per kind of station, no decor: the floor's margins are bare floor.
 *
 * It paints the scene (`../scene.ts`) and keeps nothing of the floor from one frame to the next; what it keeps are
 * pictures it painted once to stamp again (the floor's backdrop, glows, shadows) and the words of the frame, written
 * last over everything.
 */
import type { LensLayer } from '../lens';
import { layoutNames, tie, type NamedTicket } from '../nameTags';
import { armColor } from '../armRules';
import type { LaneFlow } from '../bridges';
import { fadeIn, floorLook, isLight, legible, luminance, MAJOR, mix, veil } from '../floorLook';
import { refOf, SOURCE_COLORS, SOURCE_LABEL, SOURCE_TYPE_COLORS, sourceType } from '../items';
import { BAR, bodyOf, CUT, DESK_COLOR, KIND_LOOK, kindOf, MACHINE_ICONS, ROUND, SHOULDER, STACK, type Lamp, type Rect, type RunKind } from '../machineArt';
import { portColor } from '../teleport';
import { modelTag } from '../stationModel';
import { tokenSprite, type TokenLook } from '../ticketToken';
import type { ArmView, ArmWay, BeltView, BridgeView, DockView, ExitView, LabelView, PortView, Placed, Quay, Scene, StationView, StatusView, ZoneView } from '../scene';
import { DX, DY, humanCall, type AreaLabel, type AreaSpec, type FactoryLayout, type FactoryTicket, type MachineSpec, type StationSpec } from '../types';
import type { ViewState } from '../renderer';
import type { MiniFrame, Piece, SceneLookup, Skin, Surface } from './skin';
import { builtBox, hallOf, propsIn, wallThings, type DecorOptions } from '../decor';
import { Crowd, workerState, type PeopleOptions, type Person } from '../people';
import { flatPerson, flatWorker, zees } from './peoplePaint';
import { flatProps, flatWalls, flatYard, type DecorStyle, type FlatDecorPaint } from './flatDecor';

/** A ticket's colour on the floor: the hue Fleex gives its type everywhere else (see `TicketTypeBadge`). A colour with a meaning: another skin may soften it, not replace it. */
export const TYPE_COLORS: Record<string, string> = { build: '#4ade80', fix: '#f87171', review: '#facc15', ops: '#2dd4bf', lead: '#c084fc', think: '#60a5fa', ...SOURCE_TYPE_COLORS };
export const STAR = '#facc15';
/** A ticket with no type, and the ghost of one a filter leaves out. */
export const NO_TYPE = '#8b949e', GHOST = '#71717a';
export const PRIORITY_PIP: Record<string, string> = { urgent: '#ef4444', high: '#fb923c' };
/** The paint of a zone: the colour of the status it sets, lifted where that one is too dark to read on the floor; and the paint of a zone that sets none. */
export const ZONE_PAINT: Record<string, string> = { backlog: '#a1a1aa', todo: '#fb923c', doing: '#60a5fa', reviewing: '#c084fc', done: '#22c55e' };
export const PAINT = '#60a5fa';
/* the plates things are written on: near black on a dark floor; on a light one they turn light (`write`) */
const DARK_PLATE = /^rgba\(9,9,11,/, LIGHT_PLATE = 'rgba(255,255,255,0.95)';
/** Hazard yellow, as paint: the same on any theme. */
export const HAZARD = '#eab308';
/** The colour of a Set gantry, and of everything that says what it does. */
export const SET = '#f472b6';
/** A plate of several lines beside a machine: what it is set to do, readable from the floor. */
export interface Board { /** How high it stands (see `lifted`). */ lift?: number; lines: string[]; inks: string[]; wx: number; wy: number; side: 'above' | 'below' | 'right' | 'left'; col: string }
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export interface Palette { bg: string; floor: string; grid: string; belt: string; edge: string; chev: string; /** Fast belts and fast lanes of bridges: their chevrons and their rails. */ fast: string; body: string; text: string; text2: string; text3: string; ok: string; warn: string; danger: string; accent: string; /** A light theme: the floor is light, and what is written on it is dark. */ light: boolean; /** The amber of gates and of what waits for someone, as paint: a theme's warning colour is a text colour, brown on a light theme. */ amber: string }
export type LabelOpts = Label[5];
type Label = [text: string, wx: number, wy: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; mono?: boolean; plate?: string; min?: number; max?: number; fit?: number; /** Room between letters, as a share of the letter's size: a word in capitals reads as a marking. */ spacing?: number; /** Pixels down from where it is anchored: lines of one plate keep their distance at any zoom. */ dy?: number; /** It is written on something dark whatever the theme (a veil over the floor): its ink is left as it is. */ dark?: boolean }];

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Room kept around a box in the picture of its shadow, in tiles. */
const SHADOW_PAD = 1.2;
/** The colour of a frame being dragged, and of what it takes. */
export const PICK = '#60a5fa';
/** The arrow painted under an arm, pointing east, round the middle of its tile: narrow where it takes, wide where it drops. */
export const WAY: readonly (readonly [number, number])[] = [[-0.48, -0.19], [0.14, -0.26], [0.14, -0.42], [0.5, 0], [0.14, 0.42], [0.14, 0.26], [-0.48, 0.19]];
/** Tiles of room kept round the view when what is beyond it is left unpainted. */
const VIEW_ROOM = 4;
/** How fast chevrons run along a belt, and along a fast one, in tiles per second; and how far apart the two chevrons of a fast pair are. */
export const CHEVRON_PACE = 0.6, CHEVRON_FAST = 1.2, CHEVRON_PAIR = 0.15;

/** A machine's icon as one path, made once: its strokes were parsed and stroked one by one at every frame. */
const ICON_PATHS = new Map<string, Path2D | null>();
function iconPath(exec: string): Path2D | null {
  let p = ICON_PATHS.get(exec);
  if (p === undefined) { const ds = MACHINE_ICONS[exec as keyof typeof MACHINE_ICONS]; p = ds?.length ? new Path2D(ds.join(' ')) : null; ICON_PATHS.set(exec, p); }
  return p;
}

export class FleexSkin implements Skin {
  readonly id: string = 'fleex';
  /** The zooms the view rests on, for a skin whose pixels must be whole (see `Skin.steps`): none here. */
  readonly steps?: readonly number[];
  /** The floor's clock, as the scene last said. */
  protected clockNow = 0;
  /**
   * The floor's clock, for what moves by itself: a pulse, a blink, an arc that turns, a worker. Reading it says that
   * what is being painted changes with time (`animated`), so it is read only where something is painted from it.
   */
  protected get clock(): number { this.animated = true; return this.clockNow; }
  /** The belts' clock, for their chevrons: it stands still while nothing moves on the floor (`Scene.turn`). */
  protected turn = 0;
  /** Something painted since `ground` moves by itself: the floor is then drawn often enough for it (`Skin.animated`). */
  animated = false;
  private labels: Label[] = [];
  protected boards: Board[] = [];
  protected pal: Palette | null = null;
  protected palAt = 0;
  /** The floor as last painted, and what it was painted for. */
  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey: unknown[] = [];
  private glowCache = new Map<string, HTMLCanvasElement>();
  private shadowCache = new Map<string, HTMLCanvasElement>();
  /** What it paints on, at this frame. */
  protected on!: Surface;
  /** The fonts words are written in: the app's own. */
  protected fonts = { sans: SANS, mono: MONO };
  protected get ctx(): CanvasRenderingContext2D { return this.on.ctx; }
  protected get cv(): HTMLCanvasElement { return this.on.cv; }
  protected get dpr(): number { return this.on.dpr; }
  protected get w(): number { return this.on.w; }
  protected get h(): number { return this.on.h; }
  protected get cam(): Surface['cam'] { return this.on.cam; }
  protected toWorld(sx: number, sy: number): { x: number; y: number } { return this.on.toWorld(sx, sy); }
  protected floorOf(layout: FactoryLayout): { x: number; y: number; w: number; h: number } { return this.on.floorOf(layout); }
  protected machine(id: string | null): MachineSpec | null { return this.on.machine(id); }

  ground(on: Surface, S: Scene, st: ViewState): void {
    this.clockNow = S.clock; this.animated = false;
    this.on = on; this.turn = S.turn;
    this.floor(st, S, this.palette());
    this.aim(on, S);
    this.shadows(st, this.palette());
  }

  /** Painted in layers (`Skin.layered`): it is, as long as its words are written over the picture, not in it. */
  get layered(): boolean { return !this.wordsInPicture; }
  aim(on: Surface, S: Scene): void {
    this.on = on; this.turn = S.turn;
    const ctx = this.ctx, cam = this.cam, d = this.dpr, z = cam.z;
    ctx.setTransform(z * d, 0, 0, z * d, (this.w / 2 - cam.x * z) * d, (this.h / 2 - cam.y * z) * d);
  }

  /**
   * A flat skin: everything stands on one layer, and its depth is the order things have always been painted in. Belts
   * first, their chevrons, bridges, then the boxes with what they hold, what rides the belts, the gantries over them,
   * what lies on the floor, the arms with what they carry, the tolls' arms, what leaves by an exit, and the links
   * between teleporters over all of it.
   */
  /** The decor (`decor.ts`): none until it is asked for (`setDecor`; the page asks as the settings say, `skins/index.ts`). */
  protected decorOpts: DecorOptions | null = null;
  /** The time the decor's clock gives: now, unless a check picture needs a time that does not move. */
  wallClock: () => Date = () => new Date();
  /** Give the floor a decor, or take it away. */
  setDecor(d: DecorOptions | null): this { this.decorOpts = d; return this; }
  /** How this skin draws its decor: an architect's plan. */
  protected decorStyle(): DecorStyle { return 'fleex'; }
  /** The decor: the yard and the walls under everything, the props on the floor, faded in build mode. */
  protected decorPieces(st: ViewState, out: Piece[], _standing: boolean): void {
    const d = this.decorOpts;
    if (!d) return;
    const pal = this.palette(), F = this.floorOf(st.layout), hall = hallOf(st.layout, F, d.wall), built = builtBox(st.layout.machines);
    const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h), view = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    const paint = (): FlatDecorPaint => ({ ctx: this.ctx, pal, style: this.decorStyle(), z: this.cam.z, view, clock: this.clockNow, time: this.wallClock(), say: (t, x, y, size, color, o) => this.label(t, x, y, size, color, o) });
    out.push({ layer: 'floor', depth: -3, draw: () => { const p = paint(); if (d.wall === 'built') flatYard(p, hall, F); flatWalls(p, hall, built, 'FLEEX FACTORY'); } });
    if (d.props && !(st.edit && d.build === 'hide')) out.push({ layer: 'floor', depth: -0.5, draw: () => flatProps(paint(), st.layout, hall, d.props, !!st.edit) });
  }

  /** The people (`people.ts`): none until they are asked for (`setPeople`; the page asks with the decor). */
  protected peopleOpts: PeopleOptions | null = null;
  protected readonly crowd = new Crowd();
  private crowdAt = -1;
  /** Bring people onto the floor, or send them away. */
  setPeople(o: PeopleOptions | null): this { this.peopleOpts = o; return this; }
  /**
   * The people at this frame: moved by the floor's clock (they stop when it does), none from far. Standing at their
   * row for a skin seen from three quarters, over the floor otherwise.
   */
  protected peoplePieces(S: Scene, st: ViewState, out: Piece[], standing: boolean): void {
    const o = this.peopleOpts;
    if (!o) return;
    const d = this.decorOpts, L = st.layout, hall = hallOf(L, this.floorOf(L), d?.wall ?? 'built'), pal = this.palette();
    const blocked = new Set(d?.props ? propsIn(L, hall, hall, d.props).map((q) => `${q.x},${q.y}`) : []);
    const dt = this.crowdAt < 0 ? 0 : Math.max(0, Math.min(0.3, this.clockNow - this.crowdAt)); this.crowdAt = this.clockNow;
    const waiting = S.boxes.filter((v) => v.kind === 'station' && v.gate && v.deciding.length > 0).map((v) => v.m);
    const door = wallThings(hall, builtBox(L.machines)).find((t) => t.kind === 'door');
    const still = o.still ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const people = this.crowd.update(dt, L, hall, blocked, waiting, { ...o, still }, door ? { x: door.x, y: hall.y } : undefined);
    if (this.cam.z < 10 || (st.edit && o.build === 'hide')) return;
    /* someone walks, or will in a moment */
    if (!still && people.some((p) => p.role === 'walker' || p.path.length)) this.animated = true;
    const a = st.edit ? 0.35 : 1, faded = (f: () => void) => () => { this.ctx.globalAlpha = a; f(); this.ctx.globalAlpha = 1; };
    for (const p of people) out.push({ layer: 'standing', depth: standing ? p.y + 1 : 6.5, draw: faded(() => this.person(p, pal)) });
    this.stationPeople(S, out, standing, o, pal);
  }
  /** A person, as this skin draws one. */
  protected person(p: Person, pal: Palette): void { flatPerson(this.ctx, p, pal, this.decorStyle() === 'neon'); }
  /**
   * A worker in the corner of each station that runs something, doing what the station does (`workerState`): at work,
   * a hand up under "!" or "?", waiting, or asleep with its "z"s rising.
   */
  protected stationPeople(S: Scene, out: Piece[], standing: boolean, o: PeopleOptions, pal: Palette): void {
    const neon = this.decorStyle() === 'neon';
    for (const v of S.boxes) {
      if (v.kind !== 'station' || !v.run || v.gate) continue;
      const m = v.m, state = workerState(v, o.hands), cx = m.x + m.w - 0.45, cy = m.y + m.h - 0.4, id = m.x * 31 + m.y;
      out.push({ layer: 'standing', depth: standing ? m.y + m.h + 0.5 : 6.6, draw: () => {
        flatWorker(this.ctx, cx, cy, state, this.clock, pal, neon, id, ['agent', 'skill', 'panel', 'script'].indexOf(v.run!) + 1);
        if (state === 'sleep') for (const { k, size } of zees(this.clock)) this.label(size > 0.24 ? 'Z' : 'z', cx + 0.2 + k * 0.3, cy - 0.3 - k * 0.6, size, neon ? `rgba(167,163,214,${(1 - k).toFixed(2)})` : pal.light ? `rgba(75,70,85,${(1 - k).toFixed(2)})` : `rgba(210,204,219,${(1 - k).toFixed(2)})`, { weight: 800, mono: true, min: 7, max: 16, dark: true });
        if (state !== 'call' && state !== 'ask') return;
        const ctx = this.ctx, bx = cx + 0.36, by = cy - 0.8, col = state === 'call' ? pal.danger : pal.amber, pulse = 0.17 + 0.02 * Math.sin(this.clock * 6);
        ctx.beginPath(); ctx.arc(bx, by, pulse, 0, 6.3); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.stroke();
        this.label(state === 'call' ? '!' : '?', bx, by + 0.01, 0.24, 'rgba(0,0,0,0.85)', { align: 'center', weight: 800, min: 7, max: 18, dark: true });
      } });
    }
  }

  pieces(S: Scene, st: ViewState, out: Piece[]): void {
    this.decorPieces(st, out, false);
    this.peoplePieces(S, st, out, false);
    const pal = this.palette(), z = this.cam.z, at = (depth: number, draw: () => void, turns?: boolean) => { out.push(turns ? { layer: 'standing', depth, draw, turns } : { layer: 'standing', depth, draw }); };
    /*
     * Only what the view shows is painted: a floor is often seen from close, most of it beyond the edges, and what is
     * painted there costs as much as what is seen. A few tiles of room round the view, for what reaches past its own
     * tiles (a halo, a plate, an arm's tag, a light on the floor).
     */
    const a0 = this.toWorld(0, 0), a1 = this.toWorld(this.w, this.h), x0 = a0.x - VIEW_ROOM, y0 = a0.y - VIEW_ROOM, x1 = a1.x + VIEW_ROOM, y1 = a1.y + VIEW_ROOM;
    const seen = (m: { x: number; y: number; w?: number; h?: number }) => m.x < x1 && m.y < y1 && m.x + (m.w ?? 1) > x0 && m.y + (m.h ?? 1) > y0;
    const belts = S.belts.filter((b) => seen(b.m));
    /* the areas: decor on the floor, under everything */
    for (const a of S.areas) if (seen(a)) out.push({ layer: 'floor', depth: 0, draw: () => this.area(a, pal) });
    at(0, () => this.beltBases(belts, pal));
    /* what runs with the belts' clock, and is painted at every frame when the rest is kept (`Piece.turns`) */
    if (z >= 8) at(1, () => this.chevrons(belts, pal), true);
    for (const b of S.bridges) if (seen(b.m)) at(2, () => this.bridge(b, st, pal), true);
    for (const v of S.boxes) if (seen(v.m)) at(3, () => {
      if (v.kind === 'label') this.labelOf(v, pal);
      else if (v.kind === 'zone') this.zone(v, S, st, pal);
      else if (v.kind === 'station') this.station(v, st, pal);
      else if (v.kind === 'status') this.statusStation(v, st, pal);
      else if (v.kind === 'exit') this.exit(v, pal);
      else if (v.kind === 'dock') this.dock(v, st, pal);
      else this.port(v, st, pal);
    });
    for (const b of belts) for (const r of b.riders) at(4, () => this.ticket(r, st));
    /* gantries stand over their belt: a ticket goes under the beam */
    for (const b of belts) if (b.gantry) at(5, () => this.gantry(b, pal));
    for (const p of S.loose) if (seen(p.t)) at(6, () => {
      /* the canvas of the moment it is painted at, not of the moment the pieces are listed: they may differ (`aim`) */
      const ctx = this.ctx;
      ctx.strokeStyle = pal.warn; ctx.lineWidth = 0.05; ctx.setLineDash([0.12, 0.1]); ctx.beginPath(); ctx.arc(p.t.x + 0.5, p.t.y + 0.5, 0.42, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      this.ticket(p, st);
    });
    for (const a of S.arms) if (seen(a.m)) at(7, () => this.arm(a, st, pal));
    for (const b of belts) if (b.toll) at(8, () => this.tollArm(b, st, pal));
    at(9, () => this.departures(S, pal));
    at(10, () => this.portLinks(S, pal));
  }

  top(S: Scene, st: ViewState): void {
    this.readings(S, st);
    if (this.wordsInPicture) { this.flushLabels(); this.lit(); } else { this.lit(); this.flushLabels(); }
    this.names(st, S, this.palette());
  }
  /* `top`, in the three moments a picture kept in layers needs apart (`Skin.layered`) */
  readings(S: Scene, st: ViewState): void {
    const pal = this.palette();
    if (st.lens) this.lens(st.lens, st.layout, pal);
    this.overlay(st, S, pal);
  }
  light(): void { this.lit(); }
  forget(): void { this.labels.length = 0; this.boards.length = 0; }
  words(S: Scene | null, st: ViewState | null): void {
    this.flushLabels();
    if (S && st) this.names(st, S, this.palette());
  }

  /** What the picture becomes once everything is painted, before the words are written over it. Nothing, here. */
  protected lit(): void { /* a flat skin has no light of its own */ }

  protected palette(): Palette {
    const now = performance.now();
    if (this.pal && now - this.palAt < 2000) return this.pal;
    const cs = getComputedStyle(document.documentElement), v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    this.palAt = now;
    this.pal = {
      bg: v('--theme-bg-base', '#09090b'), floor: v('--theme-bg-surface', '#18181b'), grid: v('--theme-border', '#27272a'), belt: v('--theme-bg-overlay', '#27272a'),
      edge: v('--theme-border-input', '#3f3f46'), chev: v('--theme-text-muted', '#71717a'), fast: v('--tint-blue-solid', '#60a5fa'), body: v('--theme-bg-overlay', '#27272a'),
      text: v('--theme-text-primary', '#fafafa'), text2: v('--theme-text-secondary', '#a1a1aa'), text3: v('--theme-text-muted', '#71717a'),
      ok: v('--theme-success', '#22c55e'), warn: v('--theme-warning', '#eab308'), danger: v('--theme-danger', '#ef4444'), accent: v('--theme-accent', '#D77655'),
      light: false, amber: '',
    };
    this.pal.light = isLight(this.pal.floor); this.pal.amber = this.pal.light ? '#d97706' : this.pal.warn;
    return this.pal;
  }

  /**
   * How high what is being painted stands, in tiles (a variant seen from three quarters lifts what stands): the words
   * and plates written on it go up with it.
   */
  protected lifted = 0;
  protected label(text: string, wx: number, wy: number, size: number, color: string, opts: Label[5] = {}): void { this.labels.push([text, wx, wy - this.lifted, size, color, opts]); }
  protected flushLabels(): void {
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const l of this.labels) this.write(l);
    /* plates of several lines: one box as wide as its longest line, standing off the side of its machine it was given */
    const z = this.cam.z, px = this.wordSize(clamp(0.22 * z, 9, 11), 0.22, true) ?? clamp(0.22 * z, 9, 11), lh = px * 1.3, pad = px * 0.55;
    ctx.font = `700 ${px.toFixed(1)}px ${this.fonts.mono}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const b of this.boards) {
      const w = Math.max(...b.lines.map((l) => ctx.measureText(l).width)) + pad * 2, h = b.lines.length * lh + pad, sx = (b.wx - this.cam.x) * z + this.w / 2, sy = (b.wy - (b.lift ?? 0) - this.cam.y) * z + this.h / 2;
      const x0 = b.side === 'right' ? sx + 6 : b.side === 'left' ? sx - 6 - w : sx - w / 2, y0 = b.side === 'above' ? sy - 6 - h : b.side === 'below' ? sy + 6 : sy - h / 2;
      if (x0 > this.w || x0 + w < 0 || y0 > this.h || y0 + h < 0) continue;
      const lit = !!this.pal?.light, on = lit ? 1 : 0;
      this.plate(ctx, x0, y0, w, h, 4); ctx.fillStyle = lit ? LIGHT_PLATE : 'rgba(9,9,11,0.92)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = lit ? legible(b.col, 1) : b.col; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;
      b.lines.forEach((l, i) => { const ink = b.inks[i] ?? b.col; ctx.fillStyle = lit ? legible(ink, on) : ink; ctx.fillText(l, x0 + pad, y0 + pad / 2 + lh * (i + 0.5)); });
    }
    ctx.restore(); this.labels.length = 0; this.boards.length = 0;
  }
  /** Text painted on the floor itself, now, so that what is drawn after it goes over it: a stencil, not a label. */
  private stencil(text: string, wx: number, wy: number, size: number, color: string, alpha: number, opts: Label[5] = {}): void {
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = alpha;
    this.write([text, wx, wy - this.lifted, size, color, opts]);
    ctx.restore();
  }
  /** The size words are written at, in CSS pixels, given the size asked (`px`, and `size` in tiles) and whether they are on a plate; null: not written. */
  protected wordSize(px: number, _size: number, _plated: boolean): number | null { return px; }
  /** The path of a plate words are written on, in pixels of the screen: rounded, here. */
  protected plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void { rr(ctx, x, y, w, h, r); }
  /** The size of the names on the floor (`names`), in pixels of the screen. */
  protected nameSize(): number { return 11; }
  /** Where a word is written, in CSS pixels. */
  protected wordAt(sx: number, sy: number): [number, number] { return [sx, sy]; }
  /** Words may be spaced out (a marking in capitals). */
  protected spaced = true;
  /** The words are written into the picture before it is finished (`lit`), not over it after. */
  protected wordsInPicture = false;

  private write([raw, wx, wy, size, color, o]: Label): void {
    const ctx = this.ctx, z = this.cam.z;
    let px = size * z;
    if (px < 3.6) return;
    if (o.min) px = Math.max(px, o.min);
    if (o.max) px = Math.min(px, o.max);
    const sized = this.wordSize(px, size, !!o.plate);
    if (sized == null) return;
    px = sized;
    const [sx, sy] = this.wordAt((wx - this.cam.x) * z + this.w / 2, (wy - this.cam.y) * z + this.h / 2 + (o.dy ?? 0));
    if (sx < -300 || sx > this.w + 300 || sy < -40 || sy > this.h + 40) return;
    ctx.font = `${o.weight ?? 500} ${px.toFixed(1)}px ${o.mono ? this.fonts.mono : this.fonts.sans}`;
    ctx.textAlign = o.align ?? 'left'; ctx.textBaseline = 'middle';
    let text = raw;
    if (o.fit) { const room = o.fit * z; if (ctx.measureText(text).width > room) { while (text.length > 3 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1); text += '…'; } }
    /* on a light theme: the dark plates turn light, with a hairline to stand on a white floor, and every ink is made to read on what it is written on */
    const lit = !!this.pal?.light && !o.dark, neutral = lit && !!o.plate && DARK_PLATE.test(o.plate), plate = neutral ? LIGHT_PLATE : o.plate;
    if (plate) {
      const tw = ctx.measureText(text).width, pad = px * 0.45, ph = px * 1.5;
      const x0 = o.align === 'center' ? sx - tw / 2 - pad : o.align === 'right' ? sx - tw - pad : sx - pad;
      ctx.fillStyle = plate; this.plate(ctx, x0, sy - ph / 2, tw + pad * 2, ph, Math.min(4, ph / 3)); ctx.fill();
      if (neutral) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke(); }
    }
    if (o.spacing && this.spaced) ctx.letterSpacing = `${(px * o.spacing).toFixed(2)}px`;
    ctx.fillStyle = lit ? legible(color, plate ? luminance(plate) ?? 1 : 1) : color; ctx.fillText(text, sx, sy);
    if (o.spacing && this.spaced) ctx.letterSpacing = '0px';
  }

  /** A ticket as a thing, in the shape of its type, `T` tiles wide round (px, py). False when there is none to draw: a plain square is drawn instead. */
  protected token(look: TokenLook, type: string, tint: string, px: number, py: number, T: number, alpha: number): boolean {
    const ctx = this.ctx, z = this.cam.z, sprite = tokenSprite(type, tint, T * z * this.dpr, look);
    if (!sprite) return false;
    const w = sprite.width / (z * this.dpr);
    ctx.globalAlpha = alpha; ctx.drawImage(sprite, px - w / 2, py - w / 2, w, w); ctx.globalAlpha = 1;
    return true;
  }

  protected ticket(P: Placed, st: ViewState): void {
    const ctx = this.ctx, pal = this.palette(), { t, x: px, y: py, s, mark, dragging, picked, selected, dim, call } = P;
    const z = this.cam.z, info = t.info, type = info?.type ?? '', color = TYPE_COLORS[type] ?? NO_TYPE;
    /*
     * A ticket is a token in the shape of its type (see `ticketToken.ts`), a little larger than the square it replaces
     * since a shape has holes. Too small to be told apart, it is the plain square again.
     */
    const T = s * 1.16, shaped = T * z >= 10;
    const stamp = (look: TokenLook, tint: string, alpha: number): boolean => shaped && this.token(look, type, tint, px, py, T, alpha);
    if (dim) {
      /* left out by the filter: still there, but faded and without any of its marks */
      if (!stamp('ghost', GHOST, 0.32)) { ctx.globalAlpha = 0.28; rr(ctx, px - s / 2, py - s / 2, s, s, s * 0.22); ctx.fillStyle = pal.text3; ctx.fill(); ctx.globalAlpha = 1; }
      return;
    }
    const alpha = dragging ? 0.25 : mark === 'wait' ? 0.5 : 1;
    const token = stamp('solid', color, alpha);
    if (!token) {
      ctx.globalAlpha = alpha;
      rr(ctx, px - s / 2, py - s / 2, s, s, s * 0.22);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 0.045; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(px - s / 2 + s * 0.16, py - s / 2 + s * 0.14, s * 0.68, s * 0.14);
      ctx.globalAlpha = 1;
    }
    /* marks are placed around the token's box when there is one, around the square otherwise */
    const B = token ? T : s;
    if (mark === 'run' && s * z > 6 && !this.runMark(px, py, B, t.ticketId.length)) {
      /* at work: an arc turning, around a token, inside a square */
      const a0 = this.clock * 4 + t.ticketId.length, r = token ? B * 0.6 : s * 0.24;
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(px, py, r, a0, a0 + (token ? 2.6 : 4.2));
      if (token) { ctx.strokeStyle = 'rgba(9,9,11,0.85)'; ctx.lineWidth = 0.085; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.045; ctx.stroke(); }
      else { ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = s * 0.15; ctx.stroke(); }
      ctx.lineCap = 'butt';
    }
    else if ((mark === 'human' || mark === 'fail') && !humanCall(t)) { ctx.strokeStyle = mark === 'fail' ? pal.danger : pal.warn; ctx.lineWidth = Math.floor(this.clock * 2.4) % 2 === 0 ? 0.1 : 0.05; rr(ctx, px - B / 2 - 0.06, py - B / 2 - 0.06, B + 0.12, B + 0.12, 0.13); ctx.stroke(); }
    else if (mark === 'out') { ctx.strokeStyle = pal.text2; ctx.lineWidth = 0.04; rr(ctx, px - B / 2 - 0.04, py - B / 2 - 0.04, B + 0.08, B + 0.08, 0.1); ctx.stroke(); }
    /* a ticket waiting for a human calls for attention wherever it is: a pulsing halo and a "?" (or "!" when the run failed) */
    if (call) {
      const col = call === 'failed' ? pal.danger : pal.warn, ph = (this.clock * 0.9 + (t.ticketId.charCodeAt(0) % 10) / 10) % 1, grow = B * 0.7 * ph;
      ctx.globalAlpha = 0.85 * (1 - ph); ctx.strokeStyle = col; ctx.lineWidth = 0.07;
      rr(ctx, px - B / 2 - 0.05 - grow / 2, py - B / 2 - 0.05 - grow / 2, B + 0.1 + grow, B + 0.1 + grow, B * 0.3); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 0.06 + 0.04 * Math.sin(this.clock * 6) ** 2;
      rr(ctx, px - B / 2 - 0.05, py - B / 2 - 0.05, B + 0.1, B + 0.1, B * 0.26); ctx.stroke();
      if (token) {
        /* the sign goes on a badge at the corner: over the token, it would hide what the ticket is */
        const bx = px + B * 0.36, by = py + B * 0.34, br = B * 0.25;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.3); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.stroke();
        this.label(call === 'failed' ? '!' : '?', bx, by + br * 0.08, br * 1.5, 'rgba(0,0,0,0.85)', { align: 'center', weight: 800, min: 7, max: 22 });
      } else this.label(call === 'failed' ? '!' : '?', px, py + s * 0.04, s * 0.74, 'rgba(0,0,0,0.82)', { align: 'center', weight: 800, min: 8, max: 30 });
    }
    if (!call && !dragging && t.phase === 'aside' && B * z >= 12) {
      /* set aside by a human: a pause sign on the corner, in the accent, where a question carries its "?" */
      const bx = px + B * 0.36, by = py + B * 0.34, br = B * 0.25;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.3); ctx.fillStyle = pal.accent; ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.stroke();
      ctx.fillStyle = 'rgba(9,9,11,0.88)'; ctx.fillRect(bx - br * 0.42, by - br * 0.45, br * 0.28, br * 0.9); ctx.fillRect(bx + br * 0.14, by - br * 0.45, br * 0.28, br * 0.9);
    }
    const found = P.found;
    if (info && !dragging) {
      /* its number, once there is room: inside a square, on a small plate under a token */
      if (!call && !token && !t.item && s * z >= 26) this.label(String(info.displayId), px, py + s * 0.06, s * 0.36, 'rgba(0,0,0,0.78)', { align: 'center', weight: 700, mono: true });
      if (token && !t.item && (B * z >= 34 || (st.numbers && B * z >= 13))) this.label(String(info.displayId), px, py + this.numberDy(B), B * 0.24, '#f4f4f5', { align: 'center', weight: 700, mono: true, plate: 'rgba(9,9,11,0.82)', min: 8 });
      /* priority: a pip in the top-left corner for what is urgent or high */
      const pip = PRIORITY_PIP[info.priority];
      if (pip && s * z >= 7) { ctx.beginPath(); ctx.arc(px - B / 2 + B * 0.06, py - B / 2 + B * 0.06, B * 0.15, 0, 6.3); ctx.fillStyle = pip; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke(); }
      /* favourite: a star on the top-right corner */
      if (info.favorite && s * z >= 7) {
        const cx = px + B / 2 - B * 0.04, cy = py - B / 2 + B * 0.04, r = B * 0.26;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
        ctx.closePath(); ctx.fillStyle = STAR; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
      }
    }
    if (found) { ctx.strokeStyle = pal.accent; ctx.lineWidth = 0.07; rr(ctx, px - B / 2 - 0.09, py - B / 2 - 0.09, B + 0.18, B + 0.18, B * 0.3); ctx.stroke(); }
    if (selected) { ctx.strokeStyle = pal.text; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(px, py, Math.max(B * 0.92, 0.3), 0, 6.3); ctx.stroke(); }
    /* in the frame being dragged: it will be in the selection. The frame's own colour, filled, so it shows before the mouse is let go */
    if (picked) { ctx.fillStyle = 'rgba(96,165,250,0.22)'; ctx.strokeStyle = PICK; ctx.lineWidth = 0.09; ctx.beginPath(); ctx.arc(px, py, Math.max(B * 1.02, 0.34), 0, 6.3); ctx.fill(); ctx.stroke(); }
  }

  /**
   * Names on the floor, at any zoom: the tickets you follow (favourites, the selected one, what a search found), or
   * every ticket while the key is held. Tickets of one machine, or close together on a belt, share a box that lists
   * them, and boxes keep clear of each other (see `nameTags.ts`). Drawn last, in screen pixels.
   */
  protected names(st: ViewState, S: Scene, pal: Palette): void {
    const all = st.allNames === true, z = this.cam.z;
    const items: NamedTicket[] = [], byId = new Map<string, FactoryTicket>();
    const sx = (wx: number) => (wx - this.cam.x) * z + this.w / 2, sy = (wy: number) => (wy - this.cam.y) * z + this.h / 2;
    for (const { t, x, y, box: m } of S.named) {
      byId.set(t.ticketId, t);
      /* where they are seen: as high as what carries them (on a skin seen from three quarters) */
      const b = m ? this.seen(m) : null, carrier = this.machine(t.machineId), lift = carrier ? this.seen(carrier).h - carrier.h : 0;
      items.push({
        id: t.ticketId, text: `${refOf(t.info)} ${t.info!.title}`, x: sx(x), y: sy(y - lift),
        box: m && b ? { id: m.id, rect: { x: sx(b.x), y: sy(b.y), w: b.w * z, h: b.h * z } } : undefined,
      });
    }
    if (!items.length) return;
    const ctx = this.ctx, LH = 15, PAD = 5;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const NS = this.nameSize();
    ctx.font = `500 ${NS}px ${this.fonts.sans}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const solid = st.layout.machines.filter((m) => m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit').map((m) => this.seen(m)).map((b) => ({ x: sx(b.x), y: sy(b.y), w: b.w * z, h: b.h * z }));
    const boxes = layoutNames(items, { w: this.w, h: this.h }, (s) => ctx.measureText(s).width, { maxLines: all ? 8 : 6, maxWidth: 230, lineHeight: LH, pad: PAD, chip: 13, nearX: 120, nearY: 24, radius: Math.max(5, z * 0.26) }, solid);
    /* the lines that tie each box to what it names go under every box */
    const lit = pal.light;
    ctx.strokeStyle = lit ? 'rgba(24,24,27,0.4)' : 'rgba(244,244,245,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const b of boxes) {
      const ends = b.points.length ? b.points.map((p) => tie(b, { x: p.x, y: p.y, w: 0, h: 0 })) : [tie(b, b.anchor)];
      for (const e of ends) { ctx.moveTo(e.x0, e.y0); ctx.lineTo(e.x1, e.y1); }
    }
    ctx.stroke();
    for (const b of boxes) {
      const hot = b.lines.some((l) => st.found?.has(l.id));
      this.plate(ctx, b.x, b.y, b.w, b.h, 5); ctx.fillStyle = lit ? LIGHT_PLATE : 'rgba(9,9,11,0.92)'; ctx.fill();
      ctx.strokeStyle = hot ? pal.accent : lit ? 'rgba(24,24,27,0.28)' : 'rgba(244,244,245,0.18)'; ctx.lineWidth = 1; ctx.stroke();
      b.lines.forEach((l, i) => {
        const t = byId.get(l.id), y = b.y + PAD + i * LH + LH / 2, sel = st.selTicket === l.id;
        this.plate(ctx, b.x + PAD, y - 4, 8, 8, 2); ctx.fillStyle = TYPE_COLORS[t?.info?.type ?? ''] ?? '#8b949e'; ctx.fill();
        if (t?.info?.favorite) { ctx.fillStyle = STAR; ctx.beginPath(); ctx.arc(b.x + PAD + 8, y - 4, 2.2, 0, 6.3); ctx.fill(); }
        ctx.font = `${sel ? 700 : 500} ${NS}px ${this.fonts.sans}`; ctx.fillStyle = lit ? (sel || st.found?.has(l.id) ? '#09090b' : 'rgba(24,24,27,0.86)') : sel || st.found?.has(l.id) ? '#ffffff' : 'rgba(244,244,245,0.86)';
        ctx.fillText(l.text, b.x + PAD + 13, y + 0.5);
      });
      if (b.more > 0) { ctx.font = `500 ${NS}px ${this.fonts.sans}`; ctx.fillStyle = lit ? 'rgba(24,24,27,0.6)' : 'rgba(244,244,245,0.55)'; ctx.fillText(`+${b.more} more`, b.x + PAD + 13, b.y + PAD + b.lines.length * LH + LH / 2 + 0.5); }
    }
    ctx.restore();
  }

  protected labelOf({ m }: LabelView, pal: Palette): void { this.label(m.text, m.x + 0.12, m.y + 0.5, 0.62, m.color || pal.text2, { weight: 700, min: 10, max: 24 }); }

  /**
   * The floor, before anything built on it. It has no edge: it is drawn as far as what is built, plus room to build
   * further. Out of build mode it is dressed (see `floorLook.ts`): a light over the middle, dots where tiles meet, and
   * around a station that works or waits for someone, the glow of its lamp. In build mode it keeps plain lines, which
   * is what one places machines against.
   *
   * It is painted on a canvas of its own and only when something it shows has changed (the view, the floor, the
   * theme, what a station is doing): soft light over large areas is the costliest thing on the page to paint, and it
   * changes the least. So its cost does not grow with the number of stations lit.
   */
  private floor(st: ViewState, S: Scene, pal: Palette): void {
    const d = this.dpr, z = this.cam.z, L = st.layout;
    /* not in build mode, and not under a lens: there, colour is the lens's reading */
    const lit: [StationSpec, Lamp][] = S.lit;
    const key: unknown[] = [this.cv.width, this.cv.height, this.cam.x, this.cam.y, z, st.edit, st.grid !== false, L, pal, lit.map(([m, s]) => `${m.id}:${s}`).join()];
    if (!this.backdrop) this.backdrop = document.createElement('canvas');
    const cv = this.backdrop;
    if (key.length === this.backdropKey.length && key.every((v, i) => v === this.backdropKey[i])) { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.drawImage(cv, 0, 0); return; }
    this.backdropKey = key;
    if (cv.width !== this.cv.width || cv.height !== this.cv.height) { cv.width = this.cv.width; cv.height = this.cv.height; }
    const ctx = cv.getContext('2d', { alpha: false })!, F = this.floorOf(L), look = floorLook(pal.floor);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    /* the view never leaves the floor: a first coat of its colour keeps a rounding at its edge from showing anything else */
    ctx.fillStyle = pal.floor; ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(z * d, 0, 0, z * d, (this.w / 2 - this.cam.x * z) * d, (this.h / 2 - this.cam.y * z) * d);
    /* the light over the middle and the dusk at the edges are in the floor's own paint: one opaque coat */
    rr(ctx, F.x - 0.5, F.y - 0.5, F.w + 1, F.h + 1, 0.7); ctx.fillStyle = this.floorPaint(ctx, F, st, pal); ctx.fill();
    ctx.strokeStyle = st.edit ? pal.accent : pal.grid; ctx.lineWidth = st.edit ? 0.08 : 0.05; ctx.stroke();

    if (st.edit) {
      if (st.grid !== false && z >= 6) {
        ctx.strokeStyle = pal.grid; ctx.globalAlpha = 0.9; ctx.lineWidth = 1 / z; ctx.beginPath();
        for (let i = 0; i <= F.w; i++) { ctx.moveTo(F.x + i, F.y); ctx.lineTo(F.x + i, F.y + F.h); }
        for (let i = 0; i <= F.h; i++) { ctx.moveTo(F.x, F.y + i); ctx.lineTo(F.x + F.w, F.y + i); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    } else {
      this.dress(ctx, F, st, pal);
      /* amber around a machine that needs someone, a dimmer red around one that is off; one that simply works throws no light */
      for (const [m, s] of lit) this.glow(ctx, m, s, pal);
      ctx.globalAlpha = 1;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.drawImage(cv, 0, 0);
  }

  /** The light a station's lamp throws on the floor round it: amber when it needs someone, a dimmer red when it is off. */
  protected glow(ctx: CanvasRenderingContext2D, m: StationSpec, s: Lamp, pal: Palette): void {
    const R = Math.max(m.w, m.h) * 1.25;
    ctx.globalAlpha = floorLook(pal.floor).glow * (s === 'off' ? 0.7 : 1); ctx.drawImage(this.glowSprite(s === 'off' ? pal.danger : pal.warn), m.x + m.w / 2 - R, m.y + m.h / 2 - R, R * 2, R * 2);
  }

  /** The paint of the floor: out of build mode, a light over the middle and dusk at the edges, in one opaque coat. */
  protected floorPaint(ctx: CanvasRenderingContext2D, F: { x: number; y: number; w: number; h: number }, st: ViewState, pal: Palette): string | CanvasGradient {
    if (st.edit) return pal.floor;
    const look = floorLook(pal.floor), cx = F.x + F.w / 2, cy = F.y + F.h / 2, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(F.w, F.h) * 0.62);
    g.addColorStop(0, mix(pal.floor, '#ffffff', look.light)); g.addColorStop(0.6, pal.floor); g.addColorStop(1, mix(pal.floor, '#000000', look.dusk));
    return g;
  }

  /** What the floor is dressed with out of build mode, over its paint: a dot where tiles meet, only the ones in view. */
  protected dress(ctx: CanvasRenderingContext2D, F: { x: number; y: number; w: number; h: number }, st: ViewState, pal: Palette): void {
    const z = this.cam.z, look = floorLook(pal.floor);
    {
      /* dots, only the ones in view: one path for the plain ones, one for the stronger ones */
      const seen = st.grid === false ? 0 : fadeIn(z, 8, 12);
      if (seen > 0) {
        const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
        const i0 = Math.max(F.x, Math.floor(a.x)), i1 = Math.min(F.x + F.w, Math.ceil(b.x)), j0 = Math.max(F.y, Math.floor(a.y)), j1 = Math.min(F.y + F.h, Math.ceil(b.y));
        for (const major of [false, true]) {
          const r = major ? 0.06 : 0.035, round = r * z >= 1.2;
          ctx.beginPath();
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            if ((i % MAJOR === 0 && j % MAJOR === 0) !== major) continue;
            if (round) { ctx.moveTo(i + r, j); ctx.arc(i, j, r, 0, Math.PI * 2); } else ctx.rect(i - r, j - r, r * 2, r * 2);
          }
          ctx.globalAlpha = seen; ctx.fillStyle = major ? look.major : look.dot; ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /** A machine that stands on the floor casts a shadow on it (not in build mode, which is a plain drawing). A picture made once per size, and stamped. */
  protected shadows(st: ViewState, pal: Palette): void {
    if (st.edit) return;
    const look = floorLook(pal.floor), a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
    for (const m of st.layout.machines) {
      /* a zone is paint on the floor and an exit a frame of light: only a machine stands on it */
      if (m.kind !== 'station' || m.x + m.w + SHADOW_PAD < a.x || m.x - SHADOW_PAD > b.x || m.y + m.h + SHADOW_PAD < a.y || m.y - SHADOW_PAD > b.y) continue;
      this.ctx.drawImage(this.shadowSprite(m.w, m.h, look.shadow), m.x - SHADOW_PAD, m.y - SHADOW_PAD, m.w + SHADOW_PAD * 2, m.h + SHADOW_PAD * 2);
    }
  }

  /** A lamp's light, fading from its colour to nothing: painted once per colour, then stamped at the strength wanted. */
  private glowSprite(color: string): HTMLCanvasElement {
    let cv = this.glowCache.get(color);
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d')!, g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, veil(color, 1)); g.addColorStop(1, veil(color, 0)); c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    this.glowCache.set(color, cv);
    return cv;
  }

  /**
   * The shadow of a box of that size, alone (what casts it is drawn out of the picture). Blurring is what costs: it is
   * done once per size, at a fixed scale, and the soft picture is then stretched to the zoom.
   */
  private shadowSprite(w: number, h: number, color: string): HTMLCanvasElement {
    const key = `${w}x${h}|${color}`;
    let cv = this.shadowCache.get(key);
    if (cv) return cv;
    const S = 24, far = 10000;
    cv = document.createElement('canvas'); cv.width = Math.round((w + SHADOW_PAD * 2) * S); cv.height = Math.round((h + SHADOW_PAD * 2) * S);
    const c = cv.getContext('2d')!;
    c.shadowColor = color; c.shadowBlur = 0.5 * S; c.shadowOffsetX = far + 0.1 * S; c.shadowOffsetY = 0.16 * S; c.fillStyle = '#000';
    c.setTransform(S, 0, 0, S, -far, 0);
    rr(c, SHADOW_PAD + 0.12, SHADOW_PAD + 0.12, w - 0.24, h - 0.24, 0.3); c.fill();
    if (this.shadowCache.size > 200) this.shadowCache.clear();
    this.shadowCache.set(key, cv);
    return cv;
  }

  /** Veil every station and zone, then heat the ones the lens has a value for: yellow is little, red is the most on the floor. */
  protected lens(layer: LensLayer, L: FactoryLayout, pal: Palette): void {
    const ctx = this.ctx;
    for (const m of L.machines) {
      if (m.kind !== 'station' && m.kind !== 'zone') continue;
      const v = layer.values.get(m.id) ?? 0, k = layer.max > 0 && v > 0 ? Math.sqrt(v / layer.max) : 0, hue = Math.round(52 - 52 * k);
      rr(ctx, m.x + 0.07, m.y + 0.07, m.w - 0.14, m.h - 0.14, 0.28);
      ctx.fillStyle = 'rgba(9,9,11,0.66)'; ctx.fill();
      if (k > 0) {
        ctx.fillStyle = `hsla(${hue}, 95%, 55%, ${(0.16 + 0.5 * k).toFixed(2)})`; ctx.fill();
        ctx.strokeStyle = `hsl(${hue}, 95%, 60%)`; ctx.lineWidth = 0.05 + 0.08 * k; ctx.stroke();
      }
      const text = layer.text.get(m.id);
      this.label(text ?? '–', m.x + m.w / 2, m.y + m.h / 2 + 0.2, 0.44, text ? '#ffffff' : pal.light ? '#a1a1aa' : pal.text3, { align: 'center', weight: 700, mono: true, min: 9, max: 22, fit: m.w - 0.2, dark: true });
    }
  }

  /**
   * Every belt's bed, rails and dead end, in a few strokes: one fill for the beds, one stroke for the rails of each
   * colour, one for the dead ends. Painted belt by belt (`beltBase`), a floor of a few hundred tiles took a thousand
   * small strokes a frame, for the same picture.
   */
  protected beltBases(belts: readonly BeltView[], pal: Palette): void {
    const ctx = this.ctx, bends = (v: BeltView) => {
      const b = v.m, f = v.bend, dx = DX[b.dir], dy = DY[b.dir], fx = DX[f as 0], fy = DY[f as 0], cw = -dx * fy + dy * fx > 0, a0 = Math.atan2(-dy, -dx);
      return { px: b.x + 0.5 - fx * 0.5 + dx * 0.5, py: b.y + 0.5 - fy * 0.5 + dy * 0.5, a0, a1: a0 + (cw ? 1 : -1) * Math.PI / 2, cw };
    };
    ctx.beginPath();
    for (const v of belts) {
      if (v.bend < 0) { ctx.rect(v.m.x - 0.01, v.m.y - 0.01, 1.02, 1.02); continue; }
      const { px, py, a0, a1, cw } = bends(v);
      ctx.moveTo(px, py); ctx.arc(px, py, 1.01, a0, a1, !cw); ctx.closePath();
    }
    ctx.fillStyle = pal.belt; ctx.fill();
    /* a fast belt has its rails in the fast colour: it reads from far, where chevrons are no longer drawn */
    ctx.lineWidth = 0.09;
    for (const fast of [false, true]) {
      let any = false;
      ctx.beginPath();
      for (const v of belts) {
        if (!!v.m.fast !== fast) continue;
        any = true;
        const { x, y } = v.m;
        if (v.bend >= 0) {
          const { px, py, a0, a1, cw } = bends(v);
          for (const r of [0.955, 0.045]) { ctx.moveTo(px + Math.cos(a0) * r, py + Math.sin(a0) * r); ctx.arc(px, py, r, a0, a1, !cw); }
        } else for (const s of v.rails) {
          if (s === 0) { ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); } else if (s === 2) { ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); }
          else if (s === 1) { ctx.moveTo(x, y + 0.955); ctx.lineTo(x + 1, y + 0.955); } else { ctx.moveTo(x, y + 0.045); ctx.lineTo(x + 1, y + 0.045); }
        }
      }
      if (any) { ctx.strokeStyle = fast ? mix(pal.fast, pal.belt, 0.35) : pal.edge; ctx.stroke(); }
    }
    /* a belt that leads nowhere says so */
    if (belts.some((v) => v.dead)) {
      ctx.beginPath();
      for (const v of belts) {
        if (!v.dead) continue;
        const { x, y } = v.m, dx = DX[v.m.dir], dy = DY[v.m.dir];
        ctx.moveTo(x + 0.5 + dx * 0.42 - dy * 0.4, y + 0.5 + dy * 0.42 - dx * 0.4); ctx.lineTo(x + 0.5 + dx * 0.42 + dy * 0.4, y + 0.5 + dy * 0.42 + dx * 0.4);
      }
      ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.12; ctx.stroke();
    }
  }

  /** One belt's bed, rails and dead end, on its own: for a skin that paints belts one by one, each at its depth. */
  protected beltBase(v: BeltView, pal: Palette): void {
    const ctx = this.ctx, b = v.m, f = v.bend, { x, y } = b, dx = DX[b.dir], dy = DY[b.dir];
    /* a fast belt has its rails in the fast colour: it reads from far, where chevrons are no longer drawn */
    ctx.strokeStyle = b.fast ? mix(pal.fast, pal.belt, 0.35) : pal.edge; ctx.lineWidth = 0.09;
    if (f >= 0) {
      const fx = DX[f as 0], fy = DY[f as 0], px = x + 0.5 - fx * 0.5 + dx * 0.5, py = y + 0.5 - fy * 0.5 + dy * 0.5;
      const a0 = Math.atan2(-dy, -dx), cw = -dx * fy + dy * fx > 0, a1 = a0 + (cw ? 1 : -1) * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, 1.01, a0, a1, !cw); ctx.closePath(); ctx.fillStyle = pal.belt; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, 0.955, a0, a1, !cw); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 0.045, a0, a1, !cw); ctx.stroke();
    } else {
      ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
      ctx.beginPath();
      for (const s of v.rails) {
        if (s === 0) { ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); } else if (s === 2) { ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); }
        else if (s === 1) { ctx.moveTo(x, y + 0.955); ctx.lineTo(x + 1, y + 0.955); } else { ctx.moveTo(x, y + 0.045); ctx.lineTo(x + 1, y + 0.045); }
      }
      ctx.stroke();
    }
    /* a belt that leads nowhere says so */
    if (v.dead) {
      ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.12; ctx.beginPath();
      ctx.moveTo(x + 0.5 + dx * 0.42 - dy * 0.4, y + 0.5 + dy * 0.42 - dx * 0.4); ctx.lineTo(x + 0.5 + dx * 0.42 + dy * 0.4, y + 0.5 + dy * 0.42 + dx * 0.4); ctx.stroke();
    }
  }

  /**
   * The chevrons that run along a belt. A fast belt says it is one three ways: its chevrons come in pairs, in the fast
   * colour, and they run twice as fast.
   */
  protected beltChevrons(v: BeltView, pal: Palette): void {
    const ctx = this.ctx, b = v.m, f = v.bend, dx = DX[b.dir], dy = DY[b.dir], fx = f >= 0 ? DX[f as 0] : 0, fy = f >= 0 ? DY[f as 0] : 0;
    const px = b.x + 0.5 - fx * 0.5 + dx * 0.5, py = b.y + 0.5 - fy * 0.5 + dy * 0.5, off = (this.turn * (b.fast ? CHEVRON_FAST : CHEVRON_PACE)) % 0.5;
    /* on its own, a belt strokes its chevrons; among the others (`chevrons`), it only adds them to the path they share */
    const alone = !this.chevronPath;
    if (alone) { ctx.strokeStyle = b.fast ? pal.fast : pal.chev; ctx.beginPath(); }
    const one = (u: number) => {
      let cx: number, cy: number, tx: number = dx, ty: number = dy;
      if (f >= 0) { const ca = Math.cos(u * Math.PI / 2), sa = Math.sin(u * Math.PI / 2); cx = px + 0.5 * (fx * sa - dx * ca); cy = py + 0.5 * (fy * sa - dy * ca); tx = dx * sa + fx * ca; ty = dy * sa + fy * ca; }
      else { cx = b.x + 0.5 + dx * (u - 0.5); cy = b.y + 0.5 + dy * (u - 0.5); }
      ctx.moveTo(cx - tx * 0.09 + ty * 0.19, cy - ty * 0.09 - tx * 0.19); ctx.lineTo(cx + tx * 0.09, cy + ty * 0.09); ctx.lineTo(cx - tx * 0.09 - ty * 0.19, cy - ty * 0.09 + tx * 0.19);
    };
    /* where a line starts, nothing comes in from behind: the half of a pair that would be drawn before the tile is left out */
    const fed = v.fed;
    for (let k = 0; k < 2; k++) {
      const u = off + k * 0.5;
      if (!b.fast) { one(u); continue; }
      if (fed || u - CHEVRON_PAIR / 2 >= 0) one(u - CHEVRON_PAIR / 2);
      one(u + CHEVRON_PAIR / 2);
    }
    if (alone) ctx.stroke();
  }
  /** The belts' chevrons are being gathered in one path (`chevrons`): a belt adds its own and strokes nothing. */
  private chevronPath = false;
  /** Every belt's chevrons: one stroke for those of each colour, instead of one a chevron. */
  protected chevrons(belts: readonly BeltView[], pal: Palette): void {
    const ctx = this.ctx;
    ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const fast of [false, true]) {
      const some = belts.filter((v) => !!v.m.fast === fast);
      if (!some.length) continue;
      ctx.beginPath(); this.chevronPath = true;
      try { for (const v of some) this.beltChevrons(v, pal); } finally { this.chevronPath = false; }
      ctx.strokeStyle = fast ? pal.fast : pal.chev; ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /**
   * A Set gantry: two posts either side of the belt and a beam across it. A ticket goes under the beam, stops there
   * the time it takes to write what the gantry changes, and goes on. What the gantry does is written on a plate
   * beside it, one operation a line, so its setting is read from the floor; red when it could not write.
   */
  protected gantry(v: BeltView, pal: Palette): void {
    const ctx = this.ctx, b = v.m, g = v.gantry!, { x, y } = b, across = g.across;
    const under = g.under, col = g.failed ? pal.danger : SET;
    /* laid out for a belt that runs east-west; turned a quarter for one that runs north-south */
    const box = (rx: number, ry: number, rw: number, rh: number, r: number) => { if (across) rr(ctx, x + rx, y + ry, rw, rh, r); else rr(ctx, x + ry, y + rx, rh, rw, r); };
    if (!this.gantryFrame(v, col, pal)) {
      ctx.strokeStyle = col; ctx.lineWidth = 0.045;
      for (const off of [-0.11, 0.89]) { box(0.09, off, 0.82, 0.22, 0.07); ctx.fillStyle = pal.body; ctx.fill(); ctx.stroke(); }
      box(0.365, -0.07, 0.27, 1.14, 0.09); ctx.fillStyle = col; ctx.globalAlpha = under ? 0.85 : 0.32; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 0.035; ctx.stroke();
    }
    if (this.cam.z < 13 && !g.asked) return;
    const lines = g.lines, side = g.side;
    this.boards.push({ lift: this.lifted, lines, inks: lines.map((l, i) => (l.endsWith(' yet') || l.endsWith(' more') ? pal.text3 : i >= g.set ? pal.danger : col)), col, side, wx: x + (side === 'right' ? 1 : side === 'left' ? 0 : 0.5), wy: y + (side === 'below' ? 1.1 : side === 'above' ? -0.1 : 0.5) });
  }

  /**
   * The arm of a toll: a short red arm on the edge of its belt, on the side it rejects to. It takes what the toll
   * rejects from the middle of the belt to the middle of the next tile, swinging by the way the belt runs, so it
   * does not cross what is coming.
   */
  /** A gantry's posts and beam, its own way: true when drawn. */
  protected gantryFrame(_v: BeltView, _col: string, _pal: Palette): boolean { return false; }

  protected tollArm(v: BeltView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { ex, ey, hx, hy, carried } = v.toll!;
    const col = pal.danger, steel = mix(pal.body, pal.text2, 0.38), link = (dx: number, dy: number) => { ctx.beginPath(); ctx.moveTo(ex + dx, ey + dy); ctx.lineTo(hx + dx, hy + dy); ctx.stroke(); };
    ctx.lineCap = 'round';
    if (!st.edit) { ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.22; link(0.05, 0.08); }
    if (carried) { ctx.lineCap = 'butt'; this.ticket(carried, st); ctx.lineCap = 'round'; }
    ctx.strokeStyle = steel; ctx.lineWidth = 0.2; link(0, 0);
    ctx.strokeStyle = col; ctx.lineWidth = 0.06; link(0, 0);
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(hx, hy, 0.15, 0, 6.3); ctx.fillStyle = 'rgba(24,24,27,0.3)'; ctx.fill(); ctx.strokeStyle = pal.text; ctx.lineWidth = 0.045; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey, 0.17, 0, 6.3); ctx.fillStyle = pal.body; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.055; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey, 0.06, 0, 6.3); ctx.fillStyle = steel; ctx.fill();
  }

  /** Two belts crossing: the north-south one passes under, the east-west one over it. */
  protected bridge(v: BridgeView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { m, riders } = v, { x, y } = m;
    /*
     * A bridge has no direction and no speed of its own: each lane is drawn the way the belts that feed it send
     * tickets across, and as fast as they do. A fast lane looks like a fast belt (paired chevrons in the fast colour,
     * running twice as fast, coloured rails), whichever lane it is, and the other lane keeps its own look.
     */
    const flow = v.flow;
    const rail = (fast: boolean, plain: string) => (fast ? mix(pal.fast, pal.belt, 0.35) : plain);
    ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
    const lane = (f: LaneFlow, horizontal: boolean, fast: boolean) => {
      const cx0 = x + 0.5, cy0 = y + 0.5, off = (this.turn * (fast ? CHEVRON_FAST : CHEVRON_PACE)) % 0.5;
      ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      /* one chevron at `u` along the lane, pointing the way `s` says (+1 east or south, -1 west or north); a pair of them on a fast lane */
      const chevron = (u: number, s: number) => { if (fast) { single(u - s * CHEVRON_PAIR / 2, s); single(u + s * CHEVRON_PAIR / 2, s); } else single(u, s); };
      const single = (u: number, s: number) => {
        const cx = cx0 + (horizontal ? u : 0), cy = cy0 + (horizontal ? 0 : u);
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(cx - 0.09 * s, cy - 0.19); ctx.lineTo(cx + 0.09 * s, cy); ctx.lineTo(cx - 0.09 * s, cy + 0.19); }
        else { ctx.moveTo(cx - 0.19, cy - 0.09 * s); ctx.lineTo(cx, cy + 0.09 * s); ctx.lineTo(cx + 0.19, cy - 0.09 * s); }
        ctx.stroke();
      };
      if (f === 'none') {
        /* nothing feeds this lane yet: a plain mark, no arrow that would promise a way */
        ctx.strokeStyle = pal.chev; ctx.globalAlpha = 0.6; ctx.beginPath();
        if (horizontal) { ctx.moveTo(cx0 - 0.16, cy0); ctx.lineTo(cx0 + 0.16, cy0); } else { ctx.moveTo(cx0, cy0 - 0.16); ctx.lineTo(cx0, cy0 + 0.16); }
        ctx.stroke(); ctx.globalAlpha = 1;
      } else if (f === 'clash') {
        /* fed from both ends: two chevrons facing each other, in the colour of a fault */
        ctx.strokeStyle = pal.danger; chevron(-0.2, 1); chevron(0.2, -1);
      } else {
        const s = f === 0 || f === 1 ? 1 : -1;
        ctx.strokeStyle = fast ? pal.fast : pal.chev;
        for (let k = 0; k < 2; k++) chevron(s * (off + k * 0.5 - 0.5), s);
        /*
         * Chevrons run in step along the whole lane, belts and bridge alike, so the one about to come in and the one
         * that has just left overlap this tile's edges. They are drawn by the neighbouring belts, before this tile's
         * background went over them: without this they would come in with their tip cut off and leave their tail
         * behind. Put back, inside this tile only, what the background covered.
         */
        ctx.save(); ctx.beginPath(); ctx.rect(x - 0.01, y - 0.01, 1.02, 1.02); ctx.clip();
        chevron(s * (off - 1), s); chevron(s * (off + 0.5), s);
        ctx.restore();
      }
      ctx.lineCap = 'butt';
    };
    const draw = (r: Placed) => this.ticket(r, st);
    /* under: the north-south lane, between its two rails */
    ctx.strokeStyle = rail(flow.underFast, pal.edge); ctx.lineWidth = 0.09; ctx.beginPath(); ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); ctx.stroke();
    if (this.cam.z >= 8) lane(flow.under, false, flow.underFast);
    for (const r of riders) if (r.fx === 0) draw(r);
    /* over: the deck of the east-west lane, with a shadow on the lane below */
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + 0.1, 1, 0.8);
    ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y + 0.16, 1.02, 0.68);
    ctx.strokeStyle = rail(flow.overFast, pal.text3); ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo(x, y + 0.16); ctx.lineTo(x + 1, y + 0.16); ctx.moveTo(x, y + 0.84); ctx.lineTo(x + 1, y + 0.84); ctx.stroke();
    if (this.cam.z >= 8) lane(flow.over, true, flow.overFast);
    for (const r of riders) if (r.fx !== 0) draw(r);
  }

  /**
   * An arm: a base on its tile, a flat link, and a suction cup that holds the ticket. Under it, painted on its tile,
   * an arrow in its colour says which way it works: narrow where it takes, wide where it drops, its head at the edge.
   * It is there when the arm is at rest or turned the other way, which is when one needs it.
   */
  protected arm(v: ArmView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { m: a, bx, by, dx, dy, hx, hy, carried, filtered } = v;
    const col = armColor(a, { plain: pal.text2, sorts: pal.warn }), steel = mix(pal.body, pal.text2, 0.38);
    if (!this.armBody(v, st, pal, col, steel)) {
      const link = (ox: number, oy: number) => { ctx.beginPath(); ctx.moveTo(bx + ox, by + oy); ctx.lineTo(hx + ox, hy + oy); ctx.stroke(); };
      this.wayMark(bx, by, dx, dy, col, st.edit ? 1 : 0.62);
      ctx.lineCap = 'round';
      if (!st.edit) { ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.31; link(0.06, 0.1); }
      /* what it carries is held: it moves with the cup */
      if (carried) { ctx.lineCap = 'butt'; this.ticket(carried, st); ctx.lineCap = 'round'; }
      ctx.strokeStyle = steel; ctx.lineWidth = 0.29; link(0, 0);
      ctx.strokeStyle = col; ctx.lineWidth = 0.08; link(0, 0);
      ctx.lineCap = 'butt';
      /* the cup: a ring, through which the ticket shows, the one it holds as the one that waits for it on the quay */
      ctx.beginPath(); ctx.arc(hx, hy, 0.2, 0, 6.3); ctx.fillStyle = 'rgba(24,24,27,0.3)'; ctx.fill(); ctx.strokeStyle = pal.text; ctx.lineWidth = 0.055; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 0.055, 0, 6.3); ctx.fillStyle = pal.text; ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by, 0.25, 0, 6.3); ctx.fillStyle = pal.body; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.068; ctx.stroke();
      ctx.beginPath(); ctx.arc(bx, by, 0.09, 0, 6.3); ctx.fillStyle = steel; ctx.fill();
    }
    const { tag, asked } = v;
    if (!tag || (!asked && (st.armTags === false || this.cam.z < 11))) return;
    /*
     * What the arm takes is written past its head, on the side it drops on: on its own row for an arm that points
     * sideways, in its own column otherwise. Arms stacked against a station then each carry their own tag, where a
     * tag above the arm read as belonging to the one before.
     */
    /* the tag is in the arm's colour: a dark plate tinted with it, and the colour lightened for the ink */
    /* on a light floor: a light plate tinted with it, and the colour darkened for the ink (`write` sees to the ink) */
    const o = { min: 9, max: 12, mono: true, plate: pal.light ? (a.color ? mix('#ffffff', col, 0.2) : filtered ? '#fef3c7' : 'rgba(9,9,11,0.84)') : a.color ? mix('#09090b', col, 0.2) : filtered ? 'rgba(40,32,4,0.92)' : 'rgba(9,9,11,0.84)' };
    const ink = pal.light ? (a.color ? col : filtered ? '#92400e' : pal.text2) : a.color ? mix(col, '#ffffff', 0.45) : filtered ? '#fde68a' : pal.text2;
    /* a teleporter is a tile a tag must not cover either: it has its ring and its own plate */
    if (v.solidDst && v.solidSrc) {
      /* squeezed between two machines, there is no room on its own line: beside it, as a last resort */
      if (dy === 0) this.label(tag, bx, a.y - 0.28, 0.3, ink, { ...o, align: 'center' });
      else this.label(tag, a.x + 1.14, by, 0.3, ink, { ...o, fit: 6 });
      return;
    }
    /* past the head, unless that is a machine: then behind the arm, over the belt it takes from */
    const fx = v.solidDst ? -dx : dx, fy = v.solidDst ? -dy : dy;
    if (fx > 0) this.label(tag, a.x + 1.12, by, 0.3, ink, { ...o, align: 'left', fit: 5 });
    else if (fx < 0) this.label(tag, a.x - 0.12, by, 0.3, ink, { ...o, align: 'right', fit: 5 });
    else this.label(tag, bx, fy > 0 ? a.y + 1.3 : a.y - 0.3, 0.3, ink, { ...o, align: 'center', fit: 2.6 });
  }

  /** An arm's way mark, link, cup and base (and what it carries), its own way: true when drawn. */
  protected armBody(_v: ArmView, _st: ViewState, _pal: Palette, _col: string, _steel: string): boolean { return false; }

  /** The arrow painted under an arm, from where it takes to where it drops. */
  private wayMark(bx: number, by: number, dx: number, dy: number, col: string, strength: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    WAY.forEach(([u, v], i) => { const X = bx + u * dx - v * dy, Y = by + u * dy + v * dx; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.closePath();
    ctx.fillStyle = col; ctx.globalAlpha = 0.26 * strength; ctx.fill();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7 * strength; ctx.lineWidth = 0.034; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineJoin = 'miter';
  }

  /**
   * The quay of each arm that takes from a box: a notch in its edge, in the arm's colour (a painted square on a
   * zone, which is paint itself), and the tickets on their way out, in line at the quay of the arm that will take
   * them. They slide there, slowly enough to be seen going.
   */
  protected quays(quays: Quay[], st: ViewState, pal: Palette, painted: boolean): void {
    const ctx = this.ctx;
    for (const { a, q, line, more, moreAt } of quays) {
      rr(ctx, q.x, q.y, q.w, q.h, 0.11);
      if (painted) { ctx.globalAlpha = 0.75; ctx.setLineDash([0.09, 0.07]); } else { ctx.fillStyle = pal.floor; ctx.fill(); }
      ctx.strokeStyle = armColor(a, { plain: pal.text2, sorts: pal.warn }); ctx.lineWidth = 0.045; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      /* the last in line first: the one that leaves next is on top */
      for (const p of line) this.ticket(p, st);
      if (more > 0 && moreAt) this.label(`+${more}`, moreAt.x, moreAt.y, 0.2, pal.text2, { mono: true, align: 'center', plate: 'rgba(9,9,11,0.84)' });
    }
  }

  /**
   * A station as a machine (see `machineArt.ts`): head plate, light, places, a bay for what was set aside, and a quay
   * in front of each arm for what is done. A status station stays the small box it was: it holds nothing.
   */
  protected station(v: StationView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, z = this.cam.z, { m, gate, parts: P, sorted: S, lamp: L } = v, { x, y, w, h } = m;
    const kind = v.run, look = kind ? KIND_LOOK[kind] : null, tint = look?.hue ?? pal.amber, tiny = (text: string, r: Rect, color = pal.text3) => this.label(text, r.x + 0.1, r.y + 0.17, 0.15, color, { weight: 700 });
    const pit = (r: Rect) => this.pit(r, pal);
    this.stationBody(v, tint, pal);
    this.stationHead(v, tint, pal);
    this.lamp(v, st.hoverLamp === m.id, pal);
    /* places, or what a gate decides on */
    if (gate) {
      pit(P.work); tiny(`TO DECIDE · ${S.deciding.length}`, P.work);
      for (const p of v.deciding) this.ticket(p, st);
      if (v.decidingMore > 0) this.label(`+${v.decidingMore}`, P.work.x + P.work.w - 0.1, P.work.y + P.work.h - 0.2, 0.22, pal.text2, { mono: true, align: 'right' });
    } else {
      for (const { c, t: p, size, cx, cy } of v.places) {
        pit(c);
        const t = p?.t;
        tiny(t ? (t.phase === 'running' ? 'RUNNING' : 'HELD') : 'FREE', c, t?.phase === 'running' ? pal.ok : pal.text3);
        if (!t && kind && c.w * z >= 38) this.idle(kind, cx, cy, size, c, pal.light ? mix(tint, '#000000', 0.3) : tint);
        if (p) this.ticket(p, st);
      }
      if (v.extra) this.label(`+${v.extra}`, P.work.x + P.work.w - 0.1, P.work.y + 0.2, 0.22, pal.text2, { mono: true, align: 'right', plate: 'rgba(9,9,11,0.84)' });
    }
    /* what is done and that no arm takes: it will not leave by itself, and says so in red */
    if (P.out) {
      const o = P.out;
      this.tray(o, pal); tiny('NO ARM', o, pal.danger);
      for (const p of v.stuck) this.ticket(p, st);
      if (v.stuckMore > 0) this.label(`+${v.stuckMore}`, o.x + o.w / 2, o.y + o.h - 0.16, 0.2, pal.text2, { mono: true, align: 'center' });
    }
    /* the bay: what was set aside. Hazard stripes on its edge, as a hold area has. */
    if (P.aside) {
      const a = P.aside, band = 0.42, aside = v.asideCount;
      pit(a);
      this.hazard(a, band, aside > 0, pal);
      this.label('SET ASIDE', a.x + band + 0.1, a.y + 0.17, 0.15, pal.light ? (aside ? pal.warn : pal.text3) : veil(pal.warn, aside ? 0.9 : 0.45), { weight: 700 });
      for (const p of v.aside) this.ticket(p, st);
      if (v.asideMore > 0) this.label(`+${v.asideMore}`, a.x + a.w - 0.1, a.y + a.h / 2, 0.22, pal.text2, { mono: true, align: 'right' });
    }
    this.quays(v.quays, st, pal, false);
    /* the model it runs on, under it: its own, else its persona's, or a panel's orchestrator */
    const model = v.model;
    if (model) { const b = bodyOf(m); this.label(modelTag(model), b.x + b.w / 2, b.y + b.h + 0.26, 0.24, pal.text2, { align: 'center', mono: true, plate: 'rgba(9,9,11,0.84)', min: 9, max: 12, fit: b.w + 1 }); }
    /* a script station says what it runs when it is pointed at: one line a command */
    if (v.plate) {
      const lines = v.plate, col = tint;
      /* over the station, or under it when there is no room left above in the view */
      const above = (y - this.cam.y) * z + this.h / 2 > lines.length * 15 + 24;
      this.boards.push({ lift: this.lifted, lines, inks: lines.map((l) => (l.startsWith('no command') || l.endsWith(' yet') ? pal.text3 : col)), col, side: above ? 'above' : 'below', wx: x + w / 2, wy: above ? y : y + h });
    }
    if (L === 'off') { ctx.globalAlpha = 0.28; this.trace(m); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1; }
  }

  /** The tray of what is done and that no arm takes: a place with a red edge. */
  protected tray(o: Rect, pal: Palette): void {
    const ctx = this.ctx;
    this.pit(o, pal); ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.04; ctx.stroke();
  }
  /** The hazard stripes on the edge of the bay, `band` wide; brighter when something is set aside. */
  protected hazard(a: Rect, band: number, full: boolean, pal: Palette): void {
    const ctx = this.ctx;
    ctx.save(); rr(ctx, a.x, a.y, a.w, a.h, 0.14); ctx.clip(); ctx.beginPath(); ctx.rect(a.x, a.y, band, a.h); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(a.x, a.y, band, a.h);
    ctx.strokeStyle = veil(pal.light ? HAZARD : pal.warn, full ? (pal.light ? 1 : 0.75) : pal.light ? 0.7 : 0.35); ctx.lineWidth = 0.09; ctx.beginPath();
    for (let k = -a.h; k < band + a.h; k += 0.22) { ctx.moveTo(a.x + k, a.y + a.h); ctx.lineTo(a.x + k + a.h, a.y); }
    ctx.stroke(); ctx.restore();
  }

  /** A place is a hollow in the body: deep on a dark machine, a faint shade on a light one, where what is written in it must still read. */
  protected pit(r: Rect, pal: Palette): void {
    const ctx = this.ctx;
    rr(ctx, r.x, r.y, r.w, r.h, 0.14); ctx.fillStyle = pal.light ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.4)'; ctx.fill(); ctx.lineWidth = 0.02; ctx.strokeStyle = pal.light ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.06)'; ctx.stroke();
  }
  /** The body: a plate lit from above. A gate keeps its dashed amber edge; what runs something has its kind's shape and hue. */
  protected stationBody(v: StationView, tint: string, pal: Palette): void {
    const ctx = this.ctx, { m, gate } = v, kind = v.run, { x, y, w, h } = m;
    if (kind) this.behind(m, kind, tint, pal);
    this.trace(m);
    ctx.fillStyle = this.bodyFill(kind, y, h, pal);
    ctx.fill();
    const edge = this.bodyEdge(gate, tint, pal);
    ctx.lineWidth = edge.width; ctx.strokeStyle = edge.color;
    if (gate) ctx.setLineDash([0.3, 0.2]);
    ctx.stroke(); ctx.setLineDash([]);
    if (kind === 'script') {
      /* the title bar of a terminal window, with its three buttons */
      ctx.fillStyle = veil(tint, 0.22); ctx.fillRect(x + 0.1, y + 0.1, w - 0.2, BAR - 0.04);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + 0.3 + i * 0.2, y + 0.08 + BAR / 2, 0.055, 0, 6.3); ctx.fillStyle = veil(tint, 0.9 - i * 0.25); ctx.fill(); }
    }
  }
  /** The head plate: what it is (a full badge for what runs something, its word over the name), its name, and what it runs. */
  protected stationHead(v: StationView, tint: string, pal: Palette): void {
    const ctx = this.ctx, z = this.cam.z, { m, gate, parts: P } = v, kind = v.run, look = kind ? KIND_LOOK[kind] : null;
    rr(ctx, P.badge.x, P.badge.y, P.badge.w, P.badge.h, 0.18);
    if (kind) { ctx.fillStyle = tint; ctx.fill(); } else { ctx.fillStyle = veil(tint, 0.16); ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = veil(tint, 0.55); ctx.stroke(); }
    if (P.badge.w * z >= 11) this.glyph(m.exec, P.badge.x + P.badge.w * 0.15, P.badge.y + P.badge.h * 0.15, P.badge.w * 0.7, kind ? '#09090b' : tint, kind ? 2.2 : 2);
    /* the word needs room to be read: seen from far, the head keeps its two lines and the shape and the hue say the kind */
    const fit = P.lamp.x - P.name.x - 0.1, worded = !!look && 0.17 * z >= 6;
    if (worded) this.label(look.word, P.name.x, P.name.y - 0.13, 0.17, tint, { mono: true, weight: 700, spacing: 0.16, fit });
    this.label(m.name || (gate ? 'Gate' : 'Station'), P.name.x, P.name.y + (worded ? 0.14 : 0), worded ? 0.31 : 0.33, pal.text, { weight: 650, min: 9, max: 17, fit });
    const what = v.what;
    this.label(worded ? what : `${gate ? 'gate' : m.exec} · ${what}`, P.name.x, P.name.y + (worded ? 0.44 : 0.36), worded ? 0.19 : 0.2, pal.text3, { fit });
  }
  /** The light: red off, amber it needs someone, green it works. On a machine that runs something it is the switch. */
  protected lamp(v: StationView, pointed: boolean, pal: Palette): void {
    const ctx = this.ctx, { parts: P, lamp: L } = v;
    rr(ctx, P.lamp.x, P.lamp.y, P.lamp.w, P.lamp.h, 0.12); ctx.fillStyle = '#0d0d10'; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = pointed ? pal.text : pal.edge; ctx.stroke();
    P.lights.forEach((l, i) => {
      /* a lamp is a light on a dark housing: on a light theme its colours are the bright ones, not the theme's text colours */
      const on = (i === 0 && L === 'off') || (i === 1 && L === 'call') || (i === 2 && L === 'on'), col = pal.light ? ['#ef4444', HAZARD, '#22c55e'][i]! : i === 0 ? pal.danger : i === 1 ? pal.warn : pal.ok;
      if (on) { ctx.globalAlpha = 0.28 * (i === 1 ? 0.6 + 0.4 * Math.sin(this.clock * 4) ** 2 : 1); ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 2.3, 0, 6.3); ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, 6.3); ctx.fillStyle = on ? col : '#2a2a2f'; ctx.fill();
    });
  }

  /** What a station's body is filled with: a plate lit from above; a terminal's dark glass for a script. */
  protected bodyFill(kind: RunKind | null, y: number, h: number, pal: Palette): string | CanvasGradient {
    if (kind === 'script') return mix(pal.body, '#000000', pal.light ? 0.1 : 0.55);
    const g = this.ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, mix(pal.body, '#ffffff', 0.09)); g.addColorStop(1, pal.body);
    return g;
  }
  /** A station's edge: in its kind's hue, thicker and dashed for a gate. */
  protected bodyEdge(gate: boolean, tint: string, pal: Palette): { color: string; width: number } {
    return { color: tint, width: gate ? 0.12 : pal.light ? 0.07 : 0.055 };
  }

  /** The outline of a machine's body, as a path: each kind that runs something has its own (see `machineArt.ts`). */
  protected trace(m: StationSpec): void {
    const ctx = this.ctx, b = bodyOf(m), x = b.x + 0.07, y = b.y + 0.07, w = b.w - 0.14, h = b.h - 0.14;
    if (m.exec !== 'skill') { rr(ctx, x, y, w, h, m.exec === 'agent' ? SHOULDER : m.exec === 'script' ? 0.07 : ROUND); return; }
    const c = Math.min(CUT, w / 4, h / 4);
    ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + h - c);
    ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath();
  }

  /** What stands behind the body: an agent's antenna, the two plates behind a panel's front one. */
  private behind(m: StationSpec, kind: RunKind, tint: string, pal: Palette): void {
    const ctx = this.ctx, b = bodyOf(m);
    if (kind === 'agent') {
      const ax = b.x + 0.92;
      ctx.strokeStyle = tint; ctx.lineWidth = 0.055; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ax, b.y + 0.1); ctx.lineTo(ax, b.y - 0.1); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(ax, b.y - 0.13, 0.08, 0, 6.3); ctx.fillStyle = tint; ctx.fill();
    } else if (kind === 'panel') {
      for (const [k, a] of [[1, 0.35], [0.5, 0.6]] as const) {
        rr(ctx, b.x + 0.07 + STACK * k, b.y + 0.07 - STACK * k, b.w - 0.14, b.h - 0.14, ROUND);
        ctx.fillStyle = pal.body; ctx.fill(); ctx.lineWidth = 0.055; ctx.strokeStyle = veil(tint, a); ctx.stroke();
      }
    }
  }

  /** A machine's icon, as strokes, in a square of that side. */
  /** How far under a ticket's middle its number is written, in tiles. */
  protected numberDy(B: number): number { return B * 0.52; }

  /** A ticket at work, its own way: true when drawn (otherwise an arc turns round it). */
  protected runMark(_px: number, _py: number, _B: number, _seed: number): boolean { return false; }

  private glyph(exec: string, x: number, y: number, side: number, color: string, lw: number): void {
    if (typeof Path2D === 'undefined') return;
    const ctx = this.ctx, k = side / 24;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const icon = iconPath(exec);
    if (icon) ctx.stroke(icon);
    ctx.restore();
  }

  /**
   * A free place says what will work there, faintly: a robot's head (agent), a tool in its holder (skill), three
   * seats (panel), a prompt (script). A ticket that comes in covers it.
   */
  protected idle(kind: RunKind, cx: number, cy: number, size: number, c: Rect, tint: string): void {
    const ctx = this.ctx, s = Math.min(size, 0.7);
    if (kind === 'agent') this.glyph('agent', cx - s / 2, cy - s / 2, s, veil(tint, 0.3), 1.6);
    else if (kind === 'skill') {
      ctx.setLineDash([0.09, 0.09]); ctx.lineWidth = 0.04; ctx.strokeStyle = veil(tint, 0.3); ctx.beginPath(); ctx.arc(cx, cy, s * 0.46, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      this.glyph('skill', cx - s * 0.3, cy - s * 0.3, s * 0.6, veil(tint, 0.4), 1.8);
    } else if (kind === 'panel') {
      for (const [dx, dy] of [[-0.36, -0.2], [0.36, -0.2], [0, 0.32]] as const) { ctx.beginPath(); ctx.arc(cx + dx * s, cy + dy * s, s * 0.21, 0, 6.3); ctx.fillStyle = veil(tint, 0.2); ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = veil(tint, 0.5); ctx.stroke(); }
    } else {
      const sx = c.x + 0.12, sy = c.y + 0.34, sw = c.w - 0.24, sh = c.h - 0.46;
      if (sh < 0.3) return;
      rr(ctx, sx, sy, sw, sh, 0.05); ctx.fillStyle = this.pal?.light ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.45)'; ctx.fill();
      this.label('$', sx + 0.1, sy + 0.2, 0.2, veil(tint, 0.8), { mono: true, weight: 700 });
      ctx.fillStyle = veil(tint, 0.7); ctx.fillRect(sx + 0.3, sy + 0.1, 0.07, 0.2);
      if (sh > 0.5) { ctx.fillStyle = veil(tint, 0.3); ctx.fillRect(sx + 0.1, sy + sh - 0.16, sw * 0.55, 0.05); }
    }
  }

  protected statusStation(v: StatusView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { m, big } = v, { x, y, w, h } = m, gate = false, nat = true;
    const state = v.busy ? pal.ok : pal.text3;
    rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.28); ctx.fillStyle = pal.body; ctx.fill();
    ctx.lineWidth = gate ? 0.12 : 0.06; ctx.strokeStyle = gate ? pal.warn : nat ? pal.ok : pal.edge;
    if (gate) ctx.setLineDash([0.3, 0.2]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = state; rr(ctx, x + 0.42, y + 0.2, w - 0.84, 0.08, 0.04); ctx.fill();
    this.label(m.name || (gate ? 'Gate' : 'Station'), x + w / 2, y + (big ? 0.62 : 0.54), big ? 0.32 : 0.26, pal.text, { align: 'center', weight: 600, min: 8, max: 14, fit: w - 0.25 });
    for (const c of v.slots) {
      rr(ctx, c.x, c.y, c.size, c.size, 0.08); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      if (c.t) this.ticket(c.t, st);
    }
    if (v.more > 0) this.label(`+${v.more}`, v.moreAt.x, v.moreAt.y, 0.24, pal.text2, { mono: true, align: 'right' });
    /* what no arm takes stays here, in red; the rest is at the quay of its arm */
    const o = v.outBox;
    if (o) { rr(ctx, o.x, o.y, o.w, o.h, 0.1); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill(); ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.04; ctx.stroke(); }
    for (const p of v.out) this.ticket(p, st);
    this.quays(v.quays, st, pal, false);
    if (v.full) this.label('full', x + w / 2, y + h + 0.26, 0.26, '#fdba74', { align: 'center', plate: 'rgba(9,9,11,0.84)', min: 9, max: 12 });
  }

  /**
   * A zone is paint on the floor: a faint fill, a dashed line round it, three corners. Everything it says is
   * stencilled: its name, a padlock (shut, nothing leaves without you; open with chevrons, it lets tickets out by
   * itself), how many tickets it holds as a large figure on the ground, and, where it stops releasing above a number
   * of tickets in work, that number as a line that fills.
   */
  protected zone(v: ZoneView, S: Scene, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { m, stock } = v, { x, y, w, h } = m, auto = m.release === 'auto', c = m.inbound ? pal.accent : ZONE_PAINT[m.status ?? ''] ?? PAINT, wip = S.wip;
    ctx.fillStyle = c; ctx.globalAlpha = pal.light ? 0.1 : 0.055; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = c; ctx.globalAlpha = pal.light ? 0.8 : 0.45; ctx.lineWidth = 0.045; ctx.setLineDash([0.2, 0.16]); ctx.strokeRect(x + 0.035, y + 0.035, w - 0.07, h - 0.07); ctx.setLineDash([]);
    /* three corners: the fourth is the padlock's */
    ctx.globalAlpha = 1; ctx.lineWidth = 0.11; ctx.lineCap = 'square'; ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) { ctx.moveTo(cx + sx * 0.4, cy + sy * 0.055); ctx.lineTo(cx + sx * 0.055, cy + sy * 0.055); ctx.lineTo(cx + sx * 0.055, cy + sy * 0.4); }
    ctx.stroke(); ctx.lineCap = 'butt';
    this.label((m.name || 'Zone').toUpperCase(), x + 0.26, y + 0.42, 0.26, c, { mono: true, weight: 700, min: 9, max: 15, fit: w - (auto ? 1.25 : 0.95) });
    this.padlock(x + w - (auto ? 0.86 : 0.52), y + 0.2, auto, auto ? pal.ok : pal.danger);
    /* the stock, on the ground: tickets stand on it */
    if (w >= 2 && h >= 2) this.stencil(String(stock).padStart(2, '0'), x + 0.2, y + h - 0.56, 0.9, c, pal.light ? (stock ? 0.4 : 0.22) : stock ? 0.3 : 0.14, { mono: true, weight: 700 });
    if (auto && m.status === 'todo') {
      /* it stops releasing while that many tickets are in work on the floor: the line is how close that is */
      const limit = m.limit ?? 12, k = clamp(wip / limit, 0, 1), cc = k >= 0.8 ? pal.warn : c, x0 = x + 0.24, x1 = x + w - 0.24, ly = y + h - 0.17;
      ctx.lineCap = 'round'; ctx.lineWidth = 0.09;
      ctx.strokeStyle = c; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x1, ly); ctx.stroke(); ctx.globalAlpha = 1;
      if (k > 0) { ctx.strokeStyle = cc; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + (x1 - x0) * k, ly); ctx.stroke(); }
      ctx.lineCap = 'butt';
      if (w >= 3) this.label(`IN WORK ${wip}/${limit}`, x1 + 0.04, y + h - 0.42, 0.19, cc, { mono: true, weight: 700, align: 'right', min: 8, max: 11 });
    }
    for (const p of v.held) this.ticket(p, st);
    if (v.more > 0) this.label(`+${v.more}`, x + w - 0.28, y + h - 0.72, 0.26, pal.text2, { align: 'right', mono: true, plate: 'rgba(9,9,11,0.84)' });
    this.quays(v.quays, st, pal, true);
  }

  /**
   * A dock of 3 by 2 (picked on `docs/factory/intake.html`, I1). A desk, where tickets are born: green, a badge with a
   * plus, "NEW TICKET" over its name. An intake, where items of a source come in: in its source's colour, the source's
   * mark in relief on its badge, "INTAKE" over its name, HELD (what waits for its conversation to be quiet, drawn faded
   * in the dock) and DROPPED (what its rules left out over 24 h). What is let out waits at the quays of its arms.
   */
  protected dock(v: DockView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { m } = v, { x, y, w, h } = m, z = this.cam.z, intake = m.kind === 'intake';
    const col = m.kind === 'intake' ? SOURCE_COLORS[m.source] : DESK_COLOR;
    rr(ctx, x + 0.06, y + 0.06, w - 0.12, h - 0.12, 0.22); ctx.fillStyle = pal.body; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 0.05; ctx.stroke();
    const b = 0.6, bx = x + 0.24, by = y + 0.24;
    if (m.kind === 'intake') {
      rr(ctx, bx, by, b, b, 0.14); ctx.fillStyle = mix(col, pal.body, 0.82); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.03; ctx.stroke();
      /* the source's mark, as an item of it is drawn in this skin */
      this.token('solid', sourceType(m.source), col, bx + b / 2, by + b / 2, b * 0.78, 1);
    } else {
      /* a green square with a plus: a ticket that is about to be */
      rr(ctx, bx, by, b, b, 0.14); ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(bx + b / 2, by + 0.15); ctx.lineTo(bx + b / 2, by + b - 0.15); ctx.moveTo(bx + 0.15, by + b / 2); ctx.lineTo(bx + b - 0.15, by + b / 2); ctx.stroke(); ctx.lineCap = 'butt';
    }
    if (z >= 7) this.label(intake ? 'INTAKE' : 'NEW TICKET', bx + b + 0.16, by + 0.12, 0.17, col, { mono: true, weight: 700, min: 7, max: 10, fit: w - b - 0.6 });
    this.label(m.name || (m.kind === 'intake' ? SOURCE_LABEL[m.source] : 'Desk'), bx + b + 0.16, by + 0.42, 0.28, pal.text, { weight: 650, min: 9, max: 15, fit: w - b - 0.6 });
    if (intake && z >= 10) {
      this.label(`HELD ${v.waiting}`, x + 0.26, y + h - 0.48, 0.16, v.waiting ? pal.warn : pal.text3, { mono: true, weight: 700, min: 7, max: 10 });
      if (v.pullFailed === null) this.label(`DROPPED ${v.dropped}`, x + 0.26, y + h - 0.26, 0.16, pal.text3, { mono: true, weight: 700, min: 7, max: 10 });
      else if (v.pullFailed) this.label('PULL FAILED', x + 0.26, y + h - 0.26, 0.16, pal.danger, { mono: true, weight: 700, min: 7, max: 10 });
      /* on a line of its own, under the badge: the counters and what the dock holds share the bottom */
      if (z >= 14 && v.noArm) this.label('no arm takes from it', x + 0.26, y + 1.04, 0.14, pal.danger, { mono: true });
    } else if (!intake && z >= 14) {
      if (v.noArm) this.label('no arm takes from it', x + w / 2, y + h - 0.28, 0.16, pal.danger, { mono: true, align: 'center', fit: w - 0.3 });
      else this.label(st.edit ? 'double-click: settings' : 'double-click: the form', x + 0.24, y + h - 0.28, 0.16, pal.text3, { mono: true, fit: w - 0.4 });
    }
    for (const p of v.held) this.ticket(p, st);
    if (v.more > 0) this.label(`+${v.more}`, x + w - 0.16, y + h - 0.6, 0.2, pal.text2, { align: 'right', mono: true, plate: 'rgba(9,9,11,0.84)' });
    this.quays(v.quays, st, pal, false);
  }

  /** A padlock, stencilled: shut and red, or open and green with two chevrons after it (what it holds leaves by itself). Laid out on a grid of 40 to the tile. */
  private padlock(x: number, y: number, open: boolean, col: string): void {
    const ctx = this.ctx, k = 1 / 40, top = y + (open ? 0.5 : 2.5) * k;
    ctx.fillStyle = col; rr(ctx, x, y + 5 * k, 11 * k, 9 * k, 2 * k); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x + 2.5 * k, y + 5 * k); ctx.lineTo(x + 2.5 * k, top); ctx.arc(x + 5.5 * k, top, 3 * k, Math.PI, 0); ctx.lineTo(x + 8.5 * k, top + (open ? 1 : 2.5) * k); ctx.stroke();
    if (open) {
      ctx.beginPath();
      for (const cx of [15, 20]) { ctx.moveTo(x + cx * k, y + 5.5 * k); ctx.lineTo(x + (cx + 4) * k, y + 9.5 * k); ctx.lineTo(x + cx * k, y + 13.5 * k); }
      ctx.stroke();
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  /**
   * An exit is a frame of light: it keeps its tiles, and holds nothing. A ticket that reaches it is handed back to
   * Fleex, so it is not kept there: it fades as it crosses the frame (see `departures`). What stays is how many left
   * by it over the period the floor's figures cover.
   */
  protected exit(v: ExitView, pal: Palette): void {
    const ctx = this.ctx, { m } = v, { x, y, w, h } = m, z = this.cam.z, ok = pal.ok;
    ctx.strokeStyle = ok;
    for (const [lw, a] of [[0.32, 0.07], [0.18, 0.14]] as const) { ctx.globalAlpha = a; ctx.lineWidth = lw; rr(ctx, x + 0.06, y + 0.06, w - 0.12, h - 0.12, 0.2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    rr(ctx, x + 0.06, y + 0.06, w - 0.12, h - 0.12, 0.2); ctx.fillStyle = mix(pal.floor, '#000000', pal.light ? 0.06 : 0.3); ctx.fill(); ctx.lineWidth = 0.055; ctx.stroke();
    const R = Math.min(w, h) * 0.46;
    ctx.globalAlpha = 0.24; ctx.drawImage(this.glowSprite(ok), x + w / 2 - R, y + h / 2 - R, R * 2, R * 2); ctx.globalAlpha = 1;
    const plate = { mono: true, weight: 700, min: 9, max: 12 } as const;
    /* how many left by it: on the top line too when there is room beside the name, under the frame otherwise */
    const count = v.count == null ? null : `${v.count} · ${v.days} d`, beside = count !== null && w * z >= 125;
    /* the name stops short of the count beside it (a monospace plate: about 0.62 of its size a character, and its padding) */
    const px = Math.min(12, Math.max(9, 0.24 * z)), countW = beside ? (count!.length * 0.62 * px + 10) / z + 0.15 : 0;
    this.label((m.name || 'Exit').toUpperCase(), x + 0.3, y + 0.06, 0.24, '#052e16', { ...plate, plate: ok, fit: Math.max(1.2, w - 0.6 - countW) });
    if (w >= 3 && h >= 2) this.label('handed back to Fleex', x + w / 2, y + h - 0.3, 0.17, pal.text3, { mono: true, align: 'center', fit: w - 0.3 });
    if (count === null) return;
    const o = { ...plate, plate: 'rgba(9,9,11,0.92)' };
    if (beside) this.label(count, x + w - 0.3, y + 0.06, 0.24, ok, { ...o, align: 'right' });
    else this.label(count, x + w / 2, y + h - 0.04, 0.24, ok, { ...o, align: 'center' });
  }

  /**
   * A teleporter, on one tile: a ring where its ticket stands, and four chevrons round it that go in on a departure
   * and come out on an arrival. A departure's frame is closed; an arrival's is open in the middle of each side, where
   * its chevrons come out. The ring turns to amber dashes while a departure keeps its ticket because the arrival is
   * taken, and the whole pad to red when it cannot work as it is (a departure that leads nowhere, an arrival no arm
   * empties). Its name and what it leads to are on a plate beside it.
   */
  protected port(v: PortView, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { m, dep, bad, waiting, burst } = v, { x, y } = m, cx = x + 0.5, cy = y + 0.5, z = this.cam.z, col = bad ? pal.danger : v.color;
    rr(ctx, x + 0.068, y + 0.068, 0.864, 0.864, 0.2); ctx.fillStyle = mix(pal.floor, '#000000', pal.light ? 0.08 : 0.3); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 0.057;
    if (dep) ctx.stroke();
    else {
      ctx.lineCap = 'round'; ctx.beginPath();
      for (const [px, py, sx, sy] of [[x + 0.068, y + 0.068, 1, 1], [x + 0.932, y + 0.068, -1, 1], [x + 0.932, y + 0.932, -1, -1], [x + 0.068, y + 0.932, 1, -1]] as const) {
        ctx.moveTo(px, py + sy * 0.27); ctx.lineTo(px, py + sy * 0.2); ctx.quadraticCurveTo(px, py, px + sx * 0.2, py); ctx.lineTo(px + sx * 0.27, py);
      }
      ctx.stroke(); ctx.lineCap = 'butt';
    }
    ctx.beginPath(); ctx.arc(cx, cy, 0.26, 0, 6.3); ctx.fillStyle = col; ctx.globalAlpha = 0.1 + 0.3 * burst; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = waiting ? pal.warn : col; ctx.lineWidth = 0.045;
    if (waiting) { ctx.setLineDash([0.11, 0.09]); ctx.lineDashOffset = -this.clock * 0.25; }
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (burst > 0) { ctx.globalAlpha = 1 - burst; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 0.26 + 0.3 * burst, 0, 6.3); ctx.stroke(); ctx.globalAlpha = 1; }
    if (z >= 9) {
      /* in towards the ring on a departure, out of it on an arrival */
      const k = dep ? -1 : 1;
      ctx.strokeStyle = col; ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let s = 0; s < 4; s++) {
        const ux = DX[s as 0], uy = DY[s as 0], px = cx + ux * 0.37, py = cy + uy * 0.37;
        ctx.moveTo(px - k * ux * 0.045 - uy * 0.105, py - k * uy * 0.045 + ux * 0.105); ctx.lineTo(px + k * ux * 0.05, py + k * uy * 0.05); ctx.lineTo(px - k * ux * 0.045 + uy * 0.105, py - k * uy * 0.045 - ux * 0.105);
      }
      ctx.stroke(); ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    }
    if (v.held) this.ticket(v.held, st);
    if (v.gone) {
      /* the one that has just left: it shrinks where it stood */
      const out = v.gone, k = out.k, sprite = tokenSprite(out.type, TYPE_COLORS[out.type] ?? NO_TYPE, 0.37 * z * this.dpr);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      if (sprite) { const size = (sprite.width / (z * this.dpr)) * k; ctx.drawImage(sprite, cx - size / 2, cy - size / 2, size, size); }
      else { rr(ctx, cx - 0.16 * k, cy - 0.16 * k, 0.32 * k, 0.32 * k, 0.07); ctx.fillStyle = TYPE_COLORS[out.type] ?? NO_TYPE; ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (waiting || bad) {
      /* a pause sign while it holds its ticket back, "!" when it cannot work */
      const bx = x + 0.86, by = y + 0.14;
      ctx.beginPath(); ctx.arc(bx, by, 0.15, 0, 6.3); ctx.fillStyle = bad ? pal.danger : pal.warn; ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.stroke();
      if (bad) this.label('!', bx, by + 0.012, 0.22, 'rgba(0,0,0,0.85)', { align: 'center', weight: 800, min: 7, max: 16 });
      else { ctx.fillStyle = 'rgba(9,9,11,0.88)'; ctx.fillRect(bx - 0.065, by - 0.07, 0.04, 0.14); ctx.fillRect(bx + 0.025, by - 0.07, 0.04, 0.14); }
    }
    const asked = v.asked;
    if (z < 11 && !asked) return;
    /* the plate: under the pad, over it when something stands under, beside it when it is boxed in. Its second line is what to know now. */
    const line = z >= 16 || asked || bad || waiting ? v.line : '';
    const name = { mono: true, weight: 700, min: 9, max: 12, plate: 'rgba(9,9,11,0.9)' } as const, sub = { mono: true, min: 8, max: 10, plate: 'rgba(9,9,11,0.9)' } as const;
    const ink = bad ? '#fca5a5' : waiting ? pal.warn : pal.text2;
    if (v.plate === 'below') {
      this.label(v.name, cx, y + 1, 0.24, col, { ...name, align: 'center', dy: 11 });
      if (line) this.label(line, cx, y + 1, 0.2, ink, { ...sub, align: 'center', dy: 26 });
    } else if (v.plate === 'above') {
      this.label(v.name, cx, y, 0.24, col, { ...name, align: 'center', dy: line ? -26 : -11 });
      if (line) this.label(line, cx, y, 0.2, ink, { ...sub, align: 'center', dy: -11 });
    } else {
      this.label(v.name, x + 1.14, cy, 0.24, col, { ...name, dy: line ? -8 : 0 });
      if (line) this.label(line, x + 1.14, cy, 0.2, ink, { ...sub, dy: 8 });
    }
  }

  /**
   * The link between a departure and its arrival. It is not on the floor all the time: it shows for the teleporter
   * that is selected or pointed at (for an arrival, every departure that leads to it), and while a ticket crosses,
   * with the ticket as a dot on it. Drawn over everything, since it crosses the floor.
   */
  protected portLinks(S: Scene, pal: Palette): void {
    const ctx = this.ctx;
    for (const { x1, y1, x2, y2, qx, qy, trim, color: col, hot, packet } of S.links) {
      const at = (u: number) => ({ x: (1 - u) ** 2 * x1 + 2 * (1 - u) * u * qx + u * u * x2, y: (1 - u) ** 2 * y1 + 2 * (1 - u) * u * qy + u * u * y2 });
      /* from the edge of one pad to the edge of the other */
      const path = () => { ctx.beginPath(); for (let i = 0; i <= 28; i++) { const p = at(trim + (1 - 2 * trim) * (i / 28)); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); } };
      ctx.lineCap = 'round'; ctx.setLineDash([0.07, 0.17]); ctx.lineDashOffset = -this.clock * 0.5;
      path(); ctx.strokeStyle = 'rgba(9,9,11,0.6)'; ctx.lineWidth = hot ? 0.13 : 0.1; ctx.stroke();
      path(); ctx.strokeStyle = col; ctx.lineWidth = hot ? 0.075 : 0.05; ctx.globalAlpha = hot ? 1 : 0.9; ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      /* its head, at the arrival */
      const e = at(1 - trim), e0 = at(1 - trim - 0.03), a = Math.atan2(e.y - e0.y, e.x - e0.x);
      ctx.lineJoin = 'round'; ctx.lineWidth = 0.06; ctx.beginPath();
      ctx.moveTo(e.x - Math.cos(a - 0.6) * 0.2, e.y - Math.sin(a - 0.6) * 0.2); ctx.lineTo(e.x, e.y); ctx.lineTo(e.x - Math.cos(a + 0.6) * 0.2, e.y - Math.sin(a + 0.6) * 0.2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      if (packet != null) {
        const p = at(trim + (1 - 2 * trim) * packet);
        ctx.fillStyle = col; ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(p.x, p.y, 0.23, 0, 6.3); ctx.fill();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, 0.1, 0, 6.3); ctx.fill();
      }
    }
    for (const s of S.noEntry) {
      ctx.beginPath(); ctx.arc(s.x, s.y, 0.18, 0, 6.3); ctx.fillStyle = pal.danger; ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.06; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x - 0.1, s.y); ctx.lineTo(s.x + 0.1, s.y); ctx.stroke(); ctx.lineCap = 'butt';
    }
  }

  /**
   * What leaves by an exit: the ticket goes on to the frame as it was, then it is an outline with a tick that fades
   * towards the middle, while the side it came in by lights up where it passed.
   */
  protected departures(S: Scene, pal: Palette): void {
    const ctx = this.ctx, z = this.cam.z;
    for (const l of S.leaving) {
      if (l.travel) {
        const px = l.x, py = l.y, sprite = tokenSprite(l.type, TYPE_COLORS[l.type] ?? NO_TYPE, 0.53 * z * this.dpr);
        if (sprite) { const s = sprite.width / (z * this.dpr); ctx.drawImage(sprite, px - s / 2, py - s / 2, s, s); }
        else { rr(ctx, px - 0.23, py - 0.23, 0.46, 0.46, 0.1); ctx.fillStyle = TYPE_COLORS[l.type] ?? NO_TYPE; ctx.fill(); }
        continue;
      }
      const { k, x: px, y: py, edge, a0, a1 } = l;
      ctx.globalAlpha = 1 - k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      /* the side lights up where it passed, no further than the side goes */
      ctx.strokeStyle = mix(pal.ok, '#ffffff', 0.7); ctx.lineWidth = 0.1; ctx.beginPath(); ctx.moveTo(edge.x + edge.ax * a0, edge.y + edge.ay * a0); ctx.lineTo(edge.x + edge.ax * a1, edge.y + edge.ay * a1); ctx.stroke();
      ctx.strokeStyle = pal.ok; ctx.lineWidth = 0.045; rr(ctx, px - 0.2, py - 0.2, 0.4, 0.4, 0.11); ctx.stroke();
      ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(px - 0.09, py); ctx.lineTo(px - 0.02, py + 0.07); ctx.lineTo(px + 0.1, py - 0.07); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    }
  }

  /** An area: a tinted slab bordered in its colour, its name on the floor. */
  protected area(a: AreaSpec, pal: Palette): void {
    const ctx = this.ctx, { x, y, w, h } = a, c = a.color;
    ctx.fillStyle = c; ctx.globalAlpha = pal.light ? 0.1 : 0.07; ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = pal.light ? 0.75 : 0.55; ctx.strokeStyle = c; ctx.lineWidth = 0.06; ctx.strokeRect(x + 0.03, y + 0.03, w - 0.06, h - 0.06); ctx.globalAlpha = 1;
    this.areaName(a);
  }
  /** An area's name, where it was asked to be: in a corner, or over or under it. */
  protected areaName(a: { x: number; y: number; w: number; h: number; name: string; color: string; label?: AreaLabel }): void {
    const { x, y, w, h } = a, at = a.label ?? 'bl', right = at === 'tr' || at === 'br';
    const wy = at === 'tl' || at === 'tr' ? y + 0.38 : at === 'above' ? y - 0.32 : at === 'below' ? y + h + 0.32 : y + h - 0.38;
    this.label(a.name.toUpperCase(), right ? x + w - 0.25 : x + (at === 'above' || at === 'below' ? 0.05 : 0.25), wy, 0.3, a.color, { mono: true, weight: 700, align: right ? 'right' : 'left', min: 9, max: 16, spacing: 0.08, fit: w - 0.4 });
  }

  /** The box a machine is seen in: its tiles, for a flat skin; with its front face and its top lifted, seen from three quarters. */
  protected seen(m: MachineSpec): { x: number; y: number; w: number; h: number } { return m; }

  protected overlay(st: ViewState, S: Scene, pal: Palette): void {
    const ctx = this.ctx, outline = (m: MachineSpec, color: string, lw: number) => { const b = this.seen(m); ctx.strokeStyle = color; ctx.lineWidth = lw; rr(ctx, b.x - 0.04, b.y - 0.04, b.w + 0.08, b.h + 0.08, m.w > 1 ? 0.32 : 0.2); ctx.stroke(); };
    const hov = this.machine(st.hoverMachine), sel = this.machine(st.selMachine);
    if (hov && hov.id !== sel?.id) outline(hov, pal.text3, 0.05);
    for (const id of st.selMany) { const m = this.machine(id); if (m) outline(m, pal.accent, 0.08); }
    if (st.marquee) {
      const q = st.marquee, mx = Math.min(q.x0, q.x1), my = Math.min(q.y0, q.y1);
      ctx.fillStyle = 'rgba(96,165,250,0.12)'; ctx.strokeStyle = PICK; ctx.lineWidth = 0.05; ctx.setLineDash([0.2, 0.14]);
      ctx.fillRect(mx, my, Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0)); ctx.strokeRect(mx, my, Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0)); ctx.setLineDash([]);
    }
    /* an area selected shows its own frame and handles (build mode, below) */
    if (sel && sel.kind !== 'area') {
      outline(sel, pal.text, 0.08);
      /* what feeds the selected machine, and what empties it */
      for (const n of S.feeders) outline(n, pal.ok, 0.07);
      for (const a of S.emptiers) outline(a, '#fb923c', 0.07);
    }
    /* in build mode, an arm that is selected or about to be placed says where it takes from and where it drops */
    for (const w of S.ways) this.armWay(w, pal);
    /* build mode: the area selected, with its handles; the one being drawn, moved or resized */
    if (st.edit) {
      const sa = st.areaSel ? this.machine(st.areaSel) : null, hs = Math.max(0.16, 7 / this.cam.z);
      if (sa?.kind === 'area') {
        ctx.strokeStyle = pal.accent; ctx.lineWidth = 0.07; ctx.setLineDash([0.22, 0.14]); ctx.strokeRect(sa.x, sa.y, sa.w, sa.h); ctx.setLineDash([]);
        for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]] as const) {
          const px = sa.x + sa.w * hx, py = sa.y + sa.h * hy;
          ctx.fillStyle = pal.light ? '#ffffff' : '#09090b'; ctx.fillRect(px - hs / 2, py - hs / 2, hs, hs); ctx.lineWidth = 0.05; ctx.strokeRect(px - hs / 2, py - hs / 2, hs, hs);
        }
      }
      const ag = st.areaGhost;
      if (ag) {
        ctx.fillStyle = ag.ok ? 'rgba(96,165,250,0.16)' : 'rgba(239,68,68,0.2)'; ctx.fillRect(ag.x, ag.y, ag.w, ag.h);
        ctx.strokeStyle = ag.ok ? PICK : pal.danger; ctx.lineWidth = 0.07; ctx.setLineDash([0.22, 0.14]); ctx.strokeRect(ag.x, ag.y, ag.w, ag.h); ctx.setLineDash([]);
        this.label(`${ag.w} × ${ag.h}`, ag.x + ag.w / 2, ag.y - 0.35, 0.28, pal.text, { align: 'center', mono: true, weight: 700, plate: ag.ok ? 'rgba(30,64,120,0.95)' : 'rgba(127,29,29,0.95)', min: 10, max: 13 });
      }
    }
    const g = st.ghost;
    if (g) {
      for (const c of g.cells) {
        ctx.fillStyle = g.erase || !g.ok ? 'rgba(239,68,68,0.28)' : 'rgba(96,165,250,0.26)'; ctx.strokeStyle = g.erase || !g.ok ? pal.danger : '#60a5fa'; ctx.lineWidth = 0.06;
        rr(ctx, c.x + 0.05, c.y + 0.05, c.w - 0.1, c.h - 0.1, 0.18); ctx.fill(); ctx.stroke();
        if (c.dir != null) {
          const cx = c.x + c.w / 2, cy = c.y + c.h / 2, dx = DX[c.dir as 0], dy = DY[c.dir as 0];
          ctx.strokeStyle = pal.text; ctx.lineWidth = 0.08; ctx.lineCap = 'round'; ctx.beginPath();
          ctx.moveTo(cx - dx * 0.26, cy - dy * 0.26); ctx.lineTo(cx + dx * 0.22, cy + dy * 0.22);
          ctx.moveTo(cx + dx * 0.02 - dy * 0.18, cy + dy * 0.02 - dx * 0.18); ctx.lineTo(cx + dx * 0.24, cy + dy * 0.24); ctx.lineTo(cx + dx * 0.02 + dy * 0.18, cy + dy * 0.02 + dx * 0.18); ctx.stroke(); ctx.lineCap = 'butt';
        }
      }
      const first = g.cells[0];
      if (g.text && first) this.label(g.text, first.x + first.w / 2, first.y - 0.4, 0.3, pal.text, { align: 'center', plate: g.ok ? 'rgba(30,64,120,0.95)' : 'rgba(127,29,29,0.95)', min: 10, max: 13 });
    }
    const dr = st.drag;
    if (dr) {
      const box = S.dropBox!;
      ctx.strokeStyle = dr.ok ? pal.ok : pal.warn; ctx.lineWidth = 0.09; ctx.setLineDash(dr.ok ? [] : [0.16, 0.12]);
      rr(ctx, box.x + 0.03, box.y + 0.03, box.w - 0.06, box.h - 0.06, 0.2); ctx.stroke(); ctx.setLineDash([]);
      const t = st.tickets.find((q) => q.ticketId === dr.ticketId);
      /* what is being carried: the ticket's own token, a little larger than on the floor */
      const held = t?.info?.type ?? '', sprite = tokenSprite(held, TYPE_COLORS[held] ?? NO_TYPE, 0.7 * this.cam.z * this.dpr);
      if (sprite) { const w = sprite.width / (this.cam.z * this.dpr); ctx.drawImage(sprite, dr.x - w / 2, dr.y - w / 2, w, w); }
      else { rr(ctx, dr.x - 0.3, dr.y - 0.3, 0.6, 0.6, 0.13); ctx.fillStyle = TYPE_COLORS[held] ?? NO_TYPE; ctx.fill(); }
      this.label(dr.text, dr.x, dr.y - 0.75, 0.3, pal.text, { align: 'center', plate: dr.ok ? 'rgba(20,83,45,0.95)' : 'rgba(120,53,15,0.95)', min: 10, max: 13 });
    }
  }

  /**
   * Where an arm on that tile, pointing that way, takes from and drops on: the tile behind it in the frame's blue,
   * dashed, the tile in front of it in green, each with its name. So an arm is not put down the wrong way round.
   */
  protected armWay(w: ArmWay, pal: Palette, wordsOnly = false): void {
    const ctx = this.ctx, { x, y, dir, turn, idle, shut, takes, drops } = w, dx = DX[dir as 0], dy = DY[dir as 0];
    const tile = (tx: number, ty: number, color: string, dashed: boolean) => {
      ctx.fillStyle = color; ctx.globalAlpha = 0.16; rr(ctx, tx + 0.06, ty + 0.06, 0.88, 0.88, 0.16); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 0.06; if (dashed) ctx.setLineDash([0.14, 0.1]); ctx.stroke(); ctx.setLineDash([]);
    };
    const sx = x - dx, sy = y - dy, tx = x + dx, ty = y + dy, red = 'rgba(69,10,10,0.95)', pink = '#fecaca';
    if (!wordsOnly) { tile(sx, sy, idle ? pal.danger : PICK, true); tile(tx, ty, shut ? pal.danger : pal.ok, false); }
    const o = { mono: true, weight: 700, min: 9, max: 11 } as const;
    const blue = { ...o, plate: idle ? red : 'rgba(23,37,84,0.95)' }, green = { ...o, plate: shut ? red : 'rgba(5,46,22,0.95)' };
    if (dy === 0) {
      /* side by side over the arm, each on its own side of it */
      this.label(takes, x + 0.5 - dx * 0.1, y - 0.34, 0.22, idle ? pink : '#bfdbfe', { ...blue, align: dx > 0 ? 'right' : 'left' });
      this.label(drops, x + 0.5 + dx * 0.1, y - 0.34, 0.22, shut ? pink : '#bbf7d0', { ...green, align: dx > 0 ? 'left' : 'right' });
      if (turn) this.label('right click · turn', x + 0.5, y + 1.34, 0.2, pal.text2, { ...o, align: 'center', plate: 'rgba(9,9,11,0.84)' });
    } else {
      /* one above the other, to the right of the tiles they name */
      this.label(takes, x + 1.16, sy + 0.5, 0.22, idle ? pink : '#bfdbfe', blue);
      this.label(drops, x + 1.16, ty + 0.5, 0.22, shut ? pink : '#bbf7d0', green);
      if (turn) this.label('right click · turn', x - 0.16, y + 0.5, 0.2, pal.text2, { ...o, align: 'right', plate: 'rgba(9,9,11,0.84)' });
    }
  }


  // ---------- minimap ----------
  minimap(c: CanvasRenderingContext2D, frame: MiniFrame, st: ViewState, scene: SceneLookup, on: Surface): void {
    this.on = on;
    const { w, h, dpr: d, s, ox, oy, floor: F } = frame, L = st.layout, pal = this.palette();
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
    const step = MAJOR * s;
    if (step >= 6) {
      c.strokeStyle = pal.light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)'; c.lineWidth = 1; c.beginPath();
      for (let x = ((ox % step) + step) % step; x < w; x += step) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
      for (let y = ((oy % step) + step) % step; y < h; y += step) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
      c.stroke();
    }
    c.fillStyle = pal.floor; c.fillRect(ox + F.x * s, oy + F.y * s, F.w * s, F.h * s);
    c.strokeStyle = pal.edge; c.lineWidth = 1; c.strokeRect(Math.round(ox + F.x * s) + 0.5, Math.round(oy + F.y * s) + 0.5, Math.round(F.w * s) - 1, Math.round(F.h * s) - 1);
    /* the areas, faint, under the machines */
    for (const a of L.machines) if (a.kind === 'area') { c.globalAlpha = st.lens ? 0.12 : 0.28; c.fillStyle = a.color; c.fillRect(ox + a.x * s, oy + a.y * s, a.w * s, a.h * s); }
    c.globalAlpha = 1;
    /* under a layer, a station or a zone takes the colour of its reading, and the rest goes grey */
    const lens = st.lens, heat = (id: string): string | null => { if (!lens) return null; const v = lens.values.get(id) ?? 0; if (!(lens.max > 0 && v > 0)) return null; return `hsl(${Math.round(52 - 52 * Math.sqrt(v / lens.max))}, 95%, 52%)`; };
    for (const m of L.machines) {
      if (m.kind === 'label' || m.kind === 'area') continue;
      const hot = lens && (m.kind === 'station' || m.kind === 'zone') ? heat(m.id) : null;
      c.globalAlpha = lens && !hot ? 0.45 : 1;
      c.fillStyle = hot ?? (lens ? pal.edge : m.kind === 'belt' && m.fast ? pal.fast : m.kind === 'belt' || m.kind === 'bridge' ? pal.edge : m.kind === 'arm' ? armColor(m, { plain: pal.text2, sorts: pal.text2 }) : m.kind === 'exit' ? pal.ok : m.kind === 'zone' ? (m.inbound ? pal.accent : pal.text3) : m.kind === 'teleporter' ? portColor(m, (id) => scene.machine(id) ?? undefined) : m.kind === 'desk' ? DESK_COLOR : m.kind === 'intake' ? SOURCE_COLORS[m.source] : m.exec === 'human_gate' ? pal.warn : kindOf(m) ? mix(KIND_LOOK[kindOf(m)!].hue, pal.body, 0.35) : pal.text2);
      c.fillRect(ox + m.x * s, oy + m.y * s, Math.max(1, m.w * s), Math.max(1, m.h * s));
    }
    c.globalAlpha = 1;
    for (const t of st.tickets) {
      const q = scene.shown.get(t.ticketId); if (!q) continue;
      if (st.dim?.has(t.ticketId)) { c.fillStyle = pal.text3; c.fillRect(ox + q.x * s - 0.5, oy + q.y * s - 0.5, 1.5, 1.5); continue; }
      const hot = !!humanCall(t) || t.phase === 'loose', big = hot || !!st.found?.has(t.ticketId) || t.info?.favorite === true;
      c.fillStyle = hot ? pal.warn : TYPE_COLORS[t.info?.type ?? ''] ?? '#8b949e';
      c.fillRect(ox + q.x * s - (big ? 2 : 1), oy + q.y * s - (big ? 2 : 1), big ? 4 : 2, big ? 4 : 2);
      if (st.found?.has(t.ticketId)) { c.strokeStyle = pal.text; c.lineWidth = 1; c.strokeRect(ox + q.x * s - 3.5, oy + q.y * s - 3.5, 7, 7); }
    }
    const hw = this.w / 2 / this.cam.z, hh = this.h / 2 / this.cam.z;
    c.strokeStyle = pal.text; c.lineWidth = 1; c.strokeRect(ox + (this.cam.x - hw) * s, oy + (this.cam.y - hh) * s, hw * 2 * s, hh * 2 * s);
  }}
