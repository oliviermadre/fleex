import { describe, it, expect } from 'vitest';
import { pageStep, pickGesture } from './useSheetPager';

const both = { canPage: true, canDismiss: true };

describe('pickGesture', () => {
  it('pages on a sideways drag', () => {
    expect(pickGesture({ mx: -30, my: 5, ...both })).toBe('page');
    expect(pickGesture({ mx: 30, my: -5, ...both })).toBe('page');
  });

  it('dismisses on a drag down, never up', () => {
    expect(pickGesture({ mx: 3, my: 30, ...both })).toBe('dismiss');
    expect(pickGesture({ mx: 3, my: -30, ...both })).toBeNull();
  });

  it('leaves the gesture to the content where it needs it', () => {
    expect(pickGesture({ mx: -30, my: 0, canPage: false, canDismiss: true })).toBeNull();
    expect(pickGesture({ mx: 0, my: 30, canPage: true, canDismiss: false })).toBeNull();
  });
});

describe('pageStep', () => {
  const base = { pageWidth: 300, hasPrev: true, hasNext: true };

  it('stays for a short, slow drag', () => {
    expect(pageStep({ ...base, dx: -40, velocity: 0 })).toBe(0);
  });

  it('dragging left goes to the next sheet, right to the previous one', () => {
    expect(pageStep({ ...base, dx: -120, velocity: 0 })).toBe(1);
    expect(pageStep({ ...base, dx: 120, velocity: 0 })).toBe(-1);
  });

  it('goes nowhere past either end', () => {
    expect(pageStep({ ...base, hasNext: false, dx: -200, velocity: -1 })).toBe(0);
    expect(pageStep({ ...base, hasPrev: false, dx: 200, velocity: 1 })).toBe(0);
  });
});
