/**
 * Where ticket names go on the floor. Tickets that share a station or a zone,
 * or that are too close to each other on a belt, share one box that lists
 * them; boxes are then placed so they do not cover one another. Pure geometry
 * in screen pixels: the renderer gives positions and draws the result.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface NamedTicket {
  id: string;
  /** What to print: number and title. */
  text: string;
  /** Where the ticket is drawn, in screen pixels. */
  x: number; y: number;
  /** The station or zone it is in, when it is in one: its tickets always share a box. */
  box?: { id: string; rect: Rect };
}

export interface NameBox extends Rect {
  lines: { id: string; text: string }[];
  /** Tickets of the group that did not fit in the box. */
  more: number;
  /** What the box names: the machine, or the area its tickets cover. */
  anchor: Rect;
  /** The tickets of a group that is not in a machine, to draw a line to each. Empty for a machine. */
  points: { x: number; y: number }[];
}

export interface NameLayoutOptions {
  /** Most lines in one box before "+N more". */
  maxLines: number;
  /** Widest a line may be before it is cut, in pixels. */
  maxWidth: number;
  lineHeight: number;
  /** Padding inside a box, and room on each line for the colour chip. */
  pad: number; chip: number;
  /** Tickets closer than this, outside a machine, share a box. */
  nearX: number; nearY: number;
  /** Half the size of a ticket on screen: a box keeps clear of it. */
  radius: number;
}

export const NAME_LAYOUT: NameLayoutOptions = { maxLines: 8, maxWidth: 230, lineHeight: 15, pad: 5, chip: 13, nearX: 120, nearY: 24, radius: 9 };

const GAP = 8;
const hit = (a: Rect, b: Rect, m = 3): boolean => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

function cut(text: string, room: number, measure: (s: string) => number): string {
  if (measure(text) <= room) return text;
  let t = text;
  while (t.length > 4 && measure(`${t}…`) > room) t = t.slice(0, -1);
  return `${t}…`;
}

interface Group { anchor: Rect; tickets: NamedTicket[]; points: { x: number; y: number }[]; cx: number; cy: number }

/** One group per machine, then whatever is left, gathered by nearness. */
function groupsOf(items: NamedTicket[], o: NameLayoutOptions): Group[] {
  const boxes = new Map<string, Group>(), loose: NamedTicket[] = [];
  for (const t of items) {
    if (!t.box) { loose.push(t); continue; }
    const g = boxes.get(t.box.id);
    if (g) g.tickets.push(t);
    else boxes.set(t.box.id, { anchor: t.box.rect, tickets: [t], points: [], cx: 0, cy: 0 });
  }
  const near: Group[] = [];
  for (const t of [...loose].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const g = near.find((q) => Math.abs(q.cx - t.x) < o.nearX && Math.abs(q.cy - t.y) < o.nearY);
    if (g) { const n = g.tickets.length; g.cx = (g.cx * n + t.x) / (n + 1); g.cy = (g.cy * n + t.y) / (n + 1); g.tickets.push(t); g.points.push({ x: t.x, y: t.y }); }
    else near.push({ anchor: { x: 0, y: 0, w: 0, h: 0 }, tickets: [t], points: [{ x: t.x, y: t.y }], cx: t.x, cy: t.y });
  }
  for (const g of near) {
    const x0 = Math.min(...g.points.map((p) => p.x)) - o.radius, y0 = Math.min(...g.points.map((p) => p.y)) - o.radius;
    g.anchor = { x: x0, y: y0, w: Math.max(...g.points.map((p) => p.x)) + o.radius - x0, h: Math.max(...g.points.map((p) => p.y)) + o.radius - y0 };
  }
  /* machines first: they do not move and their lists are the bulkiest, so the small boxes are the ones that fit around */
  const byPlace = (a: Group, b: Group) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x;
  return [...[...boxes.values()].sort(byPlace), ...near.sort(byPlace)];
}

/**
 * One box per group, above what it names when there is room, otherwise below,
 * to the right or to the left; and when every side is taken, further up until
 * it is clear. A group wholly outside the view gets no box. `avoid` lists what a
 * box should rather not cover (the machines of the floor): it gives way only
 * when no side is left.
 */
export function layoutNames(items: NamedTicket[], view: { w: number; h: number }, measure: (s: string) => number, o: NameLayoutOptions = NAME_LAYOUT, avoid: Rect[] = []): NameBox[] {
  const placed: NameBox[] = [], groups = groupsOf(items, o);
  for (const g of groups) {
    const a = g.anchor;
    if (a.x > view.w || a.y > view.h || a.x + a.w < 0 || a.y + a.h < 0) continue;
    const shown = g.tickets.slice(0, o.maxLines), more = g.tickets.length - shown.length;
    const lines = shown.map((t) => ({ id: t.id, text: cut(t.text, o.maxWidth, measure) }));
    const tail = more > 0 ? `+${more} more` : '';
    const w = Math.ceil(Math.max(...lines.map((l) => measure(l.text) + o.chip), tail ? measure(tail) : 0)) + o.pad * 2;
    const h = (lines.length + (tail ? 1 : 0)) * o.lineHeight + o.pad * 2;
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const clamp = (r: Rect): Rect => ({ ...r, x: Math.max(4, Math.min(view.w - w - 4, r.x)), y: Math.max(4, Math.min(view.h - h - 4, r.y)) });
    const sides: Rect[] = [
      { x: cx - w / 2, y: a.y - GAP - h, w, h }, { x: cx - w / 2, y: a.y + a.h + GAP, w, h },
      { x: a.x + a.w + GAP, y: cy - h / 2, w, h }, { x: a.x - GAP - w, y: cy - h / 2, w, h },
    ].map(clamp);
    /* a side is good when the box, once kept inside the view, covers neither what it names nor another box; better still when it covers no other ticket either */
    const free = (r: Rect) => !hit(r, a, 0) && !placed.some((p) => hit(r, p));
    const tidy = (r: Rect) => !groups.some((q) => q !== g && hit(r, q.anchor, 0));
    let at = sides.find((r) => free(r) && tidy(r) && !avoid.some((v) => hit(r, v, 0))) ?? sides.find((r) => free(r) && tidy(r)) ?? sides.find(free);
    for (let step = 1; !at && step <= 40; step++) {
      const up = clamp({ x: cx - w / 2, y: a.y - GAP - h - step * (o.lineHeight - 3), w, h });
      if (!placed.some((p) => hit(up, p))) at = up;
    }
    at ??= sides[0]!;
    placed.push({ ...at, lines, more, anchor: a, points: g.points });
  }
  return placed;
}

/** The two ends of the line that ties a box to a rectangle (or a point, as a rectangle of no size): the closest points of each. */
export function tie(box: Rect, to: Rect): { x0: number; y0: number; x1: number; y1: number } {
  const bx = box.x + box.w / 2, by = box.y + box.h / 2, tx = to.x + to.w / 2, ty = to.y + to.h / 2;
  const near = (r: Rect, px: number, py: number) => ({ x: Math.max(r.x, Math.min(r.x + r.w, px)), y: Math.max(r.y, Math.min(r.y + r.h, py)) });
  const p0 = near(box, tx, ty), p1 = near(to, bx, by);
  return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
}
