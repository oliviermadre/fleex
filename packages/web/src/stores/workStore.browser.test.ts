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

describe('useBrowserTakesCenter', () => {
  it('is true only for an expanded browser panel in the desktop shell', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useWorkStore, useBrowserTakesCenter } = await import('./workStore');
    const { useBrowserStore } = await import('./browserStore');
    const run = () => renderHook(() => useBrowserTakesCenter()).result.current;
    (window as { fleexDesktop?: unknown }).fleexDesktop = {};
    useWorkStore.getState().setRightPanel('browser');
    useBrowserStore.setState({ expanded: true });
    expect(run()).toBe(true);
    useBrowserStore.setState({ expanded: false });
    expect(run()).toBe(false);
    useBrowserStore.setState({ expanded: true });
    useWorkStore.getState().setRightPanel('diff');
    expect(run()).toBe(false);
    useWorkStore.getState().setRightPanel('browser');
    delete (window as { fleexDesktop?: unknown }).fleexDesktop;
    expect(run()).toBe(false);
    useBrowserStore.setState({ expanded: false });
  });
});
