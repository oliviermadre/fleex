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
  setView: (view) => set({ view, morePage: null, moreSheetOpen: false }),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  setMoreSheetOpen: (moreSheetOpen) => set({ moreSheetOpen }),
  openMorePage: (morePage) => set({ morePage, moreSheetOpen: false }),
  openTicket: (ticketId, tab) => {
    set({ requestedDetailTab: tab ?? null, assistantOpen: false });
    useTicketStore.getState().selectTicket(ticketId);
  },
}));
