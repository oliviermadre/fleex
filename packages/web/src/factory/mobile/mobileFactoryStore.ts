import { create } from 'zustand';
import { toast } from '../../lib/toast';

/**
 * The Factory on a phone (see `docs/mobile.md`): a mode of its own in the mobile shell, with two screens, Tickets
 * and Map. This store holds where one is in it, the ticket taken in hand on the map, and the gestures that wait out
 * their undo window.
 *
 * **The undo window.** A gesture hides what it acts on at once, but its request only leaves after `UNDO_MS`: what the
 * floor does next (a gate's decision, a release, a run stopped) cannot be taken back on the server, so "Undo" has to
 * come before it is sent. As in Focus on the phone (`focusStore`). What still waits is sent when the page goes away.
 */
export const UNDO_MS = 5000;
export type FactoryTab = 'tickets' | 'map';
export type FactoryList = 'needs' | 'all';

interface Pending { label: string; timer: ReturnType<typeof setTimeout>; run: () => Promise<unknown> | void }

interface MobileFactoryState {
  /** The phone shows the Factory instead of Fleex's own tabs. */
  open: boolean;
  tab: FactoryTab;
  list: FactoryList;
  /** The ticket taken in hand: the map waits to be told where it goes. */
  hand: string | null;
  /** The ticket the map goes to when it next shows. */
  goTo: string | null;
  /** Gestures waiting out their undo window, by what they act on (a ticket's id, a zone's). */
  pending: Record<string, Pending>;
  setOpen: (open: boolean) => void;
  setTab: (tab: FactoryTab) => void;
  setList: (list: FactoryList) => void;
  /** Take a ticket in hand: the map opens, waiting for where it goes. */
  take: (ticketId: string) => void;
  letGo: () => void;
  /** Open the map on a ticket. */
  showOnMap: (ticketId: string) => void;
  arrived: () => void;
  /** Hide what `key` names now and run `run` once the undo window closes. One gesture a key at a time. */
  commit: (key: string, label: string, run: () => Promise<unknown> | void) => void;
  undo: (key: string) => void;
  /** Send every gesture that waits now (the page is going away). */
  flush: () => void;
}

// ── Survive a reload ── as the rest of the mobile shell does (`mobileNavStore`): iOS evicts a web app in the
// background, and one must come back to the Factory, not to Focus.
const KEY = 'fleex:mobile-factory', RESTORE_TTL_MS = 6 * 3600_000;
function restored(now = Date.now()): { open: boolean; tab: FactoryTab } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { open?: boolean; tab?: FactoryTab; at?: number } | null;
    if (saved && typeof saved.at === 'number' && now - saved.at <= RESTORE_TTL_MS) return { open: saved.open === true, tab: saved.tab === 'map' ? 'map' : 'tickets' };
  } catch { /* private mode: coming back to Focus is fine */ }
  return { open: false, tab: 'tickets' };
}
const save = (s: { open: boolean; tab: FactoryTab }) => { try { localStorage.setItem(KEY, JSON.stringify({ open: s.open, tab: s.tab, at: Date.now() })); } catch { /* a nicety */ } };

const undoId = (key: string) => `factory:${key}`;

export const useMobileFactoryStore = create<MobileFactoryState>((set, get) => {
  const execute = (key: string) => {
    const p = get().pending[key];
    if (!p) return;
    clearTimeout(p.timer);
    toast.dismiss(undoId(key));
    /* it stays hidden until the floor says what became of it: the request's own answer brings the new floor */
    void Promise.resolve().then(p.run).catch(() => { /* the API call already raised a toast */ }).finally(() => set((s) => { const { [key]: _done, ...pending } = s.pending; return { pending }; }));
  };
  return {
    ...restored(), list: 'needs', hand: null, goTo: null, pending: {},
    setOpen: (open) => { set(open ? { open } : { open, hand: null, goTo: null }); save(get()); },
    setTab: (tab) => { set(tab === 'map' ? { tab } : { tab, hand: null }); save(get()); },
    setList: (list) => set({ list }),
    take: (ticketId) => { set({ open: true, tab: 'map', hand: ticketId, goTo: null }); save(get()); },
    letGo: () => set({ hand: null }),
    showOnMap: (ticketId) => { set({ open: true, tab: 'map', hand: null, goTo: ticketId }); save(get()); },
    arrived: () => set({ goTo: null }),
    commit: (key, label, run) => {
      if (get().pending[key]) return;
      const timer = setTimeout(() => execute(key), UNDO_MS);
      set((s) => ({ pending: { ...s.pending, [key]: { label, timer, run } } }));
      /* the countdown that counts is this store's timer: the toast does not pretend that pointing at it buys time */
      toast.show({ id: undoId(key), message: label, action: { label: 'Undo', onClick: () => get().undo(key) }, durationMs: UNDO_MS, pauseOnHover: false });
    },
    undo: (key) => {
      const p = get().pending[key];
      if (!p) return;
      clearTimeout(p.timer);
      toast.dismiss(undoId(key));
      set((s) => { const { [key]: _drop, ...pending } = s.pending; return { pending }; });
    },
    flush: () => { for (const key of Object.keys(get().pending)) execute(key); },
  };
});

/** Test hook: forget every gesture that waits, without sending it. */
export function resetMobileFactory(): void {
  for (const p of Object.values(useMobileFactoryStore.getState().pending)) clearTimeout(p.timer);
  useMobileFactoryStore.setState({ open: false, tab: 'tickets', list: 'needs', hand: null, goTo: null, pending: {} });
}
