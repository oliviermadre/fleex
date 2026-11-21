import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ws = vi.hoisted(() => {
  const handlers = { channel: new Map<string, (m: { type: string; data: unknown }) => void>(), open: new Set<() => void>(), close: new Set<() => void>() };
  return {
    handlers, sent: [] as unknown[], connected: true,
    reset() { this.sent.length = 0; this.connected = true; handlers.channel.clear(); handlers.open.clear(); handlers.close.clear(); },
  };
});
vi.mock('../services/websocket', () => ({
  appWs: {
    get connected() { return ws.connected; },
    sendChannel: (channel: string, data: Record<string, unknown>) => { ws.sent.push({ channel, ...data }); },
    onChannel: (c: string, h: (m: { type: string; data: unknown }) => void) => { ws.handlers.channel.set(c, h); return () => ws.handlers.channel.delete(c); },
    onOpen: (h: () => void) => { ws.handlers.open.add(h); return () => ws.handlers.open.delete(h); },
    onClose: (h: () => void) => { ws.handlers.close.add(h); return () => ws.handlers.close.delete(h); },
  },
}));

import { FULL_RELOAD_MS, watchFactory } from './factoryLive';
import { useFactoryStore } from './factoryStore';

let refreshes = 0;
const patches: unknown[] = [];
beforeEach(() => {
  vi.useFakeTimers(); ws.reset(); refreshes = 0; patches.length = 0;
  useFactoryStore.setState({ refresh: async () => { refreshes++; }, applyPatch: (p) => { patches.push(p); } });
});
afterEach(() => { vi.useRealTimers(); });

describe('watchFactory', () => {
  it('subscribes once, reads the floor, and hands the patches to the store', () => {
    const stopA = watchFactory(() => 600), stopB = watchFactory(() => 4000);
    expect(ws.sent).toEqual([{ channel: 'factory', action: 'subscribe' }]);
    expect(refreshes).toBe(2);
    ws.handlers.channel.get('factory')!({ type: 'factory:patch', data: { seq: 1 } });
    expect(patches).toEqual([{ seq: 1 }]);
    stopA(); expect(ws.sent).toHaveLength(1);
    stopB(); expect(ws.sent.at(-1)).toEqual({ channel: 'factory', action: 'unsubscribe' });
    expect(ws.handlers.channel.size).toBe(0);
  });

  it('with the WS up, reads the whole floor only every FULL_RELOAD_MS', () => {
    const stop = watchFactory(() => 600);
    refreshes = 0;
    vi.advanceTimersByTime(FULL_RELOAD_MS - 1); expect(refreshes).toBe(0);
    vi.advanceTimersByTime(1); expect(refreshes).toBe(1);
    stop();
  });

  it('polls at the fastest pace asked for while the WS is down, and catches up when it comes back', () => {
    ws.connected = false;
    const stopA = watchFactory(() => 600), stopB = watchFactory(() => 4000);
    expect(ws.sent).toEqual([]);                       // nothing to subscribe on
    refreshes = 0;
    vi.advanceTimersByTime(1200); expect(refreshes).toBe(2);
    ws.connected = true;
    for (const h of ws.handlers.open) h();
    expect(ws.sent).toEqual([{ channel: 'factory', action: 'subscribe' }]);
    expect(refreshes).toBe(3);
    vi.advanceTimersByTime(5000); expect(refreshes).toBe(3);
    ws.connected = false;
    for (const h of ws.handlers.close) h();
    vi.advanceTimersByTime(600); expect(refreshes).toBe(4);
    stopA(); stopB();
    vi.advanceTimersByTime(FULL_RELOAD_MS); expect(refreshes).toBe(4);
  });
});
