import { create } from 'zustand';
import type { StatusModel, StatusColumn } from '@fleex/shared';
import { getActiveStatusModel, setActiveStatusModel } from '@fleex/shared';
import * as api from '../services/api';

interface StatusModelState {
  model: StatusModel;
  /** Columns sorted by their display order. */
  columns: () => StatusColumn[];
  fetchModel: () => Promise<void>;
  /** Apply a model locally (also updates the shared active registry used by Status.of). */
  applyModel: (model: StatusModel) => void;
}

function sorted(model: StatusModel): StatusColumn[] {
  return [...model.columns].sort((a, b) => a.order - b.order);
}

export const useStatusModelStore = create<StatusModelState>((set, get) => ({
  // Start from the built-in default already held by the shared registry, so the
  // board renders correctly before the first fetch resolves.
  model: getActiveStatusModel(),

  columns: () => sorted(get().model),

  fetchModel: async () => {
    const model = await api.fetchStatusModel();
    setActiveStatusModel(model);
    set({ model });
  },

  applyModel: (model: StatusModel) => {
    setActiveStatusModel(model);
    set({ model });
  },
}));
