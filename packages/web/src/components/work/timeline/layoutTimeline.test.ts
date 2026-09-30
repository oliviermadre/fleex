import { describe, it, expect } from 'vitest';
import { buildTimeline } from './buildTimeline';
import { LANE_WIDTH, gap, layoutTimeline, type TimelineLayout } from './layoutTimeline';
import { NOW, at, comment, emptySources, execution, fixture591 } from './timeline.fixture';

const ALL = { status: true, cli: true, pr: true, deliverables: true, comments: true };

/** Every pair of pictos sharing a lane must not overlap (the point of the ticket). */
function expectNoOverlap(l: TimelineLayout) {
  for (const lane of ['spine', 'top', 'bottom'] as const) {
    const row = l.items.filter((i) => i.event.lane === lane).sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1]!;
      const b = row[i]!;
      expect(b.x - b.width / 2, `${lane}: ${a.event.id} overlaps ${b.event.id}`).toBeGreaterThanOrEqual(a.x + a.width / 2 - 0.001);
    }
  }
}

/** Reading left to right is reading forward in time, across lanes. */
function expectMonotonic(l: TimelineLayout) {
  const sorted = [...l.items].sort((a, b) => a.event.at - b.event.at);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.event.at > sorted[i - 1]!.event.at) {
      expect(sorted[i]!.x, `${sorted[i]!.event.id} drawn before ${sorted[i - 1]!.event.id}`).toBeGreaterThanOrEqual(sorted[i - 1]!.x);
    }
  }
}

describe('gap — compressed time', () => {
  it('grows with the log of Δt and is capped', () => {
    expect(gap(0)).toBe(0);
    expect(Math.round(gap(60_000))).toBe(14);
    expect(gap(3_600_000)).toBeGreaterThan(80);
    expect(gap(3_600_000)).toBeLessThan(86);
    expect(gap(30 * 86_400_000)).toBe(180);
  });
});

describe('layoutTimeline — ticket #591 (screenshots)', () => {
  const l = layoutTimeline(buildTimeline(fixture591(), NOW), ALL);

  it('never overlaps two pictos of one lane and stays monotonic in time', () => {
    expectNoOverlap(l);
    expectMonotonic(l);
  });

  it('stacks a produced deliverable under its step instead of widening the frieze', () => {
    const d = l.byId.get('deliv:d-spec')!;
    const parent = l.byId.get('step:sr-spec-2')!;
    expect(d.attached).toBe(true);
    // Under the parent's slot: before the next spine node.
    expect(d.x).toBeGreaterThanOrEqual(parent.x);
    expect(d.x).toBeLessThan(parent.x + LANE_WIDTH.spine);
  });

  it('draws the fork after "now" and sizes the content for it', () => {
    const lastSpine = Math.max(...l.items.filter((i) => i.event.lane === 'spine').map((i) => i.x));
    expect(l.nowX).toBeGreaterThan(lastSpine);
    expect(l.width).toBeGreaterThanOrEqual(l.nowX + 260);
  });

  it('lays one zone per status, each starting at its pill, contiguous up to the end', () => {
    expect(l.zones.map((z) => z.status)).toEqual(['backlog', 'todo', 'doing']);
    expect(l.zones[0]!.x1).toBe(l.zones[1]!.x0);
    expect(l.zones[2]!.x1).toBe(l.width);
  });

  it('tints the agentic stretch of the spine as a workflow', () => {
    expect(l.spine.active).toMatchObject({ workflow: true });
    // The Merge gate is waiting → the tinted part runs to now.
    expect(l.spine.active!.x1).toBe(l.nowX);
  });

  it('keeps notes within their slot, hidden when there is no room', () => {
    for (const it of l.items) {
      if (it.textWidth != null && it.event.lane === 'spine') expect(it.textWidth).toBeLessThanOrEqual(150);
    }
    expect(l.byId.get('step:sr-gate-1')!.textWidth).not.toBeNull();
  });
});

describe('layoutTimeline — filters', () => {
  it('hides categories but never the spine', () => {
    const none = { status: false, cli: false, pr: false, deliverables: false, comments: false };
    const l = layoutTimeline(buildTimeline(fixture591(), NOW), none);
    expect(l.zones).toEqual([]);
    expect(new Set(l.items.map((i) => i.event.lane))).toEqual(new Set(['spine', 'top'])); // workflowStart stays
    expect(l.items.some((i) => i.event.kind === 'priority' || i.event.kind === 'cli')).toBe(false);
    expect(l.items.filter((i) => i.event.kind === 'step')).toHaveLength(11);
  });
});

describe('layoutTimeline — stress cases (§7.4)', () => {
  it('20 events in the same minute spread only as much as their lane needs', () => {
    const src = emptySources();
    src.comments = Array.from({ length: 20 }, (_, i) => comment({ id: `c${i}`, body: 'x', createdAt: at(9, 30) }));
    const l = layoutTimeline(buildTimeline(src, NOW), ALL);
    expectNoOverlap(l);
    const xs = l.items.filter((i) => i.event.kind === 'comment').map((i) => i.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(20 * LANE_WIDTH.bottom);
    expect(l.width).toBeLessThan(20 * LANE_WIDTH.bottom + 600);
  });

  it('20 runs in the same minute: one spine slot each, no explosion', () => {
    const src = emptySources();
    src.executions = Array.from({ length: 20 }, (_, i) => execution({ id: `x${i}`, startedAt: at(9, 30) }));
    const l = layoutTimeline(buildTimeline(src, NOW), ALL);
    expectNoOverlap(l);
    expectMonotonic(l);
    expect(l.width).toBeLessThanOrEqual(21 * LANE_WIDTH.spine + 400);
  });

  it('10 idle days cost at most 180px and are flagged by a break', () => {
    const src = emptySources();
    src.executions = [execution({ id: 'late', startedAt: new Date(2026, 9, 9, 9, 0).toISOString() })];
    const m = buildTimeline(src, new Date(2026, 9, 9, 12, 0).getTime());
    const l = layoutTimeline(m, ALL);
    const created = l.byId.get('created')!;
    const late = l.byId.get('run:late')!;
    expect(late.x - created.x).toBeLessThanOrEqual(Math.max(180, LANE_WIDTH.spine));
    expect(l.breaks).toHaveLength(1);
    expect(l.breaks[0]!.label).toBe('⋯ 10 j');
    expect(l.days).toHaveLength(1);
  });

  it('an empty ticket lays out creation, its zone and now', () => {
    const l = layoutTimeline(buildTimeline(emptySources(), NOW), ALL);
    expect(l.items.map((i) => i.event.kind)).toEqual(['created', 'status']);
    expect(l.zones).toHaveLength(1);
    expect(l.nowX).toBeGreaterThan(l.byId.get('created')!.x);
  });

  it('500 events build + lay out well under 100ms', () => {
    const src = fixture591();
    src.comments = Array.from({ length: 250 }, (_, i) => comment({ id: `c${i}`, body: 'x', createdAt: new Date(new Date(at(5, 0)).getTime() + i * 37_000).toISOString() }));
    src.executions = [
      ...src.executions,
      ...Array.from({ length: 250 }, (_, i) => execution({ id: `bulk${i}`, startedAt: new Date(new Date(at(5, 0)).getTime() + i * 41_000).toISOString() })),
    ];
    const t0 = performance.now();
    const l = layoutTimeline(buildTimeline(src, NOW), ALL);
    expect(performance.now() - t0).toBeLessThan(100);
    expectNoOverlap(l);
    expectMonotonic(l);
  });
});
