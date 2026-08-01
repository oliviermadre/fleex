import { create } from 'zustand';
import type {
  Panel,
  CreatePanelRequest,
  UpdatePanelRequest,
  PanelWsMessage,
} from '@fleex/shared';
import * as api from '../services/api';
import { createLogger } from '../lib/logger';

const log = createLogger('stores/panelStore');

interface PanelState {
  panels: Panel[];
  loaded: boolean;
  selectedPanelId: string | null;

  loadPanels: () => Promise<void>;
  selectPanel: (id: string | null) => void;
  createPanel: (req: CreatePanelRequest) => Promise<Panel>;
  updatePanel: (id: string, req: UpdatePanelRequest) => Promise<void>;
  deletePanel: (id: string) => Promise<void>;
  handleWsMessage: (msg: PanelWsMessage) => void;
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panels: [],
  loaded: false,
  selectedPanelId: null,

  loadPanels: async () => {
    try {
      const panels = await api.fetchPanels();
      set({ panels, loaded: true });
    } catch (err) {
      log.error('Failed to load panels', { err });
    }
  },

  selectPanel: (id) => set({ selectedPanelId: id }),

  createPanel: async (req) => {
    const panel = await api.createPanel(req);
    set((state) => ({
      panels: [...state.panels, panel],
    }));
    return panel;
  },

  updatePanel: async (id, req) => {
    const updated = await api.updatePanel(id, req);
    set((state) => ({
      panels: state.panels.map((p) => (p.id === id ? updated : p)),
    }));
  },

  deletePanel: async (id) => {
    await api.deletePanel(id);
    set((state) => ({
      panels: state.panels.filter((p) => p.id !== id),
      selectedPanelId: state.selectedPanelId === id ? null : state.selectedPanelId,
    }));
  },

  handleWsMessage: (msg) => {
    const { type, data } = msg;
    const state = get();

    switch (type) {
      case 'panel:created': {
        const panel = data as Panel;
        if (!state.panels.some((p) => p.id === panel.id)) {
          set({ panels: [...state.panels, panel] });
        }
        break;
      }
      case 'panel:updated': {
        const panel = data as Panel;
        set({
          panels: state.panels.map((p) => (p.id === panel.id ? panel : p)),
        });
        break;
      }
      case 'panel:deleted': {
        const { id } = data as { id: string };
        set({
          panels: state.panels.filter((p) => p.id !== id),
          selectedPanelId: state.selectedPanelId === id ? null : state.selectedPanelId,
        });
        break;
      }
    }
  },
}));
