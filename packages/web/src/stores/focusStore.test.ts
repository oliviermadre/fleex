import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FocusItem } from '@fleex/shared';

vi.mock('../services/api', () => ({
  fetchFocus: vi.fn(),
}));

import * as api from '../services/api';
import { UNDO_MS, focusStats, median, useFocusStore, visibleFocusItems } from './focusStore';

function item(key: string, over: Partial<FocusItem> = {}): FocusItem {
  return {
    key, kind: 'gate', ticketId: `t-${key}`, since: new Date(Date.now() - 60_000).toISOString(),
    workflow: null, gate: null, question: null, error: null, idle: null, lastAgentComment: null, costUsd: 0,
    ...over,
  };
}

const PREFS = { zen: false, chain: true, showIdle: true };

describe('focusStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useFocusStore.setState({
      items: [item('a'), item('b')], runningTicketIds: [], loaded: true,
      pending: {}, settled: {}, snoozed: {}, log: [], clearedAt: [], prefs: PREFS,
    });
    vi.mocked(api.fetchFocus).mockResolvedValue({ items: [], runningTicketIds: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const visible = () => visibleFocusItems(useFocusStore.getState(), Date.now()).map((i) => i.key);

  it('hides a committed item at once but only runs the action after the undo window', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    useFocusStore.getState().commit(item('a'), 'done', run);
    expect(visible()).toEqual(['b']);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(run).toHaveBeenCalledTimes(1);
    // Still hidden (settled) until a refetch confirms the server dropped it.
    expect(visible()).toEqual(['b']);
    expect(useFocusStore.getState().log).toHaveLength(1);
  });

  it('undo cancels the action and brings the row back', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    useFocusStore.getState().commit(item('a'), 'done', run);
    useFocusStore.getState().undo('a');
    await vi.advanceTimersByTimeAsync(UNDO_MS * 2);
    expect(run).not.toHaveBeenCalled();
    expect(visible()).toEqual(['a', 'b']);
  });

  it('brings the row back when the action fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('API error 409: gone'));
    useFocusStore.getState().commit(item('a'), 'done', run);
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(visible()).toEqual(['a', 'b']);
    expect(useFocusStore.getState().log).toHaveLength(0);
  });

  it('flushPending fires pending actions right away (page going away)', () => {
    const run = vi.fn().mockResolvedValue(undefined);
    useFocusStore.getState().commit(item('a'), 'done', run);
    useFocusStore.getState().flushPending();
    expect(run).toHaveBeenCalledTimes(1);
    expect(useFocusStore.getState().pending).toEqual({});
  });

  it('drops a settled key once the server no longer reports it', async () => {
    useFocusStore.setState({ settled: { a: Date.now() + 30_000 } });
    vi.mocked(api.fetchFocus).mockResolvedValue({ items: [item('b')], runningTicketIds: [] });
    await useFocusStore.getState().load();
    expect(useFocusStore.getState().settled).toEqual({});
  });

  it('counts an emptied list', async () => {
    useFocusStore.setState({ items: [item('a')] });
    useFocusStore.getState().commit(item('a'), 'done', () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(useFocusStore.getState().clearedAt).toHaveLength(1);
  });

  it('snoozes by reason key until the given time, and persists it', () => {
    useFocusStore.getState().snooze('a', Date.now() + 3600_000);
    expect(visible()).toEqual(['b']);
    expect(JSON.parse(localStorage.getItem('fleex_focus_snoozed')!)).toHaveProperty('a');
    vi.advanceTimersByTime(3600_001);
    expect(visible()).toEqual(['a', 'b']);
  });

  it('can leave idle tickets out', () => {
    useFocusStore.setState({ items: [item('a'), item('i', { kind: 'idle' })] });
    expect(visible()).toEqual(['a', 'i']);
    useFocusStore.getState().setPref('showIdle', false);
    expect(visible()).toEqual(['a']);
  });
});

describe('focus stats', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('summarises today and the last 7 days', () => {
    const now = new Date('2026-09-28T15:00:00').getTime();
    const today = new Date('2026-09-28T10:00:00').getTime();
    const yesterday = new Date('2026-09-27T10:00:00').getTime();
    const s = focusStats(
      [{ at: today, waitedMs: 60_000 }, { at: today, waitedMs: 180_000 }, { at: yesterday, waitedMs: 600_000 }, { at: today, waitedMs: null }],
      [today, now - 10 * 24 * 3600_000],
      now,
    );
    expect(s.handledToday).toBe(3);
    expect(s.medianTodayMs).toBe(120_000);
    expect(s.medianByDayMs).toHaveLength(7);
    expect(s.medianByDayMs[6]).toBe(120_000);
    expect(s.medianByDayMs[5]).toBe(600_000);
    expect(s.medianByDayMs[0]).toBeNull();
    expect(s.clearedThisWeek).toBe(1);
  });
});
