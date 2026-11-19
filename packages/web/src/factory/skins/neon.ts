/**
 * The neon skin, "night shift": the Fleex skin on a night floor, every line a tube of light.
 *
 * It needs no shape of its own (`docs/factory/skins-handover.md`): it is a palette, and a glow. The glow is one
 * picture, not a blur per stroke: once everything is painted, a quarter-size copy of the picture is blurred and laid
 * back over it in light, before the words are written (they stay crisp). Its cost does not grow with what is built.
 *
 * Its floor is night whatever the theme. What it takes from the theme is the accent, lifted until it shines on that
 * floor: the chevrons of the belts, the Inbound, what is selected glow in the colour the rest of the app is in.
 *
 * The page around the floor (its header, its console, what lies over the floor) is painted in the same night: see
 * `nightTheme`. Chosen on `docs/factory/skin-choice.html`: a soft glow, the belts' chevrons in the theme's accent.
 */
import type { Theme } from '../../lib/themes';
import { contrast, isLight, mix } from '../floorLook';
import { FleexSkin, type Palette } from './fleex';

/** The night floor, and what does not follow the theme. */
export const NIGHT = {
  bg: '#05050b', floor: '#0b0a16', grid: '#1e1b36', belt: '#100e1f', edge: '#2a2550', body: '#0e0d19',
  text: '#e9e7ff', text2: '#a7a3d6', text3: '#6e6a8f', ok: '#39ff9c', warn: '#ffd23f', danger: '#ff4f7b', fast: '#4fd1ff',
} as const;
/** How strongly the picture glows, and how wide (in pixels of the quarter-size copy). */
export const GLOW = { soft: { alpha: 0.5, blur: 2.5 }, strong: { alpha: 0.95, blur: 3.5 } } as const;

export interface NeonOptions {
  /** How much it glows. */
  glow?: keyof typeof GLOW;
  /** What the belts' chevrons are lit in: the theme's accent, or the cyan of the tubes. */
  chevrons?: 'accent' | 'cyan';
}

/** `rgb(r,g,b)` (what `mix` gives) as `#rrggbb`; a colour already written so is given back. */
const toHex = (c: string): string => { const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c.replace(/\s/g, '')); return m ? `#${m.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : c; };

/** A colour made to shine on the night floor: lifted towards white until it stands out from it. As `#rrggbb`. */
export function shine(color: string, floor: string = NIGHT.floor): string {
  let c = color;
  for (let k = 0; k < 10 && contrast(c, floor) < 6.5; k++) c = mix(color, '#ffffff', (k + 1) * 0.1);
  return toHex(c);
}

/**
 * The theme the page around a neon floor is painted in: the night's surfaces and inks, the theme's accent lifted to
 * shine, the rest of the theme (its syntax, its terminal) as it is. Every ink holds 4.5 on its surfaces
 * (`neon.test.ts`).
 */
export function nightTheme(theme: Theme): Theme {
  const accent = shine(theme.colors.accent), [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  return {
    ...theme, id: `${theme.id}@night`, name: `${theme.name}, at night`, builtIn: false,
    colors: {
      accent, accentHover: toHex(mix(accent, '#ffffff', 0.15)), accentActive: toHex(mix(accent, '#000000', 0.15)), accentMuted: `rgba(${r}, ${g}, ${b}, 0.15)`,
      bgBase: NIGHT.bg, bgSurface: '#0e0d19', bgOverlay: '#1a1830', bgHover: 'rgba(26, 24, 48, 0.6)', bgOverlayHover: '#2a2550',
      border: '#2a2550', borderSubtle: 'rgba(42, 37, 80, 0.5)', borderInput: '#3d3770',
      textPrimary: NIGHT.text, textSecondary: '#b4b0e0', textMuted: '#908cba', textFaint: '#6e6a8f',
      success: NIGHT.ok, warning: NIGHT.warn, danger: NIGHT.danger,
    },
  };
}
/** The font of the page around a neon floor: a control room's. */
export const NIGHT_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export class NeonSkin extends FleexSkin {
  override readonly id: string = 'neon';
  private bloom: HTMLCanvasElement | null = null;
  constructor(private readonly opts: NeonOptions = {}) { super(); }

  protected override palette(): Palette {
    const now = performance.now();
    if (this.pal && now - this.palAt < 2000) return this.pal;
    const theme = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim() || '#D77655';
    const accent = shine(theme);
    this.palAt = now;
    this.pal = {
      ...NIGHT, accent, light: isLight(NIGHT.floor), amber: NIGHT.warn,
      chev: this.opts.chevrons === 'cyan' ? mix(NIGHT.fast, NIGHT.floor, 0.25) : mix(accent, NIGHT.floor, 0.2),
    };
    return this.pal;
  }

  /** The glow: a blurred quarter-size copy of the picture, laid back over it in light. */
  protected override lit(): void {
    const cv = this.cv, g = GLOW[this.opts.glow ?? 'soft'];
    if (!cv.width || !cv.height) return;
    const w = Math.max(1, Math.ceil(cv.width / 4)), h = Math.max(1, Math.ceil(cv.height / 4));
    const b = this.bloom ?? (this.bloom = document.createElement('canvas'));
    if (b.width !== w || b.height !== h) { b.width = w; b.height = h; }
    const c = b.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, w, h); c.filter = `blur(${g.blur}px)`; c.drawImage(cv, 0, 0, w, h); c.filter = 'none';
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = g.alpha; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b, 0, 0, cv.width, cv.height);
    ctx.restore();
  }
}
