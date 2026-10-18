import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { toast, useToastAnchor, useToastOffset } from './toast';
import { resetToasts, useToastStore } from '../stores/toastStore';

const visible = () => useToastStore.getState().toasts;

beforeEach(() => {
  vi.useFakeTimers();
  resetToasts();
});
afterEach(() => vi.useRealTimers());

describe('dedup', () => {
  it('drops a plain toast repeating a visible one — a dead server must not stack 6 identical errors', () => {
    const first = toast.error('Network error');
    const second = toast.error('Network error');
    expect(visible()).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('shows the same message again once the 10 s window has passed', () => {
    toast.show({ message: 'Saved', durationMs: null });
    vi.advanceTimersByTime(10_001);
    toast.show({ message: 'Saved', durationMs: null });
    expect(visible()).toHaveLength(2);
  });

  it('keeps every toast that carries an action — each Undo undoes its own change', () => {
    const first = { label: 'Undo', onClick: () => {} };
    const second = { label: 'Undo', onClick: () => {} };
    toast.info('“Untitled” deleted', { action: first });
    toast.info('“Untitled” deleted', { action: second });
    expect(visible()).toHaveLength(2);
    expect(visible()[1]!.action).toBe(second);
  });

  it('updates a toast in place when shown again with the same id (no duplicate)', () => {
    toast.show({ id: 'version-behind', message: '3 commits behind', durationMs: null });
    toast.show({ id: 'version-behind', message: '4 commits behind', durationMs: null });
    expect(visible().map((t) => t.message)).toEqual(['4 commits behind']);
    expect(visible()[0]!.version).toBe(2);
  });
});

describe('durations', () => {
  it.each([
    ['info', 5_000],
    ['success', 5_000],
    ['warning', 8_000],
    ['error', 8_000],
  ] as const)('%s auto-dismisses after %i ms', (tone, ms) => {
    toast[tone]('x');
    vi.advanceTimersByTime(ms - 1);
    expect(visible()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(visible()).toHaveLength(0);
  });

  it('gives an action toast at least 8 s so the Undo can be reached', () => {
    toast.success('Done', { action: { label: 'Undo', onClick: () => {} } });
    expect(visible()[0]!.durationMs).toBe(8_000);
  });

  it('an explicit duration wins, and null means persistent', () => {
    toast.info('Order updated', { durationMs: 1_800 });
    toast.show({ message: 'Fleex is behind', durationMs: null });
    vi.advanceTimersByTime(60_000);
    expect(visible().map((t) => t.message)).toEqual(['Fleex is behind']);
  });
});

describe('hover pause', () => {
  it('pauses the countdown while hovered and resumes with the time that was left', () => {
    const id = toast.info('x'); // 5 s
    vi.advanceTimersByTime(3_000);
    useToastStore.getState().pause(id);
    vi.advanceTimersByTime(30_000);
    expect(visible()).toHaveLength(1);
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(1_999);
    expect(visible()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(visible()).toHaveLength(0);
  });

  it('never pauses a pauseOnHover:false toast — the Focus undo timer runs regardless, the bar must not lie', () => {
    const id = toast.show({ message: 'Gate approuvée', durationMs: 5_000, pauseOnHover: false });
    useToastStore.getState().pause(id);
    vi.advanceTimersByTime(5_000);
    expect(visible()).toHaveLength(0);
  });
});

describe('stack', () => {
  it('keeps 3 visible at most, evicting the oldest with reason "programmatic"', () => {
    const onDismiss = vi.fn();
    toast.info('a', { onDismiss });
    toast.info('b');
    toast.info('c');
    toast.info('d');
    expect(visible().map((t) => t.message)).toEqual(['b', 'c', 'd']);
    expect(onDismiss).toHaveBeenCalledWith('programmatic');
  });

  it('reports why a toast left, so the version banner only remembers an explicit close', () => {
    const onDismiss = vi.fn();
    const id = toast.show({ message: 'x', durationMs: 1_000, onDismiss });
    vi.advanceTimersByTime(1_000);
    expect(onDismiss).toHaveBeenLastCalledWith('timeout');
    toast.dismiss(id); // already gone: no-op
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('layout hooks', () => {
  it('lifts the stack while an offset is mounted, last one wins, and restores on unmount', () => {
    const a = renderHook(() => useToastOffset(104));
    const b = renderHook(({ px }) => useToastOffset(px), { initialProps: { px: 64 } });
    expect(useToastStore.getState().offsets.at(-1)?.value).toBe(64);
    b.rerender({ px: 0 }); // e.g. ActionDetail no longer dirty
    expect(useToastStore.getState().offsets.at(-1)?.value).toBe(104);
    a.unmount();
    expect(useToastStore.getState().offsets).toEqual([]);
  });

  it('anchors the stack top while a sheet holds it', () => {
    const h = renderHook(({ a }) => useToastAnchor(a), { initialProps: { a: 'top' as 'top' | null } });
    expect(useToastStore.getState().anchors).toHaveLength(1);
    h.rerender({ a: null });
    expect(useToastStore.getState().anchors).toHaveLength(0);
  });
});
