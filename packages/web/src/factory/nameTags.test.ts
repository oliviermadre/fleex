import { describe, it, expect } from 'vitest';
import { layoutNames, tie, NAME_LAYOUT, type NameBox, type NamedTicket, type Rect } from './nameTags';

const measure = (s: string) => s.length * 6;
const view = { w: 1200, h: 800 };
const at = (id: string, x: number, y: number, text = `#${id} Ticket ${id}`): NamedTicket => ({ id, text, x, y });
const inBox = (id: string, box: string, rect: Rect): NamedTicket => ({ id, text: `#${id} Ticket ${id}`, x: rect.x + 10, y: rect.y + 10, box: { id: box, rect } });
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlaps = (boxes: NameBox[]) => boxes.every((a, i) => boxes.every((b, j) => i >= j || !overlap(a, b)));
const ids = (b: NameBox) => b.lines.map((l) => l.id);

describe('ticket names on the floor', () => {
  it('a ticket alone gets its name just above it', () => {
    const [b] = layoutNames([at('1', 600, 400)], view, measure);
    expect(ids(b!)).toEqual(['1']);
    expect(b!.y + b!.h).toBeLessThan(400 - NAME_LAYOUT.radius);
    expect(Math.abs(b!.x + b!.w / 2 - 600)).toBeLessThan(1);
    expect(b!.points).toEqual([{ x: 600, y: 400 }]);
  });

  it('tickets of one station share a box that lists them, whatever their number', () => {
    const station = { x: 300, y: 300, w: 100, h: 100 };
    const boxes = layoutNames(['1', '2', '3'].map((id) => inBox(id, 'spec', station)), view, measure);
    expect(boxes).toHaveLength(1);
    expect(ids(boxes[0]!)).toEqual(['1', '2', '3']);
    expect(boxes[0]!.points).toEqual([]);
    expect(overlap(boxes[0]!, station)).toBe(false);
  });

  it('a long list is cut, and says how many are left out', () => {
    const zone = { x: 300, y: 300, w: 200, h: 200 };
    const [b] = layoutNames(Array.from({ length: 30 }, (_, i) => inBox(String(i), 'backlog', zone)), view, measure);
    expect(b!.lines).toHaveLength(NAME_LAYOUT.maxLines);
    expect(b!.more).toBe(30 - NAME_LAYOUT.maxLines);
    expect(b!.h).toBe((NAME_LAYOUT.maxLines + 1) * NAME_LAYOUT.lineHeight + NAME_LAYOUT.pad * 2);
  });

  it('tickets that follow each other on a belt share one box; far ones keep their own', () => {
    const boxes = layoutNames([at('1', 400, 300), at('2', 433, 300), at('3', 466, 300), at('9', 900, 300)], view, measure);
    expect(boxes.map(ids)).toEqual([['1', '2', '3'], ['9']]);
    expect(boxes[0]!.points).toHaveLength(3);
    expect(noOverlaps(boxes)).toBe(true);
  });

  it('boxes never cover one another, even when everything is packed together', () => {
    const items: NamedTicket[] = [];
    /* three stations side by side, each full, and a belt of tickets running under them */
    for (let s = 0; s < 3; s++) for (let i = 0; i < 6; i++) items.push(inBox(`s${s}-${i}`, `station${s}`, { x: 300 + s * 110, y: 300, w: 100, h: 100 }));
    for (let i = 0; i < 12; i++) items.push(at(`b${i}`, 280 + i * 33, 430));
    for (let i = 0; i < 5; i++) items.push(at(`v${i}`, 250, 200 + i * 33));
    const boxes = layoutNames(items, view, measure);
    expect(boxes.reduce((n, b) => n + b.lines.length + b.more, 0)).toBe(items.length);
    expect(noOverlaps(boxes)).toBe(true);
    for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(view.w); }
  });

  it('a box stays inside the view, and moves to another side when its first choice is cut off', () => {
    const [top] = layoutNames([at('1', 600, 6)], view, measure);
    expect(top!.y).toBeGreaterThan(6 + NAME_LAYOUT.radius);   // no room above: it goes below
    const [corner] = layoutNames([at('2', 1195, 400, '#2 A fairly long ticket title to push it out')], view, measure);
    expect(corner!.x + corner!.w).toBeLessThanOrEqual(view.w);
  });

  it('long titles are cut to the widest a line may be', () => {
    const [b] = layoutNames([at('1', 600, 400, `#1 ${'word '.repeat(40)}`)], view, measure);
    expect(b!.lines[0]!.text.endsWith('…')).toBe(true);
    expect(measure(b!.lines[0]!.text)).toBeLessThanOrEqual(NAME_LAYOUT.maxWidth);
  });

  it('rather not covers a machine, and does when no side is left', () => {
    const exit = { x: 540, y: 340, w: 120, h: 50 };
    const [b] = layoutNames([at('1', 600, 400)], view, measure, NAME_LAYOUT, [exit]);
    expect(b!.y).toBeGreaterThan(400);   // the exit is just above: the name goes below
    const walls = [exit, { x: 540, y: 410, w: 120, h: 50 }, { x: 610, y: 380, w: 300, h: 40 }, { x: 290, y: 380, w: 300, h: 40 }];
    expect(layoutNames([at('1', 600, 400)], view, measure, NAME_LAYOUT, walls)).toHaveLength(1);
  });

  it('names nothing that is outside the view', () => {
    expect(layoutNames([at('1', -400, 300), at('2', 600, 2000)], view, measure)).toEqual([]);
  });

  it('ties a box to what it names by their closest points', () => {
    expect(tie({ x: 100, y: 100, w: 80, h: 20 }, { x: 130, y: 160, w: 20, h: 20 })).toEqual({ x0: 140, y0: 120, x1: 140, y1: 160 });
  });
});
