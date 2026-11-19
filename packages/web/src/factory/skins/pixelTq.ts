/**
 * The pixel skin seen from three quarters. DRAFT for the mock-up of lot 6 (`docs/factory/pixel-3q.html`).
 *
 * The matrix does not move: every machine keeps its tiles, where its shadow and its feet are. Its top is painted that
 * much higher (`LIFT`, under half a tile so the row above stays readable), and its front face fills the gap. What
 * stands is painted by depth, the foot of its footprint: what is lower on the screen passes in front. What is overhead
 * (arms with what they carry, gantries' bars, tolls' arms) comes after everything that stands; what is carried comes
 * just after what carries it, at its height (`order` in `skin.ts`). Words go up with what they are written on. A click
 * hits what is seen (`liftOf`, read by the view's `pick`); what is dropped (a ticket let go, a machine placed, a ghost)
 * stays on its tiles.
 *
 * The mock-up's open questions are options here: whether a line's platform raises what stands on it, how a ticket
 * hidden behind a station of the row below shows, and whether build mode goes flat.
 */
import { mix } from '../floorLook';
import type { MachineSpec, FactoryLayout } from '../types';
import type { Placed, Scene } from '../scene';
import type { ViewState } from '../renderer';
import type { Palette } from './fleex';
import { PixelSkin, ART } from './pixel';
import type { Layer, Piece } from './skin';

/** How high each kind stands, in tiles. */
export const LIFT: Partial<Record<MachineSpec['kind'], number>> = { station: 0.5, belt: 0.25, bridge: 0.25, teleporter: 0.125 };
/** How high a platform raises a line, in tiles. */
export const PLATFORM = 0.15;

/** A line drawn as a platform: a rectangle of the floor, raised, in its colour. Decor for the mock-up (lot 8 makes it a kind of the layout). */
export interface Platform { x: number; y: number; w: number; h: number; color: string; name: string }
export interface TqOptions {
  platforms?: readonly Platform[];
  /** A platform raises what stands on it (its height adds to theirs), or is only a coloured slab under them. */
  raise?: boolean;
  /** A ticket hidden behind a station of the row below: its outline drawn through, shown whole when that station is pointed at, or nothing. */
  hidden?: 'outline' | 'reveal' | 'none';
  /** Build mode goes flat: placing things on tiles, seen from above. */
  buildFlat?: boolean;
}

export class PixelTqSkin extends PixelSkin {
  override readonly id: string = 'pixel-3q';
  private st: ViewState | null = null;
  private gridFor: FactoryLayout | null = null;
  private grid = new Map<string, MachineSpec>();
  constructor(private readonly tq: TqOptions = {}) { super(); }

  /** Seen from three quarters at this frame: not in build mode when it goes flat. */
  private standing(st: ViewState): boolean { return !(st.edit && this.tq.buildFlat); }
  private tileAt(layout: FactoryLayout, x: number, y: number): MachineSpec | null {
    if (this.gridFor !== layout) {
      this.gridFor = layout; this.grid = new Map();
      for (const m of layout.machines) if (m.kind !== 'label') for (let j = m.y; j < m.y + m.h; j++) for (let i = m.x; i < m.x + m.w; i++) this.grid.set(`${i},${j}`, m);
    }
    return this.grid.get(`${x},${y}`) ?? null;
  }
  /** The platform a machine stands on, if one holds all its tiles. */
  private platformOf(m: { x: number; y: number; w: number; h: number }): Platform | null {
    return (this.tq.platforms ?? []).find((p) => m.x >= p.x && m.y >= p.y && m.x + m.w <= p.x + p.w && m.y + m.h <= p.y + p.h) ?? null;
  }

  liftOf(m: MachineSpec, st: ViewState): number {
    if (!this.standing(st)) return 0;
    const base = this.tq.raise && this.platformOf(m) ? PLATFORM : 0;
    if (m.kind !== 'arm') return base + (LIFT[m.kind] ?? 0);
    /* an arm's boom is over what it takes from and what it drops on */
    const dx = [1, 0, -1, 0][m.dir]!, dy = [0, 1, 0, -1][m.dir]!, src = this.tileAt(st.layout, m.x - dx, m.y - dy), dst = this.tileAt(st.layout, m.x + dx, m.y + dy);
    return Math.max(base + 0.25, src ? this.liftOf(src, st) : 0, dst ? this.liftOf(dst, st) : 0) + 0.06;
  }
  protected override seen(m: MachineSpec): { x: number; y: number; w: number; h: number } {
    const L = this.st ? this.liftOf(m, this.st) : 0;
    return { x: m.x, y: m.y - L, w: m.w, h: m.h + L };
  }

  /** Shadows are cast by what stands (see `stand`), at the foot of its front face. */
  protected override shadows(st: ViewState, pal: Palette): void { if (!this.standing(st)) super.shadows(st, pal); }

  override pieces(S: Scene, st: ViewState, out: Piece[]): void {
    this.st = st;
    if (!this.standing(st)) { super.pieces(S, st, out); return; }
    const pal = this.palette(), z = this.cam.z;
    const add = (layer: Layer, depth: number, draw: () => void, on?: Piece): Piece => { const p: Piece = { layer, depth, draw, on }; out.push(p); return p; };
    /** Paint it that high: its top, its words and plates go up with it. */
    const up = (L: number, f: () => void) => () => { const ctx = this.ctx; ctx.save(); ctx.translate(0, -L); this.lifted = L; f(); this.lifted = 0; ctx.restore(); };
    const L = (m: MachineSpec) => this.liftOf(m, st);

    for (const p of this.tq.platforms ?? []) add('floor', -1, () => this.platform(p, pal));
    for (const [m, s] of S.lit) add('floor', 0, up(this.tq.raise && this.platformOf(m) ? PLATFORM : 0, () => this.halo(m, s, pal)));

    /* what is painted on the floor: zones, exits, labels (on a raised platform, at its height) */
    for (const v of S.boxes) {
      const m = v.m, h = L(m);
      if (v.kind === 'label') add('floor', 1, up(h, () => this.labelOf(v, pal)));
      else if (v.kind === 'zone') add('floor', 1, up(h, () => this.zone(v, S, st, pal)));
      else if (v.kind === 'exit') add('floor', 1, up(h, () => this.exit(v, pal)));
      else {
        /* what stands: its front face and feet on its tiles, its top lifted, with what it holds */
        add('standing', m.y + m.h, () => {
          this.stand(m, h, v.kind === 'port' ? mix(v.color, '#000000', 0.45) : pal.light ? mix(pal.body, '#000000', 0.28) : mix(pal.body, '#ffffff', 0.08), true);
          up(h, () => {
            if (v.kind === 'station') { this.station(v, st, pal); if (v.run && !v.gate) this.worker(v); }
            else if (v.kind === 'status') this.statusStation(v, st, pal);
            else this.port(v, st, pal);
          })();
        });
      }
    }
    for (const b of S.belts) {
      const h = L(b.m), foot = b.m.y + 1 - 0.01;
      const host = add('standing', foot, () => {
        this.stand(b.m, h, mix(pal.belt, '#000000', 0.45), false);
        up(h, () => {
          this.beltBase(b, pal);
          if (z >= 8) { const ctx = this.ctx; ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; this.beltChevrons(b, pal); ctx.lineCap = 'butt'; }
        })();
      });
      for (const r of b.riders) add('standing', foot, up(h, () => this.ticket(r, st)), host);
      if (b.gantry) add('overhead', foot, up(h, () => this.gantry(b, pal)));
      if (b.toll) add('overhead', foot + 0.01, up(h + 0.06, () => this.tollArm(b, st, pal)));
    }
    for (const b of S.bridges) { const h = L(b.m); add('standing', b.m.y + 1 - 0.01, () => { this.stand(b.m, h, mix(pal.belt, '#000000', 0.45), false); up(h, () => this.bridge(b, st, pal))(); }); }
    for (const p of S.loose) add('standing', p.t.y + 1, () => {
      const ctx = this.ctx; ctx.strokeStyle = pal.warn; ctx.lineWidth = 0.05; ctx.setLineDash([0.12, 0.1]); ctx.beginPath(); ctx.arc(p.t.x + 0.5, p.t.y + 0.5, 0.42, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      this.ticket(p, st);
    });
    for (const a of S.arms) add('overhead', a.m.y + 1 + 0.02, up(L(a.m), () => this.arm(a, st, pal)));
    add('overhead', 1e9, () => this.departures(S, pal));
    add('overhead', 1e9 + 1, () => this.portLinks(S, pal));
    if ((this.tq.hidden ?? 'outline') !== 'none') add('overhead', 1e9 + 2, () => this.hiddenTickets(S, st, pal));
  }

  /** A front face under a lifted top, its shadow on the floor, and feet at its corners. */
  private stand(m: { x: number; y: number; w: number; h: number }, h: number, face: string, feet: boolean): void {
    if (h <= 0) return;
    const ctx = this.ctx, o = 1 / ART, base = this.tq.raise && this.platformOf(m) ? PLATFORM : 0, y1 = m.y + m.h - base;
    const top = y1 - (h - base), x0 = m.x + 0.04, w = m.w - 0.08;
    ctx.fillStyle = 'rgba(20,14,10,0.28)'; ctx.fillRect(x0 + o * 2, y1 - o, w, o * 3);
    ctx.fillStyle = face; ctx.fillRect(x0, top, w, y1 - top - o);
    /* the lip where the top meets the face catches the light */
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x0, top, w, o);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0, y1 - o * 2, w, o);
    if (feet && h - base >= 0.3) { ctx.fillStyle = '#1d1b26'; for (const fx of [x0 + o * 2, x0 + w - o * 5]) ctx.fillRect(fx, y1 - o * 4, o * 3, o * 3); }
    /* the seams of the face, as boards or panels */
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = x0 + o * 6; x < x0 + w - o * 4; x += o * 8) ctx.fillRect(x, top + o, o, y1 - top - o * 4);
  }

  /** A line's platform: its floor raised, in its colour, its front edge seen, its name stencilled. */
  private platform(p: Platform, pal: Palette): void {
    const ctx = this.ctx, o = 1 / ART, H = PLATFORM;
    ctx.fillStyle = mix(p.color, pal.floor, pal.light ? 0.8 : 0.72); ctx.fillRect(p.x, p.y - H, p.w, p.h);
    ctx.fillStyle = mix(p.color, '#000000', 0.25); ctx.fillRect(p.x, p.y + p.h - H, p.w, H);
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(p.x + o, p.y + p.h, p.w, o * 2);
    ctx.strokeStyle = mix(p.color, pal.floor, 0.3); ctx.lineWidth = o * 1.5; ctx.strokeRect(p.x + o, p.y - H + o, p.w - o * 2, p.h - o * 2);
    this.lifted = H; this.label(p.name.toUpperCase(), p.x + 0.25, p.y + p.h - 0.38, 0.28, mix(p.color, pal.light ? '#000000' : '#ffffff', 0.35), { mono: true, weight: 700 }); this.lifted = 0;
  }

  /**
   * Tickets a station of the row below hides, its top standing over them: their outline drawn through it, or (when
   * that station is pointed at) the ticket itself.
   */
  private hiddenTickets(S: Scene, st: ViewState, pal: Palette): void {
    const L = (m: MachineSpec | null) => (m ? this.liftOf(m, st) : 0);
    const fronts = S.boxes.filter((v) => v.kind === 'station' || v.kind === 'status').map((v) => ({ m: v.m, h: L(v.m) }));
    const behind: { p: Placed; h: number; foot: number }[] = [];
    for (const b of S.belts) for (const p of b.riders) behind.push({ p, h: L(b.m), foot: b.m.y + 1 });
    for (const b of S.bridges) for (const p of b.riders) behind.push({ p, h: L(b.m), foot: b.m.y + 1 });
    for (const p of S.loose) behind.push({ p, h: 0, foot: p.t.y + 1 });
    for (const v of S.boxes) if (v.kind === 'port' && v.held) behind.push({ p: v.held, h: L(v.m), foot: v.m.y + 1 });
    const ctx = this.ctx, o = 1 / ART;
    for (const { p, h, foot } of behind) {
      const x = p.x, y = p.y - h;
      const front = fronts.find((f) => f.m.y + f.m.h > foot && x >= f.m.x && x <= f.m.x + f.m.w && y >= f.m.y - f.h && y <= f.m.y + f.m.h - f.h);
      if (!front) continue;
      if (this.tq.hidden === 'reveal') { if (st.hoverMachine === front.m.id) this.ticket({ ...p, y }, st); continue; }
      const s = p.s * 1.0;
      ctx.save(); ctx.setLineDash([o * 2, o * 1.5]); ctx.lineWidth = o * 1.5; ctx.strokeStyle = pal.light ? 'rgba(29,27,38,0.85)' : 'rgba(244,236,220,0.9)';
      ctx.strokeRect(x - s / 2, y - s * 0.38, s, s * 0.76); ctx.restore();
    }
  }
}
