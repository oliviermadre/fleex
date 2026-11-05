import { describe, it, expect } from 'vitest';
import type { AgendaItem, AgendaPrefs } from '@fleex/shared';
import { DEFAULT_AGENDA_PREFS } from '@fleex/shared';
import {
  windowFor, shiftAnchor, daysCovered, isBar, itemDays, segmentForDay, groupHourly, layoutDay,
  isVisible, matchesQuery, formatDuration, workflowShortName, dayKey,
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
  it('cuts a 2-day block at midnight: one piece per column, flagged ↓ then ↑', () => {
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

  it('does not spill a block that ends at 00:00 sharp onto the next day', () => {
    const b = block('r', L(2026, 11, 4, 21, 0), L(2026, 11, 5, 0, 0));
    expect(daysCovered(b, NOW)).toBe(1);
    expect(segmentForDay(b, L(2026, 11, 5), NOW)).toBeNull();
  });

  it('grows a running block up to now', () => {
    const seg = segmentForDay(block('r', L(2026, 11, 5, 8, 54), null), L(2026, 11, 5), NOW)!;
    expect(seg.endMin).toBe(11 * 60 + 30);
  });

  it('keeps a 3-second run tall enough to click', () => {
    const seg = segmentForDay(block('r', L(2026, 11, 5, 9, 5), L(2026, 11, 5, 9, 5)), L(2026, 11, 5), NOW)!;
    expect(seg.endMin - seg.startMin).toBeGreaterThanOrEqual(20);
  });
});

describe('groupHourly / layoutDay', () => {
  const day = L(2026, 11, 5);
  const seg = (it: AgendaItem) => segmentForDay(it, day, NOW)!;

  it('merges 3+ chips of the same routine in one hour into ×N, but leaves two alone', () => {
    const sync = { id: 'sync', name: 'Sync', emoji: '🔄' };
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

  it('gives overlapping entries distinct columns and a free slot back to a later one', () => {
    const e = (startMin: number, endMin: number) => ({ startMin, endMin, col: 0, cols: 1 });
    const out = layoutDay([e(540, 600), e(550, 620), e(610, 640), e(700, 720)]);
    expect(out.map((x) => [x.col, x.cols])).toEqual([[0, 2], [1, 2], [0, 2], [0, 1]]);
  });
});

describe('filters and search', () => {
  const prefs = (over: Partial<AgendaPrefs>): AgendaPrefs => ({ ...DEFAULT_AGENDA_PREFS, ...over });
  const t = { id: 't', displayId: 642, title: 'vue agenda dans routines', boardId: 'fleex', status: 'doing', tags: ['ux'] };

  it('hides a label the user unchecked and a routine the user unchecked', () => {
    const r = point('x', NOW, { routine: { id: 'sync', name: 'Sync', emoji: '' } });
    expect(isVisible(r, prefs({}))).toBe(true);
    expect(isVisible(r, prefs({ labels: { 'routine.run': false } }))).toBe(false);
    expect(isVisible(r, prefs({ routines: { sync: false } }))).toBe(false);
  });

  it('applies the board filter to ticket items only — a routine run has no board and stays visible', () => {
    const p = prefs({ filters: { boards: ['odys'], tags: [] } });
    expect(isVisible(block('w', NOW, null, { ticket: t }), p)).toBe(false);
    expect(isVisible(point('r', NOW), p)).toBe(true);
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
