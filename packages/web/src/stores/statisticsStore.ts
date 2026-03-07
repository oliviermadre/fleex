import { create } from 'zustand';
import type { StatisticsResponse } from '@fleex/shared';
import * as api from '../services/api';

type Preset = 'today' | '7d' | '30d' | '90d' | '1y';
type Granularity = 'day' | 'week' | 'month';

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetToRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const to = formatLocalDate(tomorrow);
  let from: Date;

  switch (preset) {
    case 'today':
      from = new Date(today);
      break;
    case '7d':
      from = new Date(today);
      from.setDate(from.getDate() - 6);
      break;
    case '30d':
      from = new Date(today);
      from.setDate(from.getDate() - 29);
      break;
    case '90d':
      from = new Date(today);
      from.setDate(from.getDate() - 89);
      break;
    case '1y':
      from = new Date(today);
      from.setFullYear(from.getFullYear() - 1);
      break;
  }

  return { from: formatLocalDate(from), to };
}

interface StatisticsState {
  data: StatisticsResponse | null;
  loading: boolean;
  preset: Preset;
  granularity: Granularity;
  fetch: () => Promise<void>;
  setPreset: (preset: Preset) => void;
  setGranularity: (granularity: Granularity) => void;
}

export const useStatisticsStore = create<StatisticsState>((set, get) => ({
  data: null,
  loading: false,
  preset: '7d',
  granularity: 'day',

  fetch: async () => {
    set({ loading: true });
    try {
      const { preset, granularity } = get();
      const range = presetToRange(preset);
      const data = await api.fetchStatistics({
        from: range.from,
        to: range.to,
        granularity,
      });
      set({ data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setPreset: (preset) => {
    set({ preset });
    get().fetch();
  },

  setGranularity: (granularity) => {
    set({ granularity });
    get().fetch();
  },
}));
