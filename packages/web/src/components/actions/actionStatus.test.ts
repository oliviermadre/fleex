import { describe, it, expect } from 'vitest';
import { compactBadge } from './actionStatus';

describe('compactBadge', () => {
  it('shortens big numbers so the corner tag never spills onto the next button', () => {
    expect(compactBadge('5000')).toBe('5k');
    expect(compactBadge('4932')).toBe('4.9k');
    expect(compactBadge('12500')).toBe('13k');
    expect(compactBadge('1250000')).toBe('1.3M');
  });

  it('leaves small numbers and non-numeric badges exactly as the probe sent them', () => {
    expect(compactBadge('999')).toBe('999');
    expect(compactBadge('✓')).toBe('✓');
    expect(compactBadge('2/2')).toBe('2/2');
    expect(compactBadge('4.9k')).toBe('4.9k');
  });
});
