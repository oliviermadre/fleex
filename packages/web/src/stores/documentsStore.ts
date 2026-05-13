import { create } from 'zustand';
import type { TicketDeliverable } from '@fleex/shared';
import { documentsService } from '../services/documentsService';

interface DocumentsState {
  deliverables: TicketDeliverable[];
  loading: boolean;
  error: string | null;

  // Multi-select filters (empty set = no filter)
  filterTypes: Set<string>;
  filterAgentNames: Set<string>;
  filterStatuses: Set<string>;

  // Actions
  fetchAll: () => Promise<void>;
  toggleFilter: (dimension: 'filterTypes' | 'filterAgentNames' | 'filterStatuses', value: string) => void;
  clearFilters: () => void;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  deliverables: [],
  loading: false,
  error: null,

  filterTypes: new Set(),
  filterAgentNames: new Set(),
  filterStatuses: new Set(),

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const deliverables = await documentsService.getAll();
      set({ deliverables, loading: false });
    } catch (err) {
      console.error('Failed to load documents:', err);
      set({ loading: false, error: 'Failed to load documents' });
    }
  },

  toggleFilter: (dimension, value) => {
    const current = new Set(get()[dimension]);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    set({ [dimension]: current });
  },

  clearFilters: () => set({
    filterTypes: new Set(),
    filterAgentNames: new Set(),
    filterStatuses: new Set(),
  }),
}));
