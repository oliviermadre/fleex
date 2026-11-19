/**
 * The made-up floor of `fixture.ts`, live, for a mock-up to embed: the real renderer and the real skins, a view one
 * can move (drag), zoom (wheel, buttons), point at and click (the view's own `pick`), and put in build mode (a ghost
 * follows the pointer). Bundled into one script by `run.mjs playground`.
 *
 * The zoom is the view's own, as in the page: by steps for the pixel skin (see `FactoryView.wheel`), free for Fleex's.
 */
import { applyTheme, BUILT_IN_THEMES } from '../../lib/themes';
import { FactoryView } from '../renderer';
import { FleexSkin } from '../skins/fleex';
import { PIXEL_STEPS, PixelSkin } from '../skins/pixel';
import { PixelTqSkin, type Platform, type TqOptions } from '../skins/pixelTq';
import type { FactoryTicket, MachineSpec } from '../types';
import { floorState, layout as fixture, tickets } from './fixture';

export interface Look {
  skin: 'fleex' | 'pixel'; theme: string;
  /** The pixel skin flat, or seen from three quarters (lot 6), with its options. */
  view?: 'flat' | 'tq'; platforms?: boolean; raise?: boolean; hidden?: TqOptions['hidden']; buildFlat?: boolean;
  /** Build mode. */
  build?: boolean;
}
/** What the zoom is at: pixels per tile, and whether it is resting (on a step, for the pixel skin); and the name of what is pointed at. */
export type Report = (z: number, resting: boolean, steps: readonly number[], pointed: string | null) => void;

/**
 * The made-up floor, with a belt just behind a station of the row below (Debate) carrying two tickets: what a station
 * seen from three quarters hides.
 */
const behind: MachineSpec[] = [9, 10, 11, 12, 13].map((x) => ({ id: `hb${x}`, kind: 'belt', x, y: 7, w: 1, h: 1, dir: 2 }));
const riders: FactoryTicket[] = [['h1', 'hb12', 'fix'], ['h2', 'hb10', 'build']].map(([id, on, type], i) => ({ ...tickets[3]!, ticketId: id!, machineId: on!, p: 0.5, fx: -1, fy: 0, info: { ...tickets[3]!.info!, id: id!, displayId: 901 + i, type: type! } }));
const layout = { ...fixture, machines: [...fixture.machines, ...behind] };

/** The two lines of the made-up floor, as platforms. */
const LINES: Platform[] = [
  { x: 4, y: 0, w: 17, h: 4, color: '#3d6fd1', name: 'Build line' },
  { x: 3, y: 8, w: 17, h: 4, color: '#d6407e', name: 'Rework line' },
];

export function mount(cv: HTMLCanvasElement, report: Report, start: Look) {
  let look = { ...start };
  const make = () => (look.skin !== 'pixel' ? new FleexSkin() : look.view === 'tq' ? new PixelTqSkin({ platforms: look.platforms ? LINES : [], raise: look.raise, hidden: look.hidden, buildFlat: look.buildFlat }) : new PixelSkin());
  const theme = () => { const t = BUILT_IN_THEMES.find((x) => x.id === look.theme); if (t) applyTheme(t); };
  theme();
  const view = new FactoryView(cv, make()), st = floorState({ layout, tickets: [...tickets, ...riders], hoverMachine: null, selTicket: null, edit: !!look.build });
  view.resize(); view.cam = { x: 13, y: 9.5, z: 32 };
  const pixel = () => look.skin === 'pixel';
  const zMin = () => { const F = view.floorOf(layout); return Math.max(3, view.w / F.w, view.h / F.h); };
  /* the view zooms by itself, by steps for the pixel skin: the wheel goes to it */
  cv.addEventListener('wheel', (e) => { e.preventDefault(); view.wheel(e.offsetX, e.offsetY, e.deltaY, e.ctrlKey, e.deltaMode === 1); }, { passive: false });
  /* a drag moves the view; a click selects what is seen there; pointing names it, and in build mode a ghost follows */
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const point = (e: PointerEvent) => {
    const hit = view.pick(e.offsetX, e.offsetY, st, false);
    st.hoverMachine = hit && 'machineId' in hit ? hit.machineId : null;
    if (st.edit) { const p = view.toWorld(e.offsetX, e.offsetY), x = Math.floor(p.x), y = Math.floor(p.y); st.ghost = { cells: [{ x, y, w: 1, h: 1, dir: 0 }], ok: !view.at(x, y), text: view.at(x, y) ? 'Taken' : 'Place a belt' }; }
  };
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) { point(e); return; }
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
    if (drag.moved) { view.cam.x -= (e.clientX - drag.x) / view.cam.z; view.cam.y -= (e.clientY - drag.y) / view.cam.z; drag = { x: e.clientX, y: e.clientY, moved: true }; }
  });
  cv.addEventListener('pointerup', (e) => { if (drag && !drag.moved) { const hit = view.pick(e.offsetX, e.offsetY, st, false); st.selMachine = hit && 'machineId' in hit ? hit.machineId : null; } drag = null; });
  cv.addEventListener('pointerleave', () => { st.hoverMachine = null; st.ghost = null; });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    view.resize();
    view.draw(st, dt);
    const pointed = view.machine(st.hoverMachine);
    report(view.cam.z, view.resting, pixel() ? PIXEL_STEPS.filter((s) => s >= zMin() - 1e-6) : [], pointed ? pointed.name || pointed.kind : null);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    set(next: Partial<Look>) {
      const was = look; look = { ...look, ...next };
      if (next.theme && next.theme !== was.theme) theme();
      st.edit = !!look.build; if (!st.edit) st.ghost = null;
      view.setSkin(make());
    },
    zoom(dir: 1 | -1) { view.zoomAt(view.w / 2, view.h / 2, dir > 0 ? 1.25 : 0.8); },
    /** Point at or select a machine, as the pointer would. */
    hover(id: string | null) { st.hoverMachine = id; },
    select(id: string | null) { st.selMachine = id; },
  };
}

declare global { interface Window { FactoryPlayground: { mount: typeof mount } } }
