import { create } from 'zustand';
import * as api from '../services/api';
import { completeConfig, type QueueDisplay, type QueueFilters } from '../components/work/queueFilters';

/**
 * The user's saved views of the Tasks queue — server state (KV `saved_views:work`),
 * so they follow the user to another browser. What the queue currently applies,
 * and each view's unsaved edits, live in workStore (`queueConfig`, `viewDrafts`).
 */
export type SavedView = api.SavedViewPayload<QueueFilters, QueueDisplay>;

const SCOPE = 'work';
export const VIEW_NAME_MAX = 60;

/**
 * idle → loading → ready | unavailable (501: no KV store, views disabled) | error
 * (the list couldn't be read; the picker offers a retry, filters keep working).
 */
export type SavedViewsStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface SavedViewsState {
  views: SavedView[];
  status: SavedViewsStatus;
  /** (Re)read the views from the server. */
  load: () => Promise<void>;
  /**
   * Store the whole list on the server, then adopt it. Throws (state unchanged)
   * when the server refuses or can't be reached — the caller tells the user.
   */
  commit: (views: SavedView[]) => Promise<void>;
}

/** A view read from the server, with every config field present. */
function complete(v: api.SavedViewPayload): SavedView {
  const config = completeConfig({ filters: v.filters, display: v.display });
  return { ...v, filters: config.filters, display: config.display };
}

export const useSavedViewsStore = create<SavedViewsState>((set) => ({
  views: [],
  status: 'idle',
  load: async () => {
    set((s) => ({ status: s.status === 'ready' ? 'ready' : 'loading' }));
    try {
      const views = await api.fetchSavedViews(SCOPE);
      set({ views: views.map(complete), status: 'ready' });
    } catch (err) {
      const unavailable = err instanceof api.SavedViewsError && err.status === 501;
      set((s) => ({ status: unavailable ? 'unavailable' : s.status === 'ready' ? 'ready' : 'error' }));
    }
  },
  commit: async (views) => {
    const stored = await api.saveSavedViews(SCOPE, views);
    set({ views: stored.map(complete), status: 'ready' });
  },
}));

/** Why a view name is refused, or null when it's fine (trimmed, 1–60, unique ignoring case). */
export function viewNameError(name: string, views: readonly Pick<SavedView, 'id' | 'name'>[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'A name is required.';
  if (n.length > VIEW_NAME_MAX) return `${VIEW_NAME_MAX} characters max (${n.length}).`;
  if (views.some((v) => v.id !== exceptId && v.name.trim().toLowerCase() === n.toLowerCase())) {
    return 'A view already has this name.';
  }
  return null;
}

/** "X (copy)", "X (copy 2)"… — the first name no view uses. */
export function copyName(name: string, views: readonly Pick<SavedView, 'name'>[]): string {
  const taken = new Set(views.map((v) => v.name.trim().toLowerCase()));
  const base = name.slice(0, VIEW_NAME_MAX - 9);
  let candidate = `${base} (copy)`;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base} (copy ${i})`;
  return candidate;
}
