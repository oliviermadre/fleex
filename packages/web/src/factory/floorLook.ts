/**
 * How the floor itself looks, apart from what is built on it: a dot where four
 * tiles meet, a light over the middle, the shadow of what stands on it, and the
 * glow a station throws around itself while it works or calls for someone.
 * Decoration only, kept faint: it never says anything the machines do not
 * already say. Pure helpers; the renderer paints.
 */
import type { FactoryTicket } from './types';

/** What a station is doing, most pressing first. Drives its lamp and the glow around it. */
export type StationState = 'failed' | 'call' | 'running' | 'queue' | 'idle';
export function stationState(tickets: readonly FactoryTicket[]): StationState {
  const has = (...phases: FactoryTicket['phase'][]) => tickets.some((t) => phases.includes(t.phase));
  return has('failed') ? 'failed' : has('review', 'question', 'aside') ? 'call' : has('running') ? 'running' : has('wait') ? 'queue' : 'idle';
}
/** A station lights the floor when it works, or when it waits for a human. Queueing and idle stations stay dark. */
export const glows = (s: StationState): boolean => s === 'failed' || s === 'call' || s === 'running';

/** The channels of a theme colour (`#rgb` or `#rrggbb`), or null for anything else. */
export function channels(color: string): [number, number, number] | null {
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
/** True for the floor of a light theme (a floor that cannot be read counts as dark, as most themes are). */
export function isLight(color: string): boolean {
  const c = channels(color);
  return !!c && (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55;
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
