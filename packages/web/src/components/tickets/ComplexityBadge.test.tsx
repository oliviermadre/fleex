import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TICKET_COMPLEXITIES } from '@fleex/shared';
import { ComplexityBadge, DIAL_FILL } from './ComplexityBadge';

afterEach(cleanup);

/** The filled arc's length out of 100, or 0 when no arc is drawn. */
function arcPercent(container: HTMLElement): number {
  const arc = container.querySelector('circle[pathLength]');
  return arc ? Number(arc.getAttribute('stroke-dasharray')!.split(' ')[0]) : 0;
}

describe('ComplexityBadge dial', () => {
  // The arc lets you compare two tickets at a glance: bigger value, more arc — never less.
  it('fills more for every step up the scale, empty at 0 and full at ∞', () => {
    const fills = TICKET_COMPLEXITIES.map((c) => DIAL_FILL[c]);
    fills.slice(1).forEach((f, i) => expect(f).toBeGreaterThan(fills[i]!));
    expect(DIAL_FILL['0']).toBe(0);
    expect(DIAL_FILL.inf).toBe(1);
  });

  it('draws the agreed share of the dial (5 = a quarter, 13 = 65%)', () => {
    expect(arcPercent(render(<ComplexityBadge complexity="5" />).container)).toBeCloseTo(25);
    cleanup();
    expect(arcPercent(render(<ComplexityBadge complexity="13" />).container)).toBeCloseTo(65);
  });

  it('draws no arc for 0 nor for a ticket not estimated yet', () => {
    expect(arcPercent(render(<ComplexityBadge complexity="0" />).container)).toBe(0);
    cleanup();
    expect(arcPercent(render(<ComplexityBadge complexity={null} />).container)).toBe(0);
  });
});
