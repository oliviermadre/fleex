/**
 * Moving the view by the edges of the page, as a strategy game does: with the pointer near an edge the view glides
 * that way, faster the closer it is, and the pointer turns into an arrowhead that says so. It stays slow: at the
 * start of the zone it is only enough to notice. Pure helpers and one hook; the page says where its edges are.
 */
import { useEffect, type RefObject } from 'react';

/** How far from an edge the glide starts, in pixels. */
export const EDGE_ZONE = 10;
/** The glide's speed at the start of the zone and against the edge, in pixels of screen per second. */
export const EDGE_SLOW = 45, EDGE_FAST = 520;
/** How long the glide takes to reach its speed once the pointer is in the zone: crossing it on the way elsewhere moves nothing to speak of. */
export const EDGE_RAMP_MS = 320;

export interface EdgeRect { left: number; top: number; right: number; bottom: number }

/** How hard one edge pulls, 0 (out of its zone) to 1 (against it), for a pointer `d` pixels inside it. */
const pull = (d: number, zone: number): number => (d < 0 || d >= zone ? 0 : 1 - d / zone);
/** The speed for a pull: barely anything at the start of the zone, then more and more. */
const speed = (k: number): number => (k <= 0 ? 0 : EDGE_SLOW + (EDGE_FAST - EDGE_SLOW) * k * k);

/**
 * Where the view should glide for a pointer at (x, y) in a page whose edges are `r`: a velocity in pixels per second,
 * (0, 0) away from every edge and outside the page. In a corner both edges pull.
 */
export function edgePush(x: number, y: number, r: EdgeRect, zone = EDGE_ZONE): { vx: number; vy: number } {
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return { vx: 0, vy: 0 };
  return {
    vx: speed(pull(r.right - x, zone)) - speed(pull(x - r.left, zone)),
    vy: speed(pull(r.bottom - y, zone)) - speed(pull(y - r.top, zone)),
  };
}

export type EdgeDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
/** The way a push points, as a compass direction; null for none. */
export function edgeDir(vx: number, vy: number): EdgeDir | null {
  const v = vy < 0 ? 'n' : vy > 0 ? 's' : '', h = vx < 0 ? 'w' : vx > 0 ? 'e' : '';
  return (v + h) as EdgeDir || null;
}

const ANGLE: Record<EdgeDir, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
/** The pointer over an edge: an arrowhead towards it, light with a dark rim so it reads on any floor. */
const arrow = (deg: number): string => `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path transform="rotate(${deg} 13 13)" d="M13 3.5 21.5 20h-17z" fill="#f4f4f5" stroke="#18181b" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
)}") 13 13, default`;
/** One rule per direction, for the page to put in a style element: `root[data-edge="n"]` and everything in it take the arrowhead. */
export function edgeCursorCss(rootSelector: string): string {
  return (Object.keys(ANGLE) as EdgeDir[]).map((d) => `${rootSelector}[data-edge="${d}"], ${rootSelector}[data-edge="${d}"] * { cursor: ${arrow(ANGLE[d])} !important; }`).join('\n');
}

/** What the pointer is over that is to be clicked, not to be glided from: a control, a dialog, the minimap. */
const HELD = 'button, a, input, select, textarea, label, [role="dialog"], canvas[aria-label^="Minimap"]';

/**
 * Glide `move(dx, dy)` (pixels of screen) while the pointer is near an edge of `rect()`, and mark the root with the
 * direction (`data-edge`) so the pointer shows it. Nothing glides while the pointer is over a control, while
 * something is opened over the page, while `paused()` says so, or once the pointer has left the window.
 */
export function useEdgeScroll(root: RefObject<HTMLElement | null>, rect: () => EdgeRect | null, move: (dx: number, dy: number) => void, paused: () => boolean): void {
  useEffect(() => {
    let vx = 0, vy = 0, since = 0, last = 0, raf = 0;
    const mark = (dir: EdgeDir | null) => { const n = root.current; if (!n) return; if (dir) n.dataset.edge = dir; else delete n.dataset.edge; };
    const stop = () => { vx = 0; vy = 0; mark(null); if (raf) { cancelAnimationFrame(raf); raf = 0; } };
    const frame = (ts: number) => {
      raf = 0;
      if (!vx && !vy) return;
      const dt = Math.min(0.05, (ts - last) / 1000), ease = Math.min(1, (ts - since) / EDGE_RAMP_MS);
      last = ts;
      move(vx * dt * ease, vy * dt * ease);
      raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      const r = rect(), target = e.target as HTMLElement | null;
      if (!r || paused() || document.querySelector('[data-overlay-top]') || !root.current?.contains(target) || target?.closest?.(HELD)) { stop(); return; }
      const push = edgePush(e.clientX, e.clientY, r);
      if (!push.vx && !push.vy) { stop(); return; }
      if (!vx && !vy) { since = performance.now(); last = since; }
      vx = push.vx; vy = push.vy; mark(edgeDir(vx, vy));
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) stop(); };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('mouseout', onOut);
    window.addEventListener('blur', stop);
    return () => { stop(); window.removeEventListener('pointermove', onMove); document.removeEventListener('mouseout', onOut); window.removeEventListener('blur', stop); };
  }, [root, rect, move, paused]);
}
