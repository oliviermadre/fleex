import { create } from 'zustand';
import type { ActionDraft, AiField } from '../components/settings/actions/actionModel';
import * as api from '../services/api';

export interface PendingNewDraft {
  draft: ActionDraft;
  /** Fields an assistant filled — marked "✨ suggested" until edited. */
  aiFields: AiField[];
  /** Set when the draft came from "Describe an action", to show the AI banner. */
  fromAi: boolean;
  notes?: string;
}

interface ActionsSettingsState {
  /** null until the server answered — the ✨ buttons stay hidden meanwhile. */
  aiAvailable: boolean | null;
  loadAiStatus: () => Promise<void>;
  /** The draft a template or the composer hands to the detail screen in `new` mode. */
  pendingNew: PendingNewDraft | null;
  setPendingNew: (pending: PendingNewDraft | null) => void;
  composeOpen: boolean;
  setComposeOpen: (open: boolean) => void;
}

/** UI state of Settings › Actions that must outlive a list ⇄ detail switch. */
export const useActionsSettingsStore = create<ActionsSettingsState>((set) => ({
  aiAvailable: null,
  loadAiStatus: async () => {
    const { available } = await api.fetchActionsAiStatus();
    set({ aiAvailable: available });
  },
  pendingNew: null,
  setPendingNew: (pendingNew) => set({ pendingNew }),
  composeOpen: false,
  setComposeOpen: (composeOpen) => set({ composeOpen }),
}));
