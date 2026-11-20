/**
 * The pixel skin, "workshop": the floor in pixel art, chosen on `docs/factory/pixel-flat.html`.
 *
 * The picture is painted at a low resolution, `ART` pixels to a tile, then enlarged without smoothing; every part of
 * the floor is drawn pixel by pixel (`PixelLook`, `pixelArt.ts`). The words are not: they wait, and are written crisp
 * over the enlarged picture, in pixel fonts (`pixelFonts.css`). Pixels are whole only when a tile is a whole number of screen pixels per art pixel, so the zoom
 * rests on `PIXEL_STEPS` only: the view glides between them and never stops between them (`steps`, read by the view).
 * Seen from far (under `ART` pixels a tile), the picture is not pixelated: a pixel of art would be smaller than a pixel
 * of the screen.
 *
 * Its own drawing: a floor of tiles, flat bodies with a thick outline in their kind's hue, hard shadows, a lamp light
 * in rings that flicker, each ticket as the object of its type (a crate when it has none), and a worker at the foot of
 * each station that runs something, busy while it does. Workers are procedural: drawn from the scene at each frame, kept by no one.
 *
 * It follows the theme: a cream workshop on a light theme, a workshop at night on a dark one, with the theme's accent
 * made to read on it. The page around the floor is painted in the same workshop (`workshopTheme`).
 */
import './pixelFonts.css';
import type { Theme } from '../../lib/themes';
import { armColor } from '../armRules';
import type { LaneFlow } from '../bridges';
import { isLight, mix, readable, toHex } from '../floorLook';
import type { LensLayer } from '../lens';
import { bodyOf, type Lamp, type Rect, type RunKind } from '../machineArt';
import { DX, DY, humanCall, type AreaSpec, type FactoryLayout, type MachineSpec, type StationSpec } from '../types';
import type { ArmView, ArmWay, BeltView, BridgeView, ExitView, Placed, PortView, Quay, Scene, StationView, StatusView, ZoneView } from '../scene';
import type { ViewState } from '../renderer';
import type { TokenLook } from '../ticketToken';
import { CHEVRON_FAST, CHEVRON_PACE, CHEVRON_PAIR, clamp, FleexSkin, GHOST, HAZARD, NO_TYPE, PAINT, PICK, PRIORITY_PIP, STAR, TYPE_COLORS, WAY, ZONE_PAINT, type Palette } from './fleex';
import { ART, box, disc, figures, fillWhere, frame, hash, poly, ring, seg, sprite } from './pixelArt';
import { builtBox, hallOf, propsIn, type DecorOptions } from '../decor';
import { prop, props, walls, yard, type DecorPaint } from './pixelDecor';
import { pixelPerson, zees } from './peoplePaint';
import { workerState, type PeopleOptions, type Person } from '../people';
import type { Piece, Surface } from './skin';

/** The pixel fonts, as a canvas asks for them. */
export const PIXEL_FONTS = ['400 16px "Silkscreen"', '700 16px "Silkscreen"', '500 16px "Pixelify Sans"', '700 16px "Pixelify Sans"'];
/** The font of the page around a pixel floor. */
export const WORKSHOP_FONT = '"Pixelify Sans", ui-sans-serif, system-ui, sans-serif';
/** Art pixels to a tile. */
export { ART };
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
/** A lamp's amber light on a light floor: brighter than the amber of the paint, which reads brown there. */
const DAYLIGHT = '#ffb31a';
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
 * How sharp the pixel art is, chosen on the readability mock-ups (`docs/factory/pixel-crisp.html`, `pixel-parts.html`):
 * both are on in the app (`PIXEL_LOOK`); a mock-up may turn them off to show the pixel skin as it was.
 * - `crisp` (step 1): the view rests on the grid of art pixels; the words are in Silkscreen at whole multiples of 8
 *   pixels of the screen (the only sizes it is sharp at) on whole pixels, or not written; a ticket is the object of its
 *   type, eleven pixels square (a crate when it has none), on whole pixels; no line is thinner than a pixel.
 * - `sprites` (step 2): every part of the floor is drawn pixel by pixel, every pixel full or empty (`pixelArt.ts`):
 *   stations (body, head, badge, lamp, places, bay, tray), belts and their bends, bridges, gantries, arms and tolls,
 *   quays, zones (padlock, stock, line of work), exits and what leaves by them, teleporters and their links, status
 *   stations, areas, the lens, the tickets' marks, and what is laid over the floor; plates have square corners.
 */
export interface PixelLook {
  crisp?: boolean; sprites?: boolean;
  /** The decor: the hall, its walls, the yard and props, generated (`decor.ts`); none when unset. The page sets it (`setDecor`). */
  decor?: DecorOptions | null;
}
/** What the owner picked (R2): both steps. */
export const PIXEL_LOOK: PixelLook = { crisp: true, sprites: true };

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
/** A chevron pointing east, three pixels by five; three by six (it sits in the middle of a tile); four by seven, two thick. */
const CHEVRON = ['X..', '.X.', '..X', '.X.', 'X..'];
const CHEVRON_6 = ['X..', '.X.', '..X', '..X', '.X.', 'X..'];
const CHEVRON_7 = ['X...', 'XX..', '.XX.', '..XX', '.XX.', 'XX..', 'X...'];
/** A lamp's red, amber and green. */
const LAMP = ['#ff4d4d', '#ffc21a', '#3ddc5a'];
/** A padlock, shut and open (its shackle lifted two pixels, out of its body on the right): `h` its glint, `k` its keyhole. */
const LOCK_SHUT = ['..XXXXX..', '.XX...XX.', '.X.....X.', '.X.....X.', 'XXXXXXXXX', 'XhXXXXXXX', 'XXXXkXXXX', 'XXXXkXXXX', 'XXXXXXXXX', '.XXXXXXX.'];
const LOCK_OPEN = ['..XXXXX..', '.XX...XX.', '.X.....X.', '.X.....X.', '.X.......', '.X.......', 'XXXXXXXXX', 'XhXXXXXXX', 'XXXXkXXXX', 'XXXXkXXXX', 'XXXXXXXXX', '.XXXXXXX.'];
/** A "z" of sleep, small and large. */
const Z4 = ['XXXX', '..X.', '.X..', 'XXXX'], Z5 = ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'];
/** A tick, for what has left. */
const TICK = ['....X', '...X.', 'X.X..', '.X...'];
/** A round sign, seven pixels, `k` its outline; and what is written on it, three by five. */
const SIGN = ['.kkkkk.', 'kXXXXXk', 'kXXXXXk', 'kXXXXXk', 'kXXXXXk', 'kXXXXXk', '.kkkkk.'];
const GLYPHS = { '!': ['.X.', '.X.', '.X.', '...', '.X.'], '?': ['XX.', '..X', '.X.', '...', '.X.'], pause: ['X.X', 'X.X', 'X.X', 'X.X', 'X.X'] } as const;
/** A ticket's priority, a pip on its corner; a favourite's star. `w` their light. */
const PIP = ['.kkk.', 'kXwXk', 'kXXXk', 'kXXXk', '.kkk.'];
const STAR_7 = ['...k...', '..kXk..', 'kkkXkkk', 'kXXwXXk', '.kXXXk.', '.kXkXk.', '.kk.kk.'];

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
  constructor(look: PixelLook = PIXEL_LOOK) {
    super();
    this.look = { ...look, crisp: look.crisp || look.sprites };
    this.decorOpts = look.decor ?? null;
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

  /**
   * The decor, in pixel art: the yard and the walls under everything, then the props, on the floor
   * for a flat skin, standing at their row for one seen from three quarters (`standing`).
   */
  protected override decorPieces(st: ViewState, out: Piece[], standing: boolean): void {
    const d = this.decorOpts;
    if (!d) return;
    const pal = this.palette(), F = this.floorOf(st.layout), hall = hallOf(st.layout, F, d.wall), built = builtBox(st.layout.machines);
    const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h), view = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    const paint = (): DecorPaint => ({ ctx: this.ctx, light: pal.light, clock: this.clock, time: this.wallClock(), z: this.cam.z, view, say: (t, x, y, size, color, o) => this.label(t, x, y, size, color, o) });
    out.push({ layer: 'floor', depth: -3, draw: () => { const p = paint(); if (d.wall === 'built') yard(p, hall, F); walls(p, hall, built, 'FLEEX FACTORY'); } });
    if (!d.props || (st.edit && d.build === 'hide')) return;
    if (!standing) { out.push({ layer: 'floor', depth: -0.5, draw: () => props(paint(), st.layout, hall, d.props, !!st.edit) }); return; }
    if (this.cam.z < 10) return;
    for (const q of propsIn(st.layout, hall, view, d.props)) out.push({ layer: 'standing', depth: q.y + 1, draw: () => { const p = paint(); if (st.edit) p.ctx.globalAlpha = 0.35; prop(p, q); p.ctx.globalAlpha = 1; } });
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
    const ctx = this.ctx, o = 1 / ART, t = 3 * o, base = s === 'off' ? pal.danger : pal.light ? DAYLIGHT : pal.amber, beat = Math.floor(this.clock * FLICKER);
    const seed = hash(m.id), rnd = (k: number) => hash(`${seed}:${beat}:${k}`) / 0xffffffff;
    /* on a light floor a light reads less: it is brighter there */
    const strength = (s === 'off' ? 0.6 : 1) * (pal.light ? 1.45 : 1);
    for (let i = 0; i < RINGS.length; i++) {
      const e = (i + 1) * t, cut = (i + 1) * o * 2, x0 = m.x - e, y0 = m.y - e, w = m.w + e * 2, h = m.h + e * 2;
      /* it breathes, and its tint wanders between the lamp's colour and a warmer, lighter one */
      ctx.globalAlpha = RINGS[i]! * strength * (0.82 + 0.18 * rnd(i));
      ctx.fillStyle = mix(base, pal.light ? '#ffe680' : '#ffffff', 0.25 * rnd(i + 10));
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
    ctx.fillStyle = pal.light ? mix(base, '#ff7a00', 0.35) : mix(base, '#ffffff', 0.55);
    for (let k = 0; k < n; k++) {
      const side = Math.floor(rnd(100 + k) * 4), along = rnd(200 + k), off = Math.floor(rnd(300 + k) * RINGS.length * 3) * o;
      ctx.globalAlpha = Math.min(1, (0.35 + 0.4 * rnd(400 + k)) * strength);
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
    if (!this.sprites) { super.beltChevrons(v, pal); return; }
    if (v.bend >= 0) { this.bendChevrons(v, pal); return; }
    const b = v.m, fast = !!b.fast, off = (this.clock * (fast ? 1.2 : 0.6)) % 0.5, dx = [1, 0, -1, 0][b.dir]!, dy = [0, 1, 0, -1][b.dir]!, o = 1 / ART;
    const us: number[] = [];
    for (let k = 0; k < 2; k++) { const u = off + k * 0.5; if (fast) us.push(u - 0.075, u + 0.075); else us.push(u); }
    for (const u of us) {
      if (u < 0.08 || u > 0.92) continue;
      const cx = b.x + 0.5 + dx * (u - 0.5), cy = b.y + 0.5 + dy * (u - 0.5), wide = dx ? 3 : 5, high = dx ? 5 : 3;
      this.bits(CHEVRON, this.sn(cx) - Math.floor(wide / 2) * o, this.sn(cy) - Math.floor(high / 2) * o, fast ? pal.fast : pal.chev, b.dir);
    }
  }

  // ---------- step 2: every other part of the floor, pixel by pixel ----------
  /** A length of the floor in art pixels, whole. */
  private ap(v: number): number { return Math.round(v * ART); }
  /** Paints at an opacity, then back to full. */
  private faint(a: number, paint: () => void): void { const c = this.ctx; c.globalAlpha = a; paint(); c.globalAlpha = 1; }
  /** The ink pixel art outlines with: dark on either floor. */
  private get ink(): string { return this.palette().light ? INK : '#0f0e14'; }

  /** Crisp: a plate is square, its corners cut one pixel of art in, on whole pixels of the screen. */
  protected override plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    if (!this.look.crisp) { super.plate(ctx, x, y, w, h, r); return; }
    const d = this.on.dpr, s = (v: number) => Math.round(v * d) / d, u = Math.max(1, Math.round(Math.min(this.cam.z / ART, 3) * d)) / d;
    const x0 = s(x), y0 = s(y), x1 = s(x + w), y1 = s(y + h);
    ctx.beginPath();
    ctx.moveTo(x0 + u, y0); ctx.lineTo(x1 - u, y0); ctx.lineTo(x1 - u, y0 + u); ctx.lineTo(x1, y0 + u); ctx.lineTo(x1, y1 - u); ctx.lineTo(x1 - u, y1 - u);
    ctx.lineTo(x1 - u, y1); ctx.lineTo(x0 + u, y1); ctx.lineTo(x0 + u, y1 - u); ctx.lineTo(x0, y1 - u); ctx.lineTo(x0, y0 + u); ctx.lineTo(x0 + u, y0 + u); ctx.closePath();
  }
  /** Crisp: the names on the floor in Silkscreen at 8 pixels, the size it is drawn for. */
  protected override nameSize(): number { return this.look.crisp ? 8 : super.nameSize(); }

  /** The outline a station's body is filled in (the veil over one that is off): its notched box. */
  protected override trace(m: StationSpec): void {
    if (!this.sprites) { super.trace(m); return; }
    const o = 1 / ART, b = bodyOf(m), X = this.sn(b.x) + o, Y = this.sn(b.y) + o, W = this.sn(b.x + b.w) - o - X, H = this.sn(b.y + b.h) - o - Y, ctx = this.ctx;
    ctx.beginPath(); ctx.rect(X + 2 * o, Y, W - 4 * o, H); ctx.rect(X + o, Y + o, W - 2 * o, H - 2 * o); ctx.rect(X, Y + 2 * o, W, H - 4 * o);
  }
  protected override tray(r: Rect, pal: Palette): void {
    if (!this.sprites) { super.tray(r, pal); return; }
    this.pit(r, pal);
    frame(this.ctx, this.ap(r.x), this.ap(r.y), this.ap(r.x + r.w) - this.ap(r.x), this.ap(r.y + r.h) - this.ap(r.y), 1, pal.danger);
  }
  /** Hazard stripes, three pixels wide, on a slant of one pixel a pixel. */
  protected override hazard(a: Rect, band: number, full: boolean, pal: Palette): void {
    if (!this.sprites) { super.hazard(a, band, full, pal); return; }
    const ctx = this.ctx, i = this.ap(a.x), j = this.ap(a.y), w = this.ap(band), h = this.ap(a.y + a.h) - j;
    box(ctx, i, j, w, h, 'rgba(0,0,0,0.55)');
    const col = pal.light ? HAZARD : pal.warn;
    this.faint(full ? (pal.light ? 1 : 0.8) : pal.light ? 0.7 : 0.4, () => fillWhere(ctx, i, j, i + w, j + h, (x, y) => ((Math.floor(x) - Math.floor(y)) % 6 + 6) % 6 < 3, col));
  }

  /** The lamp: three bulbs in a housing, each in its colour, the one lit bright with a glint and a glow round the housing; amber blinks its glow. */
  protected override lamp(v: StationView, pointed: boolean, pal: Palette): void {
    if (!this.sprites) { super.lamp(v, pointed, pal); return; }
    const ctx = this.ctx, { parts: P, lamp: L } = v, X = this.ap(P.lamp.x), Y = this.ap(P.lamp.y);
    box(ctx, X, Y, 7, 16, pointed ? pal.text : '#0f0e14', 1);
    box(ctx, X + 1, Y + 1, 5, 14, '#2a2733');
    const BULB = ['.XXX.', 'XXXXX', 'XXXXX', '.XXX.'];
    for (let i = 0; i < 3; i++) {
      const on = (i === 0 && L === 'off') || (i === 1 && L === 'call') || (i === 2 && L === 'on'), col = LAMP[i]!, by = Y + 1 + i * 5;
      if (!on) { sprite(ctx, BULB, X + 1, by, { X: mix(col, '#2a2733', 0.62) }); continue; }
      sprite(ctx, BULB, X + 1, by, { X: col });
      box(ctx, X + 2, by + 1, 1, 1, mix(col, '#ffffff', 0.7));
      /* its light round the housing: steady, or blinking for what calls for someone */
      const up = i !== 1 || Math.floor(this.clock * 3) % 2 === 0;
      this.faint(up ? 0.75 : 0.25, () => { box(ctx, X - 1, by, 1, 4, col); box(ctx, X + 7, by, 1, 4, col); });
      this.faint(up ? 0.35 : 0.1, () => { box(ctx, X - 2, by + 1, 1, 2, col); box(ctx, X + 8, by + 1, 1, 2, col); });
    }
  }

  /** An arm: the way it works painted under it, a hard shadow, a link of steel with its colour down the middle, a cup one sees through, a round base. */
  protected override armBody(v: ArmView, st: ViewState, pal: Palette, col: string, steel: string): boolean {
    if (!this.sprites) return false;
    const ctx = this.ctx, { dx, dy, carried } = v, bx = v.bx * ART, by = v.by * ART, hx = v.hx * ART, hy = v.hy * ART, k = st.edit ? 1 : 0.62;
    const way = WAY.map(([u, w]) => [bx + (u * dx - w * dy) * ART, by + (u * dy + w * dx) * ART] as const);
    this.faint(0.26 * k, () => poly(ctx, way, col, null));
    this.faint(0.75 * k, () => poly(ctx, way, null, col));
    if (!st.edit) this.faint(0.3, () => seg(ctx, bx + 1, by + 2, hx + 1, hy + 2, 6, '#000000'));
    if (carried) this.ticket(carried, st);
    seg(ctx, bx, by, hx, hy, 6, this.ink);
    seg(ctx, bx, by, hx, hy, 4, steel);
    seg(ctx, bx, by, hx, hy, 1.6, col);
    this.cup(hx, hy, 4.4, pal);
    disc(ctx, bx, by, 5, this.ink); disc(ctx, bx, by, 4.2, col); disc(ctx, bx, by, 3.2, pal.body); disc(ctx, bx, by, 1.2, steel);
    box(ctx, Math.floor(bx) - 2, Math.floor(by) - 3, 2, 1, mix(pal.body, '#ffffff', 0.6));
    return true;
  }
  /** A suction cup: a ring, through which what it holds shows, and its middle. */
  private cup(hx: number, hy: number, r: number, pal: Palette): void {
    const ctx = this.ctx;
    this.faint(0.3, () => disc(ctx, hx, hy, r - 1.4, '#18181b'));
    ring(ctx, hx, hy, r, 1, this.ink); ring(ctx, hx, hy, r - 1, 1.2, pal.text);
    disc(ctx, hx, hy, 0.8, pal.text);
  }
  protected override tollArm(v: BeltView, st: ViewState, pal: Palette): void {
    if (!this.sprites) { super.tollArm(v, st, pal); return; }
    const ctx = this.ctx, T = v.toll!, ex = T.ex * ART, ey = T.ey * ART, hx = T.hx * ART, hy = T.hy * ART, col = pal.danger, steel = mix(pal.body, pal.text2, 0.38);
    if (!st.edit) this.faint(0.3, () => seg(ctx, ex + 1, ey + 2, hx + 1, hy + 2, 5, '#000000'));
    if (T.carried) this.ticket(T.carried, st);
    seg(ctx, ex, ey, hx, hy, 5, this.ink); seg(ctx, ex, ey, hx, hy, 3, steel); seg(ctx, ex, ey, hx, hy, 1.2, col);
    this.cup(hx, hy, 3.4, pal);
    disc(ctx, ex, ey, 3.8, this.ink); disc(ctx, ex, ey, 3, col); disc(ctx, ex, ey, 2, pal.body); disc(ctx, ex, ey, 0.8, steel);
  }

  /** A quay: a notch in the box's edge, outlined in its arm's colour; dashed on a zone, which is paint itself. */
  protected override quays(quays: Quay[], st: ViewState, pal: Palette, painted: boolean): void {
    if (!this.sprites) { super.quays(quays, st, pal, painted); return; }
    const ctx = this.ctx;
    for (const { a, q, line, more, moreAt } of quays) {
      const i = this.ap(q.x), j = this.ap(q.y), w = this.ap(q.x + q.w) - i, h = this.ap(q.y + q.h) - j, col = armColor(a, { plain: pal.text2, sorts: pal.warn });
      if (painted) this.faint(0.8, () => frame(ctx, i, j, w, h, 1, col, [2, 1], 1));
      else { box(ctx, i, j, w, h, pal.floor, 1); frame(ctx, i, j, w, h, 1, col, undefined, 1); }
      for (const p of line) this.ticket(p, st);
      if (more > 0 && moreAt) this.label(`+${more}`, moreAt.x, moreAt.y, 0.2, pal.text2, { mono: true, align: 'center', plate: 'rgba(9,9,11,0.84)' });
    }
  }

  /**
   * A zone, painted on the floor: a faint fill, a dashed line round it, three corners, its name, a padlock (shut and
   * red, or open and green with two chevrons that march out), its stock stencilled large, and its line of work.
   */
  protected override zone(v: ZoneView, S: Scene, st: ViewState, pal: Palette): void {
    if (!this.sprites) { super.zone(v, S, st, pal); return; }
    const ctx = this.ctx, { m, stock } = v, { x, y, w, h } = m, auto = m.release === 'auto', c = m.inbound ? pal.accent : ZONE_PAINT[m.status ?? ''] ?? PAINT;
    const i = x * ART, j = y * ART, W = w * ART, H = h * ART;
    this.faint(pal.light ? 0.1 : 0.06, () => box(ctx, i, j, W, H, c));
    this.faint(pal.light ? 0.85 : 0.5, () => frame(ctx, i + 1, j + 1, W - 2, H - 2, 1, c, [3, 2]));
    /* three corners: the fourth is the padlock's */
    ctx.fillStyle = c;
    for (const [cx, cy, sx, sy] of [[i + 1, j + 1, 1, 1], [i + 1, j + H - 1, 1, -1], [i + W - 1, j + H - 1, -1, -1]] as const) {
      box(ctx, sx > 0 ? cx : cx - 6, sy > 0 ? cy : cy - 2, 6, 2, c); box(ctx, sx > 0 ? cx : cx - 2, sy > 0 ? cy : cy - 6, 2, 6, c);
    }
    const lock = auto ? 20 : 9;
    this.label((m.name || 'Zone').toUpperCase(), x + 0.26, y + 0.56, 0.26, c, { mono: true, weight: 700, min: 9, max: 15, fit: w - 0.5 - lock / ART });
    this.lock(i + W - 4 - lock, j + 2, auto, auto ? pal.ok : pal.danger);
    if (w >= 2 && h >= 2) {
      const k = h >= 3 ? 3 : 2;
      this.faint(pal.light ? (stock ? 0.4 : 0.22) : stock ? 0.32 : 0.15, () => figures(ctx, String(stock).padStart(2, '0'), i + 4, j + H - 3 - 5 * k - (auto && m.status === 'todo' ? 3 : 0), k, c));
    }
    if (auto && m.status === 'todo') {
      const limit = m.limit ?? 12, f = clamp(S.wip / limit, 0, 1), cc = f >= 0.8 ? pal.warn : c, x0 = i + 4, x1 = i + W - 4;
      this.faint(0.25, () => box(ctx, x0, j + H - 4, x1 - x0, 2, c));
      if (f > 0) box(ctx, x0, j + H - 4, Math.max(1, Math.round((x1 - x0) * f)), 2, cc);
      if (w >= 3) this.label(`IN WORK ${S.wip}/${limit}`, x + w - 0.2, y + h - 0.5, 0.19, cc, { mono: true, weight: 700, align: 'right', min: 8, max: 11 });
    }
    for (const p of v.held) this.ticket(p, st);
    if (v.more > 0) this.label(`+${v.more}`, x + w - 0.28, y + h - 0.72, 0.26, pal.text2, { align: 'right', mono: true, plate: 'rgba(9,9,11,0.84)' });
    this.quays(v.quays, st, pal, true);
  }
  /** A padlock, nine pixels wide, its body's top at `j + 4`: shut, or open with its shackle lifted and two chevrons marching out after it. */
  private lock(i: number, j: number, open: boolean, col: string): void {
    const ctx = this.ctx, inks = { X: col, h: mix(col, '#ffffff', 0.5), k: mix(col, '#000000', 0.55) };
    if (!open) { sprite(ctx, LOCK_SHUT, i, j, inks); return; }
    sprite(ctx, LOCK_OPEN, i, j - 2, inks);
    const beat = Math.floor(this.clock * 3) % 3;
    for (let n = 0; n < 2; n++) this.faint(beat === n || beat === 2 ? 1 : 0.4, () => sprite(ctx, CHEVRON_7, i + 11 + n * 5, j + 3, { X: col }));
  }

  /** An exit: a frame of light, its glow stepped round it and pooled inside, a few of its pixels flaring. */
  protected override exit(v: ExitView, pal: Palette): void {
    if (!this.sprites) { super.exit(v, pal); return; }
    const ctx = this.ctx, { m } = v, { x, y, w, h } = m, z = this.cam.z, ok = pal.ok, i = x * ART, j = y * ART, W = w * ART, H = h * ART;
    this.faint(0.14, () => frame(ctx, i - 1, j - 1, W + 2, H + 2, 1, ok, undefined, 4));
    this.faint(0.3, () => frame(ctx, i, j, W, H, 1, ok, undefined, 3));
    box(ctx, i + 1, j + 1, W - 2, H - 2, mix(pal.floor, '#000000', pal.light ? 0.06 : 0.3), 3);
    /* its light spills inwards from the frame, a pixel at a time */
    [0.3, 0.2, 0.12, 0.06].forEach((a, k) => this.faint(a, () => frame(ctx, i + 3 + k, j + 3 + k, W - 6 - 2 * k, H - 6 - 2 * k, 1, ok, undefined, 2)));
    frame(ctx, i + 1, j + 1, W - 2, H - 2, 2, ok, undefined, 3);
    /* a few pixels of the frame flare, a few times a second */
    const beat = Math.floor(this.clock * 4), seed = hash(m.id), n = Math.round((w + h) * 1.5), per = 2 * (W + H - 8);
    for (let k = 0; k < n; k++) {
      let at = Math.floor((hash(`${seed}:${beat}:${k}`) / 0xffffffff) * per);
      const side = at < W - 4 ? 0 : at < W - 4 + H - 4 ? 1 : at < 2 * (W - 4) + H - 4 ? 2 : 3;
      at -= side === 0 ? 0 : side === 1 ? W - 4 : side === 2 ? W - 4 + H - 4 : 2 * (W - 4) + H - 4;
      const [px, py] = side === 0 ? [i + 2 + at, j + 1] : side === 1 ? [i + W - 2, j + 2 + at] : side === 2 ? [i + W - 3 - at, j + H - 2] : [i + 1, j + H - 3 - at];
      this.faint(0.8, () => box(ctx, px, py, 1, 1, mix(ok, '#ffffff', 0.65)));
    }
    const plate = { mono: true, weight: 700, min: 9, max: 12 } as const;
    this.label((m.name || 'Exit').toUpperCase(), x + 0.3, y + 0.06, 0.24, '#052e16', { ...plate, plate: ok, fit: Math.max(1.2, w - 0.6) });
    if (w >= 3 && h >= 2) this.label('handed back to Fleex', x + w / 2, y + h - 0.3, 0.17, pal.text3, { mono: true, align: 'center', fit: w - 0.3 });
    if (v.count == null) return;
    const count = `${v.count} · ${v.days} d`, o = { ...plate, plate: 'rgba(9,9,11,0.92)' };
    /* on the top line when it fits beside the name (Silkscreen's letters are about as wide as they are high), under the frame otherwise */
    const px = this.wordSize(clamp(0.24 * z, 9, 12), 0.24, true) ?? 9, name = (m.name || 'Exit').length;
    if ((name + count.length) * px + 4 * px + 0.6 * z <= w * z) this.label(count, x + w - 0.3, y + 0.06, 0.24, ok, { ...o, align: 'right' });
    else this.label(count, x + w / 2, y + h - 0.04, 0.24, ok, { ...o, align: 'center' });
  }
  /** What leaves by an exit: its ticket as it was, then a frame with a tick that fades, the side it came in by lit where it passed. */
  protected override departures(S: Scene, pal: Palette): void {
    if (!this.sprites) { super.departures(S, pal); return; }
    const ctx = this.ctx;
    for (const l of S.leaving) {
      if (l.travel) { this.token('solid', l.type, TYPE_COLORS[l.type] ?? NO_TYPE, l.x, l.y, 0.53, 1); continue; }
      const { k, x: px, y: py, edge, a0, a1 } = l, cx = Math.round(px * ART), cy = Math.round(py * ART);
      this.faint(1 - k, () => {
        seg(ctx, (edge.x + edge.ax * a0) * ART, (edge.y + edge.ay * a0) * ART, (edge.x + edge.ax * a1) * ART, (edge.y + edge.ay * a1) * ART, 2, mix(pal.ok, '#ffffff', 0.7));
        frame(ctx, cx - 4, cy - 4, 8, 8, 1, pal.ok, undefined, 1);
        sprite(ctx, TICK, cx - 2, cy - 2, { X: pal.ok });
      });
    }
  }

  /**
   * A teleporter: a dark pad, closed for a departure, open in the middle of each side for an arrival; a ring (dashes
   * that turn while it holds its ticket back), four chevrons in or out, its light when a ticket goes or comes.
   */
  protected override port(v: PortView, st: ViewState, pal: Palette): void {
    if (!this.sprites) { super.port(v, st, pal); return; }
    const ctx = this.ctx, { m, dep, bad, waiting, burst } = v, { x, y } = m, z = this.cam.z, col = bad ? pal.danger : v.color, i = x * ART, j = y * ART, ci = i + 8, cj = j + 8;
    const pad = mix(pal.floor, '#000000', pal.light ? 0.08 : 0.3);
    box(ctx, i + 1, j + 1, 14, 14, pad, 3);
    frame(ctx, i + 1, j + 1, 14, 14, 1, col, undefined, 3);
    if (!dep) { box(ctx, i + 5, j + 1, 6, 1, pad); box(ctx, i + 5, j + 14, 6, 1, pad); box(ctx, i + 1, j + 5, 1, 6, pad); box(ctx, i + 14, j + 5, 1, 6, pad); }
    this.faint(0.12 + 0.35 * burst, () => disc(ctx, ci, cj, 4, col));
    const turn = this.clock * 2;
    ring(ctx, ci, cj, 4.6, 1, waiting ? pal.amber : col, waiting ? (a) => Math.floor((a + Math.PI + turn) / (Math.PI / 4)) % 2 === 0 : undefined);
    if (burst > 0) this.faint(1 - burst, () => ring(ctx, ci, cj, 4.6 + 5 * burst, 1, col));
    if (z >= 9) {
      const at = [[ci + 5, cj - 3], [ci - 3, cj + 5], [ci - 8, cj - 3], [ci - 3, cj - 8]] as const;
      for (let s = 0; s < 4; s++) sprite(ctx, CHEVRON_6, at[s]![0], at[s]![1], { X: col }, dep ? (s + 2) % 4 : s);
    }
    if (v.held) this.ticket(v.held, st);
    if (v.gone) this.token('solid', v.gone.type, TYPE_COLORS[v.gone.type] ?? NO_TYPE, x + 0.5, y + 0.5, 0.37, Math.min(1, v.gone.k * 1.5));
    if (waiting || bad) this.sign(i + 12.5, j + 3.5, bad ? pal.danger : pal.amber, bad ? '!' : 'pause');
    if (z < 11 && !v.asked) return;
    const line = z >= 16 || v.asked || bad || waiting ? v.line : '', cx = x + 0.5, cy = y + 0.5;
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
  /** A round sign of seven pixels, centred on (ci, cj) (a pixel's middle): `!`, `?` or a pause, dark on its colour. */
  private sign(ci: number, cj: number, col: string, glyph: '!' | '?' | 'pause'): void {
    const ctx = this.ctx, i = Math.floor(ci), j = Math.floor(cj);
    sprite(ctx, SIGN, i - 3, j - 3, { k: this.ink, X: col });
    sprite(ctx, GLYPHS[glyph], i - 1, j - 2, { X: isLight(col) ? 'rgba(9,9,11,0.9)' : '#ffffff' });
  }
  /** The link between a departure and its arrival: dots that run along it, its head, and the ticket crossing. */
  protected override portLinks(S: Scene, pal: Palette): void {
    if (!this.sprites) { super.portLinks(S, pal); return; }
    const ctx = this.ctx;
    for (const { x1, y1, x2, y2, qx, qy, trim, color: col, hot, packet } of S.links) {
      const at = (u: number) => ({ x: ((1 - u) ** 2 * x1 + 2 * (1 - u) * u * qx + u * u * x2) * ART, y: ((1 - u) ** 2 * y1 + 2 * (1 - u) * u * qy + u * u * y2) * ART });
      const n = Math.max(8, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * ART * 1.3)), seen = new Set<string>(), dots: [number, number][] = [];
      let run = 0, prev = at(trim);
      for (let s = 0; s <= n; s++) {
        const p = at(trim + (1 - 2 * trim) * (s / n));
        run += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p;
        if (((run - this.clock * 8) % 6 + 6) % 6 >= 2.5) continue;
        const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
        if (!seen.has(key)) { seen.add(key); dots.push([Math.floor(p.x), Math.floor(p.y)]); }
      }
      this.faint(0.6, () => { for (const [a, b] of dots) box(ctx, a, b, 2, 2, '#09090b'); });
      this.faint(hot ? 1 : 0.9, () => { for (const [a, b] of dots) box(ctx, a, b, hot ? 2 : 1, hot ? 2 : 1, col); });
      const e = at(1 - trim), e0 = at(1 - trim - 0.03), ang = Math.atan2(e.y - e0.y, e.x - e0.x);
      for (const s of [-0.6, 0.6]) seg(ctx, e.x, e.y, e.x - Math.cos(ang + s) * 3.4, e.y - Math.sin(ang + s) * 3.4, 1.5, col);
      if (packet != null) {
        const p = at(trim + (1 - 2 * trim) * packet);
        this.faint(0.28, () => disc(ctx, p.x, p.y, 3.7, col)); disc(ctx, p.x, p.y, 1.7, col);
      }
    }
    for (const s of S.noEntry) {
      const ci = s.x * ART, cj = s.y * ART;
      disc(ctx, ci, cj, 3.4, this.ink); disc(ctx, ci, cj, 2.6, pal.danger); box(ctx, Math.round(ci) - 2, Math.round(cj) - 1, 4, 1, '#ffffff');
    }
  }

  /** A Set gantry: two posts, outlined in its colour, and the beam across the belt, full while a ticket is under it. */
  protected override gantryFrame(v: BeltView, col: string, pal: Palette): boolean {
    if (!this.sprites) return false;
    const ctx = this.ctx, g = v.gantry!, i = v.m.x * ART, j = v.m.y * ART;
    const at = (u: number, w: number, a: number, b: number) => (g.across ? [i + u, j + w, a, b] : [i + w, j + u, b, a]) as [number, number, number, number];
    for (const w of [-2, 14]) { const [a, b, c, d] = at(2, w, 12, 4); box(ctx, a, b, c, d, pal.body, 1); frame(ctx, a, b, c, d, 1, col, undefined, 1); }
    const [a, b, c, d] = at(6, -1, 4, 18);
    this.faint(g.under ? 0.85 : 0.35, () => box(ctx, a, b, c, d, col, 1));
    frame(ctx, a, b, c, d, 1, col, undefined, 1);
    return true;
  }

  /** A belt: its rails one pixel wide; a bend as a quarter of a disc, its rails round it, every pixel full or empty. */
  protected override beltBase(v: BeltView, pal: Palette): void {
    if (!this.sprites) { super.beltBase(v, pal); return; }
    const ctx = this.ctx, b = v.m, f = v.bend, i = b.x * ART, j = b.y * ART, dx = DX[b.dir], dy = DY[b.dir], rail = b.fast ? mix(pal.fast, pal.belt, 0.35) : pal.edge;
    if (f >= 0) {
      const fx = DX[f as 0], fy = DY[f as 0], px = i + 8 - fx * 8 + dx * 8, py = j + 8 - fy * 8 + dy * 8, d = (x: number, y: number) => Math.hypot(x - px, y - py);
      fillWhere(ctx, i, j, i + 16, j + 16, (x, y) => d(x, y) <= 16.2, pal.belt);
      fillWhere(ctx, i, j, i + 16, j + 16, (x, y) => { const r = d(x, y); return (r > 14.9 && r <= 16.2) || r <= 1.4; }, rail);
    } else {
      box(ctx, i, j, 16, 16, pal.belt);
      for (const s of v.rails) box(ctx, s === 0 ? i + 15 : i, s === 1 ? j + 15 : j, s % 2 ? 16 : 1, s % 2 ? 1 : 16, rail);
    }
    if (v.dead) seg(ctx, i + 8 + dx * 6.7 - dy * 6.4, j + 8 + dy * 6.7 - dx * 6.4, i + 8 + dx * 6.7 + dy * 6.4, j + 8 + dy * 6.7 + dx * 6.4, 2, pal.danger);
  }
  /** The chevrons of a bend, drawn on the curve as two strokes of a pixel. */
  private bendChevrons(v: BeltView, pal: Palette): void {
    const ctx = this.ctx, b = v.m, f = v.bend, dx = DX[b.dir], dy = DY[b.dir], fx = DX[f as 0], fy = DY[f as 0];
    const px = b.x + 0.5 - fx * 0.5 + dx * 0.5, py = b.y + 0.5 - fy * 0.5 + dy * 0.5, off = (this.clock * (b.fast ? CHEVRON_FAST : CHEVRON_PACE)) % 0.5, col = b.fast ? pal.fast : pal.chev;
    const one = (u: number) => {
      if (u < 0.06 || u > 0.94) return;
      const ca = Math.cos((u * Math.PI) / 2), sa = Math.sin((u * Math.PI) / 2), cx = (px + 0.5 * (fx * sa - dx * ca)) * ART, cy = (py + 0.5 * (fy * sa - dy * ca)) * ART, tx = dx * sa + fx * ca, ty = dy * sa + fy * ca;
      const tipx = cx + tx * 1.5, tipy = cy + ty * 1.5;
      seg(ctx, tipx, tipy, cx - tx * 1.5 + ty * 3, cy - ty * 1.5 - tx * 3, 1.3, col);
      seg(ctx, tipx, tipy, cx - tx * 1.5 - ty * 3, cy - ty * 1.5 + tx * 3, 1.3, col);
    };
    for (let k = 0; k < 2; k++) { const u = off + k * 0.5; if (b.fast) { one(u - CHEVRON_PAIR / 2); one(u + CHEVRON_PAIR / 2); } else one(u); }
  }

  /** Two belts crossing, every pixel full or empty: the north-south lane under, the east-west deck over it with its shadow. */
  protected override bridge(v: BridgeView, st: ViewState, pal: Palette): void {
    if (!this.sprites) { super.bridge(v, st, pal); return; }
    const ctx = this.ctx, { m, riders, flow } = v, i = m.x * ART, j = m.y * ART, z = this.cam.z;
    const rail = (fast: boolean, plain: string) => (fast ? mix(pal.fast, pal.belt, 0.35) : plain);
    box(ctx, i, j, 16, 16, pal.belt);
    const lane = (f: LaneFlow, horizontal: boolean, fast: boolean, j0: number) => {
      const turn = (s: number) => (horizontal ? (s > 0 ? 0 : 2) : s > 0 ? 1 : 3);
      const chev = (u: number, s: number, c: string) => {
        const along = Math.round(u * ART), l = horizontal ? i + 8 + along - 1 : i + 6, t = horizontal ? j0 - 2 : j + 8 + along - 1;
        if (Math.abs(along) > 6) return;
        sprite(ctx, CHEVRON, l, t, { X: c }, turn(s));
      };
      const pair = (u: number, s: number, c: string) => { if (fast) { chev(u - (s * CHEVRON_PAIR) / 2, s, c); chev(u + (s * CHEVRON_PAIR) / 2, s, c); } else chev(u, s, c); };
      if (f === 'none') this.faint(0.6, () => (horizontal ? box(ctx, i + 5, j0, 6, 1, pal.chev) : box(ctx, i + 8, j + 5, 1, 6, pal.chev)));
      else if (f === 'clash') { pair(-0.2, 1, pal.danger); pair(0.2, -1, pal.danger); }
      else {
        const s = f === 0 || f === 1 ? 1 : -1, off = (this.clock * (fast ? CHEVRON_FAST : CHEVRON_PACE)) % 0.5;
        for (let k = -1; k < 2; k++) pair(s * (off + k * 0.5 - 0.5), s, fast ? pal.fast : pal.chev);
      }
    };
    const under = rail(flow.underFast, pal.edge);
    box(ctx, i, j, 1, 16, under); box(ctx, i + 15, j, 1, 16, under);
    if (z >= 8) lane(flow.under, false, flow.underFast, 0);
    for (const r of riders) if (r.fx === 0) this.ticket(r, st);
    this.faint(0.35, () => box(ctx, i, j + 2, 16, 13, '#000000'));
    box(ctx, i, j + 3, 16, 10, pal.belt);
    const over = rail(flow.overFast, pal.text3);
    box(ctx, i, j + 3, 16, 1, over); box(ctx, i, j + 12, 16, 1, over);
    if (z >= 8) lane(flow.over, true, flow.overFast, j + 8);
    for (const r of riders) if (r.fx !== 0) this.ticket(r, st);
  }

  /** A status station: a small box with an edge of two pixels, its state as a bar, its slots. */
  protected override statusStation(v: StatusView, st: ViewState, pal: Palette): void {
    if (!this.sprites) { super.statusStation(v, st, pal); return; }
    const ctx = this.ctx, { m, big } = v, { x, y, w, h } = m, i = x * ART, j = y * ART, W = w * ART, H = h * ART;
    box(ctx, i + 1, j + 1, W - 2, H - 2, mix(pal.ok, '#000000', pal.light ? 0.3 : 0.1), 3);
    box(ctx, i + 3, j + 3, W - 6, H - 6, pal.body, 2);
    box(ctx, i + 4, j + 3, W - 8, 1, 'rgba(255,255,255,0.18)');
    box(ctx, i + 7, j + 5, W - 14, 2, v.busy ? pal.ok : pal.text3);
    this.label(m.name || 'Station', x + w / 2, y + (big ? 0.66 : 0.58), big ? 0.32 : 0.26, pal.text, { align: 'center', weight: 600, min: 8, max: 14, fit: w - 0.25 });
    for (const c of v.slots) { const a = this.ap(c.x), b = this.ap(c.y), s = this.ap(c.x + c.size) - a; box(ctx, a, b, s, s, pal.light ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.4)', 1); if (c.t) this.ticket(c.t, st); }
    if (v.more > 0) this.label(`+${v.more}`, v.moreAt.x, v.moreAt.y, 0.24, pal.text2, { mono: true, align: 'right' });
    const o = v.outBox;
    if (o) { const a = this.ap(o.x), b = this.ap(o.y), ow = this.ap(o.x + o.w) - a, oh = this.ap(o.y + o.h) - b; box(ctx, a, b, ow, oh, 'rgba(0,0,0,0.4)', 1); frame(ctx, a, b, ow, oh, 1, pal.danger, undefined, 1); }
    for (const p of v.out) this.ticket(p, st);
    this.quays(v.quays, st, pal, false);
    if (v.full) this.label('full', x + w / 2, y + h + 0.26, 0.26, '#fdba74', { align: 'center', plate: 'rgba(9,9,11,0.84)', min: 9, max: 12 });
  }

  /** An area: a tinted slab, an edge of one pixel in its colour, its name on the floor. */
  protected override area(a: AreaSpec, pal: Palette): void {
    if (!this.sprites) { super.area(a, pal); return; }
    const ctx = this.ctx, i = a.x * ART, j = a.y * ART, W = a.w * ART, H = a.h * ART;
    this.faint(pal.light ? 0.1 : 0.07, () => box(ctx, i, j, W, H, a.color));
    this.faint(pal.light ? 0.8 : 0.6, () => frame(ctx, i, j, W, H, 1, a.color));
    this.areaName(a);
  }

  /** The lens: every station and zone veiled, the ones it has a value for heated, notched boxes. */
  protected override lens(layer: LensLayer, L: FactoryLayout, pal: Palette): void {
    if (!this.sprites) { super.lens(layer, L, pal); return; }
    const ctx = this.ctx;
    for (const m of L.machines) {
      if (m.kind !== 'station' && m.kind !== 'zone') continue;
      const val = layer.values.get(m.id) ?? 0, k = layer.max > 0 && val > 0 ? Math.sqrt(val / layer.max) : 0, hue = Math.round(52 - 52 * k), i = m.x * ART + 1, j = m.y * ART + 1, W = m.w * ART - 2, H = m.h * ART - 2;
      box(ctx, i, j, W, H, 'rgba(9,9,11,0.66)', 3);
      if (k > 0) { box(ctx, i, j, W, H, `hsla(${hue}, 95%, 55%, ${(0.16 + 0.5 * k).toFixed(2)})`, 3); frame(ctx, i, j, W, H, k > 0.5 ? 2 : 1, `hsl(${hue}, 95%, 60%)`, undefined, 3); }
      const text = layer.text.get(m.id);
      this.label(text ?? '–', m.x + m.w / 2, m.y + m.h / 2 + 0.2, 0.44, text ? '#ffffff' : pal.light ? '#a1a1aa' : pal.text3, { align: 'center', weight: 700, mono: true, min: 9, max: 22, fit: m.w - 0.2, dark: true });
    }
  }

  /**
   * A ticket, pixel by pixel: its type's object (`token`), and its marks drawn round its eleven pixels: a frame that
   * blinks for what failed or needs someone, rings that grow from what calls, a round sign on its corner, a pip for its
   * priority, a star, a frame for what a search found, a ring when it is selected.
   */
  protected override ticket(P: Placed, st: ViewState): void {
    const z = this.cam.z, T = P.s * 1.16;
    if (!this.sprites || T * z < 10) { super.ticket(P, st); return; }
    const ctx = this.ctx, pal = this.palette(), { t, x: px, y: py, mark, dragging, picked, selected, dim, call } = P, info = t.info, type = info?.type ?? '', color = TYPE_COLORS[type] ?? NO_TYPE;
    if (dim) { this.token('ghost', type, GHOST, px, py, T, 0.32); return; }
    this.token('solid', type, color, px, py, T, dragging ? 0.25 : mark === 'wait' ? 0.5 : 1);
    /* the box of its icon, eleven pixels square */
    const i = Math.round(px * ART - 5.5), j = Math.round(py * ART - 5.5), blink = Math.floor(this.clock * 2.4) % 2 === 0;
    if (mark === 'run') this.runMark(px, py, T, t.ticketId.length);
    else if ((mark === 'human' || mark === 'fail') && !humanCall(t)) frame(ctx, i - 2, j - 2, 15, 15, blink ? 2 : 1, mark === 'fail' ? pal.danger : pal.amber, undefined, 2);
    else if (mark === 'out') frame(ctx, i - 2, j - 2, 15, 15, 1, pal.text2, undefined, 2);
    if (call) {
      const col = call === 'failed' ? pal.danger : pal.amber, ph = (this.clock * 0.9 + (t.ticketId.charCodeAt(0) % 10) / 10) % 1, g = Math.round(ph * 5);
      this.faint(0.85 * (1 - ph), () => frame(ctx, i - 2 - g, j - 2 - g, 15 + 2 * g, 15 + 2 * g, 1, col, undefined, 2));
      frame(ctx, i - 2, j - 2, 15, 15, Math.sin(this.clock * 6) ** 2 > 0.5 ? 2 : 1, col, undefined, 2);
      this.sign(i + 10.5, j + 10.5, col, call === 'failed' ? '!' : '?');
    } else if (!dragging && t.phase === 'aside') this.sign(i + 10.5, j + 10.5, pal.accent, 'pause');
    if (info && !dragging) {
      if (T * z >= 34 || (st.numbers && T * z >= 13)) this.label(String(info.displayId), px, py + this.numberDy(T), T * 0.24, '#f4f4f5', { align: 'center', weight: 700, mono: true, plate: 'rgba(9,9,11,0.82)', min: 8 });
      const pip = PRIORITY_PIP[info.priority];
      if (pip) sprite(ctx, PIP, i - 2, j - 2, { k: this.ink, X: pip, w: mix(pip, '#ffffff', 0.5) });
      if (info.favorite) sprite(ctx, STAR_7, i + 7, j - 3, { k: this.ink, X: STAR, w: mix(STAR, '#ffffff', 0.6) });
    }
    if (P.found) frame(ctx, i - 3, j - 3, 17, 17, 1, pal.accent, undefined, 3);
    if (selected) ring(ctx, i + 5.5, j + 5.5, Math.max(T * 0.92 * ART, 8.5), 1, pal.text);
    if (picked) { this.faint(0.22, () => disc(ctx, i + 5.5, j + 5.5, Math.max(T * ART, 9), PICK)); ring(ctx, i + 5.5, j + 5.5, Math.max(T * ART, 9), 2, PICK); }
  }

  /** What is laid over the floor (outlines, frames, handles, ghosts), every line on whole pixels. */
  protected override overlay(st: ViewState, S: Scene, pal: Palette): void {
    if (!this.sprites) { super.overlay(st, S, pal); return; }
    const ctx = this.ctx;
    const outline = (m: MachineSpec, color: string, th: number) => { const b = this.seen(m), i = this.ap(b.x) - 1, j = this.ap(b.y) - 1; frame(ctx, i, j, this.ap(b.x + b.w) + 1 - i, this.ap(b.y + b.h) + 1 - j, th, color, undefined, m.w > 1 ? 4 : 2); };
    const hov = this.machine(st.hoverMachine), sel = this.machine(st.selMachine);
    if (hov && hov.id !== sel?.id) outline(hov, pal.text3, 1);
    for (const id of st.selMany) { const m = this.machine(id); if (m) outline(m, pal.accent, 2); }
    if (st.marquee) {
      const q = st.marquee, i = this.ap(Math.min(q.x0, q.x1)), j = this.ap(Math.min(q.y0, q.y1)), w = this.ap(Math.max(q.x0, q.x1)) - i, h = this.ap(Math.max(q.y0, q.y1)) - j;
      box(ctx, i, j, w, h, 'rgba(96,165,250,0.12)'); frame(ctx, i, j, w, h, 1, PICK, [3, 2]);
    }
    if (sel && sel.kind !== 'area') {
      outline(sel, pal.text, 2);
      for (const n of S.feeders) outline(n, pal.ok, 2);
      for (const a of S.emptiers) outline(a, '#fb923c', 2);
    }
    for (const w of S.ways) this.armWay(w, pal);
    if (st.edit) {
      const sa = st.areaSel ? this.machine(st.areaSel) : null, hs = Math.max(3, Math.round(7 / this.cam.z * ART / 2) * 2 - 1);
      if (sa?.kind === 'area') {
        const i = sa.x * ART, j = sa.y * ART, W = sa.w * ART, H = sa.h * ART;
        frame(ctx, i, j, W, H, 1, pal.accent, [4, 2]);
        for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]] as const) {
          const a = Math.round(i + W * hx - hs / 2), b = Math.round(j + H * hy - hs / 2);
          box(ctx, a, b, hs, hs, pal.light ? '#ffffff' : '#09090b'); frame(ctx, a, b, hs, hs, 1, pal.accent);
        }
      }
      const ag = st.areaGhost;
      if (ag) {
        const i = ag.x * ART, j = ag.y * ART, W = ag.w * ART, H = ag.h * ART;
        box(ctx, i, j, W, H, ag.ok ? 'rgba(96,165,250,0.16)' : 'rgba(239,68,68,0.2)'); frame(ctx, i, j, W, H, 1, ag.ok ? PICK : pal.danger, [4, 2]);
        this.label(`${ag.w} × ${ag.h}`, ag.x + ag.w / 2, ag.y - 0.35, 0.28, pal.text, { align: 'center', mono: true, weight: 700, plate: ag.ok ? 'rgba(30,64,120,0.95)' : 'rgba(127,29,29,0.95)', min: 10, max: 13 });
      }
    }
    const g = st.ghost;
    if (g) {
      for (const c of g.cells) {
        const bad = g.erase || !g.ok, i = this.ap(c.x) + 1, j = this.ap(c.y) + 1, w = this.ap(c.x + c.w) - 1 - i, h = this.ap(c.y + c.h) - 1 - j;
        box(ctx, i, j, w, h, bad ? 'rgba(239,68,68,0.28)' : 'rgba(96,165,250,0.26)', 3); frame(ctx, i, j, w, h, 1, bad ? pal.danger : '#60a5fa', undefined, 3);
        if (c.dir != null) {
          const cx = (c.x + c.w / 2) * ART, cy = (c.y + c.h / 2) * ART, dx = DX[c.dir as 0], dy = DY[c.dir as 0];
          seg(ctx, cx - dx * 4, cy - dy * 4, cx + dx * 3.5, cy + dy * 3.5, 1.5, pal.text);
          for (const s of [1, -1]) seg(ctx, cx + dx * 3.5, cy + dy * 3.5, cx + dx * 0.5 + s * dy * 3, cy + dy * 0.5 + s * dx * 3, 1.5, pal.text);
        }
      }
      const first = g.cells[0];
      if (g.text && first) this.label(g.text, first.x + first.w / 2, first.y - 0.4, 0.3, pal.text, { align: 'center', plate: g.ok ? 'rgba(30,64,120,0.95)' : 'rgba(127,29,29,0.95)', min: 10, max: 13 });
    }
    const dr = st.drag;
    if (dr) {
      const b = S.dropBox!, i = this.ap(b.x), j = this.ap(b.y);
      frame(ctx, i, j, this.ap(b.x + b.w) - i, this.ap(b.y + b.h) - j, 2, dr.ok ? pal.ok : pal.warn, dr.ok ? undefined : [3, 2], 3);
      const held = st.tickets.find((q) => q.ticketId === dr.ticketId)?.info?.type ?? '';
      this.token('solid', held, TYPE_COLORS[held] ?? NO_TYPE, dr.x, dr.y, 0.7, 1);
      this.label(dr.text, dr.x, dr.y - 0.75, 0.3, pal.text, { align: 'center', plate: dr.ok ? 'rgba(20,83,45,0.95)' : 'rgba(120,53,15,0.95)', min: 10, max: 13 });
    }
  }
  /** In build mode, where an arm takes from (dashed, in the frame's blue) and drops on (green); their names are Fleex's. */
  protected override armWay(w: ArmWay, pal: Palette, wordsOnly = false): void {
    if (!this.sprites || wordsOnly) { super.armWay(w, pal, wordsOnly); return; }
    const ctx = this.ctx, dx = DX[w.dir as 0], dy = DY[w.dir as 0];
    const tile = (tx: number, ty: number, color: string, dashed: boolean) => {
      const i = tx * ART + 1, j = ty * ART + 1;
      this.faint(0.16, () => box(ctx, i, j, 14, 14, color, 2));
      frame(ctx, i, j, 14, 14, 1, color, dashed ? [2, 2] : undefined, 2);
    };
    tile(w.x - dx, w.y - dy, w.idle ? pal.danger : PICK, true); tile(w.x + dx, w.y + dy, w.shut ? pal.danger : pal.ok, false);
    super.armWay(w, pal, true);
  }

  /** A person in pixel art. */
  protected override person(p: Person, pal: Palette): void { pixelPerson(this.ctx, p, pal.light); }
  /** The pixel skins have their own worker at each station (`worker`), who raises a hand when the run failed. */
  protected override stationPeople(_S: Scene, _out: Piece[], _standing: boolean, _o: PeopleOptions, _pal: Palette): void { /* see `worker` */ }

  /**
   * A worker at the foot of a station, in the hue of its kind, doing what the station does (`workerState`): at work
   * (a spanner going up and down, sparks), a hand up under "!" or "?" (with people on the floor), waiting (arms at the
   * sides, a blink now and then), or asleep (slumped, eyes shut, "z"s rising). It never walks on the spot.
   */
  protected worker(v: StationView): void {
    const ctx = this.ctx, m = v.m, o = 1 / ART, t = this.clock, state = workerState(v, !!this.peopleOpts?.hands), beat = Math.floor(t * 4) % 2;
    const x = m.x + m.w - 0.75, y = (this.look.crisp ? m.y + m.h : m.y + m.h - 0.02) - (state === 'work' && beat ? o : 0) + (state === 'sleep' ? o : 0);
    const shirt = v.run ? { agent: '#8b7cf6', skill: '#38a8e8', panel: '#f08a3c', script: '#7cc43a' }[v.run] : '#f2b01e', skin = '#f2c79e', pal = this.palette();
    const r = (dx: number, dy: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x + dx * o, y + dy * o, w * o, h * o); };
    r(-4, -1, 8, 2, 'rgba(40,30,20,0.25)');
    r(-3, -6, 2, 5, '#3d4a7a'); r(1, -6, 2, 5, '#3d4a7a');
    r(-4, -11, 8, 6, shirt);
    /* the head: fallen to a side and lower asleep; eyes open, shut asleep or in a blink */
    const sleep = state === 'sleep', hx = sleep ? -1 : -2, hy = sleep ? -14 : -15;
    r(hx, hy, 4, 4, skin); r(hx - 1, hy - 2, 6, 2, '#f2b01e');
    const blink = state === 'wait' && t % 3.2 < 0.15;
    if (sleep || blink) r(hx + 1, hy + 2, 2, 1, INK); else { r(hx + 1, hy + 2, 1, 1, INK); r(hx + 3, hy + 2, 1, 1, INK); }
    if (state === 'work') {
      /* a spanner, up then down, and sparks where it strikes */
      r(-6, -10, 2, 3, skin);
      if (beat) { r(4, -14, 2, 4, skin); r(4, -17, 3, 3, '#9a93ab'); } else { r(4, -11, 2, 3, skin); r(5, -9, 3, 2, '#9a93ab'); }
      if (Math.floor(t * 8) % 4 === 0) { r(7, -9, 1, 1, '#ffd23f'); r(8, -11, 1, 1, '#ffd23f'); r(6, -12, 1, 1, '#ffffff'); }
    } else if (state === 'call' || state === 'ask') {
      const up = Math.floor(t * 2) % 2;
      r(-5, -10, 1, 4, skin); r(4, -18 - up, 2, 8, skin);
      if (this.sprites) this.sign(x * ART + 0.5, y * ART - 23.5 - up, state === 'call' ? pal.danger : pal.amber, state === 'call' ? '!' : '?');
    } else {
      r(-5, -10, 1, 4, skin); r(4, -10, 1, 4, skin);
      if (sleep) for (const { k, size } of zees(t)) {
        ctx.globalAlpha = 1 - k;
        sprite(ctx, size > 0.24 ? Z5 : Z4, Math.round(x * ART) + 3 + Math.round(k * 5), Math.round(y * ART) - 18 - Math.round(k * 12), { X: pal.text2 });
        ctx.globalAlpha = 1;
      }
    }
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
