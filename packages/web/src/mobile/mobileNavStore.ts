import { create } from 'zustand';
import { useTicketStore } from '../stores/ticketStore';

export type MobileView = 'focus' | 'tasks' | 'board';
export type MobileMorePage = 'pulse' | 'routines' | 'notes' | 'documents' | 'repos' | 'settings';
export type MobileDetailTab = 'conversation' | 'context' | 'deliverables' | 'runs' | 'workflow';

/**
 * Navigation state of the mobile shell. Lives in a store (not in MobileApp's
 * useState) so a Focus card can open a ticket straight on its Workflow / Runs
 * tab, and the ticket header can open the assistant sheet.
 */
interface MobileNavState {
  view: MobileView;
  assistantOpen: boolean;
  moreSheetOpen: boolean;
  morePage: MobileMorePage | null;
  /** Tab the ticket detail opens on; consumed once per opened ticket. */
  requestedDetailTab: MobileDetailTab | null;
  /** Tab currently shown in the ticket detail — persisted so a reload reopens it. */
  detailTab: MobileDetailTab;
  setDetailTab: (tab: MobileDetailTab) => void;
  setView: (view: MobileView) => void;
  setAssistantOpen: (open: boolean) => void;
  setMoreSheetOpen: (open: boolean) => void;
  openMorePage: (page: MobileMorePage | null) => void;
  /** Open a ticket full-screen, optionally on a given tab. */
  openTicket: (ticketId: string, tab?: MobileDetailTab) => void;
}

export const useMobileNavStore = create<MobileNavState>((set) => ({
  view: 'focus',
  assistantOpen: false,
  moreSheetOpen: false,
  morePage: null,
  requestedDetailTab: null,
  detailTab: 'conversation',
  setDetailTab: (detailTab) => set({ detailTab }),
  setView: (view) => set({ view, morePage: null, moreSheetOpen: false }),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  setMoreSheetOpen: (moreSheetOpen) => set({ moreSheetOpen }),
  openMorePage: (morePage) => set({ morePage, moreSheetOpen: false }),
  openTicket: (ticketId, tab) => {
    set({ requestedDetailTab: tab ?? null, assistantOpen: false });
    useTicketStore.getState().selectTicket(ticketId);
  },
}));

// ── Survive a reload ──
// iOS evicts a backgrounded home-screen web app, and the Vite dev client reloads
// the page when its socket comes back after sleep. Either way the user must land
// back where they were (tab, open ticket, its tab, Plus page), not on Focus.

const NAV_KEY = 'fleex:mobile-nav';
/** Past this, a reopened app starts fresh on Focus. */
const RESTORE_TTL_MS = 6 * 3600_000;

interface SavedNav {
  view: MobileView;
  morePage: MobileMorePage | null;
  ticketId: string | null;
  detailTab: MobileDetailTab;
  at: number;
}

export function saveMobileNav(now = Date.now()): void {
  const s = useMobileNavStore.getState();
  const saved: SavedNav = {
    view: s.view,
    morePage: s.morePage,
    ticketId: useTicketStore.getState().selectedTicketId,
    detailTab: s.detailTab,
    at: now,
  };
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify(saved));
  } catch {
    /* private mode / quota — restoring is a nicety */
  }
}

/** Restore the last navigation if it is recent; returns whether it did. */
export function restoreMobileNav(now = Date.now()): boolean {
  let saved: SavedNav | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(NAV_KEY) ?? 'null') as SavedNav | null;
  } catch {
    saved = null;
  }
  if (!saved || now - saved.at > RESTORE_TTL_MS) return false;
  useMobileNavStore.setState({
    view: saved.view,
    morePage: saved.morePage,
    detailTab: saved.detailTab,
    requestedDetailTab: saved.ticketId ? saved.detailTab : null,
  });
  if (saved.ticketId) useTicketStore.getState().selectTicket(saved.ticketId);
  return true;
}
