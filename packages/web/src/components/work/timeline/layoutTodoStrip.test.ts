/**
 * The todo strip must stay readable under bursts ("many in a short time
 * range"): one counted chip instead of a carpet of pictos, chips that never
 * overlap, and a burst that splits by itself when the user zooms in.
 */
import { describe, it, expect } from 'vitest';
import { CHIP_GAP, TODO_LABEL_W, TODO_STRIP, chipWidth, layoutTodoStrip, todoStripHeight } from './layoutTodoStrip';
import type { TimeAnchor } from './layoutAnnotations';
import type { TodoMark, TodoMarkKind } from './todoMarks';

const T0 = Date.parse('2026-11-03T10:00:00.000Z');
const mark = (i: number, at: number, kind: TodoMarkKind = 'created'): TodoMark => ({
  id: `m${i}`, itemId: `i${i}`, ref: i, kind, at, itemText: `Item ${i}`, actorType: 'agent', actorName: 'Catalyst', source: 'cli', reason: null, deleted: false,
});
/** One hour mapped on `px` pixels, starting at x=100. */
const anchors = (px: number): TimeAnchor[] => [{ at: T0, x: 100 }, { at: T0 + 3_600_000, x: 100 + px }];

function expectInvariants(strip: ReturnType<typeof layoutTodoStrip>, total: number) {
  for (let i = 1; i < strip.chips.length; i++) {
    const a = strip.chips[i - 1]!;
    const b = strip.chips[i]!;
    expect(b.left).toBeGreaterThanOrEqual(a.left + a.width + CHIP_GAP);
    expect(b.marks[0]!.at).toBeGreaterThanOrEqual(a.marks[a.marks.length - 1]!.at);
  }
  expect(strip.chips.reduce((n, c) => n + c.marks.length, 0)).toBe(total);
  expect(new Set(strip.chips.flatMap((c) => c.marks.map((m) => m.id))).size).toBe(total);
  for (const c of strip.chips) expect(c.left).toBeGreaterThanOrEqual(TODO_LABEL_W);
}

describe('layoutTodoStrip', () => {
  it('turns a burst of 10 items in the same second into one chip counting 10', () => {
    const marks = Array.from({ length: 10 }, (_, i) => mark(i, T0 + 600_000 + i * 50));
    const strip = layoutTodoStrip(marks, anchors(600), 2000);
    expect(strip.chips).toHaveLength(1);
    expect(strip.chips[0]!.counts).toEqual({ created: 10 });
    expect(strip.height).toBe(TODO_STRIP);
    expectInvariants(strip, 10);
  });

  it('counts each kind in its own segment and picks the dominant one', () => {
    const marks = [mark(1, T0, 'done'), mark(2, T0 + 1000, 'done'), mark(3, T0 + 2000, 'cancelled')];
    const [chip] = layoutTodoStrip(marks, anchors(600), 2000).chips;
    expect(chip!.counts).toEqual({ done: 2, cancelled: 1 });
    expect(chip!.dominant).toBe('done');
    expect(chip!.width).toBe(chipWidth({ done: 2, cancelled: 1 }));
  });

  it('a lone event is a round pill', () => {
    const [chip] = layoutTodoStrip([mark(1, T0)], anchors(600), 2000).chips;
    expect(chip!.width).toBe(18);
  });

  it('keeps spread marks apart, in order, without overlap', () => {
    const marks = Array.from({ length: 12 }, (_, i) => mark(i, T0 + i * 300_000, i % 2 ? 'done' : 'created'));
    const strip = layoutTodoStrip(marks, anchors(1200), 2000);
    expect(strip.chips.length).toBeGreaterThan(1);
    expectInvariants(strip, 12);
  });

  it('zooming in only splits groups, never absorbs a mark from another one', () => {
    // A pseudo-random but deterministic spread, mixed kinds.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const kinds: TodoMarkKind[] = ['created', 'done', 'cancelled', 'reopened'];
    const marks = Array.from({ length: 40 }, (_, i) => mark(i, T0 + Math.floor(rnd() * 3_000_000), kinds[i % 4]));
    const groupOf = (px: number) => {
      const m = new Map<string, string>();
      for (const c of layoutTodoStrip(marks, anchors(px), 100_000).chips) for (const x of c.marks) m.set(x.id, c.key);
      return m;
    };
    const levels = [300, 600, 1200, 2400, 4800];
    for (let l = 1; l < levels.length; l++) {
      const coarse = groupOf(levels[l - 1]!);
      const fine = groupOf(levels[l]!);
      // Every fine group sits inside one coarse group.
      const fineToCoarse = new Map<string, string>();
      for (const [id, fg] of fine) {
        const cg = coarse.get(id)!;
        if (fineToCoarse.has(fg)) expect(fineToCoarse.get(fg)).toBe(cg);
        else fineToCoarse.set(fg, cg);
      }
    }
  });

  it('has no height when filtered out or empty — a ticket without todo keeps its timeline', () => {
    expect(todoStripHeight([], true)).toBe(0);
    expect(todoStripHeight([mark(1, T0)], false)).toBe(0);
    expect(todoStripHeight([mark(1, T0)], true)).toBe(TODO_STRIP);
    expect(layoutTodoStrip([], anchors(600), 2000)).toEqual({ chips: [], height: 0 });
  });
});
