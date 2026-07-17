import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatAge } from './formatAge';

/**
 * Compact age formatting. Extended for the cockpit activity column (#400,
 * pass 4, remark 5): NaS spec'd "idle since {{time}}" with units
 * "1s, 1m, 1h, 1d, 1w, ..." — so ages ≥ 7 days must roll up into weeks.
 */

const NOW = new Date('2026-07-17T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('formats seconds, minutes, hours and days with floor semantics', () => {
    expect(formatAge(ago(5 * SEC))).toBe('5s');
    expect(formatAge(ago(90 * SEC))).toBe('1m');
    expect(formatAge(ago(3 * HOUR + 20 * MIN))).toBe('3h');
    expect(formatAge(ago(2 * DAY + 5 * HOUR))).toBe('2d');
  });

  it('rolls 7+ days into weeks (pass 4, remark 5: "1s, 1m, 1h, 1d, 1w, ...")', () => {
    expect(formatAge(ago(6 * DAY))).toBe('6d'); // below the week threshold
    expect(formatAge(ago(7 * DAY))).toBe('1w');
    expect(formatAge(ago(13 * DAY))).toBe('1w'); // floor, not round
    expect(formatAge(ago(30 * DAY))).toBe('4w');
  });

  it('clamps future dates to 0s', () => {
    expect(formatAge(ago(-5 * SEC))).toBe('0s');
  });

  it('accepts an explicit now so a live ticker can drive it (pass 5)', () => {
    // WHY: the cockpit badge re-renders every second off a shared clock; the
    // formatter must compute against THAT clock, not its own Date.now() call,
    // so a tick and its label can never disagree.
    const t0 = NOW.getTime();
    expect(formatAge(ago(5 * SEC), t0 + 1 * SEC)).toBe('6s');
    // Unit rollover: 59s + 2s must read "1m", never "61s".
    expect(formatAge(ago(59 * SEC), t0 + 2 * SEC)).toBe('1m');
  });
});
