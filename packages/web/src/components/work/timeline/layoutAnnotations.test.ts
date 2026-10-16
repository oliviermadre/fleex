import { describe, it, expect } from 'vitest';
import type { TimelineAnnotation } from '@fleex/shared';
import { buildTimeline } from './buildTimeline';
import { layoutTimeline } from './layoutTimeline';
import {
  BAND,
  CARD_W,
  PILL,
  SNAP_PX,
  firstImage,
  instantAtCursor,
  layoutAnnotationBand,
  rowsForBudget,
  timeAnchors,
  timeAtX,
  xAtTime,
} from './layoutAnnotations';
import { NOW, at, fixture591 } from './timeline.fixture';

const ALL = { status: true, cli: true, pr: true, deliverables: true, comments: true, annotations: true };

function annotation(id: string, iso: string, over: Partial<TimelineAnnotation> = {}): TimelineAnnotation {
  return {
    id, ticketId: 't-591', at: iso, title: id, body: '', tone: 'info', sourceCommentId: null,
    authorType: 'user', authorName: 'nas', createdAt: iso, updatedAt: iso, ...over,
  };
}

const model = buildTimeline(fixture591(), NOW);
const layout = layoutTimeline(model, ALL);
const anchors = timeAnchors(layout, NOW);

describe('time ↔ x mapping of the frieze', () => {
  it('is strictly increasing, so a later instant is never drawn left of an earlier one', () => {
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i]!.at).toBeGreaterThan(anchors[i - 1]!.at);
      expect(anchors[i]!.x).toBeGreaterThan(anchors[i - 1]!.x);
    }
    expect(anchors[anchors.length - 1]).toEqual({ at: NOW, x: layout.nowX });
  });

  it('lands exactly on a placed event at its instant, and between its neighbours otherwise', () => {
    const a = anchors[2]!;
    const b = anchors[3]!;
    expect(xAtTime(anchors, a.at)).toBeCloseTo(a.x);
    const mid = xAtTime(anchors, (a.at + b.at) / 2);
    expect(mid).toBeGreaterThan(a.x);
    expect(mid).toBeLessThan(b.x);
  });

  // The cursor → instant estimate shown under the "+" must round-trip.
  it('inverts: the instant under a cursor maps back to that cursor', () => {
    for (const x of [anchors[1]!.x + 3, (anchors[4]!.x + anchors[5]!.x) / 2, layout.nowX - 1]) {
      expect(xAtTime(anchors, timeAtX(anchors, x))).toBeCloseTo(x, 0);
    }
  });

  it('clamps out-of-range instants to the frieze ends', () => {
    expect(xAtTime(anchors, 0)).toBe(anchors[0]!.x);
    expect(xAtTime(anchors, NOW + 86_400_000)).toBe(layout.nowX);
  });
});

describe('instantAtCursor — magnetism (AC2)', () => {
  const node = layout.items.find((i) => i.event.lane === 'spine')!;

  it(`snaps to a node's exact timestamp within ${SNAP_PX}px`, () => {
    const hit = instantAtCursor(layout, anchors, node.x + SNAP_PX - 1);
    expect(hit).toMatchObject({ at: node.event.at, x: node.x, snappedTo: { id: node.event.id } });
  });

  it('interpolates freely farther away', () => {
    const free = layout.items.map((i) => i.x).sort((a, b) => a - b);
    // Widest gap between two pictos: its middle is far from every node.
    let best = 0;
    for (let i = 1; i < free.length; i++) if (free[i]! - free[i - 1]! > free[best + 1]! - free[best]!) best = i - 1;
    const x = (free[best]! + free[best + 1]!) / 2;
    const hit = instantAtCursor(layout, anchors, x);
    expect(hit.snappedTo).toBeNull();
    expect(hit.at).toBe(timeAtX(anchors, x));
  });
});

describe('layoutAnnotationBand', () => {
  // AC10: annotations take no lane slot — the frieze is laid out without them.
  it('leaves the frieze untouched: same width and same x for every picto', () => {
    const before = layoutTimeline(model, ALL);
    layoutAnnotationBand([annotation('a', at(9, 0)), annotation('b', at(10, 0))], anchors, before.width);
    const after = layoutTimeline(model, ALL);
    expect(after.width).toBe(before.width);
    expect(after.items.map((i) => i.x)).toEqual(before.items.map((i) => i.x));
  });

  it('collapses to a thin hover strip when empty, and disappears when filtered out (AC12)', () => {
    expect(layoutAnnotationBand([], anchors, layout.width).height).toBe(BAND.empty);
    expect(layoutAnnotationBand([annotation('a', at(9, 0))], anchors, layout.width, false)).toEqual({ cards: [], height: BAND.hidden, mode: 'cards' });
  });

  it('orders cards chronologically and anchors each on its instant', () => {
    const band = layoutAnnotationBand([annotation('late', at(10, 30)), annotation('early', at(8, 0))], anchors, 10_000);
    const xs = band.cards.map((c) => (c.kind === 'card' ? c.item.x : NaN));
    expect(band.cards.map((c) => (c.kind === 'card' ? c.item.annotation.id : ''))).toEqual(['early', 'late']);
    expect(xs[0]).toBeCloseTo(xAtTime(anchors, Date.parse(at(8, 0))));
    expect(xs[0]!).toBeLessThan(xs[1]!);
  });

  // AC11: overlap → second row; denser → a stack.
  it('moves an overlapping card to a second row, then stacks', () => {
    const lin = [{ at: 0, x: 0 }, { at: 1_000_000, x: 1_000_000 }];
    const iso = (x: number) => new Date(x).toISOString();
    const two = layoutAnnotationBand([annotation('a', iso(500)), annotation('b', iso(600))], lin, 5000);
    expect(two.height).toBe(BAND.twoRows);
    expect(two.cards.map((c) => c.row)).toEqual([0, 1]);

    const three = layoutAnnotationBand([annotation('a', iso(500)), annotation('b', iso(600)), annotation('c', iso(700))], lin, 5000);
    expect(three.cards).toHaveLength(2);
    expect(three.cards[1]).toMatchObject({ kind: 'stack', row: 1 });

    const dense = layoutAnnotationBand(['a', 'b', 'c', 'd'].map((id, i) => annotation(id, iso(500 + i * 10))), lin, 5000);
    expect(dense.cards).toHaveLength(1);
    expect(dense.cards[0]).toMatchObject({ kind: 'stack', row: 0 });
    expect(dense.height).toBe(BAND.oneRow);

    const apart = layoutAnnotationBand([annotation('a', iso(500)), annotation('b', iso(500 + CARD_W + 20))], lin, 5000);
    expect(apart.cards.map((c) => c.row)).toEqual([0, 0]);
  });

  // Ticket feedback: the band follows the drawer height — two rows, one row (regrouped), then pills only.
  it('picks two rows, one row or pills from the room above the frieze', () => {
    expect(rowsForBudget(BAND.twoRows)).toBe(2);
    expect(rowsForBudget(BAND.twoRows - 1)).toBe(1);
    expect(rowsForBudget(BAND.oneRow)).toBe(1);
    expect(rowsForBudget(BAND.oneRow - 1)).toBe(0);
    expect(rowsForBudget(-50)).toBe(0);
  });

  it('regroups into a stack instead of opening a second row when only one row fits', () => {
    const lin = [{ at: 0, x: 0 }, { at: 1_000_000, x: 1_000_000 }];
    const iso = (x: number) => new Date(x).toISOString();
    const one = layoutAnnotationBand([annotation('a', iso(500)), annotation('b', iso(600))], lin, 5000, true, 1);
    expect(one.height).toBe(BAND.oneRow);
    expect(one.cards).toHaveLength(1);
    expect(one.cards[0]).toMatchObject({ kind: 'stack', row: 0 });
    expect(one.cards[0]!.kind === 'stack' && one.cards[0]!.items.map((i) => i.annotation.id)).toEqual(['a', 'b']);
  });

  it('shows pills only when no card row fits, merging pills that would touch', () => {
    const lin = [{ at: 0, x: 0 }, { at: 1_000_000, x: 1_000_000 }];
    const iso = (x: number) => new Date(x).toISOString();
    const mini = layoutAnnotationBand(
      [annotation('a', iso(500)), annotation('b', iso(510)), annotation('c', iso(800))],
      lin, 5000, true, 0,
    );
    expect(mini.mode).toBe('mini');
    expect(mini.height).toBe(BAND.mini);
    expect(mini.height).toBeLessThan(BAND.oneRow);
    expect(mini.cards.map((c) => c.kind)).toEqual(['stack', 'card']);
    // A lone pill is centred on its exact instant.
    const lone = mini.cards[1]!;
    expect(lone.kind === 'card' && lone.left + PILL / 2).toBe(800);
    // No annotation at all still keeps the thin hover strip, never the mini band.
    expect(layoutAnnotationBand([], lin, 5000, true, 0).height).toBe(BAND.empty);
  });

  it('keeps a card inside the frieze while its anchor stays on the exact instant', () => {
    const band = layoutAnnotationBand([annotation('a', at(0, 0))], anchors, layout.width);
    const card = band.cards[0]!;
    expect(card.left).toBeGreaterThanOrEqual(4);
    expect(card.kind === 'card' && card.item.x).toBe(anchors[0]!.x);
  });
});

describe('firstImage', () => {
  it('returns the first markdown image of the body — the card thumbnail', () => {
    expect(firstImage('texte\n![shot](/api/files/abc) et ![b](/api/files/def)')).toBe('/api/files/abc');
    expect(firstImage('[pas une image](/api/files/x)')).toBeNull();
  });
});
