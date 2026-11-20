/**
 * Drawing pixel by pixel, for the pixel skins: every pixel of the picture full or empty, never the half-lit pixels a
 * canvas puts on the edge of a path. Each shape is told by which pixels it covers: a pixel is in it when its middle is.
 *
 * Coordinates are in pixels of art (`ART` to a tile, from the floor's origin), under a transform in tiles: what is
 * filled is whole pixels of art, which the pixel skin puts on whole pixels of the screen.
 */
export const ART = 16;

/** A number from a string, the same each time: what lets a flicker be random and kept by no one. */
export function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

type Inside = (cx: number, cy: number) => boolean;

/** The pixels of a box (art pixels, `i0` to `i1` excluded) whose middle is inside, in one colour: filled as runs along each row. */
export function fillWhere(ctx: CanvasRenderingContext2D, i0: number, j0: number, i1: number, j1: number, inside: Inside, color: string): void {
  const o = 1 / ART;
  i0 = Math.floor(i0); j0 = Math.floor(j0); i1 = Math.ceil(i1); j1 = Math.ceil(j1);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let j = j0; j < j1; j++) {
    let run = -1;
    for (let i = i0; i <= i1; i++) {
      const on = i < i1 && inside(i + 0.5, j + 0.5);
      if (on && run < 0) run = i;
      else if (!on && run >= 0) { ctx.rect(run * o, j * o, (i - run) * o, o); run = -1; }
    }
  }
  ctx.fill();
}

/** A disc of radius `r` round (cx, cy). */
export function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const r2 = r * r;
  fillWhere(ctx, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r2, color);
}

/** A ring: what lies between `r - th` and `r` from (cx, cy); `keep` leaves some of it out (a dashed ring). */
export function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, th: number, color: string, keep?: (angle: number) => boolean): void {
  const out = r * r, inn = Math.max(0, r - th) ** 2;
  fillWhere(ctx, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => { const d = (x - cx) ** 2 + (y - cy) ** 2; return d <= out && d > inn && (!keep || keep(Math.atan2(y - cy, x - cx))); }, color);
}

/** A straight stroke `th` thick from (x0, y0) to (x1, y1), its ends square. */
export function seg(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, th: number, color: string): void {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1e-9, h = th / 2, h2 = h * h;
  fillWhere(ctx, Math.min(x0, x1) - h - 1, Math.min(y0, y1) - h - 1, Math.max(x0, x1) + h + 1, Math.max(y0, y1) + h + 1, (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)), px = x0 + t * dx - x, py = y0 + t * dy - y;
    return px * px + py * py <= h2;
  }, color);
}

/** A polygon, filled; its edge (its pixels that touch a pixel outside it) in another colour, when given. */
export function poly(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], fill: string | null, edge: string | null): void {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const i0 = Math.min(...xs) - 1, j0 = Math.min(...ys) - 1, i1 = Math.max(...xs) + 1, j1 = Math.max(...ys) + 1;
  const rim = (x: number, y: number) => inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1));
  if (fill) fillWhere(ctx, i0, j0, i1, j1, edge ? (x, y) => inside(x, y) && !rim(x, y) : inside, fill);
  if (edge) fillWhere(ctx, i0, j0, i1, j1, rim, edge);
}

/** A box's outline, `th` pixels thick, inside it; dashed `on` pixels on and `off` off when asked; its corners cut by `cut`. */
export function frame(ctx: CanvasRenderingContext2D, i: number, j: number, w: number, h: number, th: number, color: string, dash?: [number, number], cut = 0): void {
  const o = 1 / ART;
  i = Math.round(i); j = Math.round(j); w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = color;
  ctx.beginPath();
  const line = (x: number, y: number, len: number, across: boolean) => {
    if (!dash) { if (len > 0) ctx.rect(x * o, y * o, (across ? len : th) * o, (across ? th : len) * o); return; }
    for (let k = 0; k < len; k += dash[0] + dash[1]) { const l = Math.min(dash[0], len - k); ctx.rect((x + (across ? k : 0)) * o, (y + (across ? 0 : k)) * o, (across ? l : th) * o, (across ? th : l) * o); }
  };
  line(i + cut, j, w - 2 * cut, true); line(i + cut, j + h - th, w - 2 * cut, true);
  line(i, j + cut, h - 2 * cut, false); line(i + w - th, j + cut, h - 2 * cut, false);
  /* a cut corner: one step in, so the outline goes round it without a gap */
  if (cut > 0) for (const [x, y] of [[i + cut - 1, j + 1], [i + w - cut, j + 1], [i + cut - 1, j + h - 2], [i + w - cut, j + h - 2]] as const) ctx.rect(x * o, y * o, o, o);
  ctx.fill();
}

/** A box filled, its corners cut `cut` pixels in. */
export function box(ctx: CanvasRenderingContext2D, i: number, j: number, w: number, h: number, color: string, cut = 0): void {
  const o = 1 / ART;
  i = Math.round(i); j = Math.round(j); w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (cut <= 0) ctx.rect(i * o, j * o, w * o, h * o);
  else for (let k = 0; k < h; k++) { const c = Math.max(0, cut - Math.min(k, h - 1 - k)); ctx.rect((i + c) * o, (j + k) * o, (w - 2 * c) * o, o); }
  ctx.fill();
}

/**
 * A sprite: rows of letters, each an ink (a letter with no ink is left empty), its top-left on (i, j), turned a quarter
 * at a time clockwise (east, south, west, north for a sprite drawn pointing east).
 */
export function sprite(ctx: CanvasRenderingContext2D, rows: readonly string[], i: number, j: number, inks: Record<string, string>, turn = 0): void {
  const o = 1 / ART, n = rows.length, m = rows[0]!.length;
  i = Math.round(i); j = Math.round(j);
  for (const [k, c] of Object.entries(inks)) {
    ctx.fillStyle = c;
    ctx.beginPath();
    for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) {
      if (rows[y]![x] !== k) continue;
      const [u, v] = turn === 1 ? [n - 1 - y, x] : turn === 2 ? [m - 1 - x, n - 1 - y] : turn === 3 ? [y, m - 1 - x] : [x, y];
      ctx.rect((i + u) * o, (j + v) * o, o, o);
    }
    ctx.fill();
  }
}

/** Figures, three pixels by five: what a stencil writes on the ground. */
export const FIGURES: Record<string, readonly string[]> = {
  0: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'], 1: ['.X.', 'XX.', '.X.', '.X.', 'XXX'], 2: ['XXX', '..X', 'XXX', 'X..', 'XXX'], 3: ['XXX', '..X', '.XX', '..X', 'XXX'],
  4: ['X.X', 'X.X', 'XXX', '..X', '..X'], 5: ['XXX', 'X..', 'XXX', '..X', 'XXX'], 6: ['XXX', 'X..', 'XXX', 'X.X', 'XXX'], 7: ['XXX', '..X', '.X.', '.X.', '.X.'],
  8: ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'], 9: ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
};

/** A number in figures of three pixels by five, each of their pixels `k` pixels square, a figure's width apart. */
export function figures(ctx: CanvasRenderingContext2D, text: string, i: number, j: number, k: number, color: string): void {
  const o = 1 / ART;
  i = Math.round(i); j = Math.round(j);
  ctx.fillStyle = color;
  ctx.beginPath();
  [...text].forEach((ch, n) => {
    const rows = FIGURES[ch];
    if (!rows) return;
    const x0 = i + n * (3 * k + k);
    rows.forEach((row, y) => { for (let x = 0; x < 3; x++) if (row[x] === 'X') ctx.rect((x0 + x * k) * o, (j + y * k) * o, k * o, k * o); });
  });
  ctx.fill();
}
