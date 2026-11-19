/**
 * The pixel skin, "workshop": the floor in pixel art, chosen on `docs/factory/pixel-flat.html`.
 *
 * Pixel art from the same painters: the picture is painted at a low resolution, `ART` pixels to a tile, then enlarged
 * without smoothing. The words are not: they wait, and are written crisp over the enlarged picture, in pixel fonts
 * (`pixelFonts.css`). Pixels are whole only when a tile is a whole number of screen pixels per art pixel, so the zoom
 * rests on `PIXEL_STEPS` only: the view glides between them and never stops between them (`steps`, read by the view).
 * Seen from far (under `ART` pixels a tile), the picture is not pixelated: a pixel of art would be smaller than a pixel
 * of the screen.
 *
 * Its own drawing: a floor of tiles, flat bodies with a thick outline in their kind's hue, hard shadows, a dithered
 * lamp light, tickets as crates in the colour of their type, and a worker at the foot of each station that runs
 * something, busy while it does. Workers are procedural: drawn from the scene at each frame, kept by no one.
 *
 * It follows the theme: a cream workshop on a light theme, a workshop at night on a dark one, with the theme's accent
 * made to read on it. The page around the floor is painted in the same workshop (`workshopTheme`).
 */
import './pixelFonts.css';
import type { Theme } from '../../lib/themes';
import { isLight, mix, readable, toHex } from '../floorLook';
import type { Lamp, RunKind } from '../machineArt';
import type { StationSpec } from '../types';
import type { Scene, StationView } from '../scene';
import type { ViewState } from '../renderer';
import type { TokenLook } from '../ticketToken';
import { FleexSkin, type Palette } from './fleex';
import type { Piece, Surface } from './skin';

/** The pixel fonts, as a canvas asks for them. */
export const PIXEL_FONTS = ['400 16px "Silkscreen"', '700 16px "Silkscreen"', '500 16px "Pixelify Sans"', '700 16px "Pixelify Sans"'];
/** The font of the page around a pixel floor. */
export const WORKSHOP_FONT = '"Pixelify Sans", ui-sans-serif, system-ui, sans-serif';
/** Art pixels to a tile. */
export const ART = 16;
/** The zooms the view rests on, in screen pixels per tile: whole multiples of the art, and two far ones. */
export const PIXEL_STEPS: readonly number[] = [4, 8, 16, 32, 48, 64, 80];

/** The workshop by day (on a light theme) and at night (on a dark one): its floor, and what is written on it. */
export const CREAM = {
  bg: '#e8dfcc', floor: '#efe7d6', grid: '#d9cfbb', belt: '#56525f', edge: '#2b2833', chev: '#d8d2e0', fast: '#2f7fd6', body: '#f4ecdc',
  text: '#1d1b26', text2: '#4b4655', text3: '#6b6574', ok: '#256b30', warn: '#7a4f00', danger: '#a3221b', amber: '#c27c0e', light: true,
} as const;
export const NIGHT = {
  bg: '#17151d', floor: '#25222c', grid: '#2f2b38', belt: '#4a4555', edge: '#0f0e14', chev: '#b3acc4', fast: '#5aa9ff', body: '#3a3644',
  text: '#f4ecdc', text2: '#d2ccdb', text3: '#9a93ab', ok: '#4fbf5f', warn: '#f2b01e', danger: '#ff7a72', amber: '#f2b01e', light: false,
} as const;
/** The rings of a lamp's light, nearest first: how strong each is. How many times a second it flickers. */
const RINGS = [0.42, 0.26, 0.13], FLICKER = 6;
/** A number from a string, the same each time: what lets the flicker be random and kept by no one. */
function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** A crate's wood, its plank line and its outline. */
const WOOD = '#c8955a', PLANK = '#9c6b3a', INK = '#2b2833';

/** The workshop that goes with a theme: by day on a light one, at night on a dark one. */
export const workshopOf = (light: boolean) => (light ? CREAM : NIGHT);
/** The theme's accent, made to read on the workshop's floor and bodies: darkened by day, lifted at night. */
export function workshopAccent(accent: string, light: boolean): string {
  const w = workshopOf(light);
  /* its floor and bodies, and the grounds of the page around it (see `workshopTheme`) */
  return readable(accent, [w.floor, w.body, w.bg, light ? '#e9dfca' : '#2f2b38'], 4.5, light ? '#000000' : '#ffffff');
}

/**
 * The theme the page around a pixel floor is painted in: the workshop's surfaces and inks, by day or at night as the
 * theme is, the theme's accent made to read on them, the rest of the theme as it is. Every ink holds 4.5 on its
 * surfaces (`pixel.test.ts`).
 */
export function workshopTheme(theme: Theme): Theme {
  const light = isLight(theme.colors.bgSurface), accent = workshopAccent(theme.colors.accent, light), [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  const day = {
    bgBase: '#e8dfcc', bgSurface: '#f4ecdc', bgOverlay: '#e9dfca', bgHover: 'rgba(217, 207, 187, 0.5)', bgOverlayHover: '#d9cfbb',
    border: '#cfc3aa', borderSubtle: 'rgba(207, 195, 170, 0.5)', borderInput: '#a89c84',
    textPrimary: '#1d1b26', textSecondary: '#4b4655', textMuted: '#5c5665', textFaint: '#7d7686', success: CREAM.ok, warning: CREAM.warn, danger: CREAM.danger,
  };
  const night = {
    bgBase: '#17151d', bgSurface: '#25222c', bgOverlay: '#2f2b38', bgHover: 'rgba(58, 54, 68, 0.5)', bgOverlayHover: '#3a3644',
    border: '#3a3644', borderSubtle: 'rgba(58, 54, 68, 0.5)', borderInput: '#4f4a5c',
    textPrimary: '#f4ecdc', textSecondary: '#d2ccdb', textMuted: '#a9a2ba', textFaint: '#857e98', success: NIGHT.ok, warning: NIGHT.warn, danger: NIGHT.danger,
  };
  return {
    ...theme, id: `${theme.id}@workshop`, name: `${theme.name}, in the workshop`, builtIn: false,
    colors: { ...(light ? day : night), accent, accentHover: toHex(mix(accent, light ? '#000000' : '#ffffff', 0.12)), accentActive: toHex(mix(accent, light ? '#000000' : '#ffffff', 0.24)), accentMuted: `rgba(${r}, ${g}, ${b}, 0.15)` },
  };
}

export class PixelSkin extends FleexSkin {
  override readonly id: string = 'pixel';
  /** The zoom rests on these only. */
  readonly steps = PIXEL_STEPS;
  /** The picture at low resolution, and how many of its pixels there are to a pixel of the view (CSS). */
  private low: HTMLCanvasElement | null = null;
  private lowCtx: CanvasRenderingContext2D | null = null;
  private scale = 1;
  /** Painting into the low picture (from the floor to the pieces), or onto the view (the words). */
  private toLow = false;

  constructor() {
    super();
    this.fonts = { sans: WORKSHOP_FONT, mono: '"Silkscreen", ui-monospace, monospace' };
    /* a canvas does not ask for a font it is told to use: ask now, and the words take it at the frame after it came */
    if (typeof document !== 'undefined' && document.fonts) for (const f of PIXEL_FONTS) void document.fonts.load(f).catch(() => undefined);
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
    /* the light of the lamps that need someone, on the floor, under everything */
    const pal = this.palette();
    for (const [m, s] of S.lit) out.push({ layer: 'floor', depth: 0, draw: () => this.halo(m, s, pal) });
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
    const light = isLight(surface), p = workshopOf(light);
    this.palAt = now;
    this.pal = { ...p, accent: workshopAccent(accent, light) };
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

  /** No light in the floor's picture: it flickers, so it is painted at every frame (`halo`), not once. */
  protected override glow(): void { /* see `halo` */ }

  /**
   * The lamp's light on the floor, as pixel art draws a light: rings round the station, solid, paler the farther they
   * are, their corners cut rounder. It flickers: a few times a second the rings breathe a little, their tint shifts,
   * and a few of their pixels flare. Chosen at random from the station and the moment, so nothing is kept; it stands
   * still when the floor does (its clock is the floor's).
   */
  protected halo(m: StationSpec, s: Lamp, pal: Palette): void {
    const ctx = this.ctx, o = 1 / ART, t = 3 * o, base = s === 'off' ? pal.danger : pal.amber, beat = Math.floor(this.clock * FLICKER);
    const seed = hash(m.id), rnd = (k: number) => hash(`${seed}:${beat}:${k}`) / 0xffffffff;
    const strength = s === 'off' ? 0.6 : 1;
    for (let i = 0; i < RINGS.length; i++) {
      const e = (i + 1) * t, cut = (i + 1) * o * 2, x0 = m.x - e, y0 = m.y - e, w = m.w + e * 2, h = m.h + e * 2;
      /* it breathes, and its tint wanders between the lamp's colour and a warmer, lighter one */
      ctx.globalAlpha = RINGS[i]! * strength * (0.82 + 0.18 * rnd(i));
      ctx.fillStyle = mix(base, '#ffffff', 0.25 * rnd(i + 10));
      ctx.beginPath();
      ctx.rect(x0 + cut, y0, w - cut * 2, t); ctx.rect(x0 + cut, y0 + h - t, w - cut * 2, t);
      ctx.rect(x0, y0 + cut, t, h - cut * 2); ctx.rect(x0 + w - t, y0 + cut, t, h - cut * 2);
      /* the corner, one step in: the ring reads round */
      ctx.rect(x0 + cut - o * 2 + t / 3, y0 + t, o * 2, o * 2); ctx.rect(x0 + w - cut - t / 3, y0 + t, o * 2, o * 2);
      ctx.rect(x0 + cut - o * 2 + t / 3, y0 + h - t - o * 2, o * 2, o * 2); ctx.rect(x0 + w - cut - t / 3, y0 + h - t - o * 2, o * 2, o * 2);
      ctx.fill();
    }
    /* a few pixels flare, here and there along the rings */
    const n = Math.round((m.w + m.h) * 1.5);
    ctx.fillStyle = mix(base, '#ffffff', 0.55);
    for (let k = 0; k < n; k++) {
      const side = Math.floor(rnd(100 + k) * 4), along = rnd(200 + k), off = Math.floor(rnd(300 + k) * RINGS.length * 3) * o;
      ctx.globalAlpha = (0.35 + 0.4 * rnd(400 + k)) * strength;
      const len = side % 2 ? m.h : m.w, at = Math.floor(along * len * ART) * o;
      if (side === 0) ctx.fillRect(m.x + at, m.y - o - off, o, o);
      else if (side === 2) ctx.fillRect(m.x + at, m.y + m.h + off, o, o);
      else if (side === 1) ctx.fillRect(m.x + m.w + off, m.y + at, o, o);
      else ctx.fillRect(m.x - o - off, m.y + at, o, o);
    }
    ctx.globalAlpha = 1;
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
  protected worker(v: StationView): void {
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
