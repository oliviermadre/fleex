import { describe, it, expect } from 'vitest';

import { costTier, formatTicketCost } from './cost';

describe('costTier', () => {
  // WHY: the ticket calibrated the tiers with INCLUSIVE upper bounds
  // ("jusqu'à 10$" ⇒ $10 is still yellow). A one-cent slip past a bound must
  // move the colour up — that boundary behaviour is the whole point of the code
  // and must be pinned so a later recalibration can't silently invert it.
  it('is green up to and including $5', () => {
    expect(costTier(0)).toMatchObject({ kind: 'tint', hue: 'green' });
    expect(costTier(3.47)).toMatchObject({ kind: 'tint', hue: 'green' });
    expect(costTier(5)).toMatchObject({ kind: 'tint', hue: 'green' });
  });

  it('is yellow from just over $5 up to and including $10', () => {
    expect(costTier(5.01)).toMatchObject({ kind: 'tint', hue: 'yellow' });
    expect(costTier(10)).toMatchObject({ kind: 'tint', hue: 'yellow' });
  });

  it('is red from just over $10 up to and including $50', () => {
    expect(costTier(10.01)).toMatchObject({ kind: 'tint', hue: 'red' });
    expect(costTier(50)).toMatchObject({ kind: 'tint', hue: 'red' });
  });

  it('is the near-black inline style above $50', () => {
    const tier = costTier(50.01);
    expect(tier.kind).toBe('style');
    if (tier.kind === 'style') {
      expect(tier.bg).toBe('#450a0a');
      expect(tier.fg).toBe('#fecaca');
    }
  });
});

describe('formatTicketCost', () => {
  it('always renders exactly 2 decimals with a $ prefix', () => {
    expect(formatTicketCost(12.8)).toBe('$12.80');
    expect(formatTicketCost(0.05)).toBe('$0.05');
    expect(formatTicketCost(3.47)).toBe('$3.47');
    expect(formatTicketCost(85)).toBe('$85.00');
  });
});
