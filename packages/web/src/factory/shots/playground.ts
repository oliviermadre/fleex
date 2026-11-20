/**
 * The made-up floor of `fixture.ts`, live, for a mock-up to embed: the real renderer and the real skins, a view one
 * can move (drag with the right button, or on bare floor out of build mode), zoom (wheel, buttons), point at and click
 * (the view's own `pick`), and build on: in build mode, areas are drawn, selected, resized, moved, edited and removed
 * (`areas.ts`). Bundled into one script by `run.mjs playground`.
 *
 * The zoom is the view's own, as in the page: by steps for the pixel skins (see `FactoryView.wheel`), free for Fleex's.
 */
import { applyTheme, BUILT_IN_THEMES } from '../../lib/themes';
import { areaAt, areasOf, fits, freshArea, handleAt, moved, nameBox, resize, spanOf, type Handle, type Overlap, type Rect } from '../areas';
import { FactoryView, type ViewState } from '../renderer';
import { FleexSkin } from '../skins/fleex';
import { NeonSkin } from '../skins/neon';
import { PIXEL_LOOK, PIXEL_STEPS, PixelSkin, type PixelLook } from '../skins/pixel';
import type { DecorOptions } from '../decor';
import type { PeopleOptions } from '../people';
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
  /** Lot 7's mock-up: the decor, and its options. */
  decor?: DecorOptions | null;
  /** Lot 9's mock-up: the people, and their options. */
  people?: PeopleOptions | null;
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
  const skinOf = () => (look.skin === 'fleex' ? new FleexSkin() : look.skin === 'neon' ? new NeonSkin() : look.skin === 'pixel-3d' || look.view === 'tq' ? new PixelTqSkin({ raise: look.raise, hidden: look.hidden, buildFlat: look.buildFlat }, PIXEL_LOOK) : new PixelSkin(PIXEL_LOOK));
  const make = () => skinOf().setDecor(look.decor ?? null).setPeople(look.people ?? null);
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
      if (next.skin !== undefined || next.view !== undefined || next.raise !== undefined || next.hidden !== undefined || next.buildFlat !== undefined || next.theme !== undefined || next.decor !== undefined || next.people !== undefined) view.setSkin(make());
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
    /** Look at a place of the floor, from a zoom: for checks and for a mock-up's buttons. */
    goto(at: { x?: number; y?: number; z?: number }) { if (at.x != null) view.cam.x = at.x; if (at.y != null) view.cam.y = at.y; if (at.z) view.cam.z = at.z; },
  };
}

/**
 * Several views of the same floor, side by side, each painted by its own skin, all looking at the same place from the
 * same zoom: to compare how they read. Each view is still (no drag, no wheel): the page moves them all together.
 */
export function compare(cvs: HTMLCanvasElement[], skins: { skin: 'pixel' | 'pixel-3d'; look: PixelLook }[], start: { theme: string; x: number; y: number; z: number }) {
  const theme = (id: string) => { const t = BUILT_IN_THEMES.find((x) => x.id === id); if (t) applyTheme(t); };
  theme(start.theme);
  const layout: FactoryLayout = { ...fixture, machines: [...fixture.machines, ...behind] };
  const st = floorState({ layout, tickets: [...tickets, ...riders], hoverMachine: null, selTicket: null, named: null, found: null });
  const make = (i: number) => (skins[i]!.skin === 'pixel-3d' ? new PixelTqSkin({}, skins[i]!.look) : new PixelSkin(skins[i]!.look));
  const views = cvs.map((cv, i) => { const v = new FactoryView(cv, make(i)); v.resize(); v.cam = { x: start.x, y: start.y, z: start.z }; return v; });
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const v of views) { v.resize(); v.draw(st, dt); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    look(at: { x?: number; y?: number; z?: number }) { for (const v of views) { if (at.z) v.cam.z = at.z; if (at.x != null) v.cam.x = at.x; if (at.y != null) v.cam.y = at.y; } },
    theme(id: string) { theme(id); views.forEach((v, i) => v.setSkin(make(i))); },
    skins(next: typeof skins) { skins = next; views.forEach((v, i) => v.setSkin(make(i))); },
  };
}

/**
 * Every type of ticket on belts, as a skin draws it: build, fix, review, ops, lead, think, and one with no type; on the
 * rows below, the same left out by a filter. One view per zoom, each exactly as wide as the floor it shows, so its
 * pixels are those of the page.
 */
export const TYPES = ['build', 'fix', 'review', 'ops', 'lead', 'think', ''] as const;
export function types(cvs: HTMLCanvasElement[], zooms: number[], start: { theme: string; skin: 'pixel' | 'fleex' | 'today' }) {
  const theme = (id: string) => { const t = BUILT_IN_THEMES.find((x) => x.id === id); if (t) applyTheme(t); };
  theme(start.theme);
  /* two rows of belts into an exit; a ticket every other tile */
  const spot = (i: number, dimmed: boolean) => ({ x: 1 + (i % 4) * 2, y: Math.floor(i / 4) * 2 + (dimmed ? 4 : 0) });
  const machines: MachineSpec[] = [{ id: 'out', kind: 'exit', x: 9, y: 0, w: 2, h: 8, name: 'Exit' }];
  for (const y of [0, 2, 4, 6]) for (let x = 0; x < 9; x++) machines.push({ id: `b${x}-${y}`, kind: 'belt', x, y, w: 1, h: 1, dir: 0 });
  const tks: FactoryTicket[] = [];
  TYPES.forEach((type, i) => { for (const dimmed of [false, true]) { const at = spot(i, dimmed); tks.push({ ...tickets[3]!, ticketId: `ty-${i}-${dimmed}`, machineId: `b${at.x}-${at.y}`, p: 0.5, fx: 1, fy: 0, info: { ...tickets[3]!.info!, id: `ty-${i}`, displayId: 700 + i, type, favorite: false, priority: 'medium' } }); } });
  const layout: FactoryLayout = { version: 2, w: 0, h: 0, machines };
  const st = floorState({ layout, tickets: tks, arms: new Map(), hoverMachine: null, selTicket: null, named: null, found: null, exits: null, dim: new Set(tks.filter((t) => t.ticketId.endsWith('true')).map((t) => t.ticketId)) });
  let skin = start.skin;
  const make = () => (skin === 'fleex' ? new FleexSkin() : new PixelSkin(skin === 'today' ? {} : { sprites: true }));
  const views = cvs.map((cv, i) => {
    const z = zooms[i]!;
    cv.style.width = `${Math.round(11 * z)}px`; cv.style.height = `${Math.round(8 * z)}px`;
    const v = new FactoryView(cv, make()); v.resize(); v.cam = { x: 5.5, y: 4, z }; return v;
  });
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    views.forEach((v, i) => { v.resize(); v.cam.z = zooms[i]!; v.cam.x = 5.5; v.cam.y = 4; v.draw(st, dt); });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    theme(id: string) { theme(id); views.forEach((v) => v.setSkin(make())); },
    skin(next: typeof skin) { skin = next; views.forEach((v) => v.setSkin(make())); },
  };
}

/**
 * Every part of the floor, one card each, as Fleex draws it and as the pixel skin does, side by side at the same zoom:
 * the sheet the pixel art is checked on, part by part. Each card is a still view of a spot of the made-up floor,
 * exactly as large as the spot, so its pixels are those of the page.
 */
export interface Spot { x: number; y: number; w: number; h: number }
export function sheet(pairs: { fleex: HTMLCanvasElement; pixel: HTMLCanvasElement; spot: Spot }[], start: { theme: string; z: number; look?: PixelLook; skin?: 'pixel' | 'pixel-3d' }) {
  const theme = (id: string) => { const t = BUILT_IN_THEMES.find((x) => x.id === id); if (t) applyTheme(t); };
  theme(start.theme);
  const layout: FactoryLayout = { ...fixture, machines: [...fixture.machines, ...LINES] };
  const st = floorState({ layout, hoverMachine: null, selTicket: null, named: null, found: null });
  let z = start.z, look: PixelLook = start.look ?? { sprites: true }, skin = start.skin ?? 'pixel';
  const pixelSkin = () => (skin === 'pixel-3d' ? new PixelTqSkin({}, look) : new PixelSkin(look));
  const views = pairs.flatMap(({ fleex, pixel, spot }) => [fleex, pixel].map((cv, i) => ({ cv, spot, pixel: i === 1, v: new FactoryView(cv, i ? pixelSkin() : new FleexSkin()) })));
  const size = () => { for (const { cv, spot } of views) { cv.style.width = `${Math.round(spot.w * z)}px`; cv.style.height = `${Math.round(spot.h * z)}px`; } };
  size();
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const { v, spot } of views) { v.resize(); v.cam = { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2, z }; v.draw(st, dt); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    theme(id: string) { theme(id); for (const x of views) x.v.setSkin(x.pixel ? pixelSkin() : new FleexSkin()); },
    zoom(next: number) { z = next; size(); },
    look(next: PixelLook) { look = next; for (const x of views) if (x.pixel) x.v.setSkin(pixelSkin()); },
    skin(next: 'pixel' | 'pixel-3d') { skin = next; for (const x of views) if (x.pixel) x.v.setSkin(pixelSkin()); },
    /** Change what the view is shown (build mode, what is selected or pointed at, a lens): for checks. */
    state(patch: Partial<ViewState>) { Object.assign(st, patch); },
  };
}

declare global { interface Window { FactoryPlayground: { mount: typeof mount; compare: typeof compare; types: typeof types; sheet: typeof sheet } } }
