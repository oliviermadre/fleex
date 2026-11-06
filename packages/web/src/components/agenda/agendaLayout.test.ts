import { describe, it, expect } from 'vitest';
import type { AgendaItem, AgendaPrefs } from '@fleex/shared';
import { DEFAULT_AGENDA_PREFS } from '@fleex/shared';
import {
  windowFor, shiftAnchor, daysCovered, isBar, itemDays, segmentForDay, groupHourly, layoutDay,
  assignLanes, isBand, isVisible, matchesQuery, formatDuration, workflowShortName, dayKey, isoWeek, POINT_MIN, MAX_COLS, type GridEntry,
} from './agendaLayout';

// Local-time constructors: these tests are about the browser's own calendar.
const L = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const NOW = L(2026, 11, 5, 11, 30);

function block(id: string, start: Date, end: Date | null, over: Partial<AgendaItem> = {}): AgendaItem {
  return { id, type: 'workflow.run', shape: 'block', start: start.toISOString(), end: end ? end.toISOString() : null, title: id, ...over };
}
function point(id: string, at: Date, over: Partial<AgendaItem> = {}): AgendaItem {
  return { id, type: 'routine.run', shape: 'point', start: at.toISOString(), title: id, ...over };
}

describe('windowFor / shiftAnchor', () => {
  it('fetches Monday→Monday for a week, even when the anchor is a Sunday', () => {
    const w = windowFor('week', L(2026, 11, 8, 15));
    expect(dayKey(w.from)).toBe('2026-11-02');
    expect(dayKey(w.to)).toBe('2026-11-09');
  });

  it('fetches a 6-week grid starting on the Monday on or before the 1st for a month', () => {
    const w = windowFor('month', L(2026, 11, 20));
    expect(dayKey(w.from)).toBe('2026-10-26');
    expect(dayKey(w.to)).toBe('2026-12-07');
  });

  it('moves a month view by calendar month, not by 30 days', () => {
    expect(dayKey(shiftAnchor('month', L(2026, 1, 31), 1))).toBe('2026-02-01');
  });
});

describe('multi-day blocks (Google Calendar rule)', () => {
  it('cuts a 2-day block at midnight: one piece per column, flagged "continues after" then "continues before"', () => {
    const b = block('r', L(2026, 11, 2, 21, 30), L(2026, 11, 3, 11, 0));
    expect(daysCovered(b, NOW)).toBe(2);
    expect(isBar(b, NOW)).toBe(false);
    const mon = segmentForDay(b, L(2026, 11, 2), NOW)!;
    const tue = segmentForDay(b, L(2026, 11, 3), NOW)!;
    expect([mon.startMin, mon.endMin, mon.continuesAfter, mon.continuesBefore]).toEqual([21 * 60 + 30, 1440, true, false]);
    expect([tue.startMin, tue.endMin, tue.continuesBefore, tue.continuesAfter]).toEqual([0, 11 * 60, true, false]);
  });

  it('sends a block over 3 calendar days to the all-day band, out of the grid', () => {
    // #750: Tuesday afternoon → still waiting on Thursday.
    const b = block('r', L(2026, 11, 3, 15, 34), null);
    expect(isBar(b, NOW)).toBe(true);
    expect(segmentForDay(b, L(2026, 11, 4), NOW)).toBeNull();
    expect(itemDays(b, NOW)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it('spreads a multi-day all-day event over its inclusive last day', () => {
    const ev: AgendaItem = { id: 'event:e', type: 'event', shape: 'allDay', start: '2026-10-30', end: '2026-11-02', title: 'Offsite' };
    expect(itemDays(ev, NOW)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(itemDays({ ...ev, end: '2026-10-30' }, NOW)).toEqual(['2026-10-30']);
    expect(itemDays({ ...ev, end: null }, NOW)).toEqual(['2026-10-30']);
  });

  it('does not spill a block that ends at 00:00 sharp onto the next day', () => {
    const b = block('r', L(2026, 11, 4, 21, 0), L(2026, 11, 5, 0, 0));
    expect(daysCovered(b, NOW)).toBe(1);
    expect(segmentForDay(b, L(2026, 11, 5), NOW)).toBeNull();
  });

  it('grows a running block up to now', () => {
    const seg = segmentForDay(block('r', L(2026, 11, 5, 8, 54), null), L(2026, 11, 5), NOW)!;
    expect(seg.endMin).toBe(11 * 60 + 30);
  });

  it('lays a 3-second run out as an instant row, exactly POINT_MIN tall', () => {
    const seg = segmentForDay(block('r', L(2026, 11, 5, 9, 5), L(2026, 11, 5, 9, 5)), L(2026, 11, 5), NOW)!;
    expect(seg.endMin - seg.startMin).toBe(POINT_MIN);
    const p = segmentForDay(point('p', L(2026, 11, 5, 9, 5)), L(2026, 11, 5), NOW)!;
    expect(p.endMin - p.startMin).toBe(POINT_MIN);
  });

  it('keeps an instant at 23:55 inside the day, at full height', () => {
    const p = segmentForDay(point('p', L(2026, 11, 5, 23, 55)), L(2026, 11, 5), NOW)!;
    expect([p.startMin, p.endMin]).toEqual([1440 - POINT_MIN, 1440]);
  });
});

describe('groupHourly / layoutDay', () => {
  const day = L(2026, 11, 5);
  const seg = (it: AgendaItem) => segmentForDay(it, day, NOW)!;

  it('merges 3+ chips of the same routine in one hour into ×N, but leaves two alone', () => {
    const sync = { id: 'sync', name: 'Sync', emoji: '' };
    const three = [5, 25, 45].map((m) => seg(point(`s${m}`, L(2026, 11, 5, 9, m), { routine: sync })));
    const two = [5, 25].map((m) => seg(point(`w${m}`, L(2026, 11, 5, 10, m), { routine: { id: 'w', name: 'W', emoji: '' } })));
    const out = groupHourly([...three, ...two]);
    expect(out.filter((e) => e.kind === 'group')).toHaveLength(1);
    expect(out.filter((e) => e.kind === 'item')).toHaveLength(2);
  });

  it('never merges workflow runs — each one is a different ticket', () => {
    const runs = [1, 2, 3].map((i) => seg(block(`r${i}`, L(2026, 11, 5, 9, i), L(2026, 11, 5, 9, i + 5))));
    expect(groupHourly(runs).every((e) => e.kind === 'item')).toBe(true);
  });

  const e = (startMin: number, endMin: number, id = `${startMin}-${endMin}`): GridEntry => ({
    kind: 'item', seg: { item: point(id, NOW), startMin, endMin, continuesBefore: false, continuesAfter: false, from: NOW, to: NOW },
    startMin, endMin, col: 0, cols: 1, span: 1,
  });

  it('gives overlapping entries side-by-side columns and a free slot back to a later one', () => {
    const out = layoutDay([e(540, 600), e(550, 620), e(610, 640), e(700, 720)]);
    expect(out.map((x) => [x.startMin, x.col, x.cols])).toEqual([[540, 0, 2], [550, 1, 2], [610, 0, 2], [700, 0, 1]]);
  });

  it('expands an entry to the right over the columns that stay free for its whole duration', () => {
    // A long block, two points side by side at 9:00, then one lone point at 10:00.
    const out = layoutDay([e(480, 720), e(540, 558), e(545, 563), e(600, 618)]);
    const at = (s: number) => out.find((x) => x.startMin === s)!;
    expect(at(480)).toMatchObject({ col: 0, span: 1, cols: 3 });
    expect(at(540)).toMatchObject({ col: 1, span: 1 });
    expect(at(545)).toMatchObject({ col: 2, span: 1 });
    // Nothing next to it at 10:00: it takes both right-hand columns.
    expect(at(600)).toMatchObject({ col: 1, span: 2 });
  });

  it('caps the visible columns and folds the rest into a "+N" chip in the last column', () => {
    const out = layoutDay([e(540, 600), e(541, 600), e(542, 600), e(543, 600), e(544, 600)], 3);
    expect(Math.max(...out.map((x) => x.col + x.span))).toBe(3);
    const more = out.filter((x) => x.kind === 'more');
    expect(more).toHaveLength(1);
    expect(more[0]).toMatchObject({ col: 2, span: 1, startMin: 542, endMin: 542 + POINT_MIN });
    expect(more[0]!.kind === 'more' && more[0]!.items).toHaveLength(3);
    expect(out.filter((x) => x.kind === 'item')).toHaveLength(2);
  });

  it('keeps a lone entry in the last column when it fits there', () => {
    const out = layoutDay([e(540, 600), e(541, 600), e(542, 560), e(543, 560), e(570, 588)], 3);
    expect(out.find((x) => x.startMin === 570)).toMatchObject({ kind: 'item', col: 2 });
    expect(out.find((x) => x.kind === 'more')!).toMatchObject({ col: 2 });
  });

  it('never draws one rectangle over another, even in a real burst', () => {
    // 4 overlapping workflow runs, 10 routine instants and a 4-hour block, on one morning.
    const runs = [0, 7, 15, 22].map((m) => block(`run${m}`, L(2026, 11, 5, 9, m), L(2026, 11, 5, 10, 30 + m)));
    const pts = Array.from({ length: 10 }, (_, i) => point(`pt${i}`, L(2026, 11, 5, 9, i * 6), { routine: { id: `r${i % 4}`, name: `R${i % 4}`, emoji: '' } }));
    const long = block('long', L(2026, 11, 5, 8, 0), L(2026, 11, 5, 12, 0), { type: 'routine.run' });
    const items = [...runs, ...pts, long];
    const drawn: number[] = [];
    for (const maxCols of [MAX_COLS.week, MAX_COLS.day]) {
      const out = layoutDay(groupHourly(items.map(seg)), maxCols);
      expect(Math.max(...out.map((x) => x.col + x.span))).toBeLessThanOrEqual(maxCols);
      for (const a of out) {
        for (const b of out) {
          if (a === b) continue;
          const sameTime = a.startMin < b.endMin && b.startMin < a.endMin;
          const sameCols = a.col < b.col + b.span && b.col < a.col + a.span;
          expect(sameTime && sameCols, `${a.kind}@${a.startMin}/c${a.col} vs ${b.kind}@${b.startMin}/c${b.col}`).toBe(false);
        }
      }
      // Nothing is lost: every item is drawn, grouped or behind a "+N".
      const shown = out.flatMap((x) => (x.kind === 'item' ? [x.seg.item.id] : x.items.map((i) => i.id)));
      expect(shown.sort()).toEqual(items.map((i) => i.id).sort());
      // The narrow Week column still folds the overflow; the Day view avoids it.
      if (maxCols === MAX_COLS.week) expect(out.some((x) => x.kind === 'more')).toBe(true);
      drawn.push(out.filter((x) => x.kind !== 'more').length);
    }
    // The Day view, wider, draws more of the burst before folding.
    expect(drawn[1]!).toBeGreaterThan(drawn[0]!);
  });
});

describe('assignLanes — workflow runs as thin bands', () => {
  const day = L(2026, 11, 5);
  it('gives each overlapping run its own lane and reuses a lane once it is free — never a "+N"', () => {
    const runs = [
      block('a', L(2026, 11, 5, 9, 0), L(2026, 11, 5, 11, 0)),
      block('b', L(2026, 11, 5, 9, 30), L(2026, 11, 5, 10, 0)),
      block('c', L(2026, 11, 5, 10, 15), L(2026, 11, 5, 10, 45)),
      block('d', L(2026, 11, 5, 9, 45), L(2026, 11, 5, 12, 0)),
      block('e', L(2026, 11, 5, 9, 50), L(2026, 11, 5, 10, 10)),
    ];
    const { lanes, placed } = assignLanes(runs.map((r) => segmentForDay(r, day, NOW)!));
    const lane = Object.fromEntries(placed.map((p) => [p.seg.item.id, p.lane]));
    expect(placed).toHaveLength(5);
    expect(lanes).toBe(4);
    expect(lane.c).toBe(lane.b); // b ended at 10:00, c starts at 10:15
  });

  it('keeps a run begun yesterday in today\'s lanes — it is never hidden in a group', () => {
    const run = block('y', L(2026, 11, 4, 22, 0), L(2026, 11, 5, 2, 0));
    expect(assignLanes([segmentForDay(run, L(2026, 11, 4), NOW)!]).lanes).toBe(1);
    expect(assignLanes([segmentForDay(run, day, NOW)!]).lanes).toBe(1);
  });
});

describe('filters and search', () => {
  const prefs = (over: Partial<AgendaPrefs>): AgendaPrefs => ({ ...DEFAULT_AGENDA_PREFS, ...over });
  const t = { id: 't', displayId: 642, title: 'vue agenda dans routines', boardId: 'fleex', status: 'doing', tags: ['ux'], epicIds: [], repos: [] };

  it('hides a label the user unchecked and a routine the user unchecked', () => {
    const r = point('x', NOW, { routine: { id: 'sync', name: 'Sync', emoji: '' } });
    expect(isVisible(r, prefs({}))).toBe(true);
    expect(isVisible(r, prefs({ labels: { 'routine.run': false } }))).toBe(false);
    expect(isVisible(r, prefs({ routines: { sync: false } }))).toBe(false);
  });

  it('applies the board filter to ticket items only — a routine run has no board and stays visible', () => {
    const p = prefs({ filters: { boards: ['odys'], epics: [], repos: [], tags: [] } });
    expect(isVisible(block('w', NOW, null, { ticket: t }), p)).toBe(false);
    expect(isVisible(point('r', NOW), p)).toBe(true);
  });

  it('agent runs: on by default, follow the board filter through their ticket, drawn as bands', () => {
    const a = block('a', NOW, null, { type: 'agent.run', ticket: t });
    expect(isVisible(a, prefs({}))).toBe(true);
    expect(isVisible(a, prefs({ labels: { 'agent.run': false } }))).toBe(false);
    expect(isVisible(a, prefs({ filters: { boards: ['odys'], epics: [], repos: [], tags: [] } }))).toBe(false);
    expect(isVisible(a, prefs({ filters: { boards: ['fleex'], epics: [], repos: [], tags: [] } }))).toBe(true);
    expect(isBand(a)).toBe(true);
    expect(isBand(point('r', NOW))).toBe(false);
  });

  it('finds every run of a ticket by its number', () => {
    expect(matchesQuery(block('w', NOW, null, { ticket: t, workflowName: 'Spec Dev PR (HITL)' }), '#642')).toBe(true);
    expect(matchesQuery(block('w', NOW, null, { ticket: t }), '643')).toBe(false);
  });
});

describe('formatting', () => {
  it('formats durations the way the popovers read them', () => {
    expect(formatDuration(18_000)).toBe('18 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration((4 * 60 + 32) * 60_000)).toBe('4 h 32');
    expect(formatDuration((43 * 60) * 60_000)).toBe('1 d 19 h');
  });

  it('drops the parenthesis from a workflow name', () => {
    expect(workflowShortName('Spec Dev PR (HITL)')).toBe('Spec Dev PR');
  });
});

describe('isoWeek — the numbers shown before each mini-calendar row', () => {
  it('matches Google Calendar and the "FW 2026-W45" epics', () => {
    expect(isoWeek(L(2026, 11, 2))).toBe(45); // Mon Nov 2
    expect(isoWeek(L(2026, 11, 8))).toBe(45); // Sun Nov 8 still belongs to Monday's week
    expect(isoWeek(L(2026, 10, 26))).toBe(44);
    expect(isoWeek(L(2026, 11, 30))).toBe(49);
  });
  it('handles year boundaries (ISO 8601)', () => {
    expect(isoWeek(L(2026, 1, 1))).toBe(1);    // Thu Jan 1 2026
    expect(isoWeek(L(2027, 1, 1))).toBe(53);   // Fri Jan 1 2027 → week 53 of 2026
    expect(isoWeek(L(2024, 12, 30))).toBe(1);  // Mon Dec 30 2024 → week 1 of 2025
  });
});
