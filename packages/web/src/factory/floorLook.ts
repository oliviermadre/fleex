/**
 * How the floor itself looks, apart from what is built on it: a dot where four
 * tiles meet, a light over the middle, the shadow of what stands on it, and the
 * glow of a machine's light when it needs someone or is switched off (what the
 * light says is in `machineArt.ts`).
 * Decoration only, kept faint: it never says anything the machines do not
 * already say. Pure helpers; the renderer paints.
 */
/** The channels of a colour (`#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)`, whose opacity is left aside), or null for anything else. */
export function channels(color: string): [number, number, number] | null {
  const f = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  if (f) return [Number(f[1]), Number(f[2]), Number(f[3])];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** A colour at a given opacity. One that cannot be read gives nothing to paint rather than a wrong colour. */
export function veil(color: string, alpha: number): string {
  const c = channels(color);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha))})` : 'rgba(0,0,0,0)';
}
/** A colour moved part of the way towards another, opaque. One that cannot be read is given back as it is. */
export function mix(color: string, towards: string, amount: number): string {
  const a = channels(color), b = channels(towards), k = Math.max(0, Math.min(1, amount));
  return a && b ? `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(',')})` : color;
}
/** A colour as `#rrggbb`: what `mix` gives (`rgb(r,g,b)`) is written so; one already written so is given back. */
export const toHex = (c: string): string => { const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c.replace(/\s/g, '')); return m ? `#${m.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : c; };
/** That colour, mixed towards white (or black) a tenth at a time until it reads at `ratio` on every one of `grounds`. As `#rrggbb`. */
export function readable(color: string, grounds: readonly string[], ratio: number, towards: '#ffffff' | '#000000'): string {
  let c = color;
  for (let k = 0; k < 10 && grounds.some((g) => contrast(c, g) < ratio); k++) c = mix(color, towards, (k + 1) * 0.1);
  return toHex(c);
}
/** True for the floor of a light theme (a floor that cannot be read counts as dark, as most themes are). */
export function isLight(color: string): boolean {
  const c = channels(color);
  return !!c && (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55;
}

/** How light a colour is, from 0 (black) to 1 (white), as contrast is counted; null for one that cannot be read. */
export function luminance(color: string): number | null {
  const c = channels(color);
  if (!c) return null;
  const [r, g, b] = c.map((v) => { const k = v / 255; return k <= 0.03928 ? k / 12.92 : ((k + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The contrast of two colours, from 1 (the same) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a) ?? 0, lb = luminance(b) ?? 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/**
 * A colour to write with on a ground of that lightness, keeping its hue: the colours of the floor were picked on a
 * dark floor, where they are light. On a light ground a light ink is darkened, the lighter the more; on a dark
 * ground an ink too dark to be read becomes near white. What already reads is given back as it is.
 */
export function legible(ink: string, ground: number): string {
  const l = luminance(ink);
  if (l == null) return ink;
  if (ground > 0.4) return l > 0.22 ? mix(ink, '#000000', Math.min(0.72, 0.4 + (l - 0.22) * 0.5)) : ink;
  return l < 0.2 ? '#f4f4f5' : ink;
}

export interface FloorLook {
  /** A dot where tiles meet, and the stronger one every `MAJOR` tiles. */
  dot: string; major: string;
  /** How much white the middle of the floor takes, and how much black its edges do (0 to 1). */
  light: number; dusk: number;
  /** The shadow of a station, a zone or an exit. */
  shadow: string;
  /** How strong a station's glow is at its centre. */
  glow: number;
}
/** Every how many tiles a dot is drawn stronger: a scale to count by. */
export const MAJOR = 4;
/** On a dark floor light is added and shadows are deep; on a light one everything is a shade of grey, and fainter. */
export function floorLook(floor: string): FloorLook {
  return isLight(floor)
    ? { dot: 'rgba(0,0,0,0.16)', major: 'rgba(0,0,0,0.28)', light: 0, dusk: 0.07, shadow: 'rgba(0,0,0,0.2)', glow: 0.16 }
    : { dot: 'rgba(255,255,255,0.13)', major: 'rgba(255,255,255,0.21)', light: 0.055, dusk: 0.38, shadow: 'rgba(0,0,0,0.55)', glow: 0.22 };
}

/** 0 below `from`, 1 above `to`, a straight ramp between: what appears with the zoom comes in, it does not pop. */
export function fadeIn(z: number, from: number, to: number): number {
  return z <= from ? 0 : z >= to ? 1 : (z - from) / (to - from);
}
