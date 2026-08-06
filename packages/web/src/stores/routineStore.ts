import { create } from 'zustand';
import type { Routine, CreateRoutineInput, UpdateRoutineInput, TicketDeliverable } from '@fleex/shared';
import * as api from '../services/api';
import type { RoutineRunDetail, RoutineListItem } from '../services/api';

/**
 * Routines and the run history of the currently open one.
 *
 * The history is deliberately keyed on a single `selectedId` rather than cached
 * per routine: a routine's runs change under live workflow events, and a stale
 * per-id cache would show a finished run as still running.
 */
interface RoutineStore {
  routines: RoutineListItem[];
  loading: boolean;
  error: string | null;

  selectedId: string | null;
  runs: RoutineRunDetail[];
  runsLoading: boolean;

  load: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  refreshRuns: () => Promise<void>;
  applyDeliverableUpdate: (updated: TicketDeliverable) => void;
  create: (input: CreateRoutineInput) => Promise<Routine>;
  update: (id: string, changes: UpdateRoutineInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  launch: (id: string) => Promise<void>;
}

/**
 * Monotonic request counter per routine. Live workflow events fire a refresh
 * per burst, so several requests for the same routine are in flight at once;
 * without ordering the LAST response to resolve wins and a slow stale one can
 * pin the UI on a step that already finished.
 */
const runsSeq = new Map<string, number>();

export const useRoutineStore = create<RoutineStore>((set, get) => ({
  routines: [],
  loading: false,
  error: null,
  selectedId: null,
  runs: [],
  runsLoading: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ routines: await api.fetchRoutines(), loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  select: async (id) => {
    set({ selectedId: id, runs: [] });
    if (id) await get().refreshRuns();
  },

  refreshRuns: async () => {
    const id = get().selectedId;
    if (!id) return;
    const seq = (runsSeq.get(id) ?? 0) + 1;
    runsSeq.set(id, seq);
    // Spinner only on a cold load. Live workflow events refresh this list on
    // every step transition; flipping `runsLoading` there would blank the open
    // run's DAG a dozen times per run.
    if (get().runs.length === 0) set({ runsLoading: true });
    try {
      const runs = await api.fetchRoutineRuns(id);
      // Guard against a late response for a routine the user already left, and
      // against a slow response for THIS routine clobbering a fresher one.
      if (get().selectedId !== id || runsSeq.get(id) !== seq) return;
      set({ runs, runsLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), runsLoading: false });
    }
  },

  /**
   * Patch one deliverable in place across the loaded runs. Deliverables are
   * edited from overlays that live outside the routine tree (reading overlay,
   * floating panel); without this the routine's lists keep rendering the type
   * captured at `fetchRoutineRuns` time until the next full refresh.
   */
  applyDeliverableUpdate: (updated) => {
    const runs = get().runs;
    if (!runs.some((r) => r.deliverables.some((d) => d.id === updated.id))) return;
    set({
      runs: runs.map((r) => (
        r.deliverables.some((d) => d.id === updated.id)
          ? { ...r, deliverables: r.deliverables.map((d) => (d.id === updated.id ? updated : d)) }
          : r
      )),
    });
  },

  create: async (input) => {
    const routine = await api.createRoutine(input);
    // The list item shape carries active-run fields the POST response has not
    // computed yet — a fresh routine has no run, so the defaults are exact.
    set({ routines: [...get().routines, { ...routine, activeRunId: null, activeRunStatus: null, awaitingAttention: false }] });
    return routine;
  },

  update: async (id, changes) => {
    const updated = await api.updateRoutine(id, changes);
    set({ routines: get().routines.map((r) => (r.id === id ? { ...r, ...updated } : r)) });
  },

  remove: async (id) => {
    await api.deleteRoutine(id);
    set({
      routines: get().routines.filter((r) => r.id !== id),
      ...(get().selectedId === id ? { selectedId: null, runs: [] } : {}),
    });
  },

  launch: async (id) => {
    await api.launchRoutine(id);
    await get().load();
    if (get().selectedId === id) await get().refreshRuns();
  },
}));
