/**
 * The skins one can choose, in Settings › Appearance next to the theme (`factorySkin` in the settings).
 *
 * A skin paints the floor (`Skin`), and may paint the page around it in its own colours (`chrome`): the console, the
 * header, what lies over the floor. Fleex's own skin follows the theme and has no chrome of its own.
 */
import type { Theme } from '../../lib/themes';
import { themeVars } from '../../lib/themes';
import { FleexSkin } from './fleex';
import { NeonSkin, nightTheme, NIGHT_FONT } from './neon';
import type { Skin } from './skin';

export type SkinId = 'fleex' | 'neon';
export const DEFAULT_SKIN: SkinId = 'fleex';

/** The page around the floor, painted in the skin's colours: CSS variables over the theme's, and a font. */
export interface SkinChrome { vars: Record<string, string>; font: string | null; light: boolean }

export interface SkinInfo {
  id: SkinId;
  name: string;
  /** What it looks like, in a few words. */
  blurb: string;
  make: () => Skin;
  /** Its colours for the page around the floor, given the theme in use; null when it keeps the theme's. */
  chrome: (theme: Theme) => SkinChrome | null;
}

export const SKINS: readonly SkinInfo[] = [
  { id: 'fleex', name: 'Fleex', blurb: 'Follows the theme', make: () => new FleexSkin(), chrome: () => null },
  { id: 'neon', name: 'Neon', blurb: 'Night floor, your accent', make: () => new NeonSkin(), chrome: (theme) => ({ vars: themeVars(nightTheme(theme)), font: NIGHT_FONT, light: false }) },
];

/** The skin of that id; Fleex's for one that is not (or no longer) known. */
export function skinInfo(id: string | null | undefined): SkinInfo {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN)!;
}
