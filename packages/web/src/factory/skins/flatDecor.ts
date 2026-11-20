/**
 * The decor of Fleex's skin and of the neon one, from the same generation as the pixel skins' (`decor.ts`): the same
 * hall, its walls, what is on the top wall, the props on the free tiles, the yard. Asked for on
 * `docs/factory/decor.html`: off by default for these two skins (`skins/index.ts`).
 *
 * Fleex's is an architect's plan: walls as a solid band, windows as a double line in it, a door as a gap with the arc
 * its leaves sweep, props as the symbols a plan gives furniture, the yard hatched. The neon one is the same plan in
 * lit tubes: walls as two lines of light, a neon sign, props as outlines in bright colours, the yard a grid at night
 * (the skin's glow does the rest).
 */
import { mix } from '../floorLook';
import { propsIn, seed, treesIn, wallThings, type DecorOptions, type Prop, type Rect } from '../decor';
import { rr, type Palette } from './fleex';

export type DecorStyle = 'fleex' | 'neon';
export interface FlatDecorPaint {
  ctx: CanvasRenderingContext2D; pal: Palette; style: DecorStyle; z: number; view: Rect; clock: number;
  /** The time the clock on the wall gives. */
  time: Date;
  say: (text: string, wx: number, wy: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; mono?: boolean; min?: number; max?: number; dark?: boolean; spacing?: number }) => void;
}

/** How thick a wall is drawn, in tiles, against the hall's edge. */
const WT = 0.45;
/** The tubes of the neon decor. */
const TUBE = { wall: '#4fd1ff', window: '#a78bfa', door: '#ff4f9a', sign: '#ff4f9a', yard: 'rgba(255, 79, 154, 0.22)', tree: '#39ff9c' };
const NEON_PROPS: Record<Prop['kind'], string> = { plant: '#39ff9c', crates: '#ffd23f', barrel: '#4fd1ff', pallet: '#a78bfa', cone: '#ff9f43', cooler: '#4fd1ff', shelf: '#ff4f9a' };

/** The ground outside the walls, hatched (a plan) or ruled in light (neon), with its trees. */
export function flatYard(p: FlatDecorPaint, hall: Rect, floor: Rect): void {
  const { ctx, pal, view } = p, neon = p.style === 'neon';
  const ox = hall.x - WT, oy = hall.y - WT, ow = hall.w + 2 * WT, oh = hall.h + 2 * WT;
  const yard = () => {
    ctx.beginPath();
    ctx.rect(floor.x, floor.y, floor.w, oy - floor.y); ctx.rect(floor.x, oy + oh, floor.w, floor.y + floor.h - oy - oh);
    ctx.rect(floor.x, oy, ox - floor.x, oh); ctx.rect(ox + ow, oy, floor.x + floor.w - ox - ow, oh);
  };
  yard(); ctx.fillStyle = neon ? '#06050d' : mix(pal.floor, pal.light ? '#000000' : '#ffffff', pal.light ? 0.035 : 0.025); ctx.fill();
  ctx.save(); yard(); ctx.clip();
  const x0 = Math.floor(view.x) - 1, x1 = Math.ceil(view.x + view.w) + 1, y0 = Math.floor(view.y) - 1, y1 = Math.ceil(view.y + view.h) + 1;
  ctx.beginPath();
  if (neon) {
    for (let x = x0 - (x0 % 2); x <= x1; x += 2) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0 - (y0 % 2); y <= y1; y += 2) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.strokeStyle = TUBE.yard; ctx.lineWidth = 0.03;
  } else {
    /* hatching, as a plan marks what is outside */
    for (let k = x0 - (y1 - y0); k <= x1; k += 0.5) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
    ctx.strokeStyle = mix(pal.grid, pal.floor, 0.2); ctx.lineWidth = 0.02;
  }
  ctx.stroke();
  ctx.restore();
  if (p.z < 6) return;
  for (const t of treesIn(hall, floor, view)) {
    const cx = t.x + 1, cy = t.y + 1;
    ctx.beginPath(); ctx.arc(cx, cy, 0.92, 0, 6.3);
    if (neon) { ctx.strokeStyle = TUBE.tree; ctx.lineWidth = 0.05; ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 0.12, 0, 6.3); ctx.fillStyle = TUBE.tree; ctx.fill(); continue; }
    ctx.fillStyle = mix(pal.ok, pal.floor, pal.light ? 0.78 : 0.82); ctx.fill(); ctx.strokeStyle = mix(pal.ok, pal.floor, 0.45); ctx.lineWidth = 0.035; ctx.stroke();
    /* the crown in lobes, as a plan draws a tree */
    ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + seed(t.x, t.y, 20); ctx.moveTo(cx + Math.cos(a) * 0.62 + 0.28, cy + Math.sin(a) * 0.62); ctx.arc(cx + Math.cos(a) * 0.62, cy + Math.sin(a) * 0.62, 0.28, 0, 6.3); }
    ctx.lineWidth = 0.02; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 0.07, 0, 6.3); ctx.fillStyle = mix(pal.ok, pal.floor, 0.4); ctx.fill();
  }
}

/** The walls round the hall, and what is on them: windows, a door, the sign over what is built, a clock. */
export function flatWalls(p: FlatDecorPaint, hall: Rect, built: Rect | null, sign: string): void {
  const { ctx, pal } = p, neon = p.style === 'neon';
  const ox = hall.x - WT, oy = hall.y - WT, ow = hall.w + 2 * WT, oh = hall.h + 2 * WT;
  const wall = neon ? '#0b0a16' : pal.light ? mix(pal.text, pal.floor, 0.3) : mix(pal.text3, pal.floor, 0.35);
  ctx.fillStyle = wall;
  ctx.beginPath(); ctx.rect(ox, oy, ow, WT); ctx.rect(ox, hall.y + hall.h, ow, WT); ctx.rect(ox, hall.y, WT, hall.h); ctx.rect(hall.x + hall.w, hall.y, WT, hall.h); ctx.fill();
  if (neon) {
    ctx.strokeStyle = TUBE.wall; ctx.lineWidth = 0.05;
    ctx.strokeRect(ox + 0.03, oy + 0.03, ow - 0.06, oh - 0.06); ctx.strokeRect(hall.x - 0.03, hall.y - 0.03, hall.w + 0.06, hall.h + 0.06);
  }
  const things = wallThings(hall, built);
  /* windows: in the top wall where they hang, in the bottom one every six tiles */
  const windows = [...things.filter((t) => t.kind === 'window').map((t) => ({ x: t.x, y: oy })), ...things.filter((t) => t.kind === 'window').map((t) => ({ x: t.x, y: hall.y + hall.h }))];
  for (const w of windows) {
    ctx.fillStyle = neon ? '#0b0a16' : mix('#7dd3fc', pal.floor, pal.light ? 0.45 : 0.7); ctx.fillRect(w.x + 0.1, w.y, 1.8, WT);
    ctx.strokeStyle = neon ? TUBE.window : pal.light ? mix(pal.text, pal.floor, 0.4) : pal.text3; ctx.lineWidth = neon ? 0.04 : 0.025;
    ctx.beginPath(); ctx.moveTo(w.x + 0.1, w.y + WT * 0.35); ctx.lineTo(w.x + 1.9, w.y + WT * 0.35); ctx.moveTo(w.x + 0.1, w.y + WT * 0.65); ctx.lineTo(w.x + 1.9, w.y + WT * 0.65); ctx.stroke();
  }
  if (p.z < 6) return;
  for (const t of things) {
    if (t.kind === 'door') {
      /* a gap in the wall, and the arcs its two leaves sweep into the hall */
      ctx.fillStyle = neon ? '#0b0a16' : pal.floor; ctx.fillRect(t.x, oy - 0.01, 2, WT + 0.02);
      ctx.strokeStyle = neon ? TUBE.door : pal.light ? mix(pal.text, pal.floor, 0.45) : pal.text3; ctx.lineWidth = neon ? 0.045 : 0.025;
      ctx.beginPath();
      ctx.moveTo(t.x, hall.y); ctx.lineTo(t.x, hall.y + 1); ctx.moveTo(t.x + 1, hall.y); ctx.arc(t.x, hall.y, 1, 0, Math.PI / 2);
      ctx.moveTo(t.x + 2, hall.y); ctx.lineTo(t.x + 2, hall.y + 1); ctx.moveTo(t.x + 1, hall.y); ctx.arc(t.x + 2, hall.y, 1, Math.PI, Math.PI / 2, true);
      ctx.stroke();
    } else if (t.kind === 'sign') {
      const x = t.x + 0.2, y = oy - 1.25, w = t.w - 0.4, h = 1.05;
      rr(ctx, x, y, w, h, 0.18);
      if (neon) { ctx.fillStyle = '#0b0a16'; ctx.fill(); ctx.strokeStyle = TUBE.sign; ctx.lineWidth = 0.05; ctx.stroke(); }
      else { ctx.fillStyle = pal.body; ctx.fill(); ctx.strokeStyle = pal.accent; ctx.lineWidth = 0.05; ctx.stroke(); }
      p.say(sign, x + w / 2, y + h / 2, 0.46, neon ? pal.accent : pal.text, { align: 'center', weight: 800, mono: neon, min: 8, max: 30, spacing: 0.08, dark: neon });
    } else if (t.kind === 'clock') {
      const cx = t.x + 0.5, cy = oy - 0.75, now = p.time, m = now.getMinutes() + now.getSeconds() / 60, hr = (now.getHours() % 12) + m / 60;
      ctx.beginPath(); ctx.arc(cx, cy, 0.42, 0, 6.3);
      ctx.fillStyle = neon ? '#0b0a16' : pal.body; ctx.fill(); ctx.strokeStyle = neon ? TUBE.wall : pal.text3; ctx.lineWidth = 0.04; ctx.stroke();
      const a = (f: number) => f * Math.PI * 2 - Math.PI / 2;
      ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a(m / 60)) * 0.32, cy + Math.sin(a(m / 60)) * 0.32);
      ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a(hr / 12)) * 0.2, cy + Math.sin(a(hr / 12)) * 0.2);
      ctx.strokeStyle = neon ? pal.accent : pal.text; ctx.lineWidth = 0.045; ctx.stroke(); ctx.lineCap = 'butt';
    } else if (t.kind === 'extinguisher') {
      ctx.beginPath(); ctx.arc(t.x + 0.5, hall.y + 0.22, 0.13, 0, 6.3); ctx.fillStyle = neon ? '#0b0a16' : mix('#ef4444', pal.floor, 0.25); ctx.fill();
      ctx.strokeStyle = neon ? '#ff4f7b' : mix('#ef4444', '#000000', 0.2); ctx.lineWidth = 0.03; ctx.stroke();
    }
  }
}

/** The props on the free tiles in view, as a plan's furniture symbols; faded in build mode. */
export function flatProps(p: FlatDecorPaint, layout: Parameters<typeof propsIn>[0], hall: Rect, density: DecorOptions['props'], faded: boolean): void {
  if (p.z < 8) return;
  const { ctx, pal } = p, neon = p.style === 'neon';
  if (faded) ctx.globalAlpha = 0.35;
  const line = neon ? 0.04 : 0.028;
  for (const q of propsIn(layout, hall, p.view, density)) {
    const cx = q.x + 0.5, cy = q.y + 0.5, ink = neon ? NEON_PROPS[q.kind] : pal.light ? mix(pal.text, pal.floor, 0.5) : pal.text3;
    const fill = (tint?: string) => (neon ? '#0b0a16' : tint ? mix(tint, pal.floor, pal.light ? 0.6 : 0.72) : mix(pal.body, pal.floor, 0.3));
    ctx.strokeStyle = ink; ctx.lineWidth = line;
    const shape = (draw: () => void, tint?: string) => { ctx.beginPath(); draw(); ctx.fillStyle = fill(tint); ctx.fill(); ctx.stroke(); };
    if (q.kind === 'plant') {
      /* a pot seen from above, its leaves round it in lobes, as a plan draws a plant */
      shape(() => { for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, lx = cx + Math.cos(a) * 0.2, ly = cy + Math.sin(a) * 0.2; ctx.moveTo(lx + 0.15, ly); ctx.arc(lx, ly, 0.15, 0, 6.3); } }, '#22c55e');
      ctx.beginPath(); ctx.arc(cx, cy, 0.12, 0, 6.3); ctx.fillStyle = fill('#c8693a'); ctx.fill(); ctx.stroke();
    } else if (q.kind === 'crates') {
      shape(() => rr(ctx, cx - 0.3, cy - 0.3, 0.6, 0.6, 0.06), '#c8955a');
      ctx.beginPath(); ctx.moveTo(cx - 0.3, cy - 0.3); ctx.lineTo(cx + 0.3, cy + 0.3); ctx.moveTo(cx + 0.3, cy - 0.3); ctx.lineTo(cx - 0.3, cy + 0.3); ctx.stroke();
    } else if (q.kind === 'barrel') {
      shape(() => ctx.arc(cx, cy, 0.27, 0, 6.3), '#60a5fa'); ctx.beginPath(); ctx.arc(cx, cy, 0.16, 0, 6.3); ctx.stroke();
    } else if (q.kind === 'pallet') {
      shape(() => ctx.rect(cx - 0.36, cy - 0.26, 0.72, 0.52), '#c8955a');
      ctx.beginPath(); for (const d of [-0.12, 0.12]) { ctx.moveTo(cx - 0.36, cy + d); ctx.lineTo(cx + 0.36, cy + d); } ctx.stroke();
    } else if (q.kind === 'cone') {
      shape(() => ctx.arc(cx, cy, 0.2, 0, 6.3), '#fb923c'); ctx.beginPath(); ctx.arc(cx, cy, 0.06, 0, 6.3); ctx.fillStyle = ink; ctx.fill();
    } else if (q.kind === 'cooler') {
      shape(() => rr(ctx, cx - 0.22, cy - 0.22, 0.44, 0.44, 0.05)); shape(() => ctx.arc(cx, cy, 0.13, 0, 6.3), '#38bdf8');
    } else if (q.kind === 'shelf') {
      shape(() => ctx.rect(cx - 0.42, cy - 0.2, 0.84, 0.4));
      ctx.beginPath(); for (const d of [-0.14, 0.14]) { ctx.moveTo(cx + d, cy - 0.2); ctx.lineTo(cx + d, cy + 0.2); } ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
