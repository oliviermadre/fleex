import { create } from 'zustand';
import type {
  Trigger,
  TriggerRun,
  CreateTriggerInput,
  UpdateTriggerInput,
} from '@fleex/shared';
import * as api from '../services/api';

interface TriggerState {
  triggers: Trigger[];
  loaded: boolean;
  runsByTrigger: Record<string, TriggerRun[]>;

  loadTriggers: () => Promise<void>;
  createTrigger: (req: CreateTriggerInput) => Promise<Trigger>;
  updateTrigger: (id: string, req: UpdateTriggerInput) => Promise<void>;
  deleteTrigger: (id: string) => Promise<void>;
  runTrigger: (id: string) => Promise<void>;
  loadRuns: (id: string) => Promise<void>;
}

export const useTriggerStore = create<TriggerState>((set, get) => ({
  triggers: [],
  loaded: false,
  runsByTrigger: {},

  loadTriggers: async () => {
    try {
      const triggers = await api.fetchTriggers();
      set({ triggers, loaded: true });
    } catch (err) {
      console.error('Failed to load triggers:', err);
      set({ loaded: true });
    }
  },

  createTrigger: async (req) => {
    const trigger = await api.createTrigger(req);
    set((state) => ({ triggers: [...state.triggers, trigger] }));
    return trigger;
  },

  updateTrigger: async (id, req) => {
    const updated = await api.updateTrigger(id, req);
    set((state) => ({ triggers: state.triggers.map((t) => (t.id === id ? updated : t)) }));
  },

  deleteTrigger: async (id) => {
    await api.deleteTrigger(id);
    set((state) => ({
      triggers: state.triggers.filter((t) => t.id !== id),
    }));
  },

  runTrigger: async (id) => {
    await api.runTrigger(id);
    // Refresh the trigger (lastRunAt/lastStatus changed) and its run history.
    await get().loadTriggers();
    await get().loadRuns(id);
  },

  loadRuns: async (id) => {
    try {
      const runs = await api.fetchTriggerRuns(id);
      set((state) => ({ runsByTrigger: { ...state.runsByTrigger, [id]: runs } }));
    } catch (err) {
      console.error('Failed to load trigger runs:', err);
    }
  },
}));
