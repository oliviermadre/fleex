/**
 * Theme-aware decorative color tints.
 *
 * This is the ONLY sanctioned way to put decorative color (badges, tags,
 * status pills, dots, bars…) on the UI. Raw Tailwind palette classes
 * (`text-orange-400`, `bg-green-500/15`, …) are forbidden in
 * `packages/web/src` (enforced by `scripts/check-raw-palette.mjs`): they are
 * calibrated for one background and break as soon as the theme flips
 * light/dark.
 *
 * Instead, every hue exposes four CSS variables set by `applyTheme()`
 * according to the active theme's luminance (see `themes.ts`):
 *
 *   --tint-{hue}-text    dark-enough / bright-enough text  (≥ 4.5:1 on bg)
 *   --tint-{hue}-bg      translucent tinted background
 *   --tint-{hue}-border  visible outline ("détourage") so chips stay legible
 *                        even on surfaces close to their own tint
 *   --tint-{hue}-solid   opaque accent for dots, bars, strokes — also safe
 *                        as a bg for white text in both palettes
 *
 * Light palette: text = Tailwind 700/800, base = 500 (bg @10%, border @30%).
 * Dark palette:  text = Tailwind 300,     base = 400 (bg @15%, border @25%).
 * Every text/bg pair is contrast-checked ≥ 4.5:1 against both `bgBase` and
 * `bgSurface` of the built-in themes (see theme-audit sweep).
 *
 * Non-canonical Tailwind hues map as follows when migrating:
 *   amber→yellow, lime/emerald→green, cyan→teal, sky→blue, violet→purple,
 *   fuchsia/rose→pink (rose used as danger→red), slate/zinc/neutral/stone→gray.
 */

export type TintHue =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'gray';

export const TINT_HUES: TintHue[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'gray',
];

export interface TintTokens {
  /** Badge text color — contrast-checked against `bg` over theme surfaces. */
  text: string;
  /** Translucent tinted background. */
  bg: string;
  /** Outline color — the "détourage" that keeps chips readable everywhere. */
  border: string;
  /** Opaque accent: dots, progress bars, strokes; safe under white text. */
  solid: string;
}

/** Light palette — text 700 (800 where 700 missed 4.5:1), base 500. */
export const LIGHT_TINTS: Record<TintHue, TintTokens> = {
  red:    { text: '#b91c1c', bg: 'rgba(239, 68, 68, 0.10)',   border: 'rgba(239, 68, 68, 0.30)',   solid: '#dc2626' },
  orange: { text: '#9a3412', bg: 'rgba(249, 115, 22, 0.10)',  border: 'rgba(249, 115, 22, 0.30)',  solid: '#c2410c' },
  yellow: { text: '#854d0e', bg: 'rgba(234, 179, 8, 0.10)',   border: 'rgba(234, 179, 8, 0.30)',   solid: '#a16207' },
  green:  { text: '#166534', bg: 'rgba(34, 197, 94, 0.10)',   border: 'rgba(34, 197, 94, 0.30)',   solid: '#15803d' },
  teal:   { text: '#0f766e', bg: 'rgba(20, 184, 166, 0.10)',  border: 'rgba(20, 184, 166, 0.30)',  solid: '#0f766e' },
  blue:   { text: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.10)',  border: 'rgba(59, 130, 246, 0.30)',  solid: '#2563eb' },
  indigo: { text: '#4338ca', bg: 'rgba(99, 102, 241, 0.10)',  border: 'rgba(99, 102, 241, 0.30)',  solid: '#4f46e5' },
  purple: { text: '#7e22ce', bg: 'rgba(168, 85, 247, 0.10)',  border: 'rgba(168, 85, 247, 0.30)',  solid: '#9333ea' },
  pink:   { text: '#be185d', bg: 'rgba(236, 72, 153, 0.10)',  border: 'rgba(236, 72, 153, 0.30)',  solid: '#db2777' },
  gray:   { text: '#52525b', bg: 'rgba(113, 113, 122, 0.10)', border: 'rgba(113, 113, 122, 0.30)', solid: '#71717a' },
};

/** Dark palette — text 300, base 400. */
export const DARK_TINTS: Record<TintHue, TintTokens> = {
  red:    { text: '#fca5a5', bg: 'rgba(248, 113, 113, 0.15)', border: 'rgba(248, 113, 113, 0.25)', solid: '#f87171' },
  orange: { text: '#fdba74', bg: 'rgba(251, 146, 60, 0.15)',  border: 'rgba(251, 146, 60, 0.25)',  solid: '#fb923c' },
  yellow: { text: '#fde047', bg: 'rgba(250, 204, 21, 0.15)',  border: 'rgba(250, 204, 21, 0.25)',  solid: '#facc15' },
  green:  { text: '#86efac', bg: 'rgba(74, 222, 128, 0.15)',  border: 'rgba(74, 222, 128, 0.25)',  solid: '#4ade80' },
  teal:   { text: '#5eead4', bg: 'rgba(45, 212, 191, 0.15)',  border: 'rgba(45, 212, 191, 0.25)',  solid: '#2dd4bf' },
  blue:   { text: '#93c5fd', bg: 'rgba(96, 165, 250, 0.15)',  border: 'rgba(96, 165, 250, 0.25)',  solid: '#60a5fa' },
  indigo: { text: '#a5b4fc', bg: 'rgba(129, 140, 248, 0.15)', border: 'rgba(129, 140, 248, 0.25)', solid: '#818cf8' },
  purple: { text: '#d8b4fe', bg: 'rgba(192, 132, 252, 0.15)', border: 'rgba(192, 132, 252, 0.25)', solid: '#c084fc' },
  pink:   { text: '#f9a8d4', bg: 'rgba(244, 114, 182, 0.15)', border: 'rgba(244, 114, 182, 0.25)', solid: '#f472b6' },
  gray:   { text: '#d4d4d8', bg: 'rgba(161, 161, 170, 0.15)', border: 'rgba(161, 161, 170, 0.25)', solid: '#a1a1aa' },
};

export interface TintClassSet {
  text: string;
  bg: string;
  /** Border COLOR only — combine with a `border` width class yourself. */
  borderColor: string;
  /** Opaque accent as background (dots, bars). */
  solid: string;
  /** Opaque accent as text (vivid icons/strokes). */
  solidText: string;
  hoverText: string;
  hoverBg: string;
  hoverSolid: string;
  hoverBorderColor: string;
  groupHoverText: string;
  ring: string;
}

/**
 * Full literal class strings per hue. They MUST stay literal (no template
 * interpolation): Tailwind's scanner only generates utilities for class
 * tokens that appear verbatim in the source.
 */
export const TINT_CLASSES: Record<TintHue, TintClassSet> = {
  red: {
    text: 'text-[var(--tint-red-text)]',
    bg: 'bg-[var(--tint-red-bg)]',
    borderColor: 'border-[var(--tint-red-border)]',
    solid: 'bg-[var(--tint-red-solid)]',
    solidText: 'text-[var(--tint-red-solid)]',
    hoverText: 'hover:text-[var(--tint-red-text)]',
    hoverBg: 'hover:bg-[var(--tint-red-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-red-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-red-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-red-text)]',
    ring: 'ring-[var(--tint-red-border)]',
  },
  orange: {
    text: 'text-[var(--tint-orange-text)]',
    bg: 'bg-[var(--tint-orange-bg)]',
    borderColor: 'border-[var(--tint-orange-border)]',
    solid: 'bg-[var(--tint-orange-solid)]',
    solidText: 'text-[var(--tint-orange-solid)]',
    hoverText: 'hover:text-[var(--tint-orange-text)]',
    hoverBg: 'hover:bg-[var(--tint-orange-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-orange-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-orange-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-orange-text)]',
    ring: 'ring-[var(--tint-orange-border)]',
  },
  yellow: {
    text: 'text-[var(--tint-yellow-text)]',
    bg: 'bg-[var(--tint-yellow-bg)]',
    borderColor: 'border-[var(--tint-yellow-border)]',
    solid: 'bg-[var(--tint-yellow-solid)]',
    solidText: 'text-[var(--tint-yellow-solid)]',
    hoverText: 'hover:text-[var(--tint-yellow-text)]',
    hoverBg: 'hover:bg-[var(--tint-yellow-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-yellow-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-yellow-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-yellow-text)]',
    ring: 'ring-[var(--tint-yellow-border)]',
  },
  green: {
    text: 'text-[var(--tint-green-text)]',
    bg: 'bg-[var(--tint-green-bg)]',
    borderColor: 'border-[var(--tint-green-border)]',
    solid: 'bg-[var(--tint-green-solid)]',
    solidText: 'text-[var(--tint-green-solid)]',
    hoverText: 'hover:text-[var(--tint-green-text)]',
    hoverBg: 'hover:bg-[var(--tint-green-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-green-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-green-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-green-text)]',
    ring: 'ring-[var(--tint-green-border)]',
  },
  teal: {
    text: 'text-[var(--tint-teal-text)]',
    bg: 'bg-[var(--tint-teal-bg)]',
    borderColor: 'border-[var(--tint-teal-border)]',
    solid: 'bg-[var(--tint-teal-solid)]',
    solidText: 'text-[var(--tint-teal-solid)]',
    hoverText: 'hover:text-[var(--tint-teal-text)]',
    hoverBg: 'hover:bg-[var(--tint-teal-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-teal-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-teal-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-teal-text)]',
    ring: 'ring-[var(--tint-teal-border)]',
  },
  blue: {
    text: 'text-[var(--tint-blue-text)]',
    bg: 'bg-[var(--tint-blue-bg)]',
    borderColor: 'border-[var(--tint-blue-border)]',
    solid: 'bg-[var(--tint-blue-solid)]',
    solidText: 'text-[var(--tint-blue-solid)]',
    hoverText: 'hover:text-[var(--tint-blue-text)]',
    hoverBg: 'hover:bg-[var(--tint-blue-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-blue-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-blue-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-blue-text)]',
    ring: 'ring-[var(--tint-blue-border)]',
  },
  indigo: {
    text: 'text-[var(--tint-indigo-text)]',
    bg: 'bg-[var(--tint-indigo-bg)]',
    borderColor: 'border-[var(--tint-indigo-border)]',
    solid: 'bg-[var(--tint-indigo-solid)]',
    solidText: 'text-[var(--tint-indigo-solid)]',
    hoverText: 'hover:text-[var(--tint-indigo-text)]',
    hoverBg: 'hover:bg-[var(--tint-indigo-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-indigo-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-indigo-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-indigo-text)]',
    ring: 'ring-[var(--tint-indigo-border)]',
  },
  purple: {
    text: 'text-[var(--tint-purple-text)]',
    bg: 'bg-[var(--tint-purple-bg)]',
    borderColor: 'border-[var(--tint-purple-border)]',
    solid: 'bg-[var(--tint-purple-solid)]',
    solidText: 'text-[var(--tint-purple-solid)]',
    hoverText: 'hover:text-[var(--tint-purple-text)]',
    hoverBg: 'hover:bg-[var(--tint-purple-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-purple-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-purple-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-purple-text)]',
    ring: 'ring-[var(--tint-purple-border)]',
  },
  pink: {
    text: 'text-[var(--tint-pink-text)]',
    bg: 'bg-[var(--tint-pink-bg)]',
    borderColor: 'border-[var(--tint-pink-border)]',
    solid: 'bg-[var(--tint-pink-solid)]',
    solidText: 'text-[var(--tint-pink-solid)]',
    hoverText: 'hover:text-[var(--tint-pink-text)]',
    hoverBg: 'hover:bg-[var(--tint-pink-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-pink-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-pink-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-pink-text)]',
    ring: 'ring-[var(--tint-pink-border)]',
  },
  gray: {
    text: 'text-[var(--tint-gray-text)]',
    bg: 'bg-[var(--tint-gray-bg)]',
    borderColor: 'border-[var(--tint-gray-border)]',
    solid: 'bg-[var(--tint-gray-solid)]',
    solidText: 'text-[var(--tint-gray-solid)]',
    hoverText: 'hover:text-[var(--tint-gray-text)]',
    hoverBg: 'hover:bg-[var(--tint-gray-bg)]',
    hoverSolid: 'hover:bg-[var(--tint-gray-solid)]',
    hoverBorderColor: 'hover:border-[var(--tint-gray-border)]',
    groupHoverText: 'group-hover:text-[var(--tint-gray-text)]',
    ring: 'ring-[var(--tint-gray-border)]',
  },
};

/**
 * The standard badge/chip recipe: pale tinted background + dark(ened) text +
 * an outline. The outline is what keeps chips readable when they sit on a
 * surface close to their own tint, in ANY theme.
 */
export function tint(hue: TintHue): string {
  const c = TINT_CLASSES[hue];
  return `${c.text} ${c.bg} border ${c.borderColor}`;
}

/** Tinted text only (inline labels, icons following the tint). */
export function tintText(hue: TintHue): string {
  return TINT_CLASSES[hue].text;
}

/** Opaque accent background (status dots, progress bars, strokes). */
export function tintSolid(hue: TintHue): string {
  return TINT_CLASSES[hue].solid;
}

/** Full class set for advanced call sites (hover/group-hover/ring variants). */
export function tintClasses(hue: TintHue): TintClassSet {
  return TINT_CLASSES[hue];
}
