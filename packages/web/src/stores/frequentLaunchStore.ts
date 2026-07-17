import { create } from 'zustand';
import type { StatisticsResponse } from '@fleex/shared';
import * as api from '../services/api';

/**
 * "Fréquents" zone of the SmartSessionButton launcher.
 *
 * The three run leaderboards from GetStatisticsUseCase (skills / workflows /
 * panels — already sorted by execution count) are merged into a single Top-N
 * list of the assets the user launches most. Personas are intentionally
 * excluded (product decision D1/G3). The raw stats are fetched lazily and cached
 * (TTL) so opening the launcher doesn't hit the heavy /statistics endpoint every
 * time; the resolution to launchable items happens in the component against the
 * *current* enabled assets, so a disabled/deleted asset drops out automatically.
 */

/** Only the leaderboards the Fréquents zone needs. */
export type FrequentStats = Pick<
  StatisticsResponse,
  'skillLeaderboard' | 'workflowLeaderboard' | 'panelLeaderboard'
>;

/** Current enabled assets, used to resolve leaderboard rows to launchable items. */
export interface FrequentSource {
  skills: { id: string; displayName: string; commandName: string }[];
  templates: { id: string; name: string; slug: string; emoji: string }[];
  panels: { id: string; displayName: string; name: string }[];
}

export type FrequentType = 'skill' | 'workflow' | 'panel';

export interface FrequentItem {
  /** Stable React key, unique across types. */
  readonly key: string;
  readonly type: FrequentType;
  /** Id used to launch the underlying asset. */
  readonly id: string;
  readonly displayName: string;
  /** Faint mono token shown on the right (e.g. "/prepare", "@panel:archi"). */
  readonly token: string;
  readonly executionCount: number;
}

const DEFAULT_LIMIT = 5;

/**
 * Merge the three run leaderboards into a single Top-`limit` list, resolving each
 * entry against the current enabled assets. Rows that no longer resolve (deleted
 * or disabled) and rows with zero runs are dropped. Sorted by run count desc.
 * Pure + synchronous so the ordering/filtering is unit-testable in isolation.
 */
export function buildFrequentItems(
  stats: FrequentStats | null,
  source: FrequentSource,
  limit = DEFAULT_LIMIT,
): FrequentItem[] {
  if (!stats) return [];

  const items: FrequentItem[] = [];

  for (const entry of stats.skillLeaderboard) {
    if (entry.executionCount <= 0) continue;
    const skill = source.skills.find((s) => s.id === entry.skillId);
    if (!skill) continue;
    items.push({
      key: `skill:${skill.id}`,
      type: 'skill',
      id: skill.id,
      displayName: skill.displayName,
      token: `/${skill.commandName}`,
      executionCount: entry.executionCount,
    });
  }

  for (const entry of stats.workflowLeaderboard) {
    if (entry.executionCount <= 0) continue;
    const template = source.templates.find((t) => t.id === entry.workflowId);
    if (!template) continue;
    items.push({
      key: `workflow:${template.id}`,
      type: 'workflow',
      id: template.id,
      displayName: template.name,
      token: `/${template.slug}`,
      executionCount: entry.executionCount,
    });
  }

  for (const entry of stats.panelLeaderboard) {
    if (entry.executionCount <= 0) continue;
    const panel = source.panels.find((p) => p.id === entry.panelId);
    if (!panel) continue;
    items.push({
      key: `panel:${panel.id}`,
      type: 'panel',
      id: panel.id,
      displayName: panel.displayName,
      token: `@panel:${panel.name}`,
      executionCount: entry.executionCount,
    });
  }

  return items.sort((a, b) => b.executionCount - a.executionCount).slice(0, limit);
}

/** Days of run history considered "frequent" (D2). */
const WINDOW_DAYS = 30;
/** How long the fetched stats stay fresh before a refetch (D3). */
const TTL_MS = 5 * 60_000;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface FrequentLaunchState {
  stats: FrequentStats | null;
  loadedAt: number | null;
  loading: boolean;
  /** Lazy fetch of the run leaderboards; no-op while fresh (TTL) or in flight. */
  load: () => Promise<void>;
}

export const useFrequentLaunchStore = create<FrequentLaunchState>((set, get) => ({
  stats: null,
  loadedAt: null,
  loading: false,

  load: async () => {
    const { loadedAt, loading } = get();
    if (loading) return;
    if (loadedAt != null && Date.now() - loadedAt < TTL_MS) return;

    set({ loading: true });
    try {
      const res = await api.fetchStatistics({
        from: isoDaysFromNow(-WINDOW_DAYS),
        to: isoDaysFromNow(1),
      });
      set({
        stats: {
          skillLeaderboard: res.skillLeaderboard,
          workflowLeaderboard: res.workflowLeaderboard,
          panelLeaderboard: res.panelLeaderboard,
        },
        loadedAt: Date.now(),
        loading: false,
      });
    } catch {
      // Never block the launcher on stats — Fréquents simply stays hidden.
      // Mark as loaded so we don't hammer the endpoint on every open.
      set({ stats: null, loadedAt: Date.now(), loading: false });
    }
  },
}));
