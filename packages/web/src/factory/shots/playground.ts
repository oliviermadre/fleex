/**
 * The made-up floor of `fixture.ts`, live, for a mock-up to embed: the real renderer and the real skins, a view one
 * can move (drag with the right button, or on bare floor out of build mode), zoom (wheel, buttons), point at and click
 * (the view's own `pick`), and build on: in build mode, areas are drawn, selected, resized, moved, edited and removed
 * (`areas.ts`). Bundled into one script by `run.mjs playground`.
 *
 * The zoom is the view's own, as in the page: by steps for the pixel skins (see `FactoryView.wheel`), free for Fleex's.
 */
import { applyTheme, BUILT_IN_THEMES } from '../../lib/themes';
import { areaAt, areasOf, fits, freshArea, handleAt, moved, resize, spanOf, type Handle, type Overlap, type Rect } from '../areas';
import { FactoryView } from '../renderer';
import { FleexSkin } from '../skins/fleex';
import { NeonSkin } from '../skins/neon';
import { PIXEL_STEPS, PixelSkin } from '../skins/pixel';
import { PixelTqSkin, type TqOptions } from '../skins/pixelTq';
import type { AreaSpec, FactoryLayout, FactoryTicket, MachineSpec } from '../types';
import { floorState, layout as fixture, tickets } from './fixture';

export interface Look {
  skin: 'fleex' | 'neon' | 'pixel' | 'pixel-3d'; theme: string;
  /** Lot 6's mock-up: the pixel skin seen from three quarters, with its options. */
  view?: 'flat' | 'tq'; platforms?: boolean; raise?: boolean; hidden?: TqOptions['hidden']; buildFlat?: boolean;
  /** Build mode, and what a drag on the floor does there: select (and resize, move), draw an area, or show a belt's ghost. */
  build?: boolean; tool?: 'select' | 'area' | 'belt';
  /** Areas: whether two may overlap, and how one is moved (by its name, by any free point of it, or not at all). */
  overlap?: Overlap; move?: 'name' | 'inside' | 'none';
}
/** What the zoom is at: pixels per tile, and whether it is resting (on a step, for the pixel skins); and the name of what is pointed at. */
export type Report = (z: number, resting: boolean, steps: readonly number[], pointed: string | null) => void;

/**
 * The made-up floor, with a belt just behind a station of the row below (Debate) carrying two tickets: what a station
 * seen from three quarters hides.
 */
const behind: MachineSpec[] = [9, 10, 11, 12, 13].map((x) => ({ id: `hb${x}`, kind: 'belt', x, y: 7, w: 1, h: 1, dir: 2 }));
const riders: FactoryTicket[] = [['h1', 'hb12', 'fix'], ['h2', 'hb10', 'build']].map(([id, on, type], i) => ({ ...tickets[3]!, ticketId: id!, machineId: on!, p: 0.5, fx: -1, fy: 0, info: { ...tickets[3]!.info!, id: id!, displayId: 901 + i, type: type! } }));
/** Its two lines, as areas. */
const LINES: AreaSpec[] = [
  { id: 'area-build', kind: 'area', x: 4, y: 0, w: 17, h: 4, color: '#60a5fa', name: 'Build line', label: 'bl' },
  { id: 'area-rework', kind: 'area', x: 3, y: 8, w: 17, h: 4, color: '#f472b6', name: 'Rework line', label: 'bl' },
];

export function mount(cv: HTMLCanvasElement, report: Report, start: Look, onArea?: (a: AreaSpec | null) => void) {
  let look: Look = { tool: 'select', overlap: 'nest', move: 'name', ...start };
  let layout: FactoryLayout = { ...fixture, machines: [...fixture.machines, ...behind, ...(start.platforms === false ? [] : LINES)] };
  const make = () => (look.skin === 'fleex' ? new FleexSkin() : look.skin === 'neon' ? new NeonSkin() : look.skin === 'pixel-3d' || look.view === 'tq' ? new PixelTqSkin({ raise: look.raise, hidden: look.hidden, buildFlat: look.buildFlat }) : new PixelSkin());
  const theme = () => { const t = BUILT_IN_THEMES.find((x) => x.id === look.theme); if (t) applyTheme(t); };
  theme();
  const view = new FactoryView(cv, make()), st = floorState({ layout, tickets: [...tickets, ...riders], hoverMachine: null, selTicket: null, edit: !!look.build });
  view.resize(); view.cam = { x: 13, y: 9.5, z: 32 };
  const pixel = () => look.skin !== 'fleex' && look.skin !== 'neon';
  const zMin = () => { const F = view.floorOf(layout); return Math.max(3, view.w / F.w, view.h / F.h); };

  // ---------- the areas, kept in the layout as the page will ----------
  const areas = () => areasOf(layout.machines);
  const area = (id: string | null | undefined) => areas().find((a) => a.id === id) ?? null;
  const setLayout = (machines: MachineSpec[]) => { layout = { ...layout, machines }; st.layout = layout; };
  const tell = () => onArea?.(area(st.areaSel));
  const others = (id: string | null) => areas().filter((a) => a.id !== id);
  let seq = 0;

  /* the view zooms by itself, by steps for the pixel skins: the wheel goes to it */
  cv.addEventListener('wheel', (e) => { e.preventDefault(); view.wheel(e.offsetX, e.offsetY, e.deltaY, e.ctrlKey, e.deltaMode === 1); }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  /** What a drag does: move the view, draw an area, resize one by a handle, or move one. */
  type Drag = { kind: 'pan'; x: number; y: number; moved: boolean } | { kind: 'draw'; ax: number; ay: number } | { kind: 'resize'; id: string; h: Handle } | { kind: 'move'; id: string; ax: number; ay: number; from: Rect };
  let drag: Drag | null = null;
  const world = (e: PointerEvent) => view.toWorld(e.offsetX, e.offsetY);
  const reach = () => Math.max(0.2, 8 / view.cam.z);
  /** Where an area's name is written, as a box of the floor: what is grabbed to move it by its name. */
  const nameBox = (a: AreaSpec): Rect => {
    const at = a.label ?? 'bl', w = Math.min(a.w, Math.max(2, a.name.length * 0.3 + 0.5)), right = at === 'tr' || at === 'br';
    const y = at === 'tl' || at === 'tr' ? a.y : at === 'above' ? a.y - 0.7 : at === 'below' ? a.y + a.h : a.y + a.h - 0.75;
    return { x: right ? a.x + a.w - w : a.x, y, w, h: 0.75 };
  };
  const inBox = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  /** The area a press in build mode takes hold of, and how: by a handle of the selected one, or to move one. */
  const grab = (p: { x: number; y: number }): Drag | null => {
    const sel = area(st.areaSel);
    if (sel) { const h = handleAt(sel, p.x, p.y, reach()); if (h) return { kind: 'resize', id: sel.id, h }; }
    if (look.move === 'none') return null;
    const target = look.move === 'name' ? [...areas()].reverse().find((a) => inBox(nameBox(a), p)) : !view.at(Math.floor(p.x), Math.floor(p.y)) ? areaAt(areas(), p.x, p.y) : null;
    return target ? { kind: 'move', id: target.id, ax: p.x, ay: p.y, from: target } : null;
  };
  const cursorFor = (p: { x: number; y: number }): string => {
    if (!st.edit) return 'grab';
    if (look.tool === 'area') return 'crosshair';
    const g = grab(p);
    if (g?.kind === 'resize') return ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' } as const)[g.h];
    return g?.kind === 'move' ? 'move' : 'default';
  };

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = world(e);
    if (!st.edit || e.button === 2) { drag = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false }; return; }
    if (look.tool === 'area') { drag = { kind: 'draw', ax: p.x, ay: p.y }; const r = spanOf(p.x, p.y, p.x, p.y); st.areaGhost = { ...r, ok: fits(r, areas(), look.overlap!) }; return; }
    drag = grab(p) ?? { kind: 'pan', x: e.clientX, y: e.clientY, moved: false };
    if (drag.kind === 'move' || drag.kind === 'resize') { st.areaSel = drag.id; st.selMachine = null; tell(); }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = world(e);
    if (!drag) {
      const hit = view.pick(e.offsetX, e.offsetY, st, false);
      st.hoverMachine = hit && 'machineId' in hit ? hit.machineId : null;
      if (st.edit && look.tool === 'belt') { const x = Math.floor(p.x), y = Math.floor(p.y); st.ghost = { cells: [{ x, y, w: 1, h: 1, dir: 0 }], ok: !view.at(x, y), text: view.at(x, y) ? 'Taken' : 'Place a belt' }; }
      cv.style.cursor = cursorFor(p);
      return;
    }
    if (drag.kind === 'pan') {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
      if (drag.moved) { view.cam.x -= (e.clientX - drag.x) / view.cam.z; view.cam.y -= (e.clientY - drag.y) / view.cam.z; drag.x = e.clientX; drag.y = e.clientY; }
      return;
    }
    const r = drag.kind === 'draw' ? spanOf(drag.ax, drag.ay, p.x, p.y) : drag.kind === 'resize' ? resize(area(drag.id)!, drag.h, p.x, p.y) : moved(drag.from, p.x - drag.ax, p.y - drag.ay);
    st.areaGhost = { ...r, ok: fits(r, others(drag.kind === 'draw' ? null : drag.id), look.overlap!) };
  });
  cv.addEventListener('pointerup', (e) => {
    const d = drag, g = st.areaGhost; drag = null; st.areaGhost = null;
    if (!d) return;
    if (d.kind === 'pan') {
      if (d.moved) return;
      /* a click: out of build mode an area answers nothing; in build mode a machine first, then the area under it */
      const hit = view.pick(e.offsetX, e.offsetY, st, false), p = world(e);
      st.selMachine = hit && 'machineId' in hit ? hit.machineId : null;
      st.areaSel = st.edit && !st.selMachine ? areaAt(areas(), p.x, p.y)?.id ?? null : null;
      tell();
      return;
    }
    if (!g?.ok) return;
    const r = { x: g.x, y: g.y, w: g.w, h: g.h };
    if (d.kind === 'draw') { const a = freshArea(areas(), r, `area-new-${++seq}`); setLayout([...layout.machines, a]); st.areaSel = a.id; }
    else setLayout(layout.machines.map((m) => (m.id === d.id ? { ...m, ...r } : m)));
    tell();
  });
  cv.addEventListener('pointerleave', () => { st.hoverMachine = null; st.ghost = null; });
  window.addEventListener('keydown', (e) => {
    if (!st.edit || !st.areaSel || (e.key !== 'Delete' && e.key !== 'Backspace') || (e.target as HTMLElement | null)?.closest?.('input,select,textarea')) return;
    setLayout(layout.machines.filter((m) => m.id !== st.areaSel)); st.areaSel = null; tell();
  });

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
      st.edit = !!look.build; st.ghost = null; st.areaGhost = null;
      if (!st.edit) { st.areaSel = null; tell(); }
      if (next.skin !== undefined || next.view !== undefined || next.raise !== undefined || next.hidden !== undefined || next.buildFlat !== undefined || next.theme !== undefined) view.setSkin(make());
    },
    zoom(dir: 1 | -1) { view.zoomAt(view.w / 2, view.h / 2, dir > 0 ? 1.25 : 0.8); },
    hover(id: string | null) { st.hoverMachine = id; },
    select(id: string | null) { st.selMachine = id; },
    /** Change the selected area (its name, colour, where its name is), or remove it. */
    patchArea(patch: Partial<Pick<AreaSpec, 'name' | 'color' | 'label'>>) { const id = st.areaSel; if (!id) return; setLayout(layout.machines.map((m) => (m.id === id && m.kind === 'area' ? { ...m, ...patch } : m))); tell(); },
    removeArea() { const id = st.areaSel; if (!id) return; setLayout(layout.machines.filter((m) => m.id !== id)); st.areaSel = null; tell(); },
    /** The areas as they stand, and the floor's camera: for checks. */
    areas,
    camera: () => ({ ...view.cam, w: view.w, h: view.h }),
  };
}

declare global { interface Window { FactoryPlayground: { mount: typeof mount } } }
