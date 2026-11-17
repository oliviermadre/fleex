import { create } from 'zustand';
import { useTicketStore } from '../stores/ticketStore';
import { toast } from '../lib/toast';
import { factoryApi } from './factoryApi';
import type { FactoryLayout, FactorySettings, FactorySnapshot, FactoryStats, Target } from './types';

interface FactoryState {
  /** False on a storage driver without Factory tables, or before the first status call. */
  supported: boolean;
  enabled: boolean;
  snapshot: FactorySnapshot | null;
  /** When the snapshot arrived, on the page's own clock (`performance.now()`): what moves keeps moving from there. */
  receivedAt: number;
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
  /** How many layout edits can be taken back, and put back. */
  undoable: number;
  redoable: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  setSettings: (patch: Partial<FactorySettings>) => Promise<void>;
  transfer: (ticketId: string, target: Target) => Promise<void>;
  move: (ticketId: string, target: Target) => Promise<void>;
  release: (ticketId: string) => Promise<void>;
  resolve: (ticketId: string, outcome: string, reason?: string) => Promise<void>;
  setAside: (ticketId: string) => Promise<void>;
  /** With an outcome the ticket leaves its station by that arm; without, the station runs again. */
  putBack: (ticketId: string, outcome?: string) => Promise<void>;
  power: (machineId: string, on: boolean) => Promise<void>;
  ackNotice: () => Promise<void>;
  retry: (ticketId: string) => Promise<void>;
  giveBack: (ticketId: string) => Promise<void>;
  /** Make a ticket a favourite, or not: a favourite carries its name on the floor. Changes the ticket itself, as the star does everywhere in Fleex. */
  star: (ticketId: string, on: boolean) => Promise<void>;
}

/** Edits in flight: while one is, a poll must not put the older server layout back. */
let pendingLayoutSaves = 0;
/**
 * Layout history, for undo in build mode. `committed` is the last layout that was saved or received,
 * as opposed to a drag in progress. It lives for the page session only: a reload starts afresh.
 */
const HISTORY = 60;
let committed: FactoryLayout | null = null;
let past: FactoryLayout[] = [];
let future: FactoryLayout[] = [];
/** Test hook: forget the history. */
export function resetFactoryHistory(): void { committed = null; past = []; future = []; pendingLayoutSaves = 0; }

export const useFactoryStore = create<FactoryState>((set, get) => {
  const apply = (snapshot: FactorySnapshot) => set((s) => {
    if (pendingLayoutSaves === 0) committed = snapshot.floor.layout;
    return {
    snapshot, receivedAt: performance.now(), layout: pendingLayoutSaves > 0 && s.layout ? s.layout : snapshot.floor.layout,
    managed: new Set(snapshot.tickets.map((t) => t.ticketId)),
    };
  });
  const save = async (layout: FactoryLayout) => {
    committed = layout;
    set({ layout, undoable: past.length, redoable: future.length });
    pendingLayoutSaves++;
    try { const snapshot = await factoryApi.setLayout(layout); pendingLayoutSaves--; apply(snapshot); }
    catch { pendingLayoutSaves--; const s = get().snapshot; if (s && pendingLayoutSaves === 0) { committed = s.floor.layout; set({ layout: s.floor.layout }); } }
  };
  const act = async (fn: () => Promise<FactorySnapshot>) => { try { apply(await fn()); } catch { /* the API call already raised a toast */ } };
  return {
    supported: false, enabled: false, snapshot: null, receivedAt: 0, layout: null, managed: new Set<string>(), stats: null, statsDays: 7,
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
    undoable: 0, redoable: 0,
    setLayout: async (layout) => {
      if (committed && committed !== layout) { past.push(committed); if (past.length > HISTORY) past.shift(); future = []; }
      await save(layout);
    },
    undo: async () => {
      const prev = past.pop();
      if (!prev) return;
      if (committed) future.push(committed);
      await save(prev);
    },
    redo: async () => {
      const next = future.pop();
      if (!next) return;
      if (committed) past.push(committed);
      await save(next);
    },
    setSettings: (patch) => act(() => factoryApi.setSettings(patch)),
    transfer: (ticketId, target) => act(() => factoryApi.transfer(ticketId, target)),
    move: (ticketId, target) => act(() => factoryApi.move(ticketId, target)),
    release: (ticketId) => act(() => factoryApi.release(ticketId)),
    resolve: (ticketId, outcome, reason) => act(() => factoryApi.resolve(ticketId, outcome, reason)),
    setAside: (ticketId) => act(() => factoryApi.setAside(ticketId)),
    putBack: (ticketId, outcome) => act(() => factoryApi.putBack(ticketId, outcome)),
    power: (machineId, on) => act(() => factoryApi.power(machineId, on)),
    ackNotice: () => act(() => factoryApi.ackNotice()),
    retry: (ticketId) => act(() => factoryApi.retry(ticketId)),
    giveBack: (ticketId) => act(() => factoryApi.giveBack(ticketId)),
    star: async (ticketId, on) => {
      try { await useTicketStore.getState().updateTicket(ticketId, { favorite: on }); } catch { toast.error('Could not change the favourite'); return; }
      await act(() => factoryApi.refreshTicket(ticketId));
    },
  };
});
