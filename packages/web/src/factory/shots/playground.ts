/**
 * The made-up floor of `fixture.ts`, live, for a mock-up to embed: the real renderer and the real skins, a view one
 * can move (drag) and zoom (wheel, buttons). Bundled into one script by `run.mjs playground`.
 *
 * The zoom is the view's own, as in the page: by steps for the pixel skin (see `FactoryView.wheel`), free for Fleex's.
 */
import { applyTheme, BUILT_IN_THEMES } from '../../lib/themes';
import { FactoryView } from '../renderer';
import { FleexSkin } from '../skins/fleex';
import { PIXEL_STEPS, PixelSkin } from '../skins/pixel';
import { floorState, layout } from './fixture';

export interface Look { skin: 'fleex' | 'pixel'; theme: string }
/** What the zoom is at: pixels per tile, and whether it is resting (on a step, for the pixel skin). */
export type Report = (z: number, resting: boolean, steps: readonly number[]) => void;

export function mount(cv: HTMLCanvasElement, report: Report, start: Look) {
  let look = { ...start };
  const make = () => (look.skin === 'pixel' ? new PixelSkin() : new FleexSkin());
  const theme = () => { const t = BUILT_IN_THEMES.find((x) => x.id === look.theme); if (t) applyTheme(t); };
  theme();
  const view = new FactoryView(cv, make()), st = floorState({ hoverMachine: null });
  view.resize(); view.cam = { x: 13, y: 9.5, z: 32 };
  const pixel = () => look.skin === 'pixel';
  const zMin = () => { const F = view.floorOf(layout); return Math.max(3, view.w / F.w, view.h / F.h); };
  /* the view zooms by itself, by steps for the pixel skin: the wheel goes to it */
  cv.addEventListener('wheel', (e) => { e.preventDefault(); view.wheel(e.offsetX, e.offsetY, e.deltaY, e.ctrlKey, e.deltaMode === 1); }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; view.cam.x -= (e.clientX - drag.x) / view.cam.z; view.cam.y -= (e.clientY - drag.y) / view.cam.z; drag = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', () => { drag = null; });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    view.resize();
    view.draw(st, dt);
    report(view.cam.z, view.resting, pixel() ? PIXEL_STEPS.filter((s) => s >= zMin() - 1e-6) : []);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    set(next: Partial<Look>) {
      const was = look; look = { ...look, ...next };
      if (next.theme && next.theme !== was.theme) theme();
      view.setSkin(make());
    },
    zoom(dir: 1 | -1) { view.zoomAt(view.w / 2, view.h / 2, dir > 0 ? 1.25 : 0.8); },
  };
}

declare global { interface Window { FactoryPlayground: { mount: typeof mount } } }
