/**
 * A ticket on the floor is an object that has the shape of its type: a hammer
 * for a build, a bug for a fix… drawn as a small token with some thickness, so
 * that what travels on the belts reads as a thing being carried, not as an icon
 * sliding about.
 *
 * The shapes are not redrawn here: they are read from the icon the rest of
 * Fleex uses for a ticket's type (`TicketTypeIconSvg`), so a token and the icon
 * next to a ticket's title are always the same drawing.
 */
import { Children, isValidElement, type ReactNode } from 'react';
import type { TicketType } from '@fleex/shared';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { SOURCE_PARTS, sourceOfType } from './items';

/** One stroke of an icon, in its 24 × 24 box. */
export type Part =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number };

const BOX = 24;
/** A ticket with no type: a plain crate. */
const CRATE: Part[] = [{ kind: 'rect', x: 4.5, y: 4.5, w: 15, h: 15, rx: 4 }];

function walk(node: ReactNode, out: Part[]): void {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as Record<string, unknown>, n = (v: unknown) => Number(v) || 0;
    if (child.type === 'path' && typeof p['d'] === 'string') out.push({ kind: 'path', d: p['d'] });
    else if (child.type === 'circle') out.push({ kind: 'circle', cx: n(p['cx']), cy: n(p['cy']), r: n(p['r']) });
    else if (child.type === 'rect') out.push({ kind: 'rect', x: n(p['x']), y: n(p['y']), w: n(p['width']), h: n(p['height']), rx: n(p['rx']) });
    else walk(p['children'] as ReactNode, out);   // a fragment, a group
  });
}

const partsCache = new Map<string, { parts: Part[]; solid: boolean }>();
/**
 * The strokes of a type's icon. `solid` is true for the crate, which is filled rather than drawn in line. An unknown
 * type, or an icon this cannot read, is a crate too: a ticket always has a shape.
 */
export function shapeOf(type: string): { parts: Part[]; solid: boolean } {
  const hit = partsCache.get(type);
  if (hit) return hit;
  /* an item: the mark of its source */
  const source = sourceOfType(type);
  if (source) { const out = { parts: SOURCE_PARTS[source], solid: false }; partsCache.set(type, out); return out; }
  const parts: Part[] = [];
  if (type) {
    try {
      /* the icon is a plain function of its props: calling it gives the drawing without mounting anything */
      const svg = TicketTypeIconSvg({ type: type as TicketType });
      if (isValidElement(svg)) walk((svg.props as { children?: ReactNode }).children, parts);
    } catch { /* fall back to the crate */ }
  }
  /* the icon of "no type" is itself a square: only real type icons count as a shape of their own */
  const own = parts.length > 0 && !(parts.length === 1 && parts[0]!.kind === 'rect');
  const out = own ? { parts, solid: false } : { parts: CRATE, solid: true };
  partsCache.set(type, out);
  return out;
}

const pathCache = new Map<string, Path2D>();
function pathOf(type: string): Path2D {
  let path = pathCache.get(type);
  if (path) return path;
  path = new Path2D();
  for (const p of shapeOf(type).parts) {
    if (p.kind === 'path') path.addPath(new Path2D(p.d));
    else if (p.kind === 'circle') { path.moveTo(p.cx + p.r, p.cy); path.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); }
    else {
      const r = Math.min(p.rx, p.w / 2, p.h / 2), { x, y, w, h } = p;
      path.moveTo(x + r, y); path.arcTo(x + w, y, x + w, y + h, r); path.arcTo(x + w, y + h, x, y + h, r); path.arcTo(x, y + h, x, y, r); path.arcTo(x, y, x + w, y, r); path.closePath();
    }
  }
  pathCache.set(type, path);
  return path;
}

/** A colour moved towards black (`k` below 1) or towards white (above 1). Takes `#rrggbb`. */
export function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16), ch = (c: number) => Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1));
  return `rgb(${ch((v >> 16) & 255)}, ${ch((v >> 8) & 255)}, ${ch(v & 255)})`;
}

/** How a token is drawn: whole, or as the flat grey ghost of a ticket a filter has left out. */
export type TokenLook = 'solid' | 'ghost';

/** Thickness of the token and width of its strokes, in the icon's own 24-unit box. */
const DEPTH = 2.6, STROKE = 3.3, RIM = 1.5;
/** Room kept around the icon's box for the rim, the thickness and the shadow, as a share of its size. */
export const TOKEN_PAD = 0.24;

/**
 * Draw a token in a square of `size`, its top-left corner at the origin of the context. The icon is drawn several
 * times over: a soft shadow on the floor, a dark body pushed down by the token's thickness, its side in a darker
 * shade of the colour, its top face in the colour, and a line of light along the upper-left edge.
 */
export function drawToken(ctx: CanvasRenderingContext2D, type: string, size: number, color: string, look: TokenLook = 'solid'): void {
  const { solid } = shapeOf(type), path = pathOf(type), k = size / BOX;
  const paint = (dx: number, dy: number, width: number, style: string, fill = solid) => {
    ctx.save(); ctx.translate(dx, dy); ctx.lineWidth = width; ctx.strokeStyle = style; ctx.fillStyle = style;
    if (fill) ctx.fill(path);
    ctx.stroke(path); ctx.restore();
  };
  ctx.save();
  ctx.scale(k, k); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (look === 'ghost') { paint(0, 0, STROKE - 0.6, color); ctx.restore(); return; }
  const lift = -DEPTH / 2;                       // the top face sits above the middle, the body below: the token stays centred
  /* the shadow it casts: the body's outline, blurred and pushed down and to the right */
  ctx.save(); ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'; ctx.shadowBlur = 2.4 * k; ctx.shadowOffsetX = 0.7 * k; ctx.shadowOffsetY = 1.5 * k;
  paint(0, lift + DEPTH, STROKE + RIM, '#09090b'); ctx.restore();
  /* the body: a dark rim all the way down the thickness, then the side in a darker shade of the colour */
  for (let d = DEPTH; d >= 0; d -= 0.65) paint(0, lift + d, STROKE + RIM, '#09090b');
  for (let d = DEPTH; d > 0.2; d -= 0.6) paint(0, lift + d, STROKE, shade(color, 0.5));
  /* the top face, lit from the upper left */
  paint(0, lift, STROKE, color);
  paint(-0.72, lift - 0.82, 0.7, 'rgba(255, 255, 255, 0.5)', false);
  ctx.restore();
}

const sprites = new Map<string, HTMLCanvasElement>();
/**
 * A token drawn once at a size in device pixels, to be stamped wherever a ticket of that type is. The picture is
 * larger than `px` by `TOKEN_PAD` on every side. Null where there is no canvas to draw on (the tests).
 */
export function tokenSprite(type: string, color: string, px: number, look: TokenLook = 'solid'): HTMLCanvasElement | null {
  const size = Math.max(4, Math.round(px)), key = `${type}|${color}|${size}|${look}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const pad = Math.ceil(size * TOKEN_PAD), cv = document.createElement('canvas');
  cv.width = cv.height = size + pad * 2;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.translate(pad, pad);
  drawToken(ctx, type, size, color, look);
  if (sprites.size > 600) sprites.clear();       // zooming makes many sizes: start over rather than grow without end
  sprites.set(key, cv);
  return cv;
}
