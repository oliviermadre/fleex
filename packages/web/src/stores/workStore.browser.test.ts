import { describe, it, expect } from 'vitest';
import { effectiveRightPanel } from './workStore';

describe('effectiveRightPanel', () => {
  it('drops the browser panel outside the desktop shell', () => {
    expect(effectiveRightPanel('browser', false)).toBeNull();
    expect(effectiveRightPanel('browser', true)).toBe('browser');
    expect(effectiveRightPanel('diff', false)).toBe('diff');
  });
});
