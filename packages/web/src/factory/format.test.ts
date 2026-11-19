import { describe, it, expect } from 'vitest';
import { money, since, span } from './format';

describe('factory format', () => {
  it('writes money short', () => {
    expect(money(0)).toBe('$0');
    expect(money(0.004)).toBe('<$0.01');
    expect(money(1.239)).toBe('$1.24');
    expect(money(1234.5)).toBe('$1,235');
  });
  it('writes a duration with the two units that matter', () => {
    expect(span(null)).toBe('–');
    expect(span(42_000)).toBe('42s');
    expect(span(7 * 60_000 + 20_000)).toBe('7m');
    expect(span(65 * 60_000)).toBe('1h 05m');
    expect(span(76 * 3_600_000)).toBe('3d 4h');
  });
  it('measures since a date, never below zero', () => {
    expect(since('2026-11-15T10:00:00.000Z', '2026-11-15T10:05:00.000Z')).toBe(300_000);
    expect(since('2026-11-15T10:05:00.000Z', '2026-11-15T10:00:00.000Z')).toBe(0);
    expect(since('nope', '2026-11-15T10:00:00.000Z')).toBe(0);
  });
});
