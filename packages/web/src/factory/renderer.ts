/**
 * The Factory floor, drawn on a canvas. World units are floor tiles; text is
 * drawn in screen space so it stays crisp. Surfaces take their colours from the
 * `--theme-*` variables, so the floor follows the active theme.
 */
import type { LensLayer } from './lens';
import { layoutNames, tie, type NamedTicket } from './nameTags';
import { armTag, isConditional } from './armRules';
import { armDue, armShown, easeSwing } from './armMotion';
import { bridgeFlow, type LaneFlow } from './bridges';
import { DX, DY, humanCall, type ArmSpec, type BeltSpec, type FactoryLayout, type FactoryTicket, type MachineSpec, type StationSpec, type ZoneSpec } from './types';

export interface Ghost { cells: { x: number; y: number; w: number; h: number; dir?: number }[]; ok: boolean; erase?: boolean; text?: string }
export interface DragState { ticketId: string; x: number; y: number; ok: boolean; text: string }
export interface ViewState {
  layout: FactoryLayout;
  tickets: FactoryTicket[];
  /** Arm id → how far it had swung (0..1) and which way it was going when the last snapshot was taken. */
  arms: Map<string, { p: number; state: 'rest' | 'carry' | 'back' }>;
  /** Seconds since that snapshot, and seconds a swing takes: an arm keeps turning between two snapshots. */
  armAge?: number;
  armSwing?: number;
  /** Board id → name, for the tag of an arm that sorts by board. */
  boardName?: (id: string) => string;
  selMachine: string | null;
  /** Build mode: several machines selected at once. */
  selMany: string[];
  /** Build mode: the rectangle being dragged to select, in world units. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  selTicket: string | null;
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
  /** Every ticket carries its name (a key held down). */
  allNames?: boolean;
}
export type Hit = { ticketId: string } | { machineId: string } | null;

/** A ticket's colour on the floor: the hue Fleex gives its type everywhere else (see `TicketTypeBadge`). */
export const TYPE_COLORS: Record<string, string> = { build: '#4ade80', fix: '#f87171', review: '#facc15', ops: '#2dd4bf', lead: '#c084fc', think: '#60a5fa' };
const STAR = '#facc15';
const PRIORITY_PIP: Record<string, string> = { urgent: '#ef4444', high: '#fb923c' };
const STATUS_COLORS: Record<string, string> = { backlog: '#71717a', todo: '#fb923c', doing: '#60a5fa', reviewing: '#c084fc', done: '#22c55e' };
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

interface Palette { bg: string; floor: string; grid: string; belt: string; edge: string; chev: string; body: string; text: string; text2: string; text3: string; ok: string; warn: string; danger: string; accent: string }
type Label = [text: string, wx: number, wy: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; mono?: boolean; plate?: string; min?: number; max?: number; fit?: number }];

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
/** The rectangle of floor that is drawn: what is built plus the margin, never smaller than a starting floor. */
export function floorRect(layout: FactoryLayout): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of layout.machines) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h); }
  if (!layout.machines.length) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  x0 -= FLOOR_MARGIN; y0 -= FLOOR_MARGIN; x1 += FLOOR_MARGIN; y1 += FLOOR_MARGIN;
  const growX = Math.max(0, 40 - (x1 - x0)), growY = Math.max(0, 24 - (y1 - y0));
  return { x: x0 - Math.floor(growX / 2), y: y0 - Math.floor(growY / 2), w: x1 - x0 + growX, h: y1 - y0 + growY };
}
export const isBox = (m: MachineSpec | null | undefined): boolean => !!m && (m.kind === 'station' || m.kind === 'zone' || m.kind === 'exit');


export class FactoryView {
  cam = { x: 24, y: 15, z: 18 };
  w = 0; h = 0;
  private dpr = 1;
  private clock = 0;
  private labels: Label[] = [];
  private pal: Palette | null = null;
  private palAt = 0;
  private gridFor: FactoryLayout | null = null;
  private grid = new Map<string, MachineSpec>();
  private byId = new Map<string, MachineSpec>();
  /** Where each ticket is drawn; eased towards where the server says it is. */
  private shown = new Map<string, { x: number; y: number }>();
  /** Arm id → the swing it is drawn at (0..1). */
  private armShown = new Map<string, number>();
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly cv: HTMLCanvasElement) { this.ctx = cv.getContext('2d')!; }

  resize(): void {
    const d = Math.min(window.devicePixelRatio || 1, 2), w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (w === this.w && h === this.h && d === this.dpr) return;
    this.w = w; this.h = h; this.dpr = d;
    this.cv.width = Math.max(1, Math.round(w * d)); this.cv.height = Math.max(1, Math.round(h * d));
  }
  toWorld(sx: number, sy: number): { x: number; y: number } { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.cam.z = clamp(this.cam.z * factor, 5, 80);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
  }
  /** Frame what is built, or the whole floor when it is empty or being edited. */
  fit(layout: FactoryLayout, whole: boolean): void {
    this.resize();
    const f = floorRect(layout), pad = whole || layout.machines.length === 0 ? 0 : FLOOR_MARGIN - 1.5;
    const x0 = f.x + pad, y0 = f.y + pad, x1 = f.x + f.w - pad, y1 = f.y + f.h - pad;
    const bw = x1 - x0, bh = y1 - y0;
    this.cam.z = clamp(Math.min(this.w / bw, this.h / bh), 5, 60);
    this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2;
  }

  private palette(): Palette {
    const now = performance.now();
    if (this.pal && now - this.palAt < 2000) return this.pal;
    const cs = getComputedStyle(document.documentElement), v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    this.palAt = now;
    this.pal = {
      bg: v('--theme-bg-base', '#09090b'), floor: v('--theme-bg-surface', '#18181b'), grid: v('--theme-border', '#27272a'), belt: v('--theme-bg-overlay', '#27272a'),
      edge: v('--theme-border-input', '#3f3f46'), chev: v('--theme-text-muted', '#71717a'), body: v('--theme-bg-overlay', '#27272a'),
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
    const ctx = this.ctx, z = this.cam.z;
    ctx.save(); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const [raw, wx, wy, size, color, o] of this.labels) {
      let px = size * z;
      if (px < 3.6) continue;
      if (o.min) px = Math.max(px, o.min);
      if (o.max) px = Math.min(px, o.max);
      const sx = (wx - this.cam.x) * z + this.w / 2, sy = (wy - this.cam.y) * z + this.h / 2;
      if (sx < -300 || sx > this.w + 300 || sy < -40 || sy > this.h + 40) continue;
      ctx.font = `${o.weight ?? 500} ${px.toFixed(1)}px ${o.mono ? MONO : SANS}`;
      ctx.textAlign = o.align ?? 'left'; ctx.textBaseline = 'middle';
      let text = raw;
      if (o.fit) { const room = o.fit * z; if (ctx.measureText(text).width > room) { while (text.length > 3 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1); text += '…'; } }
      if (o.plate) {
        const tw = ctx.measureText(text).width, pad = px * 0.45, ph = px * 1.5;
        const x0 = o.align === 'center' ? sx - tw / 2 - pad : o.align === 'right' ? sx - tw - pad : sx - pad;
        ctx.fillStyle = o.plate; rr(ctx, x0, sy - ph / 2, tw + pad * 2, ph, Math.min(4, ph / 3)); ctx.fill();
      }
      ctx.fillStyle = color; ctx.fillText(text, sx, sy);
    }
    ctx.restore(); this.labels.length = 0;
  }

  private ticket(t: FactoryTicket, x: number, y: number, s: number, st: ViewState, mark: 'run' | 'human' | 'fail' | 'out' | 'wait' | '', dt: number): void {
    const ctx = this.ctx, pal = this.palette(), cur = this.shown.get(t.ticketId), dragging = st.drag?.ticketId === t.ticketId;
    /* ease towards where the server last said the ticket is, so a poll does not make it jump */
    const k = cur ? 1 - Math.pow(0.0005, dt) : 1, px = cur ? cur.x + (x - cur.x) * k : x, py = cur ? cur.y + (y - cur.y) * k : y;
    this.shown.set(t.ticketId, { x: px, y: py });
    const selected = st.selTicket === t.ticketId, dim = !!st.dim?.has(t.ticketId) && !selected && !dragging;
    if (dim) {
      /* left out by the filter: still there, but faded and without any of its marks */
      ctx.globalAlpha = 0.28; rr(ctx, px - s / 2, py - s / 2, s, s, s * 0.22); ctx.fillStyle = pal.text3; ctx.fill(); ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = dragging ? 0.25 : mark === 'wait' ? 0.5 : 1;
    rr(ctx, px - s / 2, py - s / 2, s, s, s * 0.22);
    ctx.fillStyle = TYPE_COLORS[t.info?.type ?? ''] ?? '#8b949e'; ctx.fill();
    ctx.lineWidth = 0.045; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(px - s / 2 + s * 0.16, py - s / 2 + s * 0.14, s * 0.68, s * 0.14);
    ctx.globalAlpha = 1;
    const blink = Math.floor(this.clock * 2.4) % 2 === 0;
    if (mark === 'run' && s * this.cam.z > 6) { const a0 = this.clock * 4 + t.ticketId.length; ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = s * 0.15; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(px, py, s * 0.24, a0, a0 + 4.2); ctx.stroke(); ctx.lineCap = 'butt'; }
    else if ((mark === 'human' || mark === 'fail') && !humanCall(t)) { ctx.strokeStyle = mark === 'fail' ? pal.danger : pal.warn; ctx.lineWidth = blink ? 0.1 : 0.05; rr(ctx, px - s / 2 - 0.06, py - s / 2 - 0.06, s + 0.12, s + 0.12, 0.13); ctx.stroke(); }
    else if (mark === 'out') { ctx.strokeStyle = pal.text2; ctx.lineWidth = 0.04; rr(ctx, px - s / 2 - 0.04, py - s / 2 - 0.04, s + 0.08, s + 0.08, 0.1); ctx.stroke(); }
    /* a ticket waiting for a human calls for attention wherever it is: a pulsing halo and a "?" (or "!" when the run failed) */
    const call = dragging ? null : humanCall(t);
    if (call) {
      const col = call === 'failed' ? pal.danger : pal.warn, ph = (this.clock * 0.9 + (t.ticketId.charCodeAt(0) % 10) / 10) % 1, grow = s * 0.7 * ph;
      ctx.globalAlpha = 0.85 * (1 - ph); ctx.strokeStyle = col; ctx.lineWidth = 0.07;
      rr(ctx, px - s / 2 - 0.05 - grow / 2, py - s / 2 - 0.05 - grow / 2, s + 0.1 + grow, s + 0.1 + grow, s * 0.3); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 0.06 + 0.04 * Math.sin(this.clock * 6) ** 2;
      rr(ctx, px - s / 2 - 0.05, py - s / 2 - 0.05, s + 0.1, s + 0.1, s * 0.26); ctx.stroke();
      this.label(call === 'failed' ? '!' : '?', px, py + s * 0.04, s * 0.74, 'rgba(0,0,0,0.82)', { align: 'center', weight: 800, min: 8, max: 30 });
    }
    const z = this.cam.z, info = t.info, found = !!st.found?.has(t.ticketId);
    if (info && !dragging) {
      /* its number, once the square is big enough to hold it */
      if (!call && s * z >= 26) this.label(String(info.displayId), px, py + s * 0.06, s * 0.36, 'rgba(0,0,0,0.78)', { align: 'center', weight: 700, mono: true });
      /* priority: a pip in the top-left corner for what is urgent or high */
      const pip = PRIORITY_PIP[info.priority];
      if (pip && s * z >= 7) { ctx.beginPath(); ctx.arc(px - s / 2 + s * 0.06, py - s / 2 + s * 0.06, s * 0.17, 0, 6.3); ctx.fillStyle = pip; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke(); }
      /* favourite: a star on the top-right corner */
      if (info.favorite && s * z >= 7) {
        const cx = px + s / 2 - s * 0.04, cy = py - s / 2 + s * 0.04, r = s * 0.3;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
        ctx.closePath(); ctx.fillStyle = STAR; ctx.fill(); ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
      }
    }
    if (found) { ctx.strokeStyle = pal.accent; ctx.lineWidth = 0.07; rr(ctx, px - s / 2 - 0.09, py - s / 2 - 0.09, s + 0.18, s + 0.18, s * 0.3); ctx.stroke(); }
    if (selected) { ctx.strokeStyle = pal.text; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(px, py, Math.max(s * 0.95, 0.3), 0, 6.3); ctx.stroke(); }
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

  draw(st: ViewState, dtReal: number): void {
    const ctx = this.ctx, pal = this.palette(), cam = this.cam, d = this.dpr, z = cam.z, L = st.layout;
    this.resize(); this.index(L); this.clock += dtReal;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(z * d, 0, 0, z * d, (this.w / 2 - cam.x * z) * d, (this.h / 2 - cam.y * z) * d);

    /* the floor has no edge: it is drawn as far as what is built, plus room to build further */
    const F = floorRect(L);
    rr(ctx, F.x - 0.5, F.y - 0.5, F.w + 1, F.h + 1, 0.7); ctx.fillStyle = pal.floor; ctx.fill();
    ctx.strokeStyle = st.edit ? pal.accent : pal.grid; ctx.lineWidth = st.edit ? 0.08 : 0.05; ctx.stroke();
    if (z >= (st.edit ? 6 : 12)) {
      ctx.strokeStyle = pal.grid; ctx.globalAlpha = st.edit ? 0.9 : 0.5; ctx.lineWidth = 1 / z; ctx.beginPath();
      for (let i = 0; i <= F.w; i++) { ctx.moveTo(F.x + i, F.y); ctx.lineTo(F.x + i, F.y + F.h); }
      for (let i = 0; i <= F.h; i++) { ctx.moveTo(F.x, F.y + i); ctx.lineTo(F.x + F.w, F.y + i); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    const inside = new Map<string, FactoryTicket[]>();
    for (const t of st.tickets) if (t.machineId) { const a = inside.get(t.machineId); if (a) a.push(t); else inside.set(t.machineId, [t]); }
    for (const a of inside.values()) a.sort((p, q) => p.since.localeCompare(q.since));
    const live = new Set(st.tickets.map((t) => t.ticketId));
    for (const id of this.shown.keys()) if (!live.has(id)) this.shown.delete(id);

    const belts = L.machines.filter((m): m is BeltSpec => m.kind === 'belt');
    const bends = new Map<string, number>();
    for (const b of belts) { const f = this.bendOf(b); bends.set(b.id, f); this.beltBase(b, f, pal); }
    if (z >= 8) { ctx.strokeStyle = pal.chev; ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const b of belts) this.beltChevrons(b, bends.get(b.id) ?? -1); ctx.lineCap = 'butt'; }

    for (const m of L.machines) if (m.kind === 'bridge') this.bridge(m, inside.get(m.id) ?? [], st, pal, dtReal);
    for (const m of L.machines) {
      if (m.kind === 'label') this.label(m.text, m.x + 0.12, m.y + 0.5, 0.62, m.color || pal.text2, { weight: 700, min: 10, max: 24 });
      else if (m.kind === 'zone') this.zone(m, inside.get(m.id) ?? [], st, pal, dtReal);
      else if (m.kind === 'station') this.station(m, inside.get(m.id) ?? [], st, pal, dtReal);
      else if (m.kind === 'exit') this.exit(m, pal);
    }
    for (const b of belts) {
      const t = inside.get(b.id)?.[0]; if (!t) continue;
      const f = bends.get(b.id) ?? -1, cx = b.x + 0.5, cy = b.y + 0.5;
      let x: number, y: number;
      if (f >= 0 && t.fx === DX[f as 0] && t.fy === DY[f as 0]) {
        const ca = Math.cos(t.p * Math.PI / 2), sa = Math.sin(t.p * Math.PI / 2);
        x = cx - DX[f as 0] * 0.5 + DX[b.dir] * 0.5 + 0.5 * (DX[f as 0] * sa - DX[b.dir] * ca); y = cy - DY[f as 0] * 0.5 + DY[b.dir] * 0.5 + 0.5 * (DY[f as 0] * sa - DY[b.dir] * ca);
      } else if (t.p < 0.5) { x = cx - t.fx * (0.5 - t.p); y = cy - t.fy * (0.5 - t.p); }
      else { x = cx + DX[b.dir] * (t.p - 0.5); y = cy + DY[b.dir] * (t.p - 0.5); }
      this.ticket(t, x, y, 0.46, st, '', dtReal);
    }
    for (const t of st.tickets) if (!t.machineId || !this.byId.has(t.machineId)) {
      ctx.strokeStyle = pal.warn; ctx.lineWidth = 0.05; ctx.setLineDash([0.12, 0.1]); ctx.beginPath(); ctx.arc(t.x + 0.5, t.y + 0.5, 0.42, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      this.ticket(t, t.x + 0.5, t.y + 0.5, 0.5, st, '', dtReal);
    }
    for (const m of L.machines) if (m.kind === 'arm') this.arm(m, inside.get(m.id)?.[0] ?? null, st, pal, dtReal);

    if (st.lens) this.lens(st.lens, L, pal);
    this.overlay(st, pal);
    this.flushLabels();
    this.names(st, pal);
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
    ctx.strokeStyle = pal.edge; ctx.lineWidth = 0.09;
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
        if (s === b.dir ? !!n && (n.kind === 'belt' || n.kind === 'bridge' || isBox(n)) : this.feeds(n, x, y)) continue;
        if (s === 0) { ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); } else if (s === 2) { ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); }
        else if (s === 1) { ctx.moveTo(x, y + 0.955); ctx.lineTo(x + 1, y + 0.955); } else { ctx.moveTo(x, y + 0.045); ctx.lineTo(x + 1, y + 0.045); }
      }
      ctx.stroke();
    }
    /* a belt that leads nowhere says so */
    const n = this.at(x + dx, y + dy);
    if (!(n && (n.kind === 'belt' || n.kind === 'bridge' || isBox(n))) && !this.takersOf(b).length) {
      ctx.strokeStyle = pal.danger; ctx.lineWidth = 0.12; ctx.beginPath();
      ctx.moveTo(x + 0.5 + dx * 0.42 - dy * 0.4, y + 0.5 + dy * 0.42 - dx * 0.4); ctx.lineTo(x + 0.5 + dx * 0.42 + dy * 0.4, y + 0.5 + dy * 0.42 + dx * 0.4); ctx.stroke();
    }
  }

  private beltChevrons(b: BeltSpec, f: number): void {
    const ctx = this.ctx, dx = DX[b.dir], dy = DY[b.dir], fx = f >= 0 ? DX[f as 0] : 0, fy = f >= 0 ? DY[f as 0] : 0;
    const px = b.x + 0.5 - fx * 0.5 + dx * 0.5, py = b.y + 0.5 - fy * 0.5 + dy * 0.5, off = (this.clock * 0.6) % 0.5;
    for (let k = 0; k < 2; k++) {
      const u = off + k * 0.5;
      let cx: number, cy: number, tx: number = dx, ty: number = dy;
      if (f >= 0) { const ca = Math.cos(u * Math.PI / 2), sa = Math.sin(u * Math.PI / 2); cx = px + 0.5 * (fx * sa - dx * ca); cy = py + 0.5 * (fy * sa - dy * ca); tx = dx * sa + fx * ca; ty = dy * sa + fy * ca; }
      else { cx = b.x + 0.5 + dx * (u - 0.5); cy = b.y + 0.5 + dy * (u - 0.5); }
      ctx.beginPath(); ctx.moveTo(cx - tx * 0.09 + ty * 0.19, cy - ty * 0.09 - tx * 0.19); ctx.lineTo(cx + tx * 0.09, cy + ty * 0.09); ctx.lineTo(cx - tx * 0.09 - ty * 0.19, cy - ty * 0.09 + tx * 0.19); ctx.stroke();
    }
  }

  /** Two belts crossing: the north-south one passes under, the east-west one over it. */
  private bridge(m: MachineSpec, tickets: FactoryTicket[], st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y } = m, off = (this.clock * 0.6) % 0.5;
    /* a bridge has no direction of its own: each lane is drawn the way the belts that feed it send tickets across */
    const flow = bridgeFlow((px, py) => this.at(px, py), m);
    ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
    const lane = (f: LaneFlow, horizontal: boolean) => {
      const cx0 = x + 0.5, cy0 = y + 0.5;
      ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      /* one chevron at `u` along the lane, pointing the way `s` says (+1 east or south, -1 west or north) */
      const chevron = (u: number, s: number) => {
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
        ctx.strokeStyle = pal.chev;
        for (let k = 0; k < 2; k++) chevron(s * (off + k * 0.5 - 0.5), s);
      }
      ctx.lineCap = 'butt';
    };
    const draw = (t: FactoryTicket) => this.ticket(t, x + 0.5 + t.fx * (t.p - 0.5), y + 0.5 + t.fy * (t.p - 0.5), 0.46, st, '', dt);
    /* under: the north-south lane, between its two rails */
    ctx.strokeStyle = pal.edge; ctx.lineWidth = 0.09; ctx.beginPath(); ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); ctx.stroke();
    if (this.cam.z >= 8) lane(flow.under, false);
    for (const t of tickets) if (t.fx === 0) draw(t);
    /* over: the deck of the east-west lane, with a shadow on the lane below */
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + 0.1, 1, 0.8);
    ctx.fillStyle = pal.belt; ctx.fillRect(x - 0.01, y + 0.16, 1.02, 0.68);
    ctx.strokeStyle = pal.text3; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo(x, y + 0.16); ctx.lineTo(x + 1, y + 0.16); ctx.moveTo(x, y + 0.84); ctx.lineTo(x + 1, y + 0.84); ctx.stroke();
    if (this.cam.z >= 8) lane(flow.over, true);
    for (const t of tickets) if (t.fx !== 0) draw(t);
  }

  private arm(a: ArmSpec, carried: FactoryTicket | null, st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, bx = a.x + 0.5, by = a.y + 0.5, dx = DX[a.dir], dy = DY[a.dir];
    /*
     * The half turn is drawn here, not sampled from the server: see `armMotion.ts`.
     */
    const swing = st.armSwing || 1.1, p = armShown(this.armShown.get(a.id), armDue(st.arms.get(a.id), st.armAge ?? 0, swing), dt, swing);
    this.armShown.set(a.id, p);
    const e = easeSwing(p);
    const th = Math.atan2(dy, dx) + Math.PI * (1 - e), hx = bx + Math.cos(th) * 0.92, hy = by + Math.sin(th) * 0.92;
    const filtered = isConditional(a), col = filtered ? pal.warn : pal.text2;
    ctx.fillStyle = col; ctx.globalAlpha = 0.55; ctx.beginPath();
    ctx.moveTo(bx + dx * 0.48, by + dy * 0.48); ctx.lineTo(bx + dx * 0.3 - dy * 0.16, by + dy * 0.3 - dx * 0.16); ctx.lineTo(bx + dx * 0.3 + dy * 0.16, by + dy * 0.3 + dx * 0.16); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = pal.bg; ctx.beginPath(); ctx.arc(bx, by, 0.3, 0, 6.3); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.07; ctx.stroke();
    ctx.lineCap = 'round'; ctx.strokeStyle = pal.bg; ctx.lineWidth = 0.2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 0.11; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx, by, 0.13, 0, 6.3); ctx.fill();
    if (carried) this.ticket(carried, hx, hy, 0.44, st, '', dt);
    ctx.strokeStyle = col; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(hx, hy, 0.17, th - 1.9, th + 1.9); ctx.stroke();
    const src = this.at(a.x - dx, a.y - dy), tag = armTag(a, src ? this.takersOf(src) : [], st.boardName);
    if (!tag || (this.cam.z < 11 && st.selMachine !== a.id && st.hoverMachine !== a.id)) return;
    /*
     * What the arm takes is written past its head, on the side it drops on: on its own row for an arm that points
     * sideways, in its own column otherwise. Arms stacked against a station then each carry their own tag, where a
     * tag above the arm read as belonging to the one before.
     */
    const o = { min: 9, max: 12, mono: true, plate: filtered ? 'rgba(40,32,4,0.92)' : 'rgba(9,9,11,0.84)' }, ink = filtered ? '#fde68a' : pal.text2;
    const dst = this.at(a.x + dx, a.y + dy);
    if (isBox(dst) && isBox(src)) {
      /* squeezed between two machines, there is no room on its own line: beside it, as a last resort */
      if (dy === 0) this.label(tag, bx, a.y - 0.28, 0.3, ink, { ...o, align: 'center' });
      else this.label(tag, a.x + 1.14, by, 0.3, ink, { ...o, fit: 6 });
      return;
    }
    /* past the head, unless that is a machine: then behind the arm, over the belt it takes from */
    const fx = isBox(dst) ? -dx : dx, fy = isBox(dst) ? -dy : dy;
    if (fx > 0) this.label(tag, a.x + 1.12, by, 0.3, ink, { ...o, align: 'left', fit: 5 });
    else if (fx < 0) this.label(tag, a.x - 0.12, by, 0.3, ink, { ...o, align: 'right', fit: 5 });
    else this.label(tag, bx, fy > 0 ? a.y + 1.3 : a.y - 0.3, 0.3, ink, { ...o, align: 'center', fit: 2.6 });
  }

  private station(m: StationSpec, tickets: FactoryTicket[], st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y, w, h } = m, big = w >= 3, gate = m.exec === 'human_gate', nat = m.exec === 'native';
    const waiting = tickets.filter((t) => t.phase !== 'out'), out = tickets.filter((t) => t.phase === 'out');
    const state = tickets.some((t) => t.phase === 'failed') ? pal.danger : tickets.some((t) => t.phase === 'review' || t.phase === 'question') ? pal.warn
      : tickets.some((t) => t.phase === 'running') ? pal.ok : tickets.some((t) => t.phase === 'wait') ? '#60a5fa' : pal.text3;
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
    rr(ctx, x + 0.28, ty, w - 0.56, th, 0.1); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
    out.forEach((t, i) => { if (i < max) this.ticket(t, x + 0.4 + ts / 2 + i * (ts + 0.08), ty + th / 2, ts, st, 'out', dt); else this.shown.set(t.ticketId, { x: x + w - 0.5, y: ty + th / 2 }); });
    if (tickets.length >= m.cap) this.label('full', x + w / 2, y + h + 0.26, 0.26, '#fdba74', { align: 'center', plate: 'rgba(9,9,11,0.84)', min: 9, max: 12 });
  }

  private zone(m: ZoneSpec, tickets: FactoryTicket[], st: ViewState, pal: Palette, dt: number): void {
    const ctx = this.ctx, { x, y, w, h } = m;
    rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.22); ctx.fillStyle = pal.bg; ctx.fill(); ctx.strokeStyle = m.inbound ? pal.accent : pal.edge; ctx.lineWidth = 0.08;
    if (m.inbound) ctx.setLineDash([0.35, 0.18]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = m.inbound ? pal.accent : STATUS_COLORS[m.status ?? ''] ?? pal.text3; rr(ctx, x + 0.3, y + 0.24, 0.14, 0.4, 0.05); ctx.fill();
    this.label(`${m.name || 'Zone'} · ${tickets.filter((t) => !t.released).length}`, x + 0.58, y + 0.45, 0.34, pal.text, { weight: 600, min: 9, max: 15, fit: w - 0.8 });
    if (m.release === 'auto' && w >= 4) this.label('auto', x + w - 0.3, y + 0.45, 0.24, pal.ok, { align: 'right', mono: true });
    const pitch = 0.5, cols = Math.max(1, Math.floor((w - 0.5) / pitch)), rows = Math.max(1, Math.floor((h - 1.05) / pitch)), n = cols * rows;
    const ox = x + (w - cols * pitch) / 2 + pitch / 2, oy = y + 0.85 + pitch / 2;
    tickets.forEach((t, i) => {
      if (i < n) this.ticket(t, ox + (i % cols) * pitch, oy + Math.floor(i / cols) * pitch, 0.38, st, t.released ? 'out' : '', dt);
      else this.shown.set(t.ticketId, { x: x + w - 0.5, y: y + h - 0.4 });
    });
    if (tickets.length > n) this.label(`+${tickets.length - n}`, x + w - 0.28, y + h - 0.32, 0.26, pal.text2, { align: 'right', mono: true, plate: 'rgba(9,9,11,0.84)' });
  }

  private exit(m: MachineSpec, pal: Palette): void {
    const ctx = this.ctx, { x, y, w, h } = m;
    rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.3); ctx.fillStyle = pal.body; ctx.fill(); ctx.strokeStyle = pal.ok; ctx.lineWidth = 0.08; ctx.stroke();
    this.label(m.name || 'Exit', x + w / 2, y + 0.55, 0.32, pal.ok, { align: 'center', weight: 600, min: 9, max: 14, fit: Math.max(w, 3) });
    if (h >= 2) this.label('done', x + w / 2, y + 1.05, 0.24, pal.text2, { align: 'center' });
  }

  private overlay(st: ViewState, pal: Palette): void {
    const ctx = this.ctx, outline = (m: MachineSpec, color: string, lw: number) => { ctx.strokeStyle = color; ctx.lineWidth = lw; rr(ctx, m.x - 0.04, m.y - 0.04, m.w + 0.08, m.h + 0.08, m.w > 1 ? 0.32 : 0.2); ctx.stroke(); };
    const hov = this.machine(st.hoverMachine), sel = this.machine(st.selMachine);
    if (hov && hov.id !== sel?.id) outline(hov, pal.text3, 0.05);
    for (const id of st.selMany) { const m = this.machine(id); if (m) outline(m, pal.accent, 0.08); }
    if (st.marquee) {
      const q = st.marquee, mx = Math.min(q.x0, q.x1), my = Math.min(q.y0, q.y1);
      ctx.fillStyle = 'rgba(96,165,250,0.12)'; ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 0.05; ctx.setLineDash([0.2, 0.14]);
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
      const tx = Math.floor(dr.x), ty = Math.floor(dr.y), m = this.at(tx, ty), box = m && m.kind !== 'belt' ? m : { x: tx, y: ty, w: 1, h: 1 };
      ctx.strokeStyle = dr.ok ? pal.ok : pal.warn; ctx.lineWidth = 0.09; ctx.setLineDash(dr.ok ? [] : [0.16, 0.12]);
      rr(ctx, box.x + 0.03, box.y + 0.03, box.w - 0.06, box.h - 0.06, 0.2); ctx.stroke(); ctx.setLineDash([]);
      const t = st.tickets.find((q) => q.ticketId === dr.ticketId);
      rr(ctx, dr.x - 0.3, dr.y - 0.3, 0.6, 0.6, 0.13); ctx.fillStyle = TYPE_COLORS[t?.info?.type ?? ''] ?? '#8b949e'; ctx.fill();
      this.label(dr.text, dr.x, dr.y - 0.75, 0.3, pal.text, { align: 'center', plate: dr.ok ? 'rgba(20,83,45,0.95)' : 'rgba(120,53,15,0.95)', min: 10, max: 13 });
    }
  }

  // ---------- minimap ----------
  private mini: { s: number; ox: number; oy: number } | null = null;
  minimap(cv: HTMLCanvasElement, st: ViewState): void {
    const d = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight, L = st.layout, pal = this.palette();
    if (!w || !h) return;
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
    const c = cv.getContext('2d'); if (!c) return;
    const F = floorRect(L), s = Math.min(w / (F.w + 2), h / (F.h + 2)), ox = (w - F.w * s) / 2 - F.x * s, oy = (h - F.h * s) / 2 - F.y * s;
    this.mini = { s, ox, oy };
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = pal.floor; c.fillRect(ox + F.x * s, oy + F.y * s, F.w * s, F.h * s);
    for (const m of L.machines) {
      if (m.kind === 'label') continue;
      c.fillStyle = m.kind === 'belt' || m.kind === 'bridge' ? pal.edge : m.kind === 'arm' ? pal.text2 : m.kind === 'exit' ? pal.ok : m.kind === 'zone' ? (m.inbound ? pal.accent : pal.text3) : m.exec === 'human_gate' ? pal.warn : pal.text2;
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
    if (m) return { machineId: m.id };
    for (const l of st.layout.machines) if (l.kind === 'label' && Math.floor(p.x) === l.x && Math.floor(p.y) === l.y) return { machineId: l.id };
    return null;
  }
}
