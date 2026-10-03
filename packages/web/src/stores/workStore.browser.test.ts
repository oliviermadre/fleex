import { describe, it, expect } from 'vitest';
import { effectiveRightPanel } from './workStore';

describe('effectiveRightPanel', () => {
  it('drops the browser panel outside the desktop shell', () => {
    expect(effectiveRightPanel('browser', false)).toBeNull();
    expect(effectiveRightPanel('browser', true)).toBe('browser');
    expect(effectiveRightPanel('diff', false)).toBe('diff');
  });
});

describe('useEffectiveRightPanel', () => {
  it('reads a remembered browser panel as no panel outside the desktop shell', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useWorkStore, useEffectiveRightPanel } = await import('./workStore');
    useWorkStore.getState().setRightPanel('browser');
    delete (window as { fleexDesktop?: unknown }).fleexDesktop;
    expect(renderHook(() => useEffectiveRightPanel()).result.current).toBeNull();
    (window as { fleexDesktop?: unknown }).fleexDesktop = {};
    expect(renderHook(() => useEffectiveRightPanel()).result.current).toBe('browser');
    delete (window as { fleexDesktop?: unknown }).fleexDesktop;
  });
});
