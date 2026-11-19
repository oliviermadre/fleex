/**
 * Paints the made-up floor of `fixture.ts` in a few situations (dark and light themes, build mode, a lens, from far,
 * stopped), the same frames each time, and hands back each picture as a PNG data URL. Run by
 * `packages/web/scripts/factory-shots/run.mjs`, which saves them and compares two runs pixel by pixel: a change to
 * the renderer that should show nothing is checked that way.
 */
import { applyTheme, BUILT_IN_THEMES } from '../../lib/themes';
import { FactoryView, type ViewState } from '../renderer';
import { FleexSkin } from '../skins/fleex';
import { NeonSkin, type NeonOptions } from '../skins/neon';
import { PIXEL_FONTS, PixelSkin } from '../skins/pixel';
import type { Skin } from '../skins/skin';
import { floorState, later, lens } from './fixture';

const W = 1400, H = 900, FRAMES = 48, DT = 1 / 60;

/** `then`: what changes after the first frames, drawn for `after` more frames (what is seen moving between two snapshots). */
interface Shot { name: string; theme: string; cam: { x: number; y: number; z: number }; st: Partial<ViewState>; then?: Partial<ViewState>; after?: number; skin?: () => Skin }

const base = (): ViewState => floorState();

const SHOTS: Shot[] = [
  { name: 'floor-dark', theme: 'verdant', cam: { x: 13, y: 10, z: 38 }, st: {} },
  { name: 'floor-light', theme: 'light', cam: { x: 13, y: 10, z: 38 }, st: {} },
  { name: 'close-dark', theme: 'verdant', cam: { x: 12.5, y: 3, z: 72 }, st: { hoverLamp: 'st_agent', selMachine: 'g1' } },
  { name: 'close-light', theme: 'light', cam: { x: 18, y: 9, z: 72 }, st: { selMachine: 'st_script' } },
  {
    name: 'build', theme: 'verdant', cam: { x: 13, y: 10, z: 38 },
    st: {
      edit: true, selMachine: 'a4', selMany: [], selTicket: null, hoverMachine: 'b9', marquee: { x0: 18.2, y0: 14.5, x1: 25.6, y1: 18.4 },
      ghost: { cells: [{ x: 12, y: 16, w: 1, h: 1, dir: 0, arm: true }, { x: 13, y: 17, w: 5, h: 4 }], ok: true, text: 'Place a station' },
    },
  },
  { name: 'build-many', theme: 'light', cam: { x: 13, y: 10, z: 38 }, st: { edit: true, selMany: ['b1', 'b2', 'g1'], selTicket: null, grid: true, ghost: { cells: [{ x: 22, y: 16, w: 2, h: 1 }], ok: false, erase: true } } },
  { name: 'lens', theme: 'verdant', cam: { x: 13, y: 10, z: 38 }, st: { lens } },
  { name: 'far', theme: 'verdant', cam: { x: 13, y: 10, z: 9 }, st: { allNames: true, armTags: false, numbers: true } },
  { name: 'moving', theme: 'verdant', cam: { x: 13, y: 10, z: 38 }, st: { hoverMachine: null }, then: { tickets: later }, after: 14 },
  { name: 'moving-light', theme: 'light', cam: { x: 13, y: 10, z: 38 }, st: { hoverMachine: null }, then: { tickets: later }, after: 30 },
  { name: 'neon-dark', theme: 'verdant', cam: { x: 13, y: 10, z: 38 }, st: {}, skin: () => new NeonSkin() },
  { name: 'neon-light', theme: 'light', cam: { x: 13, y: 10, z: 38 }, st: { edit: true, selMachine: 'a4' }, skin: () => new NeonSkin() },
  { name: 'pixel-dark', theme: 'verdant', cam: { x: 13, y: 10, z: 32 }, st: {}, skin: () => new PixelSkin() },
  { name: 'pixel-light', theme: 'light', cam: { x: 11, y: 6, z: 48 }, st: { selMachine: 'st_agent' }, skin: () => new PixelSkin() },
  {
    name: 'halted-drag', theme: 'verdant', cam: { x: 13, y: 10, z: 38 },
    st: { halted: true, selTickets: new Set(['t28', 't29']), pickTickets: new Set(['t0']), drag: { ticketId: 't1', x: 12.4, y: 5.6, ok: true, text: 'Drop on Build' } },
  },
];

/** The skins side by side on the two kinds of theme, for a mock-up: each skin and theme, the same floor. */
const SKINS: { name: string; skin: () => Skin; z?: number }[] = [
  { name: 'fleex', skin: () => new FleexSkin() },
  ...(['soft', 'strong'] as const).flatMap((glow) => (['accent', 'cyan'] as const).map((chevrons) => ({ name: `neon-${glow}-${chevrons}`, skin: () => new NeonSkin({ glow, chevrons } satisfies NeonOptions) }))),
];
/* the pixel skin rests on whole steps of its art (see `PIXEL_STEPS`) */
SKINS.push(
  { name: 'pixel-32', skin: () => new PixelSkin(), z: 32 }, { name: 'pixel-48', skin: () => new PixelSkin(), z: 48 },
);
const looks = (): Shot[] => SKINS.flatMap(({ name, skin, z }) => ['verdant', 'light'].map((theme) => ({ name: `${name}-${theme}`, theme, cam: { x: 13, y: 9.6, z: z ?? 44 }, st: {}, skin })));

async function shoot(which: 'checks' | 'looks' = 'checks', type = 'image/png'): Promise<Record<string, string>> {
  await Promise.all(PIXEL_FONTS.map((f) => document.fonts.load(f).catch(() => undefined)));
  await document.fonts.ready;
  const out: Record<string, string> = {};
  for (const s of which === 'looks' ? looks() : SHOTS) {
    const theme = BUILT_IN_THEMES.find((t) => t.id === s.theme);
    if (!theme) throw new Error(`no theme ${s.theme}`);
    applyTheme(theme);
    const cv = document.createElement('canvas');
    cv.style.width = `${W}px`; cv.style.height = `${H}px`; cv.style.display = 'block';
    document.body.replaceChildren(cv);
    /* a fresh view each time: it keeps where tickets were drawn and the theme it read */
    const v = new FactoryView(cv, s.skin?.()), st = { ...base(), ...s.st };
    v.resize(); v.cam = { ...s.cam };
    for (let i = 0; i < FRAMES; i++) v.draw(st, DT);
    if (s.then) { const next = { ...st, ...s.then }; for (let i = 0; i < (s.after ?? 10); i++) v.draw(next, DT); }
    out[s.name] = cv.toDataURL(type, 0.86);
  }
  return out;
}

declare global { interface Window { shoot: typeof shoot; shotsReady: boolean } }
window.shoot = shoot;
window.shotsReady = true;
