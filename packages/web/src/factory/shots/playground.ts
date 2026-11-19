/**
 * The made-up floor of `fixture.ts`, live, for a mock-up to embed: the real renderer and the real skins, a view one
 * can move (drag) and zoom (wheel, buttons). Bundled into one script by `run.mjs playground`.
 *
 * The zoom of the pixel skin is what it was made to show: it glides, and it only ever rests on a step of
 * `PIXEL_STEPS`. A notch of the wheel sends it to the next step that way; the view eases there and stops exactly on
 * it. Fleex's own skin zooms freely, as the page does today.
 */
import { applyTheme, BUILT_IN_THEMES } from '../../lib/themes';
import { FactoryView } from '../renderer';
import { FleexSkin } from '../skins/fleex';
import { PIXEL_STEPS, PixelSkin, type PixelOptions } from '../skins/pixel';
import { floorState, layout } from './fixture';

export interface Look { skin: 'fleex' | 'pixel'; theme: string; dark: NonNullable<PixelOptions['dark']>; words: NonNullable<PixelOptions['words']> }
/** What the zoom is at: pixels per tile, and whether it is resting (on a step, for the pixel skin). */
export type Report = (z: number, resting: boolean, steps: readonly number[]) => void;

export function mount(cv: HTMLCanvasElement, report: Report, start: Look) {
  let look = { ...start };
  const make = () => (look.skin === 'pixel' ? new PixelSkin({ dark: look.dark, words: look.words }) : new FleexSkin());
  const theme = () => { const t = BUILT_IN_THEMES.find((x) => x.id === look.theme); if (t) applyTheme(t); };
  theme();
  const view = new FactoryView(cv, make()), st = floorState({ hoverMachine: null });
  view.resize(); view.cam = { x: 13, y: 9.5, z: 32 };
  /* where the zoom is going, and round which point of the canvas */
  let target: number | null = null, anchor = { x: 0, y: 0 }, acc = 0;
  const pixel = () => look.skin === 'pixel';
  const zMin = () => { const F = view.floorOf(layout); return Math.max(3, view.w / F.w, view.h / F.h); };
  const steps = () => PIXEL_STEPS.filter((s) => s >= zMin() - 1e-6);
  const centre = () => ({ x: view.w / 2, y: view.h / 2 });
  /** The next step that way from where the zoom is going; none past the last. */
  const step = (dir: 1 | -1, at = centre()) => {
    const from = target ?? view.cam.z, all = steps();
    const next = dir > 0 ? all.find((s) => s > from + 1e-3) : [...all].reverse().find((s) => s < from - 1e-3);
    if (next != null) { target = next; anchor = at; }
  };
  /** To the nearest step, when the view is not on one (another skin chosen, the window resized). */
  const settle = () => { if (!pixel() || target != null) return; const all = steps(), z = view.cam.z; if (all.includes(z)) return; target = all.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a), all[0] ?? z); anchor = centre(); };

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const at = { x: e.offsetX, y: e.offsetY };
    if (!pixel()) { view.zoomAt(at.x, at.y, Math.exp(-e.deltaY * 0.0015)); return; }
    acc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    if (Math.abs(acc) >= 40) { step(acc < 0 ? 1 : -1, at); acc = 0; }
  }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; view.cam.x -= (e.clientX - drag.x) / view.cam.z; view.cam.y -= (e.clientY - drag.y) / view.cam.z; drag = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', () => { drag = null; });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    view.resize(); settle();
    if (target != null) {
      /* it glides: fast at first, slower as it comes, and lands exactly on the step */
      const z = view.cam.z, next = Math.abs(target - z) < 0.05 ? target : z + (target - z) * (1 - Math.exp(-dt * 14));
      view.zoomAt(anchor.x, anchor.y, next / z);
      if (next === target || view.cam.z !== next) { view.cam.z = Math.max(view.cam.z, target); target = null; }
    }
    view.draw(st, dt);
    report(view.cam.z, target == null, pixel() ? steps() : []);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    set(next: Partial<Look>) {
      const was = look; look = { ...look, ...next };
      if (next.theme && next.theme !== was.theme) theme();
      view.setSkin(make());
    },
    zoom(dir: 1 | -1) { if (pixel()) step(dir); else view.zoomAt(view.w / 2, view.h / 2, dir > 0 ? 1.25 : 0.8); },
  };
}

declare global { interface Window { FactoryPlayground: { mount: typeof mount } } }
