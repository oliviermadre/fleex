import { create } from 'zustand';
import type { PendingElement } from '../components/shared/elementContext';

/**
 * The desktop ticket browser: tabs per ticket (persisted under `fleex_browser`)
 * and the elements picked from it that wait in the composer (not persisted —
 * they are not a durable draft). Webviews themselves live in BrowserPanel.
 */
export interface BrowserTab {
  id: string;
  /** '' = the new-tab page. */
  url: string;
  title?: string;
  favicon?: string;
}

export interface TicketBrowser {
  tabs: BrowserTab[];
  activeId: string | null;
}

interface BrowserState {
  byTicket: Record<string, TicketBrowser>;
  pendingElements: Record<string, PendingElement[]>;
  expanded: boolean;
  /** Bumped to ask the work composer to take the focus (after a pick). */
  composerFocusTick: number;
  openTab: (ticketId: string, url?: string) => string;
  closeTab: (ticketId: string, tabId: string) => void;
  setActive: (ticketId: string, tabId: string) => void;
  updateTab: (ticketId: string, tabId: string, patch: Partial<Omit<BrowserTab, 'id'>>) => void;
  addElement: (ticketId: string, el: PendingElement) => void;
  removeElement: (ticketId: string, id: string) => void;
  clearElements: (ticketId: string) => void;
  setExpanded: (expanded: boolean) => void;
  requestComposerFocus: () => void;
}

const KEY = 'fleex_browser';
const EMPTY: TicketBrowser = { tabs: [], activeId: null };

function load(): Record<string, TicketBrowser> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? ((JSON.parse(raw) as { byTicket?: Record<string, TicketBrowser> }).byTicket ?? {}) : {};
  } catch {
    return {};
  }
}

function save(byTicket: Record<string, TicketBrowser>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ byTicket }));
  } catch {
    // storage full or blocked: tabs just won't survive a reload
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

export const useBrowserStore = create<BrowserState>((set, get) => {
  const writeTicket = (ticketId: string, next: TicketBrowser) => {
    const byTicket = { ...get().byTicket, [ticketId]: next };
    save(byTicket);
    set({ byTicket });
  };
  const ticket = (ticketId: string) => get().byTicket[ticketId] ?? EMPTY;

  return {
    byTicket: load(),
    pendingElements: {},
    expanded: false,
    composerFocusTick: 0,

    openTab: (ticketId, url = '') => {
      const id = newId();
      const t = ticket(ticketId);
      writeTicket(ticketId, { tabs: [...t.tabs, { id, url }], activeId: id });
      return id;
    },
    closeTab: (ticketId, tabId) => {
      const t = ticket(ticketId);
      const i = t.tabs.findIndex((x) => x.id === tabId);
      if (i < 0) return;
      const tabs = t.tabs.filter((x) => x.id !== tabId);
      const activeId = t.activeId === tabId ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : t.activeId;
      writeTicket(ticketId, { tabs, activeId });
    },
    setActive: (ticketId, tabId) => writeTicket(ticketId, { ...ticket(ticketId), activeId: tabId }),
    updateTab: (ticketId, tabId, patch) => {
      const t = ticket(ticketId);
      writeTicket(ticketId, { ...t, tabs: t.tabs.map((x) => (x.id === tabId ? { ...x, ...patch } : x)) });
    },
    addElement: (ticketId, el) =>
      set({ pendingElements: { ...get().pendingElements, [ticketId]: [...(get().pendingElements[ticketId] ?? []), el] } }),
    removeElement: (ticketId, id) =>
      set({ pendingElements: { ...get().pendingElements, [ticketId]: (get().pendingElements[ticketId] ?? []).filter((e) => e.id !== id) } }),
    clearElements: (ticketId) => set({ pendingElements: { ...get().pendingElements, [ticketId]: [] } }),
    setExpanded: (expanded) => set({ expanded }),
    requestComposerFocus: () => set({ composerFocusTick: get().composerFocusTick + 1 }),
  };
});
