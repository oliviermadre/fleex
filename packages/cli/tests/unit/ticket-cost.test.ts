import { describe, it, expect } from 'vitest';
import { costTier, formatCostUsd } from '../../src/commands/ticket/_shared.ts';

// The CLI cost display (#404) must stay faithful to the Kanban card badge:
// same thresholds, same $X.XX shape — so `fleex ticket show` and the board
// never disagree on a ticket's tier.
describe('costTier', () => {
  it('is green for zero and small costs (≤ $5)', () => {
    expect(costTier(0)).toBe('green');
    expect(costTier(4.99)).toBe('green');
    expect(costTier(5)).toBe('green'); // bound is inclusive
  });

  it('is yellow just above $5 up to $10 inclusive', () => {
    expect(costTier(5.01)).toBe('yellow');
    expect(costTier(10)).toBe('yellow');
  });

  it('is red just above $10 up to $50 inclusive', () => {
    expect(costTier(10.01)).toBe('red');
    expect(costTier(50)).toBe('red');
  });

  it('is critical only beyond $50', () => {
    expect(costTier(50.01)).toBe('critical');
    expect(costTier(1000)).toBe('critical');
  });
});

describe('formatCostUsd', () => {
  it('always renders two decimals with a $ prefix', () => {
    expect(formatCostUsd(0)).toBe('$0.00');
    expect(formatCostUsd(0.05)).toBe('$0.05');
    expect(formatCostUsd(12.8)).toBe('$12.80');
    expect(formatCostUsd(1234.5)).toBe('$1234.50');
  });
});
