import { create } from 'zustand';

import type { DeliverableTypeDef, DeliverableRenderer, DeliverableTypeColor } from '@fleex/shared';
import {
  DEFAULT_DELIVERABLE_TYPES,
  rendererForType,
  labelForType,
  colorForType,
} from '@fleex/shared';

import { themedTypeColor, type ThemedTypeColor } from '../lib/tints';
import * as api from '../services/api';

interface DeliverableTypesState {
  types: DeliverableTypeDef[];
  usage: Record<string, number>;
  loaded: boolean;

  load: () => Promise<void>;
  create: (input: {
    id: string;
    label: string;
    description?: string;
    renderer: DeliverableRenderer;
    color?: DeliverableTypeColor | null;
  }) => Promise<void>;
  update: (
    id: string,
    patch: {
      label?: string;
      description?: string;
      renderer?: DeliverableRenderer;
      color?: DeliverableTypeColor | null;
    },
  ) => Promise<void>;
  rename: (id: string, newId: string) => Promise<number>;
  remove: (id: string) => Promise<void>;
  reassign: (from: string, to: string) => Promise<number>;

  /** Types an agent/user can pick (system types excluded). */
  selectableTypes: () => DeliverableTypeDef[];
  rendererFor: (type: string) => DeliverableRenderer;
  labelFor: (type: string) => string;
  /**
   * Configured badge colour for a type, or null (caller falls back to theme
   * accent). Preset colours are re-mapped to theme-aware `var(--tint-*)`
   * values (ticket #395) — persisted config stays untouched.
   */
  colorFor: (type: string) => ThemedTypeColor | null;
}

export const useDeliverableTypesStore = create<DeliverableTypesState>((set, get) => ({
  // Seed with the default preset so rendering works before the first fetch.
  types: DEFAULT_DELIVERABLE_TYPES,
  usage: {},
  loaded: false,

  load: async () => {
    try {
      const view = await api.fetchDeliverableTypes();
      set({ types: view.types, usage: view.usage, loaded: true });
    } catch {
      // Keep the default preset on failure (older server / offline).
      set({ loaded: true });
    }
  },

  create: async (input) => {
    const view = await api.createDeliverableType(input);
    set({ types: view.types, usage: view.usage });
  },

  update: async (id, patch) => {
    const view = await api.updateDeliverableType(id, patch);
    set({ types: view.types, usage: view.usage });
  },

  rename: async (id, newId) => {
    const view = await api.renameDeliverableType(id, newId);
    set({ types: view.types, usage: view.usage });
    return view.migrated;
  },

  remove: async (id) => {
    const view = await api.deleteDeliverableType(id);
    set({ types: view.types, usage: view.usage });
  },

  reassign: async (from, to) => {
    const { migrated } = await api.reassignDeliverableType(from, to);
    // Refresh usage counts after a bulk move.
    await get().load();
    return migrated;
  },

  selectableTypes: () => get().types.filter((t) => !t.system),
  rendererFor: (type) => rendererForType(type, get().types),
  labelFor: (type) => labelForType(type, get().types),
  colorFor: (type) => themedTypeColor(colorForType(type, get().types)),
}));
