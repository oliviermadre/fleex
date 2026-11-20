/**
 * The decor of the pixel skins, painted pixel by pixel (`pixelArt.ts`) from what `decor.ts` generates: the yard round
 * a hall that follows what is built, the hall's walls, what hangs on the top wall (windows, the sign, a clock that
 * gives the time, a door, notice boards, extinguishers, vents) and the props on free tiles. DRAFT for the decor
 * mock-up (`docs/factory/decor.html`).
 *
 * By day the windows show the sky, at night the stars. Nothing here is kept: it is painted from the layout at each
 * frame, the parts of it the view shows.
 */
import { mix } from '../floorLook';
import { WALL_H, WALL_T, propsIn, seed, treesIn, wallThings, type DecorOptions, type Prop, type Rect } from '../decor';
export type { Prop };
import { ART, box, disc, fillWhere, seg } from './pixelArt';

/** What the painters need of the skin. */
export interface DecorPaint {
  ctx: CanvasRenderingContext2D;
  light: boolean;
  /** The floor's clock, in seconds; the clock on the wall reads the real time. */
  clock: number;
  /** Pixels of the screen to a tile. */
  z: number;
  /** The tiles the view shows. */
  view: Rect;
  /** Write words over the picture, as the skin writes its labels. */
  say: (text: string, wx: number, wy: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; mono?: boolean; min?: number; max?: number; dark?: boolean }) => void;
}

const INK = '#2b2833';
/** The hall by day and at night: its walls, their seams, their cap, the skirting, the pipe. */
const WALL = {
  day: { face: '#e4dac4', seam: '#d3c6ac', cap: '#9e9483', capLight: '#b9ae97', skirt: '#9e9483', pipe: '#8a8f99', pipeDark: '#5d6169', sill: '#b5a98e', grass: '#9cc46a', grassDark: '#86ad57', grassLight: '#b3d77f' },
  night: { face: '#3a3644', seam: '#302c3a', cap: '#14121a', capLight: '#24212c', skirt: '#24212c', pipe: '#55525f', pipeDark: '#2a2733', sill: '#2a2733', grass: '#26402a', grassDark: '#1d3322', grassLight: '#33553a' },
};
const WOOD = '#c8955a', PLANK = '#9c6b3a';

/** The yard outside a hall that follows what is built: grass with its tufts, and trees. */
export function yard(p: DecorPaint, hall: Rect, floor: Rect): void {
  const { ctx, view } = p, w = p.light ? WALL.day : WALL.night;
  const ox = hall.x - WALL_T, oy = hall.y - WALL_H, ow = hall.w + 2 * WALL_T, oh = hall.h + WALL_H + WALL_T, A = ART;
  ctx.fillStyle = w.grass;
  ctx.beginPath();
  ctx.rect(floor.x, floor.y, floor.w, oy - floor.y); ctx.rect(floor.x, oy + oh, floor.w, floor.y + floor.h - oy - oh);
  ctx.rect(floor.x, oy, ox - floor.x, oh); ctx.rect(ox + ow, oy, floor.x + floor.w - ox - ow, oh);
  ctx.fill();
  if (p.z < 10) return;
  const i0 = Math.floor(view.x), j0 = Math.floor(view.y), i1 = Math.ceil(view.x + view.w), j1 = Math.ceil(view.y + view.h);
  const outside = (i: number, j: number) => i < ox || i >= ox + ow || j < oy || j >= oy + oh;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    if (!outside(i, j)) continue;
    const r = seed(i, j, 7);
    if (r < 0.5) { const a = Math.floor(r * 26) % 12 + 2, b = Math.floor(seed(i, j, 8) * 12) + 2; box(ctx, i * A + a, j * A + b, 1, 2, w.grassDark); box(ctx, i * A + a + 1, j * A + b - 1, 1, 2, w.grassDark); }
    if (r > 0.85) box(ctx, i * A + Math.floor(seed(i, j, 9) * 13) + 1, j * A + Math.floor(r * 90) % 13 + 1, 2, 1, w.grassLight);
  }
  for (const t of treesIn(hall, floor, view)) tree(p, t.x, t.y);
}

function tree(p: DecorPaint, x: number, y: number): void {
  const { ctx } = p, X = x * ART, Y = y * ART, dark = p.light ? '#2f7d3b' : '#173a20', mid = p.light ? '#3f9e4b' : '#21502b', lite = p.light ? '#62c06a' : '#2e6a38';
  ctx.globalAlpha = 0.25; box(ctx, X + 5, Y + 27, 24, 4, '#000000', 2); ctx.globalAlpha = 1;
  box(ctx, X + 13, Y + 18, 6, 11, INK); box(ctx, X + 14, Y + 18, 4, 10, p.light ? '#7a5534' : '#4a3422');
  box(ctx, X + 2, Y + 4, 28, 17, INK, 5); box(ctx, X + 3, Y + 5, 26, 15, dark, 5);
  box(ctx, X + 6, Y + 1, 20, 9, INK, 3); box(ctx, X + 7, Y + 2, 18, 8, dark, 3);
  box(ctx, X + 6, Y + 4, 16, 10, mid, 3); box(ctx, X + 8, Y + 4, 6, 3, lite, 1); box(ctx, X + 18, Y + 8, 4, 2, lite);
}

/**
 * The hall's walls: the top one seen from the front, three tiles high, with its seams, a pipe along it and its
 * skirting; the sides and the bottom as the top of a wall, a tile thick. Then what hangs on the top one.
 */
export function walls(p: DecorPaint, hall: Rect, built: Rect | null, sign: string): void {
  const { ctx, view, light } = p, w = light ? WALL.day : WALL.night, A = ART;
  const x0 = hall.x - WALL_T, x1 = hall.x + hall.w + WALL_T, top = hall.y - WALL_H, bottom = hall.y + hall.h;
  /* the part of the top wall in view, on whole tiles */
  const vx0 = Math.max(x0, Math.floor(view.x) - 1), vx1 = Math.min(x1, Math.ceil(view.x + view.w) + 1), WY = top * A;
  if (vx1 > vx0 && view.y < hall.y && view.y + view.h > top) {
    box(ctx, vx0 * A, WY, (vx1 - vx0) * A, WALL_H * A, w.face);
    box(ctx, vx0 * A, WY, (vx1 - vx0) * A, 4, w.cap);
    box(ctx, vx0 * A, WY + 4, (vx1 - vx0) * A, 1, w.capLight);
    if (p.z >= 8) for (let x = vx0; x < vx1; x++) { box(ctx, x * A, WY + 5, 1, 38, w.seam); box(ctx, x * A, WY + 24, A, 1, w.seam); }
    /* a pipe along the wall, on brackets */
    box(ctx, vx0 * A, WY + 35, (vx1 - vx0) * A, 3, w.pipe); box(ctx, vx0 * A, WY + 38, (vx1 - vx0) * A, 1, w.pipeDark);
    if (p.z >= 8) for (let x = vx0 - (vx0 % 2); x < vx1; x += 2) box(ctx, x * A + 6, WY + 33, 3, 7, w.pipeDark);
    box(ctx, vx0 * A, WY + 43, (vx1 - vx0) * A, 4, w.skirt); box(ctx, vx0 * A, WY + 47, (vx1 - vx0) * A, 1, INK);
    /* the wall's shadow on the floor */
    ctx.globalAlpha = light ? 0.12 : 0.3; box(ctx, Math.max(vx0, hall.x) * A, hall.y * A, (Math.min(vx1, hall.x + hall.w) - Math.max(vx0, hall.x)) * A, 3, '#000000'); ctx.globalAlpha = 1;
    for (const t of wallThings(hall, built)) if (t.x + t.w >= vx0 && t.x <= vx1) fixture(p, t.kind, t.x, top, t.w, sign);
  }
  /* the sides and the bottom: the top of a wall, its inner edge lit */
  const side = (x: number, y: number, ww: number, hh: number, edge: 'l' | 'r' | 't') => {
    box(ctx, x * A, y * A, ww * A, hh * A, w.cap);
    if (edge === 'l') box(ctx, (x + ww) * A - 2, y * A, 2, hh * A, w.capLight); else if (edge === 'r') box(ctx, x * A, y * A, 2, hh * A, w.capLight); else box(ctx, x * A, y * A, ww * A, 2, w.capLight);
  };
  side(x0, top, WALL_T, WALL_H + hall.h + WALL_T, 'l');
  side(hall.x + hall.w, top, WALL_T, WALL_H + hall.h + WALL_T, 'r');
  side(hall.x, bottom, hall.w, WALL_T, 't');
}

function fixture(p: DecorPaint, kind: ReturnType<typeof wallThings>[number]['kind'], x: number, top: number, w: number, sign: string): void {
  const { ctx, light } = p, A = ART, X = x * A, WY = top * A;
  if (p.z < 8 && kind !== 'window' && kind !== 'door') return;
  if (kind === 'window') {
    const sky = light ? '#9fd8ec' : '#1f2a4d';
    box(ctx, X + 1, WY + 7, 30, 24, INK); box(ctx, X + 2, WY + 8, 28, 22, sky);
    if (light) { box(ctx, X + 5, WY + 11, 8, 2, '#e8f7fc'); box(ctx, X + 7, WY + 10, 4, 1, '#e8f7fc'); box(ctx, X + 20, WY + 20, 6, 2, '#e8f7fc'); box(ctx, X + 3, WY + 9, 1, 3, '#ffffff'); }
    /* at night, stars that twinkle a few times a minute */
    else for (let k = 0; k < 5; k++) { const sx = Math.floor(seed(x, k, 11) * 26) + 3, sy = Math.floor(seed(x, k, 12) * 19) + 9; if (seed(x, k + Math.floor(p.clock / 7), 13) > 0.25) box(ctx, X + sx, WY + sy, 1, 1, '#fff7c2'); }
    box(ctx, X + 15, WY + 8, 2, 22, INK); box(ctx, X + 2, WY + 18, 28, 1, INK);
    box(ctx, X, WY + 31, 32, 3, light ? WALL.day.sill : WALL.night.sill); box(ctx, X, WY + 34, 32, 1, INK);
  } else if (kind === 'door') {
    box(ctx, X, WY + 14, 32, 34, INK); box(ctx, X + 1, WY + 15, 30, 33, light ? '#8a6a4a' : '#4a3a2c');
    box(ctx, X + 15, WY + 15, 2, 33, INK); box(ctx, X + 4, WY + 18, 9, 10, light ? '#9fd8ec' : '#1f2a4d'); box(ctx, X + 19, WY + 18, 9, 10, light ? '#9fd8ec' : '#1f2a4d');
    box(ctx, X + 12, WY + 33, 2, 2, '#f2b01e'); box(ctx, X + 18, WY + 33, 2, 2, '#f2b01e');
    /* a hazard band on the floor in front of it */
    const fy = (top + WALL_H) * A;
    fillWhere(ctx, X, fy, X + 32, fy + 4, (cx, cy) => ((Math.floor(cx) + Math.floor(cy)) % 6 + 6) % 6 < 3, '#f2b01e');
    fillWhere(ctx, X, fy, X + 32, fy + 4, (cx, cy) => ((Math.floor(cx) + Math.floor(cy)) % 6 + 6) % 6 >= 3, INK);
  } else if (kind === 'sign') {
    box(ctx, X + 2, WY + 6, w * A - 4, 20, INK, 2); box(ctx, X + 3, WY + 7, w * A - 6, 18, light ? '#3a3742' : '#24212c', 1);
    box(ctx, X + 6, WY + 26, 2, 6, INK); box(ctx, X + w * A - 8, WY + 26, 2, 6, INK);
    p.say(sign, x + w / 2, top + 1, 0.5, '#f2b01e', { align: 'center', weight: 700, mono: true, min: 8, max: 32, dark: true });
  } else if (kind === 'clock') {
    const cx = X + 8, cy = WY + 16, now = new Date(), m = now.getMinutes() + now.getSeconds() / 60, h = (now.getHours() % 12) + m / 60;
    disc(ctx, cx, cy, 7.5, INK); disc(ctx, cx, cy, 6.5, '#fafafa');
    for (let k = 0; k < 4; k++) box(ctx, cx + [5, 0, -6, 0][k]!, cy + [0, 5, 0, -6][k]!, 1, 1, INK);
    const a = (t: number) => (t * Math.PI * 2) - Math.PI / 2;
    seg(ctx, cx, cy, cx + Math.cos(a(m / 60)) * 5.5, cy + Math.sin(a(m / 60)) * 5.5, 1.2, INK);
    seg(ctx, cx, cy, cx + Math.cos(a(h / 12)) * 3.5, cy + Math.sin(a(h / 12)) * 3.5, 1.6, '#d9433f');
  } else if (kind === 'board') {
    box(ctx, X + 2, WY + 7, 28, 19, INK); box(ctx, X + 3, WY + 8, 26, 17, WOOD);
    box(ctx, X + 6, WY + 10, 7, 9, '#fafafa'); box(ctx, X + 16, WY + 11, 9, 6, '#ffe680'); box(ctx, X + 15, WY + 19, 6, 4, '#bfe3ff');
    for (const [a, b] of [[9, 10], [20, 11], [17, 19]] as const) box(ctx, X + a, WY + b, 1, 1, '#d9433f');
    box(ctx, X + 7, WY + 12, 5, 1, '#9a93ab'); box(ctx, X + 7, WY + 14, 4, 1, '#9a93ab'); box(ctx, X + 7, WY + 16, 5, 1, '#9a93ab');
  } else if (kind === 'extinguisher') {
    box(ctx, X + 5, WY + 25, 6, 15, INK, 1); box(ctx, X + 6, WY + 26, 4, 13, '#d9433f'); box(ctx, X + 6, WY + 27, 1, 8, '#f07a74');
    box(ctx, X + 7, WY + 22, 3, 3, INK); box(ctx, X + 10, WY + 23, 2, 1, INK); box(ctx, X + 6, WY + 30, 4, 2, '#fafafa');
  } else if (kind === 'vent') {
    box(ctx, X + 2, WY + 8, 12, 11, INK); box(ctx, X + 3, WY + 9, 10, 9, light ? '#b9bcc4' : '#55525f');
    for (let k = 0; k < 4; k++) box(ctx, X + 3, WY + 10 + k * 2, 10, 1, light ? '#7d818a' : '#2a2733');
  }
}

/** The props on the free tiles in view. In build mode they fade, so that the tiles read as free. */
export function props(p: DecorPaint, layout: Parameters<typeof propsIn>[0], hall: Rect, density: DecorOptions['props'], faded: boolean): Prop[] {
  if (p.z < 10) return [];
  const list = propsIn(layout, hall, p.view, density);
  if (faded) p.ctx.globalAlpha = 0.35;
  for (const q of list) prop(p, q);
  p.ctx.globalAlpha = 1;
  return list;
}

/** One prop, drawn in its tile. */
export function prop(p: DecorPaint, q: Prop): void {
  const { ctx, light } = p, X = q.x * ART, Y = q.y * ART, a = ctx.globalAlpha;
  const shade = (c: string) => (light ? c : mix(c, '#000000', 0.3));
  ctx.globalAlpha = a * (light ? 0.18 : 0.4); box(ctx, X + 2, Y + 13, 12, 3, '#000000', 1); ctx.globalAlpha = a;
  if (q.kind === 'plant') {
    box(ctx, X + 4, Y + 9, 8, 6, INK, 1); box(ctx, X + 5, Y + 10, 6, 4, shade('#c8693a')); box(ctx, X + 5, Y + 10, 6, 1, shade('#e08a5a'));
    box(ctx, X + 2, Y + 2, 12, 8, shade('#2f7d3b'), 2); box(ctx, X + 5, Y, 6, 4, shade('#2f7d3b'), 1);
    box(ctx, X + 4, Y + 3, 3, 2, shade('#4fbf5f')); box(ctx, X + 9, Y + 1, 2, 2, shade('#4fbf5f')); box(ctx, X + 9, Y + 5, 3, 2, shade('#4fbf5f')); box(ctx, X + 7, Y + 7, 2, 1, shade('#62c06a'));
  } else if (q.kind === 'crates') {
    box(ctx, X + 2, Y + 6, 12, 9, INK); box(ctx, X + 3, Y + 7, 10, 7, shade(WOOD)); box(ctx, X + 3, Y + 10, 10, 1, shade(PLANK));
    box(ctx, X + 4, Y + 1, 8, 6, INK); box(ctx, X + 5, Y + 2, 6, 4, shade(WOOD)); box(ctx, X + 5, Y + 4, 6, 1, shade(PLANK));
  } else if (q.kind === 'barrel') {
    box(ctx, X + 4, Y + 2, 8, 13, INK, 1); box(ctx, X + 5, Y + 3, 6, 11, shade('#3a7bd5'));
    box(ctx, X + 5, Y + 3, 6, 1, shade('#7cb0f0')); box(ctx, X + 5, Y + 6, 6, 1, shade('#245ca8')); box(ctx, X + 5, Y + 11, 6, 1, shade('#245ca8')); box(ctx, X + 6, Y + 7, 1, 3, shade('#7cb0f0'));
  } else if (q.kind === 'pallet') {
    box(ctx, X + 1, Y + 11, 14, 4, INK); box(ctx, X + 2, Y + 11, 12, 1, shade(WOOD)); box(ctx, X + 2, Y + 13, 12, 1, shade(WOOD));
    box(ctx, X + 3, Y + 5, 10, 7, INK, 2); box(ctx, X + 4, Y + 6, 8, 5, shade('#d9c9a3'), 1); box(ctx, X + 5, Y + 7, 3, 1, shade('#efe2c0'));
  } else if (q.kind === 'cone') {
    box(ctx, X + 3, Y + 13, 10, 2, INK); box(ctx, X + 7, Y + 2, 2, 2, INK);
    box(ctx, X + 6, Y + 4, 4, 3, shade('#f08a3c')); box(ctx, X + 5, Y + 7, 6, 2, '#fafafa'); box(ctx, X + 5, Y + 9, 6, 4, shade('#f08a3c')); box(ctx, X + 6, Y + 4, 1, 3, shade('#ffb27a'));
  } else if (q.kind === 'cooler') {
    box(ctx, X + 4, Y + 6, 8, 9, INK, 1); box(ctx, X + 5, Y + 7, 6, 7, shade('#e8e8ee'));
    box(ctx, X + 5, Y, 6, 7, INK, 2); box(ctx, X + 6, Y + 1, 4, 5, shade('#7cc4f0')); box(ctx, X + 6, Y + 1, 1, 3, '#d8f0ff'); box(ctx, X + 7, Y + 9, 2, 1, shade('#3a7bd5'));
  } else if (q.kind === 'shelf') {
    box(ctx, X + 1, Y, 14, 15, INK); box(ctx, X + 2, Y + 1, 12, 13, shade('#8a6a4a'));
    box(ctx, X + 2, Y + 5, 12, 1, INK); box(ctx, X + 2, Y + 10, 12, 1, INK);
    box(ctx, X + 3, Y + 2, 3, 3, shade('#d9433f')); box(ctx, X + 7, Y + 3, 4, 2, shade('#f2b01e')); box(ctx, X + 4, Y + 7, 5, 3, shade(WOOD)); box(ctx, X + 10, Y + 6, 3, 4, shade('#3a7bd5')); box(ctx, X + 3, Y + 11, 9, 3, shade('#9a93ab'));
  }
  ctx.globalAlpha = a;
}
