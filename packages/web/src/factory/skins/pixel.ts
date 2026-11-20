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
import { bodyOf, type Lamp, type Rect, type RunKind } from '../machineArt';
import type { StationSpec } from '../types';
import type { BeltView, Scene, StationView } from '../scene';
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

/**
 * How sharp the pixel art is. DRAFT for the readability mock-up (`docs/factory/pixel-crisp.html`): neither is on in
 * the app until the owner picks.
 * - `crisp` (step 1): the view rests on the grid of art pixels; the words are in Silkscreen at whole multiples of 8
 *   pixels of the screen (the only sizes it is sharp at) on whole pixels, or not written; a ticket is the object of its
 *   type, eleven pixels square (a crate when it has none), on whole pixels; no line is thinner than a pixel.
 * - `sprites` (step 2): a station's body, head, badge, lamp and places, the belts' chevrons, the crates and the mark of
 *   what runs are drawn pixel by pixel, every pixel full or empty.
 */
export interface PixelLook { crisp?: boolean; sprites?: boolean }

/** The icons of the kinds of station, seven pixels square: an agent's head, a tool, three seats, a prompt, a shield. */
const ICONS: Record<string, readonly string[]> = {
  agent: ['...X...', '.XXXXX.', 'X.....X', 'X.X.X.X', 'X.....X', 'X.XXX.X', '.XXXXX.'],
  skill: ['....XX.', '...X..X', '...X.X.', '..X.X..', '.X.X...', 'X.X....', 'XX.....'],
  panel: ['XX...XX', 'XX...XX', '.......', '..XXX..', '..XXX..', '.......', 'XXXXXXX'],
  script: ['XXXXXXX', 'X.....X', 'X.X...X', 'X..X..X', 'X.X.XXX', 'X.....X', 'XXXXXXX'],
  human_gate: ['XXXXXXX', 'X.....X', 'X....XX', 'XX..X.X', 'X.XX..X', '.X...X.', '..XXX..'],
};
/**
 * The tickets' types, eleven pixels square, as the rest of Fleex draws them (`TicketTypeIconSvg`): a hammer, a bug,
 * an eye, a gear, a briefcase, a light bulb. `X` the outline, `o` the type's colour, `w` its light, `g` grey. A ticket
 * with no type is a crate, as in the rest of Fleex.
 */
const TYPE_ICONS: Record<string, readonly string[]> = {
  build: ['.XXXXXXXX..', 'XowooooooX.', 'XooooooooXX', '.XXXXooXXX.', '....XooX...', '....XooX...', '....XooX...', '....XooX...', '....XooX...', '....XooX...', '....XXXX...'],
  fix: ['..X.....X..', '...XXXXX...', '..XowoooX..', 'XXXoooooXXX', '..XooXooX..', 'XXXooXooXXX', '..XooXooX..', 'XXXooXooXXX', '..XooXooX..', '...XXXXX...', '...........'],
  review: ['...........', '...........', '...XXXXX...', '.XXoooooXX.', 'XoooXXXoooX', 'XooXXwXXooX', 'XoooXXXoooX', '.XXoooooXX.', '...XXXXX...', '...........', '...........'],
  ops: ['...XX.XX...', '..XooXooX..', '.XXooXooXX.', 'XowoooooooX', 'XoooXXXoooX', '.XXoX.XoXX.', 'XoooXXXoooX', 'XoooooooooX', '.XXooXooXX.', '..XooXooX..', '...XX.XX...'],
  lead: ['...........', '....XXX....', '...X...X...', 'XXXXXXXXXXX', 'XowoooooooX', 'XoooooooooX', 'XXXXXwXXXXX', 'XoooooooooX', 'XoooooooooX', 'XXXXXXXXXXX', '...........'],
  think: ['...XXXXX...', '..XowoooX..', '.XowoooooX.', '.XoooooooX.', '.XoooooooX.', '..XoooooX..', '...XoooX...', '...XXXXX...', '...XgggX...', '...XXXXX...', '....XXX....'],
};
/** A chevron pointing east, three pixels by five. */
const CHEVRON = ['X..', '.X.', '..X', '.X.', 'X..'];

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

  private readonly look: PixelLook;
  /** The view's camera moved onto the grid of art pixels, for this frame (crisp only). */
  private snapCam: { x: number; y: number; z: number } | null = null;
  constructor(look: PixelLook = {}) {
    super();
    this.look = { ...look, crisp: look.crisp || look.sprites };
    this.fonts = this.look.crisp ? { sans: '"Silkscreen", ui-monospace, monospace', mono: '"Silkscreen", ui-monospace, monospace' } : { sans: WORKSHOP_FONT, mono: '"Silkscreen", ui-monospace, monospace' };
    this.spaced = !this.look.crisp;
    /* a canvas does not ask for a font it is told to use: ask now, and the words take it at the frame after it came */
    if (typeof document !== 'undefined' && document.fonts) for (const f of PIXEL_FONTS) void document.fonts.load(f).catch(() => undefined);
  }

  protected override get ctx(): CanvasRenderingContext2D { return this.toLow && this.lowCtx ? this.lowCtx : this.on.ctx; }
  protected override get cv(): HTMLCanvasElement { return this.toLow && this.low ? this.low : this.on.cv; }
  protected override get dpr(): number { return this.toLow ? this.scale : this.on.dpr; }
  protected override get cam(): Surface['cam'] { return this.snapCam ?? this.on.cam; }
  /** A length of the floor, on the grid of art pixels. */
  private sn(v: number): number { return Math.round(v * ART) / ART; }
  private get sprites(): boolean { return !!this.look.sprites && this.toLow; }

  override ground(on: Surface, S: Scene, st: ViewState): void {
    this.on = on;
    /* art pixels to a CSS pixel; at most the screen's own: from far the picture is not pixelated */
    this.scale = Math.min(on.dpr, ART / on.cam.z);
    this.toLow = this.scale < on.dpr;
    if (this.toLow) {
      const low = this.low ?? (this.low = document.createElement('canvas')), w = Math.max(1, Math.ceil(on.w * this.scale)), h = Math.max(1, Math.ceil(on.h * this.scale));
      if (low.width !== w || low.height !== h) { low.width = w; low.height = h; }
      this.lowCtx = low.getContext('2d');
      if (this.lowCtx) { this.lowCtx.imageSmoothingEnabled = false; if (this.look.crisp) thick(this.lowCtx); } else this.toLow = false;
    }
    /* crisp: the camera onto the grid of art pixels, so that what is on whole pixels of the floor is on whole pixels of the picture */
    const crisp = !!this.look.crisp && this.toLow;
    this.snapCam = null;
    if (crisp) {
      const z = on.cam.z, k = this.scale, tx = Math.round((on.w / 2 - on.cam.x * z) * k), ty = Math.round((on.h / 2 - on.cam.y * z) * k);
      this.snapCam = { x: (on.w / 2 - tx / k) / z, y: (on.h / 2 - ty / k) / z, z };
    }
    super.ground(on, S, st);
  }

  /**
   * Crisp: Silkscreen is sharp only at whole multiples of 8 pixels of the screen, on whole pixels. A word keeps about
   * the size it asks for, brought down to such a multiple; one that would be under 8 pixels is not written (what is on
   * a plate always is). Words are written over the picture, at the screen's resolution: written into it, on the grid of
   * art pixels, they would be half a tile high.
   */
  protected override wordSize(px: number, size: number, plated: boolean): number | null {
    if (!this.look.crisp) return px;
    /* the size asked, as the zoom makes it (not held under a maximum: pixel art grows with the zoom, its words with it) */
    const d = this.on.dpr, asked = Math.max(px, size * this.cam.z), n = Math.floor((asked * d) / 8 + 0.25);
    if (n < 1 && !plated) return null;
    return (Math.max(1, n) * 8) / d;
  }
  protected override wordAt(sx: number, sy: number): [number, number] {
    if (!this.look.crisp) return [sx, sy];
    const d = this.on.dpr;
    return [Math.round(sx * d) / d, Math.round(sy * d) / d];
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
  protected override token(look: TokenLook, type: string, tint: string, px: number, py: number, T: number, alpha: number): boolean {
    if (this.look.crisp && this.toLow) return TYPE_ICONS[type] ? this.typeIcon(TYPE_ICONS[type]!, look, tint, px, py, alpha) : this.crate(look, tint, px, py, T, alpha);
    const ctx = this.ctx, w = T * 0.86, h = T * 0.66, x = px - w / 2, y = py - h / 2, o = 1 / ART;
    ctx.globalAlpha = look === 'ghost' ? alpha * 0.8 : alpha;
    ctx.fillStyle = look === 'ghost' ? '#9a9a9a' : WOOD; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = look === 'ghost' ? '#7a7a7a' : PLANK; ctx.fillRect(x, y + h * 0.55, w, o * 1.2);
    ctx.fillStyle = tint; ctx.fillRect(x, y, w, h * 0.3);
    ctx.strokeStyle = INK; ctx.lineWidth = o * 1.4; ctx.strokeRect(x + o * 0.7, y + o * 0.7, w - o * 1.4, h - o * 1.4);
    ctx.globalAlpha = 1;
    return true;
  }

  /** Crisp: a crate on whole pixels, at least twelve wide: wood, a band in its type's colour, a plank line, a one-pixel outline. */
  private crate(look: TokenLook, tint: string, px: number, py: number, T: number, alpha: number): boolean {
    const ctx = this.ctx, o = 1 / ART, w = Math.max(12, Math.round(T * ART * 0.95)), h = Math.round(w * 0.75), x = Math.round(px * ART - w / 2) * o, y = Math.round(py * ART - h / 2) * o;
    const ghost = look === 'ghost', r = (dx: number, dy: number, ww: number, hh: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x + dx * o, y + dy * o, ww * o, hh * o); };
    ctx.globalAlpha = ghost ? alpha * 0.8 : alpha;
    r(0, 0, w, h, INK);
    r(1, 1, w - 2, h - 2, ghost ? '#9a9a9a' : WOOD);
    r(1, 1, w - 2, Math.max(2, Math.round(h * 0.3)), tint);
    r(1, Math.round(h * 0.62), w - 2, 1, ghost ? '#7a7a7a' : PLANK);
    r(2, h - 2, 1, 1, PLANK); r(w - 3, h - 2, 1, 1, PLANK);
    ctx.globalAlpha = 1;
    return true;
  }

  /** Crisp: a ticket's number, under its eleven pixels and a pixel apart, whatever the zoom (its plate is 12 pixels of the screen high). */
  protected override numberDy(B: number): number { return this.look.crisp && this.toLow ? 6.5 / ART + 6 / this.cam.z : super.numberDy(B); }

  /** Crisp: a ticket as the object of its type, eleven pixels square on whole pixels, in its type's colour. */
  private typeIcon(rows: readonly string[], look: TokenLook, tint: string, px: number, py: number, alpha: number): boolean {
    const ctx = this.ctx, o = 1 / ART, x = Math.round(px * ART - 5.5) * o, y = Math.round(py * ART - 5.5) * o, ghost = look === 'ghost';
    const fill = ghost ? '#9a9a9a' : tint, ink: Record<string, string> = { X: INK, o: fill, w: mix(fill, '#ffffff', 0.55), g: '#9a93ab' };
    ctx.globalAlpha = ghost ? alpha * 0.8 : alpha;
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = ink[row[i]!]; if (c) { ctx.fillStyle = c; ctx.fillRect(x + i * o, y + j * o, o, o); } } });
    ctx.globalAlpha = 1;
    return true;
  }

  // ---------- step 2: drawn pixel by pixel ----------
  /** A bitmap of the floor, from rows of `X`, its top-left on a whole art pixel. */
  private bits(rows: readonly string[], x: number, y: number, color: string, turn = 0): void {
    const ctx = this.ctx, o = 1 / ART, n = rows.length, m = rows[0]!.length;
    ctx.fillStyle = color;
    for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) {
      if (rows[j]![i] !== 'X') continue;
      /* turned a quarter at a time, clockwise: east, south, west, north */
      const [u, v] = turn === 1 ? [n - 1 - j, i] : turn === 2 ? [m - 1 - i, j] : turn === 3 ? [j, m - 1 - i] : [i, j];
      ctx.fillRect(x + u * o, y + v * o, o, o);
    }
  }
  /** A rectangle with its corners cut one pixel in, on whole pixels. */
  private notched(x: number, y: number, w: number, h: number, c: string, cut = 1): void {
    const ctx = this.ctx, o = 1 / ART;
    ctx.fillStyle = c;
    ctx.fillRect(x + cut * o, y, w - 2 * cut * o, h); ctx.fillRect(x, y + cut * o, w, h - 2 * cut * o);
  }
  protected override stationBody(v: StationView, tint: string, pal: Palette): void {
    if (!this.sprites) { super.stationBody(v, tint, pal); return; }
    const ctx = this.ctx, o = 1 / ART, { m, gate } = v, kind = v.run, b = bodyOf(m);
    const X = this.sn(b.x) + o, Y = this.sn(b.y) + o, W = this.sn(b.x + b.w) - o - X, H = this.sn(b.y + b.h) - o - Y;
    const edge = this.bodyEdge(gate, tint, pal).color, fill = this.bodyFill(kind, Y, H, pal) as string;
    if (kind === 'panel') for (const k of [2, 1]) { this.notched(X + k * 2 * o, Y - k * 2 * o, W, H, mix(edge, pal.body, 0.4 * k), 2); this.notched(X + k * 2 * o + 2 * o, Y - k * 2 * o + 2 * o, W - 4 * o, H - 4 * o, pal.body, 1); }
    if (kind === 'agent') { const ax = this.sn(b.x + 0.92); ctx.fillStyle = tint; ctx.fillRect(ax, Y - 3 * o, o, 3 * o); ctx.fillRect(ax - o, Y - 5 * o, 3 * o, 2 * o); }
    if (gate) {
      this.notched(X, Y, W, H, fill, 2);
      /* a dashed edge: four pixels on, three off, two thick */
      ctx.fillStyle = edge;
      for (let x = X + 2 * o; x < X + W - 2 * o; x += 7 * o) { const l = Math.min(4 * o, X + W - 2 * o - x); ctx.fillRect(x, Y, l, 2 * o); ctx.fillRect(x, Y + H - 2 * o, l, 2 * o); }
      for (let y = Y + 2 * o; y < Y + H - 2 * o; y += 7 * o) { const l = Math.min(4 * o, Y + H - 2 * o - y); ctx.fillRect(X, y, 2 * o, l); ctx.fillRect(X + W - 2 * o, y, 2 * o, l); }
    } else {
      this.notched(X, Y, W, H, edge, 2);
      this.notched(X + 2 * o, Y + 2 * o, W - 4 * o, H - 4 * o, fill, 1);
      /* light along the top edge, shade along the bottom */
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(X + 3 * o, Y + 2 * o, W - 6 * o, o);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(X + 3 * o, Y + H - 3 * o, W - 6 * o, o);
    }
    if (kind === 'script') {
      ctx.fillStyle = mix(tint, fill, 0.6); ctx.fillRect(X + 2 * o, Y + 2 * o, W - 4 * o, 3 * o);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = mix(tint, '#000000', i * 0.2); ctx.fillRect(X + (4 + i * 3) * o, Y + 3 * o, 2 * o, o); }
    }
  }
  protected override stationHead(v: StationView, tint: string, pal: Palette): void {
    if (!this.sprites) { super.stationHead(v, tint, pal); return; }
    const o = 1 / ART, { m, gate, parts: P } = v, kind = v.run;
    /* the badge has its icon's parity, so the icon sits in its middle to the pixel: one pixel wider (or higher) when it would not */
    const odd = (n: number) => (n % 2 === 7 % 2 ? n : n + 1);
    const bx = this.sn(P.badge.x), by = this.sn(P.badge.y), bw = odd(Math.max(9, Math.round(P.badge.w * ART))), bh = odd(Math.max(9, Math.round(P.badge.h * ART)));
    this.notched(bx, by, bw * o, bh * o, kind ? tint : mix(tint, pal.body, 0.7));
    const icon = ICONS[m.exec];
    if (icon) this.bits(icon, bx + ((bw - 7) / 2) * o, by + ((bh - 7) / 2) * o, kind ? INK : mix(tint, '#000000', 0.3));
    /* its name beside the badge; under it what it runs, when there is room for a second line; its kind is its hue and its icon */
    const nx = bx + (bw + 3) * o, fit = P.lamp.x - nx - 0.1, mid = by + (bh * o) / 2, two = 0.19 * this.cam.z * this.on.dpr >= 7;
    this.label(m.name || (gate ? 'Gate' : 'Station'), nx, two ? mid - 0.13 : mid, 0.31, pal.text, { weight: 700, fit });
    if (two) this.label(v.what, nx, mid + 0.2, 0.19, pal.text3, { fit });
  }
  protected override lamp(v: StationView, pointed: boolean, pal: Palette): void {
    if (!this.sprites) { super.lamp(v, pointed, pal); return; }
    const ctx = this.ctx, o = 1 / ART, { parts: P, lamp: L } = v;
    const x = this.sn(P.lamp.x), y = this.sn(P.lamp.y), w = 7, h = 3 * 4 + 3;
    this.notched(x, y, w * o, h * o, pointed ? pal.text : '#0f0e14');
    this.notched(x + o, y + o, (w - 2) * o, (h - 2) * o, '#1d1b26');
    for (let i = 0; i < 3; i++) {
      const on = (i === 0 && L === 'off') || (i === 1 && L === 'call') || (i === 2 && L === 'on'), col = ['#ff4d4d', '#ffc21a', '#3ddc5a'][i]!;
      const ly = y + (2 + i * 4) * o;
      if (on && (i !== 1 || Math.floor(this.clock * 3) % 2 === 0)) { ctx.fillStyle = mix(col, '#ffffff', 0.4); ctx.fillRect(x + 2 * o, ly, 3 * o, 3 * o); ctx.fillStyle = col; ctx.fillRect(x + 3 * o, ly + o, o, o); }
      else { ctx.fillStyle = on ? col : '#3a3644'; ctx.fillRect(x + 2 * o, ly, 3 * o, 3 * o); }
    }
  }
  protected override pit(r: Rect, pal: Palette): void {
    if (!this.sprites) { super.pit(r, pal); return; }
    const ctx = this.ctx, o = 1 / ART, x = this.sn(r.x), y = this.sn(r.y), w = this.sn(r.x + r.w) - x, h = this.sn(r.y + r.h) - y;
    ctx.fillStyle = pal.light ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pal.light ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.4)'; ctx.fillRect(x, y, w, o); ctx.fillRect(x, y + o, o, h - o);
    ctx.fillStyle = pal.light ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.08)'; ctx.fillRect(x + o, y + h - o, w - o, o); ctx.fillRect(x + w - o, y + o, o, h - 2 * o);
  }
  protected override idle(kind: RunKind, cx: number, cy: number, size: number, c: Rect, tint: string): void {
    if (!this.sprites) { super.idle(kind, cx, cy, size, c, tint); return; }
    const ctx = this.ctx, o = 1 / ART;
    ctx.globalAlpha = 0.35; this.bits(ICONS[kind]!, this.sn(cx) - 3 * o, this.sn(cy) - 3 * o, tint); ctx.globalAlpha = 1;
  }
  /** At work: a pixel running round the crate, with two behind it. */
  protected override runMark(px: number, py: number, B: number, seed: number): boolean {
    if (!this.sprites) return false;
    const ctx = this.ctx, o = 1 / ART, w = 15, h = 15;
    const x = Math.round(px * ART - w / 2) * o, y = Math.round(py * ART - h / 2) * o, per = 2 * (w + h) - 4, head = Math.floor(this.clock * 18 + seed * 7) % per;
    const at = (k: number): [number, number] => { k = ((k % per) + per) % per; if (k < w) return [k, 0]; k -= w - 1; if (k < h) return [w - 1, k]; k -= h - 1; if (k < w) return [w - 1 - k, h - 1]; k -= w - 1; return [0, h - 1 - k]; };
    for (let i = 0; i < 4; i++) { const [u, v] = at(head - i); ctx.fillStyle = i ? (i === 1 ? '#3ddc5a' : 'rgba(61,220,90,0.5)') : '#ffffff'; ctx.fillRect(x + u * o, y + v * o, o, o); }
    return true;
  }
  /** A straight belt's chevrons, on whole pixels; a bend keeps the curved ones. */
  protected override beltChevrons(v: BeltView, pal: Palette): void {
    if (!this.sprites || v.bend >= 0) { super.beltChevrons(v, pal); return; }
    const b = v.m, fast = !!b.fast, off = (this.clock * (fast ? 1.2 : 0.6)) % 0.5, dx = [1, 0, -1, 0][b.dir]!, dy = [0, 1, 0, -1][b.dir]!, o = 1 / ART;
    const us: number[] = [];
    for (let k = 0; k < 2; k++) { const u = off + k * 0.5; if (fast) us.push(u - 0.075, u + 0.075); else us.push(u); }
    for (const u of us) {
      if (u < 0.08 || u > 0.92) continue;
      const cx = b.x + 0.5 + dx * (u - 0.5), cy = b.y + 0.5 + dy * (u - 0.5), wide = dx ? 3 : 5, high = dx ? 5 : 3;
      this.bits(CHEVRON, this.sn(cx) - Math.floor(wide / 2) * o, this.sn(cy) - Math.floor(high / 2) * o, fast ? pal.fast : pal.chev, b.dir);
    }
  }

  /** A worker at the foot of a station, in the hue of its kind; it bobs while something runs there. */
  protected worker(v: StationView): void {
    const ctx = this.ctx, m = v.m, busy = v.places.some((p) => p.t?.t.phase === 'running'), o = 1 / ART;
    const x = m.x + m.w - 0.75, y = (this.look.crisp ? m.y + m.h : m.y + m.h - 0.02) - (busy && Math.floor(this.clock * 6) % 2 ? o : 0);
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

/**
 * Crisp: no line thinner than a pixel of the picture. A canvas draws a thinner one as a smear of half-lit pixels, which
 * is what blurs pixel art; it is widened to one pixel, whatever the transform it is drawn under.
 */
const thickened = new WeakSet<CanvasRenderingContext2D>();
function thick(ctx: CanvasRenderingContext2D): void {
  if (thickened.has(ctx)) return;
  thickened.add(ctx);
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'lineWidth');
  if (!d?.get || !d.set) return;
  Object.defineProperty(ctx, 'lineWidth', {
    configurable: true,
    get() { return d.get!.call(this); },
    set(v: number) { const t = (this as CanvasRenderingContext2D).getTransform(), unit = 1 / Math.max(1e-6, Math.hypot(t.a, t.b)); d.set!.call(this, Math.max(v, unit)); },
  });
}
