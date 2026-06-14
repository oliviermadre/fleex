import { create } from 'zustand';
import type { StatisticsResponse } from '@fleex/shared';
import * as api from '../services/api';

export type Preset = 'today' | '7d' | '30d' | '90d' | '1y' | 'custom';
export type Granularity = 'day' | 'week' | 'month';

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Range {
  from: string;
  to: string;
}

function presetToRange(preset: Exclude<Preset, 'custom'>): Range {
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

/**
 * The immediately preceding window of equal length, used to compute
 * period-over-period deltas (e.g. "+12% vs previous 7 days").
 */
function previousRange(range: Range): Range {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - durationMs);
  return { from: formatLocalDate(prevFrom), to: formatLocalDate(prevTo) };
}

/** Auto-pick a sensible granularity when the user changes only the date range. */
function autoGranularity(range: Range): Granularity {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

interface StatisticsState {
  data: StatisticsResponse | null;
  /** Same metrics for the immediately-preceding window, for trend deltas. */
  previous: StatisticsResponse | null;
  loading: boolean;
  preset: Preset;
  granularity: Granularity;
  customFrom: string;
  customTo: string;
  fetch: () => Promise<void>;
  setPreset: (preset: Preset) => void;
  setGranularity: (granularity: Granularity) => void;
  setCustomRange: (from: string, to: string) => void;
}

function currentRange(state: Pick<StatisticsState, 'preset' | 'customFrom' | 'customTo'>): Range {
  if (state.preset === 'custom' && state.customFrom && state.customTo) {
    return { from: state.customFrom, to: state.customTo };
  }
  return presetToRange(state.preset === 'custom' ? '7d' : state.preset);
}

const defaultRange = presetToRange('7d');

export const useStatisticsStore = create<StatisticsState>((set, get) => ({
  data: null,
  previous: null,
  loading: false,
  preset: '7d',
  granularity: 'day',
  customFrom: defaultRange.from,
  customTo: defaultRange.to,

  fetch: async () => {
    set({ loading: true });
    try {
      const { granularity } = get();
      const range = currentRange(get());
      const prev = previousRange(range);
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const [data, previous] = await Promise.all([
        api.fetchStatistics({ from: range.from, to: range.to, granularity, tzOffsetMinutes }),
        api
          .fetchStatistics({ from: prev.from, to: prev.to, granularity, tzOffsetMinutes })
          .catch(() => null),
      ]);
      set({ data, previous, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setPreset: (preset) => {
    if (preset === 'custom') {
      const range = currentRange(get());
      set({ preset, granularity: autoGranularity(range) });
    } else {
      set({ preset });
    }
    get().fetch();
  },

  setGranularity: (granularity) => {
    set({ granularity });
    get().fetch();
  },

  setCustomRange: (from, to) => {
    set({ preset: 'custom', customFrom: from, customTo: to, granularity: autoGranularity({ from, to }) });
    get().fetch();
  },
}));
