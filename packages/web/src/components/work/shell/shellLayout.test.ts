import { describe, it, expect } from 'vitest';
import { paneCount } from './shellLayout';

describe('paneCount', () => {
  it('maps each layout to its number of panes', () => {
    expect(paneCount('1')).toBe(1);
    expect(paneCount('cols')).toBe(2);
    expect(paneCount('rows')).toBe(2);
    expect(paneCount('three')).toBe(3);
    expect(paneCount('grid')).toBe(4);
  });
});
