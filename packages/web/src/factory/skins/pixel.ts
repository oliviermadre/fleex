/**
 * The pixel skin, "workshop": the floor in pixel art. DRAFT for the mock-up of lot 5 (`docs/factory/pixel-flat.html`).
 *
 * Pixel art from the same painters: the picture is painted at a low resolution, `ART` pixels to a tile, then enlarged
 * without smoothing. The words are not: they wait, and are written crisp over the enlarged picture. Pixels are whole
 * only when a tile is a whole number of screen pixels per art pixel, so the zoom rests on `PIXEL_STEPS` only (it
 * glides between them, it never stops between them). Seen from far (under `ART` pixels a tile), the picture is not
 * pixelated: a pixel of art would be smaller than a pixel of the screen.
 *
 * Its own drawing: a floor of tiles, flat bodies with a dark outline, hard shadows, tickets as crates in the colour of
 * their type, and a worker at the foot of each station that runs something, busy while it does. Workers are
 * procedural: drawn from the scene at each frame, kept by no one.
 *
 * It follows the theme: a cream workshop on a light theme, a workshop at night on a dark one (or cream always).
 */
import { isLight, legible, luminance, mix } from '../floorLook';
import type { Lamp, RunKind } from '../machineArt';
import type { StationSpec } from '../types';
import type { Scene, StationView } from '../scene';
import type { ViewState } from '../renderer';
import type { TokenLook } from '../ticketToken';
import { FleexSkin, type Palette } from './fleex';
import type { Piece, Surface } from './skin';

/** The pixel fonts, as a canvas asks for them. */
export const PIXEL_FONTS = ['400 16px "Silkscreen"', '700 16px "Silkscreen"', '500 16px "Pixelify Sans"', '700 16px "Pixelify Sans"'];
/** Art pixels to a tile. */
export const ART = 16;
/** The zooms the view rests on, in screen pixels per tile: whole multiples of the art, and two far ones. */
export const PIXEL_STEPS: readonly number[] = [4, 8, 16, 32, 48, 64, 80];

export interface PixelOptions {
  /** On a dark theme: a workshop at night (it follows the theme), or the cream workshop always. */
  dark?: 'night' | 'cream';
  /** The words: in pixel fonts, or in the app's own (crisper when small). */
  words?: 'pixel' | 'app';
}

const CREAM = {
  bg: '#e8dfcc', floor: '#efe7d6', grid: '#d9cfbb', belt: '#56525f', edge: '#2b2833', chev: '#d8d2e0', fast: '#2f7fd6', body: '#f4ecdc',
  text: '#1d1b26', text2: '#4b4655', text3: '#6b6574', ok: '#2f9e44', warn: '#a86d00', danger: '#c8322e', amber: '#c27c0e', light: true,
};
const NIGHT = {
  bg: '#17151d', floor: '#25222c', grid: '#2f2b38', belt: '#4a4555', edge: '#0f0e14', chev: '#b3acc4', fast: '#5aa9ff', body: '#3a3644',
  text: '#f4ecdc', text2: '#d2ccdb', text3: '#9a93ab', ok: '#4fbf5f', warn: '#f2b01e', danger: '#ff6b62', amber: '#f2b01e', light: false,
};
/** A crate's wood, its plank line and its outline. */
const WOOD = '#c8955a', PLANK = '#9c6b3a', INK = '#2b2833';

export class PixelSkin extends FleexSkin {
  override readonly id: string = 'pixel';
  /** The picture at low resolution, and how many of its pixels there are to a pixel of the view (CSS). */
  private low: HTMLCanvasElement | null = null;
  private lowCtx: CanvasRenderingContext2D | null = null;
  private scale = 1;
  /** Painting into the low picture (from the floor to the pieces), or onto the view (the words). */
  private toLow = false;

  constructor(private readonly opts: PixelOptions = {}) {
    super();
    if (opts.words !== 'app') {
      this.fonts = { sans: '"Pixelify Sans", ui-sans-serif, system-ui, sans-serif', mono: '"Silkscreen", ui-monospace, monospace' };
      /* a canvas does not ask for a font it is told to use: ask now, and the words take it at the frame after it came */
      if (typeof document !== 'undefined' && document.fonts) for (const f of PIXEL_FONTS) void document.fonts.load(f).catch(() => undefined);
    }
  }

  protected override get ctx(): CanvasRenderingContext2D { return this.toLow && this.lowCtx ? this.lowCtx : this.on.ctx; }
  protected override get cv(): HTMLCanvasElement { return this.toLow && this.low ? this.low : this.on.cv; }
  protected override get dpr(): number { return this.toLow ? this.scale : this.on.dpr; }

  override ground(on: Surface, S: Scene, st: ViewState): void {
    this.on = on;
    /* art pixels to a CSS pixel; at most the screen's own: from far the picture is not pixelated */
    this.scale = Math.min(on.dpr, ART / on.cam.z);
    this.toLow = this.scale < on.dpr;
    if (this.toLow) {
      const low = this.low ?? (this.low = document.createElement('canvas')), w = Math.max(1, Math.ceil(on.w * this.scale)), h = Math.max(1, Math.ceil(on.h * this.scale));
      if (low.width !== w || low.height !== h) { low.width = w; low.height = h; }
      this.lowCtx = low.getContext('2d');
      if (this.lowCtx) this.lowCtx.imageSmoothingEnabled = false; else this.toLow = false;
    }
    super.ground(on, S, st);
  }

  /** The procedural sprites: a worker at the foot of each station that runs something. */
  override pieces(S: Scene, st: ViewState, out: Piece[]): void {
    super.pieces(S, st, out);
    for (const v of S.boxes) if (v.kind === 'station' && v.run && !v.gate) out.push({ layer: 'standing', depth: 3.5, draw: () => this.worker(v) });
  }

  /** The low picture, enlarged without smoothing; then the words are written on the view itself. */
  protected override lit(): void {
    if (!this.toLow || !this.low) return;
    const real = this.on.ctx, k = this.on.dpr / this.scale;
    real.save(); real.setTransform(1, 0, 0, 1, 0, 0); real.imageSmoothingEnabled = false;
    real.drawImage(this.low, 0, 0, this.low.width, this.low.height, 0, 0, this.low.width * k, this.low.height * k);
    real.restore();
    this.toLow = false;
  }

  protected override palette(): Palette {
    const now = performance.now();
    if (this.pal && now - this.palAt < 2000) return this.pal;
    const cs = getComputedStyle(document.documentElement), surface = cs.getPropertyValue('--theme-bg-surface').trim() || '#18181b', accent = cs.getPropertyValue('--theme-accent').trim() || '#D77655';
    const p = isLight(surface) || this.opts.dark === 'cream' ? CREAM : NIGHT, ground = luminance(p.floor) ?? 0.5;
    this.palAt = now;
    /* the theme's accent, made to read on the workshop's floor */
    this.pal = { ...p, accent: p.light ? legible(accent, ground) : mix(accent, '#ffffff', luminance(accent)! < 0.2 ? 0.35 : 0) };
    return this.pal;
  }

  /** Tiles, a little darker one in two, with a seam between them. */
  protected override floorPaint(): string { return this.palette().floor; }
  protected override dress(ctx: CanvasRenderingContext2D, F: { x: number; y: number; w: number; h: number }, st: ViewState, pal: Palette): void {
    if (st.grid === false) return;
    const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
    const i0 = Math.max(F.x, Math.floor(a.x)), i1 = Math.min(F.x + F.w, Math.ceil(b.x)), j0 = Math.max(F.y, Math.floor(a.y)), j1 = Math.min(F.y + F.h, Math.ceil(b.y));
    ctx.fillStyle = mix(pal.floor, '#000000', pal.light ? 0.035 : 0.12);
    ctx.beginPath();
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if ((i + j) % 2) ctx.rect(i, j, 1, 1);
    ctx.fill();
    const px = 1 / ART;
    ctx.fillStyle = mix(pal.floor, '#000000', pal.light ? 0.08 : 0.2);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) ctx.rect(i, j0, px, j1 - j0);
    for (let j = j0; j <= j1; j++) ctx.rect(i0, j, i1 - i0, px);
    ctx.fill();
  }

  /** The lamp's light on the floor, as pixel art has it: a band of dither round the station, not a blur. */
  protected override glow(ctx: CanvasRenderingContext2D, m: StationSpec, s: Lamp, pal: Palette): void {
    const o = 1 / ART, band = 0.5;
    ctx.fillStyle = s === 'off' ? pal.danger : pal.amber; ctx.globalAlpha = s === 'off' ? 0.35 : 0.5;
    ctx.beginPath();
    for (let k = 0; k < 2; k++) {
      const x0 = m.x - band * (1 - k * 0.5), y0 = m.y - band * (1 - k * 0.5), x1 = m.x + m.w + band * (1 - k * 0.5), y1 = m.y + m.h + band * (1 - k * 0.5), d = k ? 2 : 4;
      for (let x = x0; x < x1; x += o * d) { ctx.rect(x, y0, o, o); ctx.rect(x + o * (d / 2), y1 - o, o, o); }
      for (let y = y0; y < y1; y += o * d) { ctx.rect(x0, y + o * (d / 2), o, o); ctx.rect(x1 - o, y, o, o); }
    }
    ctx.fill(); ctx.globalAlpha = 1;
  }

  /** A hard shadow, down and to the right, as in pixel art. */
  protected override shadows(st: ViewState, pal: Palette): void {
    if (st.edit) return;
    const ctx = this.ctx;
    ctx.fillStyle = pal.light ? 'rgba(40,30,20,0.18)' : 'rgba(0,0,0,0.45)';
    for (const m of st.layout.machines) if (m.kind === 'station') ctx.fillRect(m.x + 0.22, m.y + 0.3, m.w - 0.2, m.h - 0.2);
  }

  /** Flat, as pixel art is: no light from above. */
  protected override bodyFill(kind: RunKind | null, _y: number, _h: number, pal: Palette): string { return kind === 'script' ? mix(pal.body, '#000000', pal.light ? 0.12 : 0.35) : pal.body; }
  /** A thick outline, its kind's hue darkened: the kind still shows, the edge reads as drawn. */
  protected override bodyEdge(gate: boolean, tint: string, pal: Palette): { color: string; width: number } {
    return gate ? { color: pal.amber, width: 0.14 } : { color: mix(tint, '#000000', pal.light ? 0.45 : 0.15), width: 0.11 };
  }

  /** A ticket is a crate: wood, a band in the colour of its type on top, a plank line, an outline. */
  protected override token(look: TokenLook, _type: string, tint: string, px: number, py: number, T: number, alpha: number): boolean {
    const ctx = this.ctx, w = T * 0.86, h = T * 0.66, x = px - w / 2, y = py - h / 2, o = 1 / ART;
    ctx.globalAlpha = look === 'ghost' ? alpha * 0.8 : alpha;
    ctx.fillStyle = look === 'ghost' ? '#9a9a9a' : WOOD; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = look === 'ghost' ? '#7a7a7a' : PLANK; ctx.fillRect(x, y + h * 0.55, w, o * 1.2);
    ctx.fillStyle = tint; ctx.fillRect(x, y, w, h * 0.3);
    ctx.strokeStyle = INK; ctx.lineWidth = o * 1.4; ctx.strokeRect(x + o * 0.7, y + o * 0.7, w - o * 1.4, h - o * 1.4);
    ctx.globalAlpha = 1;
    return true;
  }

  /** A worker at the foot of a station, in the hue of its kind; it bobs while something runs there. */
  private worker(v: StationView): void {
    const ctx = this.ctx, m = v.m, busy = v.places.some((p) => p.t?.t.phase === 'running'), o = 1 / ART;
    const x = m.x + m.w - 0.75, y = m.y + m.h - 0.02 - (busy && Math.floor(this.clock * 6) % 2 ? o : 0);
    const shirt = v.run ? { agent: '#8b7cf6', skill: '#38a8e8', panel: '#f08a3c', script: '#7cc43a' }[v.run] : '#f2b01e';
    const r = (dx: number, dy: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x + dx * o, y + dy * o, w * o, h * o); };
    r(-4, -1, 8, 2, 'rgba(40,30,20,0.25)');
    const step = busy ? Math.floor(this.clock * 6) % 2 : 0;
    r(-3, -6, 2, 5 - step, '#3d4a7a'); r(1, -6, 2, 5 - (1 - step), '#3d4a7a');
    r(-4, -11, 8, 6, shirt);
    r(-2, -15, 4, 4, '#f2c79e');
    r(-3, -17, 6, 2, '#f2b01e');
    if (busy) r(4, -10 - step, 2, 3, '#f2c79e');
  }
}
