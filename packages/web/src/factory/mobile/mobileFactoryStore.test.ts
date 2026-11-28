import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../../stores/toastStore';
import { resetMobileFactory, UNDO_MS, useMobileFactoryStore } from './mobileFactoryStore';

const store = () => useMobileFactoryStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => { vi.useFakeTimers(); resetMobileFactory(); useToastStore.setState({ toasts: [] }); });
afterEach(() => { resetMobileFactory(); vi.useRealTimers(); });

describe('the undo window of a gesture on the floor', () => {
  it('hides what it acts on at once, and sends nothing before the window closes', async () => {
    const run = vi.fn(async () => {});
    store().commit('t1', '#1 leaves the gate as approve', run);
    expect(store().pending.t1?.label).toBe('#1 leaves the gate as approve');
    expect(toasts()).toEqual(['#1 leaves the gate as approve']);
    await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(store().pending.t1).toBeUndefined();          // once the floor has answered
    expect(toasts()).toEqual([]);
  });

  it('is taken back by Undo: nothing is ever sent', async () => {
    const run = vi.fn();
    store().commit('t1', 'gone', run);
    useToastStore.getState().toasts[0]!.action!.onClick();
    expect(store().pending).toEqual({});
    expect(toasts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(UNDO_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });

  it('takes one gesture a ticket at a time, and keeps the ticket hidden while its request is on its way', async () => {
    let done = () => {};
    const first = vi.fn(() => new Promise<void>((ok) => { done = ok; })), second = vi.fn();
    store().commit('t1', 'first', first);
    store().commit('t1', 'second', second);
    expect(store().pending.t1?.label).toBe('first');
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(first).toHaveBeenCalled();
    expect(store().pending.t1).toBeDefined();            // sent, not yet answered
    done(); await vi.advanceTimersByTimeAsync(0);
    expect(store().pending.t1).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
  });

  it('sends what still waits when the page goes away, and frees the ticket even when the request fails', async () => {
    const a = vi.fn(async () => {}), b = vi.fn(async () => { throw new Error('refused'); });
    store().commit('t1', 'a', a); store().commit('t2', 'b', b);
    store().flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
    expect(store().pending).toEqual({});
    await vi.advanceTimersByTimeAsync(UNDO_MS);          // their timers are gone: not sent twice
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe('where one is in the Factory on the phone', () => {
  it('takes a ticket in hand on the map, and lets go of it when the map is left', () => {
    store().take('t9');
    expect(store()).toMatchObject({ open: true, tab: 'map', hand: 't9' });
    store().setTab('tickets');
    expect(store().hand).toBeNull();
  });

  it('opens the map on a ticket asked for from its screen, until the map has gone to it', () => {
    store().take('t9');
    store().showOnMap('t3');
    expect(store()).toMatchObject({ open: true, tab: 'map', hand: null, goTo: 't3' });
    store().arrived();
    expect(store().goTo).toBeNull();
  });

  it('remembers that the Factory was open, and its screen, for a reload', () => {
    store().setOpen(true); store().setTab('map');
    expect(JSON.parse(localStorage.getItem('fleex:mobile-factory')!)).toMatchObject({ open: true, tab: 'map' });
    store().setOpen(false);
    expect(JSON.parse(localStorage.getItem('fleex:mobile-factory')!)).toMatchObject({ open: false });
  });
});
