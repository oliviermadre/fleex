/**
 * The Factory floor, drawn on a canvas. World units are floor tiles; text is
 * drawn in screen space so it stays crisp. Surfaces take their colours from the
 * `--theme-*` variables, so the floor follows the active theme.
 */
import type { LensLayer } from './lens';
import { layoutNames, tie, type NamedTicket } from './nameTags';
import { armColor, armTag, isConditional, shortCondition } from './armRules';
import { armDue, armShown, easeSwing } from './armMotion';
import { bridgeFlow, type LaneFlow } from './bridges';
import { fadeIn, floorLook, MAJOR, mix, veil } from './floorLook';
import { follow, type Track, type TrackPos } from './ticketMotion';
import { BAR, bodyOf, CUT, inRect, KIND_LOOK, kindOf, lampOf, MACHINE_ICONS, machineParts, ROUND, SHOULDER, sortInto, STACK, type Lamp, type Rect, type RunKind } from './machineArt';
import { dispatch, entryOf, QUAY_ROOM, quayRect, quaySpot, reachOf, type Dispatch, type EdgePoint } from './quays';
import { arrivalOf, departuresOf, isArrival, isDeparture, isPort, portBad, portColor, portLine, portName, portState } from './teleport';
import { opText, plateLines } from './setOps';
import { scriptPlate, scriptSummary } from './script';
import { tokenSprite, type TokenLook } from './ticketToken';
import { DX, DY, humanCall, type ArmSpec, type BeltSpec, type FactoryLayout, type FactoryTicket, type MachineSpec, type StationSpec, type TeleporterSpec, type ZoneSpec } from './types';

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
  exitDays?: number;
}
/** What is under the pointer: a ticket, a machine, or the light of a machine (its switch). */
export type Hit = { ticketId: string } | { machineId: string } | { lamp: string } | null;

/** A ticket's colour on the floor: the hue Fleex gives its type everywhere else (see `TicketTypeBadge`). */
export const TYPE_COLORS: Record<string, string> = { build: '#4ade80', fix: '#f87171', review: '#facc15', ops: '#2dd4bf', lead: '#c084fc', think: '#60a5fa' };
const STAR = '#facc15';
/** A ticket with no type, and the ghost of one a filter leaves out. */
const NO_TYPE = '#8b949e', GHOST = '#71717a';
const PRIORITY_PIP: Record<string, string> = { urgent: '#ef4444', high: '#fb923c' };
const STATUS_COLORS: Record<string, string> = { backlog: '#71717a', todo: '#fb923c', doing: '#60a5fa', reviewing: '#c084fc', done: '#22c55e' };
/** The paint of a zone: the colour of the status it sets, lifted where that one is too dark to read on the floor; and the paint of a zone that sets none. */
const ZONE_PAINT: Record<string, string> = { backlog: '#a1a1aa', todo: '#fb923c', doing: '#60a5fa', reviewing: '#c084fc', done: '#22c55e' };
const PAINT = '#60a5fa';
/** What is left of a ticket's way after a second: when it is moved (it must not jump), and when it slides to its quay (it must be seen going). */
const SNAP = 0.0005, SLIDE = 0.03;
/** The colour of a Set gantry, and of everything that says what it does. */
const SET = '#f472b6';
/** A plate of several lines beside a machine: what it is set to do, readable from the floor. */
interface Board { lines: string[]; inks: string[]; wx: number; wy: number; side: 'above' | 'below' | 'right' | 'left'; col: string }
/** Seconds a ticket takes to fade once it is past an exit's frame. */
const FADE_S = 0.75;
/** Seconds a ticket is drawn jumping from a departure to its arrival. The engine moves it at once; this is for the eye. */
const JUMP_S = 0.6;
/** A ticket on its way from a departure to its arrival. */
interface Jump { id: string; type: string; from: TeleporterSpec; to: TeleporterSpec; age: number }
/** A ticket that has just left by an exit, drawn a moment longer: up to the frame as it was, then as an outline that fades. */
interface Leaving { type: string; from: { x: number; y: number }; edge: EdgePoint; exit: MachineSpec; age: number; travel: number }
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

interface Palette { bg: string; floor: string; grid: string; belt: string; edge: string; chev: string; /** Fast belts and fast lanes of bridges: their chevrons and their rails. */ fast: string; body: string; text: string; text2: string; text3: string; ok: string; warn: string; danger: string; accent: string }
type Label = [text: string, wx: number, wy: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; mono?: boolean; plate?: string; min?: number; max?: number; fit?: number; /** Room between letters, as a share of the letter's size: a word in capitals reads as a marking. */ spacing?: number; /** Pixels down from where it is anchored: lines of one plate keep their distance at any zoom. */ dy?: number }];

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Empty tiles kept around what is built, so there is always room to extend it. */
export const FLOOR_MARGIN = 8;
/**
 * The floor: what is built plus the margin, never smaller than a starting floor. Given the shape of the view
 * (`aspect`, its width over its height), it is widened or heightened to that shape, so that seen whole it fills the
 * view: the floor is the map, and nothing shows beyond it. Its sides stay on whole tiles.
 */
export function floorRect(layout: FactoryLayout, aspect = 0): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of layout.machines) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
  if (!layout.machines.length) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  x0 -= FLOOR_MARGIN; y0 -= FLOOR_MARGIN; x1 += FLOOR_MARGIN; y1 += FLOOR_MARGIN;
  const growX = Math.max(0, 40 - (x1 - x0)), growY = Math.max(0, 24 - (y1 - y0));
  let x = x0 - Math.floor(growX / 2), y = y0 - Math.floor(growY / 2), w = x1 - x0 + growX, h = y1 - y0 + growY;
  if (aspect > 0 && Number.isFinite(aspect)) {
    if (w / h < aspect) { const wide = Math.ceil(h * aspect), by = wide - w; x -= Math.floor(by / 2); w = wide; }
    else { const high = Math.ceil(w / aspect), by = high - h; y -= Math.floor(by / 2); h = high; }
  }
  return { x, y, w, h };
}
/** The closest and the farthest the floor is ever seen from, in pixels per tile. The farthest is also bounded by the floor: see `FactoryView.constrain`. */
const Z_MAX = 80, Z_MIN = 3;
/** Room kept around a box in the picture of its shadow, in tiles. */
const SHADOW_PAD = 1.2;
/** A ticket drawn on a belt or a bridge, and where on it. */
interface Riding { t: FactoryTicket; pos: TrackPos }
/** The colour of a frame being dragged, and of what it takes. */
const PICK = '#60a5fa';
/** The arrow painted under an arm, pointing east, round the middle of its tile: narrow where it takes, wide where it drops. */
const WAY: readonly (readonly [number, number])[] = [[-0.48, -0.19], [0.14, -0.26], [0.14, -0.42], [0.5, 0], [0.14, 0.42], [0.14, 0.26], [-0.48, 0.19]];
/** How fast chevrons run along a belt, and along a fast one, in tiles per second; and how far apart the two chevrons of a fast pair are. */
const CHEVRON_PACE = 0.6, CHEVRON_FAST = 1.2, CHEVRON_PAIR = 0.15;
export const isBox = (m: MachineSpec | null | undefined): boolean => !!m && (m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit');


export class FactoryView {
  cam = { x: 24, y: 15, z: 18 };
  w = 0; h = 0;
  private dpr = 1;
  private clock = 0;
  private labels: Label[] = [];
  private boards: Board[] = [];
  private pal: Palette | null = null;
  private palAt = 0;
  private gridFor: FactoryLayout | null = null;
  private grid = new Map<string, MachineSpec>();
  private byId = new Map<string, MachineSpec>();
  /** Where each ticket is drawn; eased towards where the server says it is. */
  private shown = new Map<string, { x: number; y: number }>();
  /** Arm id → the swing it is drawn at (0..1). */
  private armShown = new Map<string, number>();
  /** Ticket id → where it is drawn on the belts: it follows what the server says along them (see `ticketMotion.ts`). */
  private drawnOn = new Map<string, TrackPos>();
  /** Ticket id → the arm whose quay it was last sent to: it does not change quay while that arm still takes it. */
  private quayFor = new Map<string, string>();
  /** Ticket id → where it was at the last frame, to tell one that left by an exit from one that was taken back. */
  private lastOn = new Map<string, { m: string | null; fx: number; fy: number; type: string }>();
  /** Arm id → where its cup was drawn at the last frame. */
  private handAt = new Map<string, { x: number; y: number }>();
  private leaving: Leaving[] = [];
  private jumps: Jump[] = [];
  /** Machine id → the tickets it holds, at this frame. */
  private inside = new Map<string, FactoryTicket[]>();
  /** Where an arm points into an arrival, at this frame: a no-entry sign goes there, over the arm. */
  private noEntry: { x: number; y: number }[] = [];
  /** Belt id → the ticket its toll's arm is carrying, at this frame. */
  private tollCarry = new Map<string, FactoryTicket>();
  /** Exit id → tickets seen leaving by it since the counts were last given. */
  private passed = new Map<string, number>();
  private countsFrom: unknown = null;
  /** Tickets on the floor that are being worked on or reviewed: what a zone's limit is about. */
  private wip = 0;
  private readonly ctx: CanvasRenderingContext2D;
  /** The floor as last painted, and what it was painted for. */
  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey: unknown[] = [];
  private glowCache = new Map<string, HTMLCanvasElement>();
  private shadowCache = new Map<string, HTMLCanvasElement>();

  constructor(private readonly cv: HTMLCanvasElement) { this.ctx = cv.getContext('2d')!; }

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
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * factor, this.zMin, Z_MAX);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
  }
  /** Frame what is built, or the whole floor when it is empty or being edited. */
  fit(layout: FactoryLayout, whole: boolean): void {
    this.resize();
    const f = this.floorOf(layout), pad = whole || layout.machines.length === 0 ? 0 : FLOOR_MARGIN - 1.5;
    const x0 = f.x + pad, y0 = f.y + pad, x1 = f.x + f.w - pad, y1 = f.y + f.h - pad;
    const bw = x1 - x0, bh = y1 - y0;
    this.cam.z = clamp(Math.min(this.w / bw, this.h / bh), Z_MIN, 60);
    this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2;
    this.constrain(layout);
  }

  private palette(): Palette {
    const now = performance.now();
    if (this.pal && now - this.palAt < 2000) return this.pal;
    const cs = getComputedStyle(document.documentElement), v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    this.palAt = now;
    this.pal = {
      bg: v('--theme-bg-base', '#09090b'), floor: v('--theme-bg-surface', '#18181b'), grid: v('--theme-border', '#27272a'), belt: v('--theme-bg-overlay', '#27272a'),
      edge: v('--theme-border-input', '#3f3f46'), chev: v('--theme-text-muted', '#71717a'), fast: v('--tint-blue-solid', '#60a5fa'), body: v('--theme-bg-overlay', '#27272a'),
      text: v('--theme-text-primary', '#fafafa'), text2: v('--theme-text-secondary', '#a1a1aa'), text3: v('--theme-text-muted', '#71717a'),
      ok: v('--theme-success', '#22c55e'), warn: v('--theme-warning', '#eab308'), danger: v('--theme-danger', '#ef4444'), accent: v('--theme-accent', '#D77655'),
    };
    return this.pal;
  }

  private index(layout: FactoryLayout): void {
    if (this.gridFor === layout) return;
    this.gridFor = layout; this.grid = new Map(); this.byId = new Map();
    for (const m of layout.machines) {
      this.byId.set(m.id, m);
      if (m.kind === 'label') continue;
      for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) this.grid.set(`${i},${j}`, m);
    }
  }
  /**
   * Read the floor from this layout. The draw loop does it at every frame; whoever asks the view a question about a
   * layout it holds (the side panel) says so first, since the page gets a fresh copy of the layout at every poll.
   */
  use(layout: FactoryLayout): void { this.index(layout); }
  at(x: number, y: number): MachineSpec | null { return this.grid.get(`${x},${y}`) ?? null; }
  machine(id: string | null): MachineSpec | null { return id ? this.byId.get(id) ?? null : null; }
  /** Does this neighbour push tickets onto the tile at (x, y)? A bridge does, unless that tile is a belt pointing back at it. */
  private feeds(n: MachineSpec | null, x: number, y: number): boolean {
    if (!n) return false;
    if (n.kind === 'belt') return n.x + DX[n.dir] === x && n.y + DY[n.dir] === y;
    if (n.kind !== 'bridge') return false;
    const me = this.at(x, y);
    return !(me && me.kind === 'belt' && me.x + DX[me.dir] === n.x && me.y + DY[me.dir] === n.y);
  }
  /** A belt fed from one side only, and not from behind, is a bend: the direction its feeder travels in, or -1. */
  private bendOf(b: BeltSpec): number {
    let f = -1, n = 0;
    for (let s = 0; s < 4; s++) if (s !== b.dir && this.feeds(this.at(b.x + DX[s as 0], b.y + DY[s as 0]), b.x, b.y)) { n++; f = (s + 2) % 4; }
    return n === 1 && f !== b.dir ? f : -1;
  }
  takersOf(m: MachineSpec): ArmSpec[] {
    const out: ArmSpec[] = [];
    for (let x = m.x - 1; x <= m.x + m.w; x++) for (let y = m.y - 1; y <= m.y + m.h; y++) {
      const n = this.at(x, y);
      /* by id, never by object: the machine asked about may come from another copy of the same layout */
      if (n && n.kind === 'arm' && this.at(n.x - DX[n.dir], n.y - DY[n.dir])?.id === m.id && !out.some((q) => q.id === n.id)) out.push(n);
    }
    return out;
  }
  /** The first machine a belt leads to, following the belts as they point. */
  leadsTo(m: MachineSpec | null, dir = 0): MachineSpec | null {
    let guard = 0;
    while (m && (m.kind === 'belt' || m.kind === 'bridge') && guard++ < 5000) {
      if (m.kind === 'belt') dir = m.dir;
      m = this.at(m.x + DX[dir as 0], m.y + DY[dir as 0]);
    }
    return m && m.kind !== 'belt' && m.kind !== 'bridge' ? m : null;
  }

  private label(text: string, wx: number, wy: number, size: number, color: string, opts: Label[5] = {}): void { this.labels.push([text, wx, wy, size, color, opts]); }
  private flushLabels(): void {
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const l of this.labels) this.write(l);
    /* plates of several lines: one box as wide as its longest line, standing off the side of its machine it was given */
    const z = this.cam.z, px = clamp(0.22 * z, 9, 11), lh = px * 1.3, pad = px * 0.55;
    ctx.font = `700 ${px.toFixed(1)}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const b of this.boards) {
      const w = Math.max(...b.lines.map((l) => ctx.measureText(l).width)) + pad * 2, h = b.lines.length * lh + pad, sx = (b.wx - this.cam.x) * z + this.w / 2, sy = (b.wy - this.cam.y) * z + this.h / 2;
      const x0 = b.side === 'right' ? sx + 6 : b.side === 'left' ? sx - 6 - w : sx - w / 2, y0 = b.side === 'above' ? sy - 6 - h : b.side === 'below' ? sy + 6 : sy - h / 2;
      if (x0 > this.w || x0 + w < 0 || y0 > this.h || y0 + h < 0) continue;
      rr(ctx, x0, y0, w, h, 4); ctx.fillStyle = 'rgba(9,9,11,0.92)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = b.col; ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;
      b.lines.forEach((l, i) => { ctx.fillStyle = b.inks[i] ?? b.col; ctx.fillText(l, x0 + pad, y0 + pad / 2 + lh * (i + 0.5)); });
    }
    ctx.restore(); this.labels.length = 0; this.boards.length = 0;
  }
  /** Text painted on the floor itself, now, so that what is drawn after it goes over it: a stencil, not a label. */
  private stencil(text: string, wx: number, wy: number, size: number, color: string, alpha: number, opts: Label[5] = {}): void {
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = alpha;
    this.write([text, wx, wy, size, color, opts]);
    ctx.restore();
  }
  private write([raw, wx, wy, size, color, o]: Label): void {
    const ctx = this.ctx, z = this.cam.z;
    let px = size * z;
    if (px < 3.6) return;
    if (o.min) px = Math.max(px, o.min);
    if (o.max) px = Math.min(px, o.max);
    const sx = (wx - this.cam.x) * z + this.w / 2, sy = (wy - this.cam.y) * z + this.h / 2 + (o.dy ?? 0);
    if (sx < -300 || sx > this.w + 300 || sy < -40 || sy > this.h + 40) return;
    ctx.font = `${o.weight ?? 500} ${px.toFixed(1)}px ${o.mono ? MONO : SANS}`;
    ctx.textAlign = o.align ?? 'left'; ctx.textBaseline = 'middle';
    let text = raw;
    if (o.fit) { const room = o.fit * z; if (ctx.measureText(text).width > room) { while (text.length > 3 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1); text += '…'; } }
    if (o.plate) {
      const tw = ctx.measureText(text).width, pad = px * 0.45, ph = px * 1.5;
      const x0 = o.align === 'center' ? sx - tw / 2 - pad : o.align === 'right' ? sx - tw - pad : sx - pad;
      ctx.fillStyle = o.plate; rr(ctx, x0, sy - ph / 2, tw + pad * 2, ph, Math.min(4, ph / 3)); ctx.fill();
    }
    if (o.spacing) ctx.letterSpacing = `${(px * o.spacing).toFixed(2)}px`;
    ctx.fillStyle = color; ctx.fillText(text, sx, sy);
    if (o.spacing) ctx.letterSpacing = '0px';
  }

  private ticket(t: FactoryTicket, x: number, y: number, s: number, st: ViewState, mark: 'run' | 'human' | 'fail' | 'out' | 'wait' | '', dt: number, rate = SNAP): void {
    const ctx = this.ctx, pal = this.palette(), cur = this.shown.get(t.ticketId), dragging = st.drag?.ticketId === t.ticketId;
    /* ease towards where the server last said the ticket is, so a poll does not make it jump */
    const k = cur ? 1 - Math.pow(rate, dt) : 1, px = cur ? cur.x + (x - cur.x) * k : x, py = cur ? cur.y + (y - cur.y) * k : y;
    this.shown.set(t.ticketId, { x: px, y: py });
    const picked = !!st.pickTickets?.has(t.ticketId), selected = st.selTicket === t.ticketId || !!st.selTickets?.has(t.ticketId), dim = !!st.dim?.has(t.ticketId) && !selected && !picked && !dragging;
    const z = this.cam.z, info = t.info, type = info?.type ?? '', color = TYPE_COLORS[type] ?? NO_TYPE;
    /*
     * A ticket is a token in the shape of its type (see `ticketToken.ts`), a little larger than the square it replaces
     * since a shape has holes. Too small to be told apart, it is the plain square again.
     */
    const T = s * 1.16, shaped = T * z >= 10;
    const stamp = (look: TokenLook, tint: string, alpha: number): boolean => {
      const sprite = shaped ? tokenSprite(type, tint, T * z * this.dpr, look) : null;
      if (!sprite) return false;
      const w = sprite.width / (z * this.dpr);
      ctx.globalAlpha = alpha; ctx.drawImage(sprite, px - w / 2, py - w / 2, w, w); ctx.globalAlpha = 1;
      return true;
    };
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
    const blink = Math.floor(this.clock * 2.4) % 2 === 0;
    if (mark === 'run' && s * z > 6) {
      /* at work: an arc turning, around a token, inside a square */
      const a0 = this.clock * 4 + t.ticketId.length, r = token ? B * 0.6 : s * 0.24;
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(px, py, r, a0, a0 + (token ? 2.6 : 4.2));
      if (token) { ctx.strokeStyle = 'rgba(9,9,11,0.85)'; ctx.lineWidth = 0.085; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.045; ctx.stroke(); }
      else { ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = s * 0.15; ctx.stroke(); }
      ctx.lineCap = 'butt';
    }
    else if ((mark === 'human' || mark === 'fail') && !humanCall(t)) { ctx.strokeStyle = mark === 'fail' ? pal.danger : pal.warn; ctx.lineWidth = blink ? 0.1 : 0.05; rr(ctx, px - B / 2 - 0.06, py - B / 2 - 0.06, B + 0.12, B + 0.12, 0.13); ctx.stroke(); }
    else if (mark === 'out') { ctx.strokeStyle = pal.text2; ctx.lineWidth = 0.04; rr(ctx, px - B / 2 - 0.04, py - B / 2 - 0.04, B + 0.08, B + 0.08, 0.1); ctx.stroke(); }
    /* a ticket waiting for a human calls for attention wherever it is: a pulsing halo and a "?" (or "!" when the run failed) */
    const call = dragging ? null : humanCall(t);
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
    const found = !!st.found?.has(t.ticketId);
    if (info && !dragging) {
      /* its number, once there is room: inside a square, on a small plate under a token */
      if (!call && !token && s * z >= 26) this.label(String(info.displayId), px, py + s * 0.06, s * 0.36, 'rgba(0,0,0,0.78)', { align: 'center', weight: 700, mono: true });
      if (token && (B * z >= 34 || (st.numbers && B * z >= 13))) this.label(String(info.displayId), px, py + B * 0.52, B * 0.24, '#f4f4f5', { align: 'center', weight: 700, mono: true, plate: 'rgba(9,9,11,0.82)', min: 8 });
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
  private names(st: ViewState, pal: Palette): void {
    const all = st.allNames === true, z = this.cam.z;
    const items: NamedTicket[] = [], byId = new Map<string, FactoryTicket>();
    const sx = (wx: number) => (wx - this.cam.x) * z + this.w / 2, sy = (wy: number) => (wy - this.cam.y) * z + this.h / 2;
    for (const t of st.tickets) {
      const info = t.info;
      if (!info || st.drag?.ticketId === t.ticketId || st.dim?.has(t.ticketId)) continue;
      if (!all && !info.favorite && st.selTicket !== t.ticketId && !st.named?.has(t.ticketId)) continue;
      const m = this.machine(t.machineId), p = this.shown.get(t.ticketId) ?? { x: t.x + 0.5, y: t.y + 0.5 };
      byId.set(t.ticketId, t);
      items.push({
        id: t.ticketId, text: `#${info.displayId} ${info.title}`, x: sx(p.x), y: sy(p.y),
        box: m && (m.kind === 'station' || m.kind === 'zone') ? { id: m.id, rect: { x: sx(m.x), y: sy(m.y), w: m.w * z, h: m.h * z } } : undefined,
      });
    }
    if (!items.length) return;
    const ctx = this.ctx, LH = 15, PAD = 5;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `500 11px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const solid = st.layout.machines.filter((m) => m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit').map((m) => ({ x: sx(m.x), y: sy(m.y), w: m.w * z, h: m.h * z }));
    const boxes = layoutNames(items, { w: this.w, h: this.h }, (s) => ctx.measureText(s).width, { maxLines: all ? 8 : 6, maxWidth: 230, lineHeight: LH, pad: PAD, chip: 13, nearX: 120, nearY: 24, radius: Math.max(5, z * 0.26) }, solid);
    /* the lines that tie each box to what it names go under every box */
    ctx.strokeStyle = 'rgba(244,244,245,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const b of boxes) {
      const ends = b.points.length ? b.points.map((p) => tie(b, { x: p.x, y: p.y, w: 0, h: 0 })) : [tie(b, b.anchor)];
      for (const e of ends) { ctx.moveTo(e.x0, e.y0); ctx.lineTo(e.x1, e.y1); }
    }
    ctx.stroke();
    for (const b of boxes) {
      const hot = b.lines.some((l) => st.found?.has(l.id));
      rr(ctx, b.x, b.y, b.w, b.h, 5); ctx.fillStyle = 'rgba(9,9,11,0.92)'; ctx.fill();
      ctx.strokeStyle = hot ? pal.accent : 'rgba(244,244,245,0.18)'; ctx.lineWidth = 1; ctx.stroke();
      b.lines.forEach((l, i) => {
        const t = byId.get(l.id), y = b.y + PAD + i * LH + LH / 2, sel = st.selTicket === l.id;
        rr(ctx, b.x + PAD, y - 4, 8, 8, 2); ctx.fillStyle = TYPE_COLORS[t?.info?.type ?? ''] ?? '#8b949e'; ctx.fill();
        if (t?.info?.favorite) { ctx.fillStyle = STAR; ctx.beginPath(); ctx.arc(b.x + PAD + 8, y - 4, 2.2, 0, 6.3); ctx.fill(); }
        ctx.font = `${sel ? 700 : 500} 11px ${SANS}`; ctx.fillStyle = sel || st.found?.has(l.id) ? '#ffffff' : 'rgba(244,244,245,0.86)';
        ctx.fillText(l.text, b.x + PAD + 13, y + 0.5);
      });
      if (b.more > 0) { ctx.font = `500 11px ${SANS}`; ctx.fillStyle = 'rgba(244,244,245,0.55)'; ctx.fillText(`+${b.more} more`, b.x + PAD + 13, b.y + PAD + b.lines.length * LH + LH / 2 + 0.5); }
    }
    ctx.restore();
  }

  ticketPos(ticketId: string): { x: number; y: number } | null { return this.shown.get(ticketId) ?? null; }
  /** Where every ticket is drawn, for a frame to be laid over them. */
  ticketPlaces(): Iterable<[string, { x: number; y: number }]> { return this.shown; }
  /** Where a ticket's machine is on screen (the ticket itself, when it stands on no box), in the canvas's own pixels: what a card about the ticket sits beside. */
  anchorOf(ticketId: string, st: ViewState): { x: number; y: number; w: number; h: number } | null {
    const t = st.tickets.find((q) => q.ticketId === ticketId); if (!t) return null;
    const z = this.cam.z, sx = (wx: number) => (wx - this.cam.x) * z + this.w / 2, sy = (wy: number) => (wy - this.cam.y) * z + this.h / 2;
    this.index(st.layout);
    const m = this.machine(t.machineId);
    if (m && isBox(m)) return { x: sx(m.x), y: sy(m.y), w: m.w * z, h: m.h * z };
    const p = this.shown.get(ticketId);
    return p ? { x: sx(p.x - 0.7), y: sy(p.y - 0.7), w: 1.4 * z, h: 1.4 * z } : null;
  }

  draw(st: ViewState, dtReal: number): void {
    const ctx = this.ctx, pal = this.palette(), cam = this.cam, d = this.dpr, L = st.layout;
    /* stopped, the floor's own clock stands still: chevrons do not run, rings do not turn */
    const moving = st.halted ? 0 : dtReal;
    this.resize(); this.index(L); this.clock += moving;
    this.constrain(L);
    const z = cam.z;
    const inside = new Map<string, FactoryTicket[]>();
    for (const t of st.tickets) if (t.machineId) { const a = inside.get(t.machineId); if (a) a.push(t); else inside.set(t.machineId, [t]); }
    for (const a of inside.values()) a.sort((p, q) => p.since.localeCompare(q.since));
    this.inside = inside; this.noEntry.length = 0;
    this.floor(st, inside, pal);
    ctx.setTransform(z * d, 0, 0, z * d, (this.w / 2 - cam.x * z) * d, (this.h / 2 - cam.y * z) * d);
    this.shadows(st, pal);

    const live = new Set(st.tickets.map((t) => t.ticketId));
    if (st.exits !== this.countsFrom) { this.countsFrom = st.exits; this.passed.clear(); }
    for (const id of this.shown.keys()) if (!live.has(id)) { this.left(id, st); this.shown.delete(id); }
    for (const id of this.lastOn.keys()) if (!live.has(id)) { this.lastOn.delete(id); this.quayFor.delete(id); }
    this.wip = 0;
    this.jumps = this.jumps.filter((j) => { j.age += dtReal; return j.age < JUMP_S && live.has(j.id); });
    for (const t of st.tickets) {
      const was = this.lastOn.get(t.ticketId);
      if (was && was.m !== t.machineId) this.jumped(t, was.m);
      this.lastOn.set(t.ticketId, { m: t.machineId, fx: t.fx, fy: t.fy, type: t.info?.type ?? '' });
      if (t.info && (t.info.status === 'doing' || t.info.status === 'reviewing')) this.wip++;
    }

    const belts = L.machines.filter((m): m is BeltSpec => m.kind === 'belt');
    const bends = new Map<string, number>();
    for (const b of belts) { const f = this.bendOf(b); bends.set(b.id, f); this.beltBase(b, f, pal); }
    if (z >= 8) { ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const b of belts) this.beltChevrons(b, bends.get(b.id) ?? -1, pal); ctx.lineCap = 'butt'; }

    /*
     * Tickets on belts and bridges are drawn moving along them at the belts' pace, towards where the server last had
     * them: told as it is, twice a second, a ticket would stand, jump and stand again. So a ticket may be drawn on the
     * tile before the one the server has it on.
     */
    const track = this.track(st), onTrack = new Map<string, Riding[]>(), riding = new Set<string>();
    this.tollCarry.clear();
    for (const t of st.tickets) {
      const m = t.machineId ? this.byId.get(t.machineId) : null;
      if (!m || (m.kind !== 'belt' && m.kind !== 'bridge')) continue;
      /* what a toll rejected is in its arm, no longer on its belt */
      if (t.phase === 'arm') { this.tollCarry.set(m.id, t); continue; }
      const told: TrackPos = { id: m.id, p: t.p, fx: t.fx, fy: t.fy };
      let pos = follow(track, this.drawnOn.get(t.ticketId), told, moving);
      const tile = this.byId.get(pos.id);
      if (!tile || (tile.kind !== 'belt' && tile.kind !== 'bridge')) pos = told;
      this.drawnOn.set(t.ticketId, pos); riding.add(t.ticketId);
      const list = onTrack.get(pos.id); if (list) list.push({ t, pos }); else onTrack.set(pos.id, [{ t, pos }]);
    }
    for (const id of this.drawnOn.keys()) if (!riding.has(id)) this.drawnOn.delete(id);

    for (const m of L.machines) if (m.kind === 'bridge') this.bridge(m, onTrack.get(m.id) ?? [], st, pal, dtReal);
    for (const m of L.machines) {
      if (m.kind === 'label') this.label(m.text, m.x + 0.12, m.y + 0.5, 0.62, m.color || pal.text2, { weight: 700, min: 10, max: 24 });
      else if (m.kind === 'zone') this.zone(m, inside.get(m.id) ?? [], st, pal, dtReal);
      else if (m.kind === 'station') this.station(m, inside.get(m.id) ?? [], st, pal, dtReal);
      else if (m.kind === 'exit') this.exit(m, st, pal);
      else if (m.kind === 'teleporter') this.port(m, inside.get(m.id)?.[0] ?? null, st, pal, dtReal);
    }
    for (const b of belts) for (const { t, pos } of onTrack.get(b.id) ?? []) {
      const f = bends.get(b.id) ?? -1, cx = b.x + 0.5, cy = b.y + 0.5;
      let x: number, y: number;
      if (f >= 0 && pos.fx === DX[f as 0] && pos.fy === DY[f as 0]) {
        const ca = Math.cos(pos.p * Math.PI / 2), sa = Math.sin(pos.p * Math.PI / 2);
        x = cx - DX[f as 0] * 0.5 + DX[b.dir] * 0.5 + 0.5 * (DX[f as 0] * sa - DX[b.dir] * ca); y = cy - DY[f as 0] * 0.5 + DY[b.dir] * 0.5 + 0.5 * (DY[f as 0] * sa - DY[b.dir] * ca);
      } else if (pos.p < 0.5) { x = cx - pos.fx * (0.5 - pos.p); y = cy - pos.fy * (0.5 - pos.p); }
      else { x = cx + DX[b.dir] * (pos.p - 0.5); y = cy + DY[b.dir] * (pos.p - 0.5); }
      this.ticket(t, x, y, 0.46, st, '', dtReal);
    }
    /* gantries stand over their belt: a ticket goes under the beam */
    for (const b of belts) if (b.set !== undefined) this.gantry(b, onTrack.get(b.id) ?? [], st, pal);
    for (const t of st.tickets) if (!t.machineId || !this.byId.has(t.machineId)) {
      ctx.strokeStyle = pal.warn; ctx.lineWidth = 0.05; ctx.setLineDash([0.12, 0.1]); ctx.beginPath(); ctx.arc(t.x + 0.5, t.y + 0.5, 0.42, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      this.ticket(t, t.x + 0.5, t.y + 0.5, 0.5, st, '', dtReal);
    }
    for (const m of L.machines) if (m.kind === 'arm') this.arm(m, inside.get(m.id)?.[0] ?? null, st, pal, dtReal);
    for (const b of belts) if (b.toll) this.tollArm(b, this.tollCarry.get(b.id) ?? null, st, pal, dtReal);
    this.departures(pal, dtReal);
    this.portLinks(st, pal);

    if (st.lens) this.lens(st.lens, L, pal);
    this.overlay(st, pal);
    this.flushLabels();
    this.names(st, pal);
  }

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
  private floor(st: ViewState, inside: Map<string, FactoryTicket[]>, pal: Palette): void {
    const d = this.dpr, z = this.cam.z, L = st.layout;
    /* not in build mode, and not under a lens: there, colour is the lens's reading */
    const lit: [MachineSpec, Lamp][] = [];
    if (!st.edit && !st.lens) for (const m of L.machines) if (m.kind === 'station' && m.exec !== 'native') { const s = lampOf(m, inside.get(m.id) ?? []); if (s !== 'on') lit.push([m, s]); }
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
    let paint: string | CanvasGradient = pal.floor;
    if (!st.edit) {
      const cx = F.x + F.w / 2, cy = F.y + F.h / 2, g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(F.w, F.h) * 0.62);
      g.addColorStop(0, mix(pal.floor, '#ffffff', look.light)); g.addColorStop(0.6, pal.floor); g.addColorStop(1, mix(pal.floor, '#000000', look.dusk));
      paint = g;
    }
    rr(ctx, F.x - 0.5, F.y - 0.5, F.w + 1, F.h + 1, 0.7); ctx.fillStyle = paint; ctx.fill();
    ctx.strokeStyle = st.edit ? pal.accent : pal.grid; ctx.lineWidth = st.edit ? 0.08 : 0.05; ctx.stroke();

    if (st.edit) {
      if (st.grid !== false && z >= 6) {
        ctx.strokeStyle = pal.grid; ctx.globalAlpha = 0.9; ctx.lineWidth = 1 / z; ctx.beginPath();
        for (let i = 0; i <= F.w; i++) { ctx.moveTo(F.x + i, F.y); ctx.lineTo(F.x + i, F.y + F.h); }
        for (let i = 0; i <= F.h; i++) { ctx.moveTo(F.x, F.y + i); ctx.lineTo(F.x + F.w, F.y + i); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    } else {
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
      /* amber around a machine that needs someone, a dimmer red around one that is off; one that simply works throws no light */
      for (const [m, s] of lit) { const R = Math.max(m.w, m.h) * 1.25; ctx.globalAlpha = look.glow * (s === 'off' ? 0.7 : 1); ctx.drawImage(this.glowSprite(s === 'off' ? pal.danger : pal.warn), m.x + m.w / 2 - R, m.y + m.h / 2 - R, R * 2, R * 2); }
      ctx.globalAlpha = 1;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.drawImage(cv, 0, 0);
  }

  /** A machine that stands on the floor casts a shadow on it (not in build mode, which is a plain drawing). A picture made once per size, and stamped. */
  private shadows(st: ViewState, pal: Palette): void {
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
  private lens(layer: LensLayer, L: FactoryLayout, pal: Palette): void {
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
      this.label(text ?? '–', m.x + m.w / 2, m.y + m.h / 2 + 0.2, 0.44, text ? '#ffffff' : pal.text3, { align: 'center', weight: 700, mono: true, min: 9, max: 22, fit: m.w - 0.2 });
    }
  }

  private beltBase(b: BeltSpec, f: number, pal: Palette): void {
    const ctx = this.ctx, { x, y } = b, dx = DX[b.dir], dy = DY[b.dir];
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
      for (let s = 0; s < 4; s++) {
        const n = this.at(x + DX[s as 0], y + DY[s as 0]);
        if (s === b.dir ? !!n && (n.kind === 'belt' || n.kind === 'bridge' || isBox(n) || isDeparture(n)) : this.feeds(n, x, y)) continue;
        if (s === 0) { ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); } else if (s === 2) { ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); }
        else if (s === 1) { ctx.moveTo(x, y + 0.955); ctx.lineTo(x + 1, y + 0.955); } else { ctx.moveTo(x, y + 0.045); ctx.lineTo(x + 1, y + 0.045); }
      }
      ctx.stroke();
    }
    /* a belt that leads nowhere says so */
    const n = this.at(x + dx, y + dy);
    if (!(n && (n.kind === 'belt' || n.kind === 'bridge' || isBox(n) || isDeparture(n))) && !this.takersOf(b).length) {
      ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.12; ctx.beginPath();
      ctx.moveTo(x + 0.5 + dx * 0.42 - dy * 0.4, y + 0.5 + dy * 0.42 - dx * 0.4); ctx.lineTo(x + 0.5 + dx * 0.42 + dy * 0.4, y + 0.5 + dy * 0.42 + dx * 0.4); ctx.stroke();
    }
  }

  /**
   * The chevrons that run along a belt. A fast belt says it is one three ways: its chevrons come in pairs, in the fast
   * colour, and they run twice as fast.
   */
  private beltChevrons(b: BeltSpec, f: number, pal: Palette): void {
    const ctx = this.ctx, dx = DX[b.dir], dy = DY[b.dir], fx = f >= 0 ? DX[f as 0] : 0, fy = f >= 0 ? DY[f as 0] : 0;
    const px = b.x + 0.5 - fx * 0.5 + dx * 0.5, py = b.y + 0.5 - fy * 0.5 + dy * 0.5, off = (this.clock * (b.fast ? CHEVRON_FAST : CHEVRON_PACE)) % 0.5;
    ctx.strokeStyle = b.fast ? pal.fast : pal.chev;
    const one = (u: number) => {
      let cx: number, cy: number, tx: number = dx, ty: number = dy;
      if (f >= 0) { const ca = Math.cos(u * Math.PI / 2), sa = Math.sin(u * Math.PI / 2); cx = px + 0.5 * (fx * sa - dx * ca); cy = py + 0.5 * (fy * sa - dy * ca); tx = dx * sa + fx * ca; ty = dy * sa + fy * ca; }
      else { cx = b.x + 0.5 + dx * (u - 0.5); cy = b.y + 0.5 + dy * (u - 0.5); }
      ctx.beginPath(); ctx.moveTo(cx - tx * 0.09 + ty * 0.19, cy - ty * 0.09 - tx * 0.19); ctx.lineTo(cx + tx * 0.09, cy + ty * 0.09); ctx.lineTo(cx - tx * 0.09 - ty * 0.19, cy - ty * 0.09 + tx * 0.19); ctx.stroke();
    };
    /* where a line starts, nothing comes in from behind: the half of a pair that would be drawn before the tile is left out */
    const fed = f >= 0 || (() => { const n = this.at(b.x - dx, b.y - dy); return !!n && (n.kind === 'bridge' || this.feeds(n, b.x, b.y)); })();
    for (let k = 0; k < 2; k++) {
      const u = off + k * 0.5;
      if (!b.fast) { one(u); continue; }
      if (fed || u - CHEVRON_PAIR / 2 >= 0) one(u - CHEVRON_PAIR / 2);
      one(u + CHEVRON_PAIR / 2);
    }
  }

  /** The side of a tile a plate can stand on without covering what is next to it: the sides across the belt first. */
  private freeSide(x: number, y: number, across: boolean): Board['side'] {
    const order: Board['side'][] = across ? ['above', 'below', 'right', 'left'] : ['right', 'left', 'above', 'below'];
    const free = (s: Board['side']) => !this.at(x + (s === 'right' ? 1 : s === 'left' ? -1 : 0), y + (s === 'below' ? 1 : s === 'above' ? -1 : 0));
    return order.find(free) ?? order[0]!;
  }
  /**
   * A Set gantry: two posts either side of the belt and a beam across it. A ticket goes under the beam, stops there
   * the time it takes to write what the gantry changes, and goes on. What the gantry does is written on a plate
   * beside it, one operation a line, so its setting is read from the floor; red when it could not write.
   */
  private gantry(b: BeltSpec, riding: Riding[], st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { x, y } = b, across = b.dir % 2 === 0;
    const under = riding.some((r) => Math.abs(r.pos.p - 0.5) < 0.18), failed = riding.some((r) => !!r.t.note), col = failed ? pal.danger : SET;
    /* laid out for a belt that runs east-west; turned a quarter for one that runs north-south */
    const box = (rx: number, ry: number, rw: number, rh: number, r: number) => { if (across) rr(ctx, x + rx, y + ry, rw, rh, r); else rr(ctx, x + ry, y + rx, rh, rw, r); };
    ctx.strokeStyle = col; ctx.lineWidth = 0.045;
    for (const off of [-0.11, 0.89]) { box(0.09, off, 0.82, 0.22, 0.07); ctx.fillStyle = pal.body; ctx.fill(); ctx.stroke(); }
    box(0.365, -0.07, 0.27, 1.14, 0.09); ctx.fillStyle = col; ctx.globalAlpha = under ? 0.85 : 0.32; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 0.035; ctx.stroke();
    const asked = st.selMachine === b.id || st.hoverMachine === b.id;
    if (this.cam.z < 13 && !asked) return;
    const ops = b.set ?? [], rejects = (b.toll?.when ?? []).map((c) => `reject: ${shortCondition(c, st.boardName)}`);
    const set = ops.length ? plateLines(ops.map((o) => opText(o, st.boardName)), asked ? 12 : 4) : b.toll ? [] : ['nothing set yet'];
    /* a toll says what it rejects under what it sets, in the colour of its arm */
    const lines = [...set, ...(b.toll ? (rejects.length ? plateLines(rejects, asked ? 8 : 3) : ['rejects nothing yet']) : [])];
    /* the plate keeps clear of the side the toll's arm works on */
    let side = this.freeSide(b.x, b.y, across);
    if (b.toll && side === (['right', 'below', 'left', 'above'] as const)[b.toll.out]) side = (['left', 'above', 'right', 'below'] as const)[b.toll.out];
    this.boards.push({ lines, inks: lines.map((l, i) => (l.endsWith(' yet') || l.endsWith(' more') ? pal.text3 : i >= set.length ? pal.danger : col)), col, side, wx: x + (side === 'right' ? 1 : side === 'left' ? 0 : 0.5), wy: y + (side === 'below' ? 1.1 : side === 'above' ? -0.1 : 0.5) });
  }

  /**
   * The arm of a toll: a short red arm on the edge of its belt, on the side it rejects to. It takes what the toll
   * rejects from the middle of the belt to the middle of the next tile, swinging by the way the belt runs, so it
   * does not cross what is coming.
   */
  private tollArm(b: BeltSpec, carried: FactoryTicket | null, st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, out = b.toll!.out, ox = DX[out], oy = DY[out], ex = b.x + 0.5 + ox * 0.5, ey = b.y + 0.5 + oy * 0.5;
    const swing = (st.armSwing || 1.1) * 0.6, p = armShown(this.armShown.get(b.id), armDue(st.arms.get(b.id), st.armAge ?? 0, swing), dt, swing);
    this.armShown.set(b.id, p);
    const way = oy === DX[b.dir] && -ox === DY[b.dir] ? 1 : -1, th = Math.atan2(-oy, -ox) + way * Math.PI * easeSwing(p), hx = ex + Math.cos(th) * 0.5, hy = ey + Math.sin(th) * 0.5;
    const col = pal.danger, steel = mix(pal.body, pal.text2, 0.38), link = (dx: number, dy: number) => { ctx.beginPath(); ctx.moveTo(ex + dx, ey + dy); ctx.lineTo(hx + dx, hy + dy); ctx.stroke(); };
    ctx.lineCap = 'round';
    if (!st.edit) { ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.22; link(0.05, 0.08); }
    const hand = this.handAt.get(b.id);
    this.handAt.set(b.id, { x: hx, y: hy });
    if (carried) {
      const cur = this.shown.get(carried.ticketId);
      if (cur && hand) this.shown.set(carried.ticketId, { x: cur.x + hx - hand.x, y: cur.y + hy - hand.y });
      ctx.lineCap = 'butt'; this.ticket(carried, hx, hy, 0.4, st, '', dt); ctx.lineCap = 'round';
    }
    ctx.strokeStyle = steel; ctx.lineWidth = 0.2; link(0, 0);
    ctx.strokeStyle = col; ctx.lineWidth = 0.06; link(0, 0);
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(hx, hy, 0.15, 0, 6.3); ctx.fillStyle = 'rgba(24,24,27,0.3)'; ctx.fill(); ctx.strokeStyle = pal.text; ctx.lineWidth = 0.045; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey, 0.17, 0, 6.3); ctx.fillStyle = pal.body; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.055; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey, 0.06, 0, 6.3); ctx.fillStyle = steel; ctx.fill();
  }

  /** The belts and bridges as a track a ticket is drawn along: which tile follows which, and how fast each carries. */
  private track(st: ViewState): Track {
    const base = st.beltSpeed || 1.2, times = st.fastBelt || 2;
    return {
      next: (at) => {
        const m = this.byId.get(at.id);
        if (!m) return null;
        const dx = m.kind === 'belt' ? DX[m.dir] : at.fx, dy = m.kind === 'belt' ? DY[m.dir] : at.fy, n = this.at(m.x + dx, m.y + dy);
        return n && (n.kind === 'belt' || n.kind === 'bridge') ? { id: n.id, fx: dx, fy: dy } : null;
      },
      pace: (at) => {
        const m = this.byId.get(at.id);
        if (m?.kind === 'belt') return base * (m.fast ? times : 1);
        if (m?.kind === 'bridge') { const f = bridgeFlow((px, py) => this.at(px, py), m); return base * ((at.fx !== 0 ? f.overFast : f.underFast) ? times : 1); }
        return base;
      },
    };
  }

  /** Two belts crossing: the north-south one passes under, the east-west one over it. */
  private bridge(m: MachineSpec, tickets: Riding[], st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y } = m;
    /*
     * A bridge has no direction and no speed of its own: each lane is drawn the way the belts that feed it send
     * tickets across, and as fast as they do. A fast lane looks like a fast belt (paired chevrons in the fast colour,
     * running twice as fast, coloured rails), whichever lane it is, and the other lane keeps its own look.
     */
    const flow = bridgeFlow((px, py) => this.at(px, py), m);
    const rail = (fast: boolean, plain: string) => (fast ? mix(pal.fast, pal.belt, 0.35) : plain);
    ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
    const lane = (f: LaneFlow, horizontal: boolean, fast: boolean) => {
      const cx0 = x + 0.5, cy0 = y + 0.5, off = (this.clock * (fast ? CHEVRON_FAST : CHEVRON_PACE)) % 0.5;
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
    const draw = ({ t, pos }: Riding) => this.ticket(t, x + 0.5 + pos.fx * (pos.p - 0.5), y + 0.5 + pos.fy * (pos.p - 0.5), 0.46, st, '', dt);
    /* under: the north-south lane, between its two rails */
    ctx.strokeStyle = rail(flow.underFast, pal.edge); ctx.lineWidth = 0.09; ctx.beginPath(); ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); ctx.stroke();
    if (this.cam.z >= 8) lane(flow.under, false, flow.underFast);
    for (const r of tickets) if (r.pos.fx === 0) draw(r);
    /* over: the deck of the east-west lane, with a shadow on the lane below */
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + 0.1, 1, 0.8);
    ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y + 0.16, 1.02, 0.68);
    ctx.strokeStyle = rail(flow.overFast, pal.text3); ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo(x, y + 0.16); ctx.lineTo(x + 1, y + 0.16); ctx.moveTo(x, y + 0.84); ctx.lineTo(x + 1, y + 0.84); ctx.stroke();
    if (this.cam.z >= 8) lane(flow.over, true, flow.overFast);
    for (const r of tickets) if (r.pos.fx !== 0) draw(r);
  }

  /**
   * An arm: a base on its tile, a flat link, and a suction cup that holds the ticket. Under it, painted on its tile,
   * an arrow in its colour says which way it works: narrow where it takes, wide where it drops, its head at the edge.
   * It is there when the arm is at rest or turned the other way, which is when one needs it.
   */
  private arm(a: ArmSpec, carried: FactoryTicket | null, st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, bx = a.x + 0.5, by = a.y + 0.5, dx = DX[a.dir], dy = DY[a.dir];
    /*
     * The half turn is drawn here, not sampled from the server: see `armMotion.ts`.
     */
    const swing = st.armSwing || 1.1, p = armShown(this.armShown.get(a.id), armDue(st.arms.get(a.id), st.armAge ?? 0, swing), dt, swing);
    this.armShown.set(a.id, p);
    const e = easeSwing(p), src = this.at(a.x - dx, a.y - dy), dst = this.at(a.x + dx, a.y + dy), R = reachOf(src, dst);
    /*
     * The cup goes where the ticket is: over the middle of a belt's tile, over its quay on the edge of a station or a
     * zone (see `quays.ts`). So its reach changes while it turns, and it lifts what it is on.
     */
    const th = Math.atan2(dy, dx) + Math.PI * (1 - e), reach = R.from + (R.to - R.from) * e, hx = bx + Math.cos(th) * reach, hy = by + Math.sin(th) * reach;
    const filtered = isConditional(a), col = armColor(a, { plain: pal.text2, sorts: pal.warn }), steel = mix(pal.body, pal.text2, 0.38);
    const link = (ox: number, oy: number) => { ctx.beginPath(); ctx.moveTo(bx + ox, by + oy); ctx.lineTo(hx + ox, hy + oy); ctx.stroke(); };
    this.wayMark(bx, by, dx, dy, col, st.edit ? 1 : 0.62);
    ctx.lineCap = 'round';
    if (!st.edit) { ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.31; link(0.06, 0.1); }
    /*
     * What it carries is held: it moves with the cup. Only what was between the two when it was lifted is closed in on,
     * so a ticket never trails behind the arm that turns.
     */
    const hand = this.handAt.get(a.id);
    this.handAt.set(a.id, { x: hx, y: hy });
    if (carried) {
      const cur = this.shown.get(carried.ticketId);
      if (cur && hand) this.shown.set(carried.ticketId, { x: cur.x + hx - hand.x, y: cur.y + hy - hand.y });
      ctx.lineCap = 'butt'; this.ticket(carried, hx, hy, 0.42, st, '', dt); ctx.lineCap = 'round';
    }
    ctx.strokeStyle = steel; ctx.lineWidth = 0.29; link(0, 0);
    ctx.strokeStyle = col; ctx.lineWidth = 0.08; link(0, 0);
    ctx.lineCap = 'butt';
    /* the cup: a ring, through which the ticket shows, the one it holds as the one that waits for it on the quay */
    ctx.beginPath(); ctx.arc(hx, hy, 0.2, 0, 6.3); ctx.fillStyle = 'rgba(24,24,27,0.3)'; ctx.fill(); ctx.strokeStyle = pal.text; ctx.lineWidth = 0.055; ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, 0.055, 0, 6.3); ctx.fillStyle = pal.text; ctx.fill();
    ctx.beginPath(); ctx.arc(bx, by, 0.25, 0, 6.3); ctx.fillStyle = pal.body; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.068; ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, 0.09, 0, 6.3); ctx.fillStyle = steel; ctx.fill();
    const tag = armTag(a, src ? this.takersOf(src) : [], st.boardName);
    const asked = st.selMachine === a.id || st.hoverMachine === a.id;
    if (!tag || (!asked && (st.armTags === false || this.cam.z < 11))) return;
    /*
     * What the arm takes is written past its head, on the side it drops on: on its own row for an arm that points
     * sideways, in its own column otherwise. Arms stacked against a station then each carry their own tag, where a
     * tag above the arm read as belonging to the one before.
     */
    /* the tag is in the arm's colour: a dark plate tinted with it, and the colour lightened for the ink */
    const o = { min: 9, max: 12, mono: true, plate: a.color ? mix('#09090b', col, 0.2) : filtered ? 'rgba(40,32,4,0.92)' : 'rgba(9,9,11,0.84)' }, ink = a.color ? mix(col, '#ffffff', 0.45) : filtered ? '#fde68a' : pal.text2;
    /* a teleporter is a tile a tag must not cover either: it has its ring and its own plate */
    const solid = (m: MachineSpec | null) => isBox(m) || isPort(m);
    if (solid(dst) && solid(src)) {
      /* squeezed between two machines, there is no room on its own line: beside it, as a last resort */
      if (dy === 0) this.label(tag, bx, a.y - 0.28, 0.3, ink, { ...o, align: 'center' });
      else this.label(tag, a.x + 1.14, by, 0.3, ink, { ...o, fit: 6 });
      return;
    }
    /* past the head, unless that is a machine: then behind the arm, over the belt it takes from */
    const fx = solid(dst) ? -dx : dx, fy = solid(dst) ? -dy : dy;
    if (fx > 0) this.label(tag, a.x + 1.12, by, 0.3, ink, { ...o, align: 'left', fit: 5 });
    else if (fx < 0) this.label(tag, a.x - 0.12, by, 0.3, ink, { ...o, align: 'right', fit: 5 });
    else this.label(tag, bx, fy > 0 ? a.y + 1.3 : a.y - 0.3, 0.3, ink, { ...o, align: 'center', fit: 2.6 });
  }

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

  /** Which arm takes each ticket that is ready to leave a box; a ticket keeps the quay it was sent to. */
  private leavers(m: MachineSpec, takers: ArmSpec[], tickets: FactoryTicket[], st: ViewState): Dispatch {
    const D = dispatch(m, takers, tickets, { keep: this.quayFor, busy: (id) => { const a = st.arms.get(id); return !!a && a.state !== 'rest'; } });
    for (const [ticketId, armId] of D.quay) this.quayFor.set(ticketId, armId);
    return D;
  }
  /**
   * The quay of each arm that takes from a box: a notch in its edge, in the arm's colour (a painted square on a
   * zone, which is paint itself), and the tickets on their way out, in line at the quay of the arm that will take
   * them. They slide there, slowly enough to be seen going.
   */
  private quays(takers: ArmSpec[], D: Dispatch, st: ViewState, pal: Palette, dt: number, painted: boolean): void {
    const ctx = this.ctx;
    for (const a of takers) {
      const q = quayRect(a), line = D.byArm.get(a.id) ?? [];
      rr(ctx, q.x, q.y, q.w, q.h, 0.11);
      if (painted) { ctx.globalAlpha = 0.75; ctx.setLineDash([0.09, 0.07]); } else { ctx.fillStyle = pal.floor; ctx.fill(); }
      ctx.strokeStyle = armColor(a, { plain: pal.text2, sorts: pal.warn }); ctx.lineWidth = 0.045; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      /* the last in line first: the one that leaves next is on top */
      for (let i = line.length - 1; i >= 0; i--) {
        const at = quaySpot(a, i);
        if (i < QUAY_ROOM) this.ticket(line[i]!, at.x, at.y, i ? 0.34 : 0.4, st, '', dt, SLIDE); else this.shown.set(line[i]!.ticketId, at);
      }
      if (line.length > QUAY_ROOM) { const at = quaySpot(a, QUAY_ROOM - 1); this.label(`+${line.length - QUAY_ROOM}`, at.x, at.y + 0.3, 0.2, pal.text2, { mono: true, align: 'center', plate: 'rgba(9,9,11,0.84)' }); }
    }
  }

  /**
   * A station as a machine (see `machineArt.ts`): head plate, light, places, a bay for what was set aside, and a quay
   * in front of each arm for what is done. A status station stays the small box it was: it holds nothing.
   */
  private station(m: StationSpec, tickets: FactoryTicket[], st: ViewState, pal: Palette, dt: number): void {
    if (m.exec === 'native') { this.statusStation(m, tickets, st, pal, dt); return; }
    const ctx = this.ctx, z = this.cam.z, { x, y, w, h } = m, gate = m.exec === 'human_gate', takers = this.takersOf(m), D = this.leavers(m, takers, tickets, st);
    const P = machineParts(m, D.stuck.length > 0), S = sortInto(m, tickets), L = lampOf(m, tickets);
    /* a question an arm takes is on its way out: it stands at that arm's quay, not in the bay */
    const aside = S.aside.filter((t) => !D.quay.has(t.ticketId));
    const kind = kindOf(m), look = kind ? KIND_LOOK[kind] : null, tint = look?.hue ?? pal.warn, tiny = (text: string, r: Rect, color = pal.text3) => this.label(text, r.x + 0.1, r.y + 0.17, 0.15, color, { weight: 700 });
    const pit = (r: Rect) => { rr(ctx, r.x, r.y, r.w, r.h, 0.14); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill(); ctx.lineWidth = 0.02; ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke(); };
    /* the body: a plate lit from above. A gate keeps its dashed amber edge; what runs something has its kind's shape and hue. */
    if (kind) this.behind(m, kind, tint, pal);
    this.trace(m);
    if (kind === 'script') ctx.fillStyle = mix(pal.body, '#000000', 0.55);
    else { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, mix(pal.body, '#ffffff', 0.09)); g.addColorStop(1, pal.body); ctx.fillStyle = g; }
    ctx.fill();
    ctx.lineWidth = gate ? 0.12 : 0.055; ctx.strokeStyle = tint;
    if (gate) ctx.setLineDash([0.3, 0.2]);
    ctx.stroke(); ctx.setLineDash([]);
    if (kind === 'script') {
      /* the title bar of a terminal window, with its three buttons */
      ctx.fillStyle = veil(tint, 0.22); ctx.fillRect(x + 0.1, y + 0.1, w - 0.2, BAR - 0.04);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + 0.3 + i * 0.2, y + 0.08 + BAR / 2, 0.055, 0, 6.3); ctx.fillStyle = veil(tint, 0.9 - i * 0.25); ctx.fill(); }
    }
    /* head plate: what it is (a full badge for what runs something, its word over the name), and its name */
    rr(ctx, P.badge.x, P.badge.y, P.badge.w, P.badge.h, 0.18);
    if (kind) { ctx.fillStyle = tint; ctx.fill(); } else { ctx.fillStyle = veil(tint, 0.16); ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = veil(tint, 0.55); ctx.stroke(); }
    if (P.badge.w * z >= 11) this.glyph(m.exec, P.badge.x + P.badge.w * 0.15, P.badge.y + P.badge.h * 0.15, P.badge.w * 0.7, kind ? '#09090b' : tint, kind ? 2.2 : 2);
    /* the word needs room to be read: seen from far, the head keeps its two lines and the shape and the hue say the kind */
    const fit = P.lamp.x - P.name.x - 0.1, worded = !!look && 0.17 * z >= 6;
    if (worded) this.label(look.word, P.name.x, P.name.y - 0.13, 0.17, tint, { mono: true, weight: 700, spacing: 0.16, fit });
    this.label(m.name || (gate ? 'Gate' : 'Station'), P.name.x, P.name.y + (worded ? 0.14 : 0), worded ? 0.31 : 0.33, pal.text, { weight: 650, min: 9, max: 17, fit });
    const what = gate ? 'you decide' : m.exec === 'script' ? scriptSummary(m.script) : m.ref || 'nothing chosen';
    this.label(worded ? what : `${gate ? 'gate' : m.exec} · ${what}`, P.name.x, P.name.y + (worded ? 0.44 : 0.36), worded ? 0.19 : 0.2, pal.text3, { fit });
    /* the light: red off, amber it needs someone, green it works. On a machine that runs something it is the switch. */
    rr(ctx, P.lamp.x, P.lamp.y, P.lamp.w, P.lamp.h, 0.12); ctx.fillStyle = '#0d0d10'; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = st.hoverLamp === m.id ? pal.text : pal.edge; ctx.stroke();
    P.lights.forEach((l, i) => {
      const on = (i === 0 && L === 'off') || (i === 1 && L === 'call') || (i === 2 && L === 'on'), col = i === 0 ? pal.danger : i === 1 ? pal.warn : pal.ok;
      if (on) { ctx.globalAlpha = 0.28 * (i === 1 ? 0.6 + 0.4 * Math.sin(this.clock * 4) ** 2 : 1); ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 2.3, 0, 6.3); ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, 6.3); ctx.fillStyle = on ? col : '#2a2a2f'; ctx.fill();
    });
    /* places, or what a gate decides on */
    if (gate) {
      pit(P.work); tiny(`TO DECIDE · ${S.deciding.length}`, P.work);
      const pitch = 0.8, cols = Math.max(1, Math.floor((P.work.w - 0.2) / pitch)), rows = Math.max(1, Math.floor((P.work.h - 0.36) / pitch)), n = cols * rows;
      S.deciding.forEach((t, i) => {
        if (i < n) this.ticket(t, P.work.x + 0.1 + pitch / 2 + (i % cols) * pitch, P.work.y + 0.34 + pitch / 2 + Math.floor(i / cols) * pitch, 0.44, st, 'human', dt);
        else this.shown.set(t.ticketId, { x: P.work.x + P.work.w - 0.3, y: P.work.y + P.work.h - 0.3 });
      });
      if (S.deciding.length > n) this.label(`+${S.deciding.length - n}`, P.work.x + P.work.w - 0.1, P.work.y + P.work.h - 0.2, 0.22, pal.text2, { mono: true, align: 'right' });
    } else {
      P.places.forEach((c, i) => {
        pit(c);
        const t = S.places[i], size = Math.min(c.w, c.h - 0.2) * 0.52, cx = c.x + c.w / 2, cy = c.y + c.h / 2 + 0.08;
        tiny(t ? (t.phase === 'running' ? 'RUNNING' : 'HELD') : 'FREE', c, t?.phase === 'running' ? pal.ok : pal.text3);
        if (!t && kind && c.w * z >= 38) this.idle(kind, cx, cy, size, c, tint);
        if (t) this.ticket(t, cx, cy, size, st, t.phase === 'running' ? 'run' : 'wait', dt);
      });
      S.extra.forEach((t) => this.shown.set(t.ticketId, { x: P.work.x + P.work.w - 0.3, y: P.work.y + 0.3 }));
      if (S.extra.length) this.label(`+${S.extra.length}`, P.work.x + P.work.w - 0.1, P.work.y + 0.2, 0.22, pal.text2, { mono: true, align: 'right', plate: 'rgba(9,9,11,0.84)' });
    }
    /* what is done and that no arm takes: it will not leave by itself, and says so in red */
    if (P.out) {
      const o = P.out;
      pit(o); ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.04; ctx.stroke(); tiny('NO ARM', o, pal.danger);
      const os = Math.min(0.42, o.w * 0.56), room = Math.max(1, Math.floor((o.h - 0.36) / (os + 0.12)));
      D.stuck.forEach((t, i) => { if (i < room) this.ticket(t, o.x + o.w / 2, o.y + 0.36 + os / 2 + i * (os + 0.12), os, st, 'fail', dt); else this.shown.set(t.ticketId, { x: o.x + o.w / 2, y: o.y + o.h - 0.2 }); });
      if (D.stuck.length > room) this.label(`+${D.stuck.length - room}`, o.x + o.w / 2, o.y + o.h - 0.16, 0.2, pal.text2, { mono: true, align: 'center' });
    }
    /* the bay: what was set aside. Hazard stripes on its edge, as a hold area has. */
    if (P.aside) {
      const a = P.aside, band = 0.42;
      pit(a);
      ctx.save(); rr(ctx, a.x, a.y, a.w, a.h, 0.14); ctx.clip(); ctx.beginPath(); ctx.rect(a.x, a.y, band, a.h); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(a.x, a.y, band, a.h);
      ctx.strokeStyle = veil(pal.warn, aside.length ? 0.75 : 0.35); ctx.lineWidth = 0.09; ctx.beginPath();
      for (let k = -a.h; k < band + a.h; k += 0.22) { ctx.moveTo(a.x + k, a.y + a.h); ctx.lineTo(a.x + k + a.h, a.y); }
      ctx.stroke(); ctx.restore();
      this.label('SET ASIDE', a.x + band + 0.1, a.y + 0.17, 0.15, veil(pal.warn, aside.length ? 0.9 : 0.45), { weight: 700 });
      /* the tickets stand to the right of the bay's name, apart enough for their signs not to cover one another */
      const as = Math.min(0.44, a.h * 0.56), step = as + 0.4, x0 = a.x + band + 1.2, fit = Math.max(1, Math.floor((a.x + a.w - 0.1 - x0) / step));
      aside.forEach((t, i) => { if (i < fit) this.ticket(t, x0 + as / 2 + i * step, a.y + a.h / 2, as, st, t.phase === 'failed' ? 'fail' : 'human', dt); else this.shown.set(t.ticketId, { x: a.x + a.w - 0.3, y: a.y + a.h / 2 }); });
      if (aside.length > fit) this.label(`+${aside.length - fit}`, a.x + a.w - 0.1, a.y + a.h / 2, 0.22, pal.text2, { mono: true, align: 'right' });
    }
    this.quays(takers, D, st, pal, dt, false);
    /* a script station says what it runs when it is pointed at: one line a command */
    if (m.exec === 'script' && (st.selMachine === m.id || st.hoverMachine === m.id)) {
      const lines = plateLines(scriptPlate(m.script), 9), col = tint;
      /* over the station, or under it when there is no room left above in the view */
      const above = (y - this.cam.y) * z + this.h / 2 > lines.length * 15 + 24;
      this.boards.push({ lines, inks: lines.map((l) => (l.startsWith('no command') || l.endsWith(' yet') ? pal.text3 : col)), col, side: above ? 'above' : 'below', wx: x + w / 2, wy: above ? y : y + h });
    }
    if (L === 'off') { ctx.globalAlpha = 0.28; this.trace(m); ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1; }
  }

  /** The outline of a machine's body, as a path: each kind that runs something has its own (see `machineArt.ts`). */
  private trace(m: StationSpec): void {
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
  private glyph(exec: string, x: number, y: number, side: number, color: string, lw: number): void {
    if (typeof Path2D === 'undefined') return;
    const ctx = this.ctx, k = side / 24;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const d of MACHINE_ICONS[exec as keyof typeof MACHINE_ICONS] ?? []) ctx.stroke(new Path2D(d));
    ctx.restore();
  }

  /**
   * A free place says what will work there, faintly: a robot's head (agent), a tool in its holder (skill), three
   * seats (panel), a prompt (script). A ticket that comes in covers it.
   */
  private idle(kind: RunKind, cx: number, cy: number, size: number, c: Rect, tint: string): void {
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
      rr(ctx, sx, sy, sw, sh, 0.05); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      this.label('$', sx + 0.1, sy + 0.2, 0.2, veil(tint, 0.8), { mono: true, weight: 700 });
      ctx.fillStyle = veil(tint, 0.7); ctx.fillRect(sx + 0.3, sy + 0.1, 0.07, 0.2);
      if (sh > 0.5) { ctx.fillStyle = veil(tint, 0.3); ctx.fillRect(sx + 0.1, sy + sh - 0.16, sw * 0.55, 0.05); }
    }
  }

  private statusStation(m: StationSpec, tickets: FactoryTicket[], st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y, w, h } = m, big = w >= 3, gate = false, nat = true;
    const takers = this.takersOf(m), D = this.leavers(m, takers, tickets, st);
    const waiting = tickets.filter((t) => t.phase !== 'out'), out = D.stuck;
    const state = tickets.length ? pal.ok : pal.text3;
    rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.28); ctx.fillStyle = pal.body; ctx.fill();
    ctx.lineWidth = gate ? 0.12 : 0.06; ctx.strokeStyle = gate ? pal.warn : nat ? pal.ok : pal.edge;
    if (gate) ctx.setLineDash([0.3, 0.2]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = state; rr(ctx, x + 0.42, y + 0.2, w - 0.84, 0.08, 0.04); ctx.fill();
    this.label(m.name || (gate ? 'Gate' : 'Station'), x + w / 2, y + (big ? 0.62 : 0.54), big ? 0.32 : 0.26, pal.text, { align: 'center', weight: 600, min: 8, max: 14, fit: w - 0.25 });
    const cols = big ? 4 : 3, rows = big ? 2 : 1, size = big ? 0.5 : 0.4, gap = big ? 0.1 : 0.09, n = cols * rows;
    const x0 = x + (w - cols * size - (cols - 1) * gap) / 2, y0 = y + (big ? 0.92 : 0.8);
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i % cols) * (size + gap), cy = y0 + Math.floor(i / cols) * (size + gap);
      rr(ctx, cx, cy, size, size, 0.08); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      const t = waiting[i];
      if (t) this.ticket(t, cx + size / 2, cy + size / 2, size * 0.86, st, t.phase === 'running' ? 'run' : t.phase === 'failed' ? 'fail' : t.phase === 'wait' ? 'wait' : 'human', dt);
    }
    for (let i = n; i < waiting.length; i++) this.shown.set(waiting[i]!.ticketId, { x: x + w / 2, y: y + h / 2 });
    if (waiting.length > n) this.label(`+${waiting.length - n}`, x + w - 0.3, y0 - 0.12, 0.24, pal.text2, { mono: true, align: 'right' });
    const ty = y + h - (big ? 0.86 : 0.64), th = big ? 0.56 : 0.44, ts = big ? 0.38 : 0.3, max = Math.floor((w - 0.7) / (ts + 0.08));
    /* what no arm takes stays here, in red; the rest is at the quay of its arm */
    if (out.length) { rr(ctx, x + 0.28, ty, w - 0.56, th, 0.1); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill(); ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.04; ctx.stroke(); }
    out.forEach((t, i) => { if (i < max) this.ticket(t, x + 0.4 + ts / 2 + i * (ts + 0.08), ty + th / 2, ts, st, 'fail', dt); else this.shown.set(t.ticketId, { x: x + w - 0.5, y: ty + th / 2 }); });
    this.quays(takers, D, st, pal, dt, false);
    if (tickets.length >= m.cap) this.label('full', x + w / 2, y + h + 0.26, 0.26, '#fdba74', { align: 'center', plate: 'rgba(9,9,11,0.84)', min: 9, max: 12 });
  }

  /**
   * A zone is paint on the floor: a faint fill, a dashed line round it, three corners. Everything it says is
   * stencilled: its name, a padlock (shut, nothing leaves without you; open with chevrons, it lets tickets out by
   * itself), how many tickets it holds as a large figure on the ground, and, where it stops releasing above a number
   * of tickets in work, that number as a line that fills.
   */
  private zone(m: ZoneSpec, tickets: FactoryTicket[], st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y, w, h } = m, auto = m.release === 'auto', c = m.inbound ? pal.accent : ZONE_PAINT[m.status ?? ''] ?? PAINT;
    const takers = this.takersOf(m), D = this.leavers(m, takers, tickets, st), held = tickets.filter((t) => !D.quay.has(t.ticketId)), stock = tickets.filter((t) => !t.released).length;
    ctx.fillStyle = c; ctx.globalAlpha = 0.055; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = c; ctx.globalAlpha = 0.45; ctx.lineWidth = 0.045; ctx.setLineDash([0.2, 0.16]); ctx.strokeRect(x + 0.035, y + 0.035, w - 0.07, h - 0.07); ctx.setLineDash([]);
    /* three corners: the fourth is the padlock's */
    ctx.globalAlpha = 1; ctx.lineWidth = 0.11; ctx.lineCap = 'square'; ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) { ctx.moveTo(cx + sx * 0.4, cy + sy * 0.055); ctx.lineTo(cx + sx * 0.055, cy + sy * 0.055); ctx.lineTo(cx + sx * 0.055, cy + sy * 0.4); }
    ctx.stroke(); ctx.lineCap = 'butt';
    this.label((m.name || 'Zone').toUpperCase(), x + 0.26, y + 0.42, 0.26, c, { mono: true, weight: 700, min: 9, max: 15, fit: w - (auto ? 1.25 : 0.95) });
    this.padlock(x + w - (auto ? 0.86 : 0.52), y + 0.2, auto, auto ? pal.ok : pal.danger);
    /* the stock, on the ground: tickets stand on it */
    if (w >= 2 && h >= 2) this.stencil(String(stock).padStart(2, '0'), x + 0.2, y + h - 0.56, 0.9, c, stock ? 0.3 : 0.14, { mono: true, weight: 700 });
    if (auto && m.status === 'todo') {
      /* it stops releasing while that many tickets are in work on the floor: the line is how close that is */
      const limit = m.limit ?? 12, k = clamp(this.wip / limit, 0, 1), cc = k >= 0.8 ? pal.warn : c, x0 = x + 0.24, x1 = x + w - 0.24, ly = y + h - 0.17;
      ctx.lineCap = 'round'; ctx.lineWidth = 0.09;
      ctx.strokeStyle = c; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x1, ly); ctx.stroke(); ctx.globalAlpha = 1;
      if (k > 0) { ctx.strokeStyle = cc; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + (x1 - x0) * k, ly); ctx.stroke(); }
      ctx.lineCap = 'butt';
      if (w >= 3) this.label(`IN WORK ${this.wip}/${limit}`, x1 + 0.04, y + h - 0.42, 0.19, cc, { mono: true, weight: 700, align: 'right', min: 8, max: 11 });
    }
    const pitch = 0.5, cols = Math.max(1, Math.floor((w - 0.5) / pitch)), rows = Math.max(1, Math.floor((h - 1.05) / pitch)), n = cols * rows;
    const ox = x + (w - cols * pitch) / 2 + pitch / 2, oy = y + 0.85 + pitch / 2;
    held.forEach((t, i) => {
      /* released and no arm takes it: it is marked as on its way out, and stays */
      if (i < n) this.ticket(t, ox + (i % cols) * pitch, oy + Math.floor(i / cols) * pitch, 0.38, st, t.released ? 'out' : '', dt);
      else this.shown.set(t.ticketId, { x: x + w - 0.5, y: y + h - 0.4 });
    });
    if (held.length > n) this.label(`+${held.length - n}`, x + w - 0.28, y + h - 0.72, 0.26, pal.text2, { align: 'right', mono: true, plate: 'rgba(9,9,11,0.84)' });
    this.quays(takers, D, st, pal, dt, true);
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
  private exit(m: MachineSpec, st: ViewState, pal: Palette): void {
    const ctx = this.ctx, { x, y, w, h } = m, z = this.cam.z, ok = pal.ok;
    ctx.strokeStyle = ok;
    for (const [lw, a] of [[0.32, 0.07], [0.18, 0.14]] as const) { ctx.globalAlpha = a; ctx.lineWidth = lw; rr(ctx, x + 0.06, y + 0.06, w - 0.12, h - 0.12, 0.2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    rr(ctx, x + 0.06, y + 0.06, w - 0.12, h - 0.12, 0.2); ctx.fillStyle = mix(pal.floor, '#000000', 0.3); ctx.fill(); ctx.lineWidth = 0.055; ctx.stroke();
    const R = Math.min(w, h) * 0.46;
    ctx.globalAlpha = 0.24; ctx.drawImage(this.glowSprite(ok), x + w / 2 - R, y + h / 2 - R, R * 2, R * 2); ctx.globalAlpha = 1;
    const plate = { mono: true, weight: 700, min: 9, max: 12 } as const;
    this.label((m.name || 'Exit').toUpperCase(), x + 0.3, y + 0.06, 0.24, '#052e16', { ...plate, plate: ok, fit: Math.max(1.2, w - 0.6) });
    if (w >= 3 && h >= 2) this.label('handed back to Fleex', x + w / 2, y + h - 0.3, 0.17, pal.text3, { mono: true, align: 'center', fit: w - 0.3 });
    if (!st.exits) return;
    /* how many left by it: on the top line too when there is room beside the name, under the frame otherwise */
    const count = `${(st.exits[m.id] ?? 0) + (this.passed.get(m.id) ?? 0)} · ${st.exitDays ?? 7} d`, o = { ...plate, plate: 'rgba(9,9,11,0.92)' };
    if (w * z >= 125) this.label(count, x + w - 0.3, y + 0.06, 0.24, ok, { ...o, align: 'right' });
    else this.label(count, x + w / 2, y + h - 0.04, 0.24, ok, { ...o, align: 'center' });
  }

  /**
   * A teleporter, on one tile: a ring where its ticket stands, and four chevrons round it that go in on a departure
   * and come out on an arrival. A departure's frame is closed; an arrival's is open in the middle of each side, where
   * its chevrons come out. The ring turns to amber dashes while a departure keeps its ticket because the arrival is
   * taken, and the whole pad to red when it cannot work as it is (a departure that leads nowhere, an arrival no arm
   * empties). Its name and what it leads to are on a plate beside it.
   */
  private port(m: TeleporterSpec, held: FactoryTicket | null, st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y } = m, cx = x + 0.5, cy = y + 0.5, z = this.cam.z, find = (id: string) => this.byId.get(id), dep = m.role === 'departure';
    const arrival = arrivalOf(m, find), state = portState(m, { arrival, arrivalHolds: !!arrival && !!this.inside.get(arrival.id)?.length, holds: held, takers: dep ? [] : this.takersOf(m) });
    const bad = portBad(state), waiting = state === 'waiting', col = bad ? pal.danger : portColor(m, find);
    /* a ticket on its way out of here, or into here: see `jumped` */
    const out = this.jumps.find((j) => j.from.id === m.id), into = this.jumps.find((j) => j.to.id === m.id), w = (j: Jump) => j.age / JUMP_S;
    const burst = out && w(out) < 0.5 ? w(out) / 0.5 : into && w(into) > 0.5 ? 1 - (w(into) - 0.5) / 0.5 : 0;
    rr(ctx, x + 0.068, y + 0.068, 0.864, 0.864, 0.2); ctx.fillStyle = mix(pal.floor, '#000000', 0.3); ctx.fill();
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
    if (held) {
      /* one that is still crossing is not here yet; it is kept in place, so it does not come sliding over the floor */
      if (into && into.id === held.ticketId && w(into) < 0.6) this.shown.set(held.ticketId, { x: cx, y: cy });
      else this.ticket(held, cx, cy, 0.32, st, '', dt);
    }
    if (out && w(out) < 0.4) {
      /* the one that has just left: it shrinks where it stood */
      const k = 1 - w(out) / 0.4, sprite = tokenSprite(out.type, TYPE_COLORS[out.type] ?? NO_TYPE, 0.37 * z * this.dpr);
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
    /* an arm that points into an arrival will never drop there: a no-entry sign on the side it comes from */
    if (!dep) for (let s = 0; s < 4; s++) {
      const n = this.at(m.x - DX[s as 0], m.y - DY[s as 0]);
      if (n && n.kind === 'arm' && n.dir === s) this.noEntry.push({ x: cx - DX[s as 0] * 0.5, y: cy - DY[s as 0] * 0.5 });
    }
    const asked = st.selMachine === m.id || st.hoverMachine === m.id;
    if (z < 11 && !asked) return;
    /* the plate: under the pad, over it when something stands under, beside it when it is boxed in. Its second line is what to know now. */
    const line = z >= 16 || asked || bad || waiting ? portLine(m, state, arrival, dep ? 0 : departuresOf(m, st.layout.machines).length) : '';
    const name = { mono: true, weight: 700, min: 9, max: 12, plate: 'rgba(9,9,11,0.9)' } as const, sub = { mono: true, min: 8, max: 10, plate: 'rgba(9,9,11,0.9)' } as const;
    const ink = bad ? '#fca5a5' : waiting ? pal.warn : pal.text2;
    if (!this.at(m.x, m.y + 1)) {
      this.label(portName(m), cx, y + 1, 0.24, col, { ...name, align: 'center', dy: 11 });
      if (line) this.label(line, cx, y + 1, 0.2, ink, { ...sub, align: 'center', dy: 26 });
    } else if (!this.at(m.x, m.y - 1)) {
      this.label(portName(m), cx, y, 0.24, col, { ...name, align: 'center', dy: line ? -26 : -11 });
      if (line) this.label(line, cx, y, 0.2, ink, { ...sub, align: 'center', dy: -11 });
    } else {
      this.label(portName(m), x + 1.14, cy, 0.24, col, { ...name, dy: line ? -8 : 0 });
      if (line) this.label(line, x + 1.14, cy, 0.2, ink, { ...sub, dy: 8 });
    }
  }

  /**
   * A ticket that is now in an arrival and was, a frame ago, in a departure that leads to it (or in the arm or on
   * the belt that fed that departure, when the page did not see it there): it jumped. It is drawn crossing.
   */
  private jumped(t: FactoryTicket, before: string | null): void {
    const to = t.machineId ? this.byId.get(t.machineId) : null;
    if (!isArrival(to)) return;
    const was = before ? this.byId.get(before) : null;
    const from = was && (was.kind === 'arm' || was.kind === 'belt') ? this.at(was.x + DX[was.dir], was.y + DY[was.dir]) : was;
    if (!isDeparture(from) || from.to !== to.id) return;
    this.jumps.push({ id: t.ticketId, type: t.info?.type ?? '', from, to, age: 0 });
    this.shown.set(t.ticketId, { x: to.x + 0.5, y: to.y + 0.5 });
  }

  /**
   * The link between a departure and its arrival. It is not on the floor all the time: it shows for the teleporter
   * that is selected or pointed at (for an arrival, every departure that leads to it), and while a ticket crosses,
   * with the ticket as a dot on it. Drawn over everything, since it crosses the floor.
   */
  private portLinks(st: ViewState, pal: Palette): void {
    const ctx = this.ctx, find = (id: string) => this.byId.get(id), arcs = new Map<string, { from: TeleporterSpec; to: TeleporterSpec; packet: number | null }>();
    for (const id of [st.selMachine, st.hoverMachine]) {
      const m = id ? this.byId.get(id) : null;
      if (!isPort(m)) continue;
      const a = arrivalOf(m, find);
      if (a) arcs.set(m.id, { from: m, to: a, packet: null });
      else if (m.role === 'arrival') for (const d of departuresOf(m, st.layout.machines)) arcs.set(d.id, { from: d, to: m, packet: null });
    }
    for (const j of this.jumps) { const w = j.age / JUMP_S; arcs.set(j.from.id, { from: j.from, to: j.to, packet: w > 0.15 && w < 0.85 ? (w - 0.15) / 0.7 : null }); }
    /* arcs that end on the same arrival bend one way then the other, so they do not lie on each other */
    const seen = new Map<string, number>();
    for (const { from, to, packet } of arcs.values()) {
      const n = seen.get(to.id) ?? 0; seen.set(to.id, n + 1);
      const x1 = from.x + 0.5, y1 = from.y + 0.5, x2 = to.x + 0.5, y2 = to.y + 0.5, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
      if (L < 0.01) continue;
      const bend = (n % 2 ? -1 : 1) * 0.2 * (1 + Math.floor(n / 2) * 0.5), qx = (x1 + x2) / 2 + dy * bend, qy = (y1 + y2) / 2 - dx * bend;
      const at = (u: number) => ({ x: (1 - u) ** 2 * x1 + 2 * (1 - u) * u * qx + u * u * x2, y: (1 - u) ** 2 * y1 + 2 * (1 - u) * u * qy + u * u * y2 });
      /* from the edge of one pad to the edge of the other */
      const trim = Math.min(0.3, 0.6 / L), col = portColor(from, find), hot = packet != null || this.jumps.some((j) => j.from.id === from.id);
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
    for (const s of this.noEntry) {
      ctx.beginPath(); ctx.arc(s.x, s.y, 0.18, 0, 6.3); ctx.fillStyle = pal.danger; ctx.fill(); ctx.lineWidth = 0.035; ctx.strokeStyle = 'rgba(9,9,11,0.9)'; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.06; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(s.x - 0.1, s.y); ctx.lineTo(s.x + 0.1, s.y); ctx.stroke(); ctx.lineCap = 'butt';
    }
  }

  /** A ticket that was on its way into an exit when it left the floor: it is seen crossing the frame. Anything else that goes was taken back, and just goes. */
  private left(ticketId: string, st: ViewState): void {
    const was = this.lastOn.get(ticketId), from = this.shown.get(ticketId), m = was?.m ? this.byId.get(was.m) : null;
    if (!was || !from || !m) return;
    const to = m.kind === 'arm' || m.kind === 'belt' ? this.at(m.x + DX[m.dir], m.y + DY[m.dir]) : m.kind === 'bridge' ? this.at(m.x + was.fx, m.y + was.fy) : null;
    if (!to || to.kind !== 'exit') return;
    const edge = entryOf(to, from);
    this.leaving.push({ type: was.type, from: { ...from }, edge, exit: to, age: 0, travel: Math.min(0.5, Math.hypot(edge.x - from.x, edge.y - from.y) / (st.beltSpeed || 1.2)) });
    this.passed.set(to.id, (this.passed.get(to.id) ?? 0) + 1);
  }
  /**
   * What leaves by an exit: the ticket goes on to the frame as it was, then it is an outline with a tick that fades
   * towards the middle, while the side it came in by lights up where it passed.
   */
  private departures(pal: Palette, dt: number): void {
    const ctx = this.ctx, z = this.cam.z;
    this.leaving = this.leaving.filter((l) => { l.age += dt; return l.age < l.travel + FADE_S && this.byId.has(l.exit.id); });
    for (const l of this.leaving) {
      const { exit: m, edge, from } = l;
      if (l.age < l.travel) {
        const k = l.age / l.travel, px = from.x + (edge.x - from.x) * k, py = from.y + (edge.y - from.y) * k, sprite = tokenSprite(l.type, TYPE_COLORS[l.type] ?? NO_TYPE, 0.53 * z * this.dpr);
        if (sprite) { const s = sprite.width / (z * this.dpr); ctx.drawImage(sprite, px - s / 2, py - s / 2, s, s); }
        else { rr(ctx, px - 0.23, py - 0.23, 0.46, 0.46, 0.1); ctx.fillStyle = TYPE_COLORS[l.type] ?? NO_TYPE; ctx.fill(); }
        continue;
      }
      const k = (l.age - l.travel) / FADE_S, e = k * k * (3 - 2 * k), px = edge.x + (m.x + m.w / 2 - edge.x) * e, py = edge.y + (m.y + m.h / 2 - edge.y) * e;
      ctx.globalAlpha = 1 - k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      /* the side lights up where it passed, no further than the side goes */
      const a0 = Math.max(-0.45, edge.ax ? m.x + 0.2 - edge.x : m.y + 0.2 - edge.y), a1 = Math.min(0.45, edge.ax ? m.x + m.w - 0.2 - edge.x : m.y + m.h - 0.2 - edge.y);
      ctx.strokeStyle = mix(pal.ok, '#ffffff', 0.7); ctx.lineWidth = 0.1; ctx.beginPath(); ctx.moveTo(edge.x + edge.ax * a0, edge.y + edge.ay * a0); ctx.lineTo(edge.x + edge.ax * a1, edge.y + edge.ay * a1); ctx.stroke();
      ctx.strokeStyle = pal.ok; ctx.lineWidth = 0.045; rr(ctx, px - 0.2, py - 0.2, 0.4, 0.4, 0.11); ctx.stroke();
      ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(px - 0.09, py); ctx.lineTo(px - 0.02, py + 0.07); ctx.lineTo(px + 0.1, py - 0.07); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    }
  }

  private overlay(st: ViewState, pal: Palette): void {
    const ctx = this.ctx, outline = (m: MachineSpec, color: string, lw: number) => { ctx.strokeStyle = color; ctx.lineWidth = lw; rr(ctx, m.x - 0.04, m.y - 0.04, m.w + 0.08, m.h + 0.08, m.w > 1 ? 0.32 : 0.2); ctx.stroke(); };
    const hov = this.machine(st.hoverMachine), sel = this.machine(st.selMachine);
    if (hov && hov.id !== sel?.id) outline(hov, pal.text3, 0.05);
    for (const id of st.selMany) { const m = this.machine(id); if (m) outline(m, pal.accent, 0.08); }
    if (st.marquee) {
      const q = st.marquee, mx = Math.min(q.x0, q.x1), my = Math.min(q.y0, q.y1);
      ctx.fillStyle = 'rgba(96,165,250,0.12)'; ctx.strokeStyle = PICK; ctx.lineWidth = 0.05; ctx.setLineDash([0.2, 0.14]);
      ctx.fillRect(mx, my, Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0)); ctx.strokeRect(mx, my, Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0)); ctx.setLineDash([]);
    }
    if (sel) {
      outline(sel, pal.text, 0.08);
      /* what feeds the selected machine, and what empties it */
      if (isBox(sel)) {
        for (let x = sel.x - 1; x <= sel.x + sel.w; x++) for (let y = sel.y - 1; y <= sel.y + sel.h; y++) {
          const n = this.at(x, y);
          if (!n || n.id === sel.id) continue;
          if ((n.kind === 'belt' || n.kind === 'arm') && this.at(n.x + DX[n.dir], n.y + DY[n.dir])?.id === sel.id) outline(n, pal.ok, 0.07);
        }
        for (const a of this.takersOf(sel)) outline(a, '#fb923c', 0.07);
      }
    }
    /* in build mode, an arm that is selected or about to be placed says where it takes from and where it drops */
    if (st.edit && sel?.kind === 'arm' && !st.selMany.length) this.armWay(sel.x, sel.y, sel.dir, pal, true);
    const g = st.ghost;
    if (g && !g.erase) for (const c of g.cells) if (c.arm && c.dir != null) this.armWay(c.x, c.y, c.dir, pal, g.cells.length === 1);
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
      const tx = Math.floor(dr.x), ty = Math.floor(dr.y), m = this.at(tx, ty), box = m && m.kind !== 'belt' ? m : { x: tx, y: ty, w: 1, h: 1 };
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
  private armWay(x: number, y: number, dir: number, pal: Palette, turn: boolean): void {
    const ctx = this.ctx, dx = DX[dir as 0], dy = DY[dir as 0];
    const nameOf = (m: MachineSpec | null): string => (!m ? 'the floor' : m.kind === 'belt' ? 'a belt' : m.kind === 'bridge' ? 'a bridge' : m.kind === 'arm' ? 'an arm' : m.kind === 'label' ? 'the floor' : m.kind === 'teleporter' ? portName(m) : m.name || (m.kind === 'exit' ? 'Exit' : m.kind === 'zone' ? 'Zone' : 'Station'));
    const tile = (tx: number, ty: number, color: string, dashed: boolean) => {
      ctx.fillStyle = color; ctx.globalAlpha = 0.16; rr(ctx, tx + 0.06, ty + 0.06, 0.88, 0.88, 0.16); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 0.06; if (dashed) ctx.setLineDash([0.14, 0.1]); ctx.stroke(); ctx.setLineDash([]);
    };
    const sx = x - dx, sy = y - dy, tx = x + dx, ty = y + dy, src = this.at(sx, sy), dst = this.at(tx, ty);
    /* a teleporter only goes one way: nothing is taken out of a departure, nothing is put into an arrival */
    const idle = isDeparture(src), shut = isArrival(dst), red = 'rgba(69,10,10,0.95)', pink = '#fecaca';
    tile(sx, sy, idle ? pal.danger : PICK, true); tile(tx, ty, shut ? pal.danger : pal.ok, false);
    const o = { mono: true, weight: 700, min: 9, max: 11 } as const;
    const takes = idle ? `TAKES NOTHING · ${nameOf(src)} is a departure` : `TAKES FROM · ${nameOf(src)}`, drops = shut ? `NO ENTRY · ${nameOf(dst)} is an arrival` : `DROPS ON · ${nameOf(dst)}`;
    const blue = { ...o, plate: idle ? red : 'rgba(23,37,84,0.95)' }, green = { ...o, plate: shut ? red : 'rgba(5,46,22,0.95)' };
    if (dy === 0) {
      /* side by side over the arm, each on its own side of it */
      this.label(takes, x + 0.5 - dx * 0.1, y - 0.34, 0.22, idle ? pink : '#bfdbfe', { ...blue, align: dx > 0 ? 'right' : 'left' });
      this.label(drops, x + 0.5 + dx * 0.1, y - 0.34, 0.22, shut ? pink : '#bbf7d0', { ...green, align: dx > 0 ? 'left' : 'right' });
      if (turn) this.label('R · turn', x + 0.5, y + 1.34, 0.2, pal.text2, { ...o, align: 'center', plate: 'rgba(9,9,11,0.84)' });
    } else {
      /* one above the other, to the right of the tiles they name */
      this.label(takes, x + 1.16, sy + 0.5, 0.22, idle ? pink : '#bfdbfe', blue);
      this.label(drops, x + 1.16, ty + 0.5, 0.22, shut ? pink : '#bbf7d0', green);
      if (turn) this.label('R · turn', x - 0.16, y + 0.5, 0.2, pal.text2, { ...o, align: 'right', plate: 'rgba(9,9,11,0.84)' });
    }
  }

  // ---------- minimap ----------
  private mini: { s: number; ox: number; oy: number } | null = null;
  minimap(cv: HTMLCanvasElement, st: ViewState): void {
    const d = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight, L = st.layout, pal = this.palette();
    if (!w || !h) return;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const c = cv.getContext('2d'); if (!c) return;
    const F = this.floorOf(L), s = Math.min(w / F.w, h / F.h), ox = (w - F.w * s) / 2 - F.x * s, oy = (h - F.h * s) / 2 - F.y * s;
    this.mini = { s, ox, oy };
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = pal.floor; c.fillRect(ox + F.x * s, oy + F.y * s, F.w * s, F.h * s);
    for (const m of L.machines) {
      if (m.kind === 'label') continue;
      c.fillStyle = m.kind === 'belt' && m.fast ? pal.fast : m.kind === 'belt' || m.kind === 'bridge' ? pal.edge : m.kind === 'arm' ? armColor(m, { plain: pal.text2, sorts: pal.text2 }) : m.kind === 'exit' ? pal.ok : m.kind === 'zone' ? (m.inbound ? pal.accent : pal.text3) : m.kind === 'teleporter' ? portColor(m, (id) => this.byId.get(id)) : m.exec === 'human_gate' ? pal.warn : kindOf(m) ? mix(KIND_LOOK[kindOf(m)!].hue, pal.body, 0.35) : pal.text2;
      c.fillRect(ox + m.x * s, oy + m.y * s, Math.max(1, m.w * s), Math.max(1, m.h * s));
    }
    for (const t of st.tickets) {
      const q = this.shown.get(t.ticketId); if (!q) continue;
      if (st.dim?.has(t.ticketId)) { c.fillStyle = pal.text3; c.fillRect(ox + q.x * s - 0.5, oy + q.y * s - 0.5, 1.5, 1.5); continue; }
      const hot = !!humanCall(t) || t.phase === 'loose', big = hot || !!st.found?.has(t.ticketId) || t.info?.favorite === true;
      c.fillStyle = hot ? pal.warn : TYPE_COLORS[t.info?.type ?? ''] ?? '#8b949e';
      c.fillRect(ox + q.x * s - (big ? 2 : 1), oy + q.y * s - (big ? 2 : 1), big ? 4 : 2, big ? 4 : 2);
      if (st.found?.has(t.ticketId)) { c.strokeStyle = pal.text; c.lineWidth = 1; c.strokeRect(ox + q.x * s - 3.5, oy + q.y * s - 3.5, 7, 7); }
    }
    const hw = this.w / 2 / this.cam.z, hh = this.h / 2 / this.cam.z;
    c.strokeStyle = pal.text; c.lineWidth = 1; c.strokeRect(ox + (this.cam.x - hw) * s, oy + (this.cam.y - hh) * s, hw * 2 * s, hh * 2 * s);
  }
  miniToWorld(mx: number, my: number): { x: number; y: number } | null { const m = this.mini; return m ? { x: (mx - m.ox) / m.s, y: (my - m.oy) / m.s } : null; }

  pick(sx: number, sy: number, st: ViewState, withTickets: boolean): Hit {
    const p = this.toWorld(sx, sy);
    if (withTickets) {
      let best: string | null = null, bd = Math.max(0.3, 9 / this.cam.z);
      for (const t of st.tickets) { const q = this.shown.get(t.ticketId); if (!q) continue; const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < bd) { bd = dd; best = t.ticketId; } }
      if (best) return { ticketId: best };
    }
    this.index(st.layout);
    const m = this.at(Math.floor(p.x), Math.floor(p.y));
    /* out of build mode, the light of a machine is its own target: its switch, and what it has to say */
    if (m && withTickets && m.kind === 'station' && m.exec !== 'native' && inRect(machineParts(m).lamp, p.x, p.y)) return { lamp: m.id };
    if (m) return { machineId: m.id };
    for (const l of st.layout.machines) if (l.kind === 'label' && Math.floor(p.x) === l.x && Math.floor(p.y) === l.y) return { machineId: l.id };
    return null;
  }
}
