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
import { PixelSkin, WORKSHOP_FONT, workshopTheme } from './pixel';
import { PixelTqSkin } from './pixelTq';
import { isLight } from '../floorLook';
import type { DecorOptions } from '../decor';
import type { PeopleOptions } from '../people';

export type SkinId = 'fleex' | 'neon' | 'pixel' | 'pixel-3d';
export const DEFAULT_SKIN: SkinId = 'fleex';

/** The page around the floor, painted in the skin's colours: CSS variables over the theme's, and a font. */
export interface SkinChrome { vars: Record<string, string>; font: string | null; light: boolean }

export interface SkinInfo {
  id: SkinId;
  name: string;
  /** What it looks like, in a few words. */
  blurb: string;
  make: () => FleexSkin;
  /** Whether its floor has a decor until one says otherwise: the pixel skins do, Fleex's and the neon one do not. */
  decor: boolean;
  /** Its colours for the page around the floor, given the theme in use; null when it keeps the theme's. */
  chrome: (theme: Theme) => SkinChrome | null;
}

export const SKINS: readonly SkinInfo[] = [
  { id: 'fleex', name: 'Fleex', blurb: 'Follows the theme', make: () => new FleexSkin(), decor: false, chrome: () => null },
  { id: 'neon', name: 'Neon', blurb: 'Night floor, your accent', make: () => new NeonSkin(), decor: false, chrome: (theme) => ({ vars: themeVars(nightTheme(theme)), font: NIGHT_FONT, light: false }) },
  { id: 'pixel', name: 'Pixel', blurb: 'A workshop, by day or at night', make: () => new PixelSkin(), decor: true, chrome: (theme) => ({ vars: themeVars(workshopTheme(theme)), font: WORKSHOP_FONT, light: isLight(theme.colors.bgSurface) }) },
  { id: 'pixel-3d', name: 'Pixel 3D', blurb: 'The workshop, seen from three quarters', make: () => new PixelTqSkin(), decor: true, chrome: (theme) => ({ vars: themeVars(workshopTheme(theme)), font: WORKSHOP_FONT, light: isLight(theme.colors.bgSurface) }) },
];

/**
 * The decor, as the owner picked it on `docs/factory/decor.html`: walls round what is built with a yard outside (W2),
 * a few props (A1), faded in build mode (B1).
 */
export const DECOR: DecorOptions = { wall: 'built', props: 1, build: 'fade' };
/**
 * The people, as the owner picked them on `docs/factory/people.html`: a few walkers (N1), a reviewer at a gate that
 * waits and a hand raised at a station whose run failed or asked (E1), faded in build mode (M1). They come with the
 * decor (R1): one switch.
 */
export const PEOPLE: PeopleOptions = { walkers: 1, gate: true, hands: true, build: 'fade' };
/** Whether a skin's floor has its decor: as set for that skin (`factoryDecor`), else that skin's default. */
export const decorOn = (skin: SkinInfo, set: Record<string, boolean> | undefined): boolean => set?.[skin.id] ?? skin.decor;

/** The skin of that id; Fleex's for one that is not (or no longer) known. */
export function skinInfo(id: string | null | undefined): SkinInfo {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN)!;
}
