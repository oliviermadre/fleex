import { create } from 'zustand';
import { factoryApi } from './factoryApi';
import type { FactoryLayout, FactorySettings, FactorySnapshot, FactoryStats, Target } from './types';

interface FactoryState {
  /** False on a storage driver without Factory tables, or before the first status call. */
  supported: boolean;
  enabled: boolean;
  snapshot: FactorySnapshot | null;
  /** The layout being edited: ahead of the server between a local edit and its save. */
  layout: FactoryLayout | null;
  /** Tickets handed over to the Factory, for the banner shown on a ticket elsewhere in Fleex. */
  managed: ReadonlySet<string>;
  /** What the floor did over the last `statsDays` days; null until first loaded. */
  stats: FactoryStats | null;
  statsDays: number;
  loadStats: (days?: number) => Promise<void>;
  loadStatus: () => Promise<void>;
  loadManaged: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Show a layout without saving it (a drag in progress). Pair with `endEdit`. */
  previewLayout: (layout: FactoryLayout) => void;
  beginEdit: () => void;
  endEdit: () => void;
  setLayout: (layout: FactoryLayout) => Promise<void>;
  setSettings: (patch: Partial<FactorySettings>) => Promise<void>;
  transfer: (ticketId: string, target: Target) => Promise<void>;
  move: (ticketId: string, target: Target) => Promise<void>;
  release: (ticketId: string) => Promise<void>;
  resolve: (ticketId: string, outcome: string) => Promise<void>;
  retry: (ticketId: string) => Promise<void>;
  giveBack: (ticketId: string) => Promise<void>;
}

/** Edits in flight: while one is, a poll must not put the older server layout back. */
let pendingLayoutSaves = 0;

export const useFactoryStore = create<FactoryState>((set, get) => {
  const apply = (snapshot: FactorySnapshot) => set((s) => ({
    snapshot, layout: pendingLayoutSaves > 0 && s.layout ? s.layout : snapshot.floor.layout,
    managed: new Set(snapshot.tickets.map((t) => t.ticketId)),
  }));
  const act = async (fn: () => Promise<FactorySnapshot>) => { try { apply(await fn()); } catch { /* the API call already raised a toast */ } };
  return {
    supported: false, enabled: false, snapshot: null, layout: null, managed: new Set<string>(), stats: null, statsDays: 7,
    loadStats: async (days) => {
      const span = days ?? get().statsDays;
      if (span !== get().statsDays) set({ statsDays: span, stats: null });
      try { const stats = await factoryApi.stats(span); if (get().statsDays === span) set({ stats }); } catch { /* keep what we had */ }
    },
    loadStatus: async () => {
      try { set(await factoryApi.status()); } catch { set({ supported: false, enabled: false }); }
    },
    loadManaged: async () => {
      if (!get().enabled) return;
      try { set({ managed: new Set((await factoryApi.managed()).ticketIds) }); } catch { /* keep what we had */ }
    },
    refresh: async () => {
      try { apply(await factoryApi.state()); } catch { /* next poll */ }
    },
    previewLayout: (layout) => set({ layout }),
    beginEdit: () => { pendingLayoutSaves++; },
    endEdit: () => { pendingLayoutSaves = Math.max(0, pendingLayoutSaves - 1); },
    setLayout: async (layout) => {
      set({ layout });
      pendingLayoutSaves++;
      try { const snapshot = await factoryApi.setLayout(layout); pendingLayoutSaves--; apply(snapshot); }
      catch { pendingLayoutSaves--; const s = get().snapshot; if (s && pendingLayoutSaves === 0) set({ layout: s.floor.layout }); }
    },
    setSettings: (patch) => act(() => factoryApi.setSettings(patch)),
    transfer: (ticketId, target) => act(() => factoryApi.transfer(ticketId, target)),
    move: (ticketId, target) => act(() => factoryApi.move(ticketId, target)),
    release: (ticketId) => act(() => factoryApi.release(ticketId)),
    resolve: (ticketId, outcome) => act(() => factoryApi.resolve(ticketId, outcome)),
    retry: (ticketId) => act(() => factoryApi.retry(ticketId)),
    giveBack: (ticketId) => act(() => factoryApi.giveBack(ticketId)),
  };
});
