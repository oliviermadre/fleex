import { describe, it, expect } from 'vitest';
import {
  CODE_TREE_DEFAULT_WIDTH,
  CODE_TREE_MAX_WIDTH,
  CODE_TREE_MIN_WIDTH,
  clampCodeTreeWidth,
} from './useCodeTreeWidth';

describe('clampCodeTreeWidth', () => {
  it('keeps widths within bounds as-is, rounded', () => {
    expect(clampCodeTreeWidth(320)).toBe(320);
    expect(clampCodeTreeWidth(320.6)).toBe(321);
  });

  it('clamps to the min and max', () => {
    expect(clampCodeTreeWidth(10)).toBe(CODE_TREE_MIN_WIDTH);
    expect(clampCodeTreeWidth(5000)).toBe(CODE_TREE_MAX_WIDTH);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampCodeTreeWidth(Number.NaN)).toBe(CODE_TREE_DEFAULT_WIDTH);
    expect(clampCodeTreeWidth(Number.POSITIVE_INFINITY)).toBe(CODE_TREE_DEFAULT_WIDTH);
  });
});
