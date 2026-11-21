import { appWs } from '../services/websocket';
import { useFactoryStore } from './factoryStore';
import type { FactoryPatch } from './types';

/**
 * Keeps the floor held in the store up to date while something shows it.
 *
 * Over the WS, the server pushes what changes (`factory` channel, `factory:patch`, every half second at most) and the
 * store applies it. The whole floor is still read now and then, in case something was missed and nothing told the
 * page: when the WS (re)connects, when the window comes back in front, after a gap in the patches, and every
 * `FULL_RELOAD_MS`. Without the WS, the floor is polled as before, at the pace each watcher asks for.
 */
export const FULL_RELOAD_MS = 60_000;

const watchers = new Set<() => number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let unhook: (() => void)[] = [];

const read = () => { if (typeof document === 'undefined' || !document.hidden) void useFactoryStore.getState().refresh(); };

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!watchers.size) return;
  const ms = appWs.connected ? FULL_RELOAD_MS : Math.min(...[...watchers].map((f) => f()));
  timer = setTimeout(() => { read(); schedule(); }, ms);
}

/** Read the whole floor now, and count the next full read from now. */
const readNow = () => { read(); schedule(); };
const subscribe = () => appWs.sendChannel('factory', { action: 'subscribe' });

/**
 * Watch the floor while mounted: `fallbackMs` is how often to poll it when the WS is down (asked at each poll, so it
 * may follow the window's focus). Returns the function that stops watching.
 */
export function watchFactory(fallbackMs: () => number): () => void {
  const mine = () => fallbackMs();
  watchers.add(mine);
  if (watchers.size === 1) {
    const onFocus = () => readNow();
    window.addEventListener('focus', onFocus);
    unhook = [
      appWs.onChannel('factory', (m) => { if (m.type === 'factory:patch') useFactoryStore.getState().applyPatch(m.data as FactoryPatch); }),
      /* a new connection holds no subscription: ask again, and read what happened while it was down */
      appWs.onOpen(() => { subscribe(); readNow(); }),
      appWs.onClose(() => schedule()),
      () => window.removeEventListener('focus', onFocus),
    ];
    if (appWs.connected) subscribe();
  }
  readNow();
  return () => {
    if (!watchers.delete(mine)) return;
    if (watchers.size) { schedule(); return; }
    if (timer) clearTimeout(timer);
    timer = null;
    for (const off of unhook) off();
    unhook = [];
    if (appWs.connected) appWs.sendChannel('factory', { action: 'unsubscribe' });
  };
}
