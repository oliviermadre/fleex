import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime } from './relativeTime';

// Fixed "now" so every case is deterministic.
const NOW = new Date('2026-07-06T12:00:00.000Z').getTime();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Build an ISO string that is `ms` before the frozen NOW. */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeTime — verbose (default)', () => {
  it('says "just now" under a minute', () => {
    expect(formatRelativeTime(ago(0))).toBe('just now');
    expect(formatRelativeTime(ago(30 * SECOND))).toBe('just now');
    expect(formatRelativeTime(ago(59 * SECOND))).toBe('just now');
  });

  it('switches to minutes at exactly one minute', () => {
    expect(formatRelativeTime(ago(MINUTE))).toBe('1m ago');
    expect(formatRelativeTime(ago(5 * MINUTE))).toBe('5m ago');
    expect(formatRelativeTime(ago(59 * MINUTE))).toBe('59m ago');
  });

  it('switches to hours at exactly one hour', () => {
    expect(formatRelativeTime(ago(HOUR))).toBe('1h ago');
    expect(formatRelativeTime(ago(3 * HOUR))).toBe('3h ago');
    expect(formatRelativeTime(ago(23 * HOUR))).toBe('23h ago');
  });

  it('switches to days at exactly one day', () => {
    expect(formatRelativeTime(ago(DAY))).toBe('1d ago');
    expect(formatRelativeTime(ago(2 * DAY))).toBe('2d ago');
  });

  it('keeps counting days past a month when maxUnit stays "day" (default)', () => {
    expect(formatRelativeTime(ago(30 * DAY))).toBe('30d ago');
    expect(formatRelativeTime(ago(45 * DAY))).toBe('45d ago');
  });
});

describe('formatRelativeTime — compact style', () => {
  it('has no "just now"; renders 0m under a minute', () => {
    expect(formatRelativeTime(ago(0), 'compact')).toBe('0m');
    expect(formatRelativeTime(ago(30 * SECOND), 'compact')).toBe('0m');
  });

  it('drops the " ago" suffix', () => {
    expect(formatRelativeTime(ago(5 * MINUTE), 'compact')).toBe('5m');
    expect(formatRelativeTime(ago(3 * HOUR), 'compact')).toBe('3h');
    expect(formatRelativeTime(ago(2 * DAY), 'compact')).toBe('2d');
  });

  it('accepts the equivalent options object form', () => {
    expect(formatRelativeTime(ago(5 * MINUTE), { style: 'compact' })).toBe('5m');
  });
});

describe('formatRelativeTime — maxUnit "month"', () => {
  it('rolls days into months at exactly 30 days (verbose)', () => {
    expect(formatRelativeTime(ago(29 * DAY), { maxUnit: 'month' })).toBe('29d ago');
    expect(formatRelativeTime(ago(30 * DAY), { maxUnit: 'month' })).toBe('1mo ago');
    expect(formatRelativeTime(ago(60 * DAY), { maxUnit: 'month' })).toBe('2mo ago');
  });
});

describe('formatRelativeTime — input types', () => {
  it('accepts a Date', () => {
    expect(formatRelativeTime(new Date(NOW - 3 * HOUR))).toBe('3h ago');
  });

  it('accepts epoch milliseconds', () => {
    expect(formatRelativeTime(NOW - 3 * HOUR)).toBe('3h ago');
  });

  it('accepts an ISO string', () => {
    expect(formatRelativeTime(new Date(NOW - 3 * HOUR).toISOString())).toBe('3h ago');
  });
});
