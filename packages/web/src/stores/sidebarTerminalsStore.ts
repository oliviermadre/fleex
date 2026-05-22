import { create } from 'zustand';

const STORAGE_KEY = 'fleex_sidebar_terminals';

interface PersistedShape {
  terminalsByParent?: Record<string, string[]>;
  activeByParent?: Record<string, string | null>;
  activeTopTabByParent?: Record<string, string>;
}

interface SidebarTerminalsState {
  terminalsByParent: Record<string, string[]>;
  activeByParent: Record<string, string | null>;
  /** Per-parent, the active top-panel scratchpad tab key ('__global__' or 'org/name'). */
  activeTopTabByParent: Record<string, string>;
  addTerminal: (parentSessionId: string, sidebarSessionId: string) => void;
  removeTerminal: (parentSessionId: string, sidebarSessionId: string) => void;
  setActive: (parentSessionId: string, sidebarSessionId: string | null) => void;
  setActiveTopTab: (parentSessionId: string, tabKey: string) => void;
  /** Reconcile against the current set of known session IDs — drops stale references. */
  reconcile: (knownSessionIds: Set<string>) => void;
}

function loadPersisted(): PersistedShape {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function savePersisted(
  state: Pick<SidebarTerminalsState, 'terminalsByParent' | 'activeByParent' | 'activeTopTabByParent'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        terminalsByParent: state.terminalsByParent,
        activeByParent: state.activeByParent,
        activeTopTabByParent: state.activeTopTabByParent,
      }),
    );
  } catch {
    // ignore
  }
}

const initial = loadPersisted();

export const useSidebarTerminalsStore = create<SidebarTerminalsState>((set, get) => ({
  terminalsByParent: initial.terminalsByParent ?? {},
  activeByParent: initial.activeByParent ?? {},
  activeTopTabByParent: initial.activeTopTabByParent ?? {},

  addTerminal: (parentSessionId, sidebarSessionId) => {
    const current = get().terminalsByParent[parentSessionId] ?? [];
    if (current.includes(sidebarSessionId)) return;
    const nextTerminals = { ...get().terminalsByParent, [parentSessionId]: [...current, sidebarSessionId] };
    const nextActive = { ...get().activeByParent, [parentSessionId]: sidebarSessionId };
    set({ terminalsByParent: nextTerminals, activeByParent: nextActive });
    savePersisted({ terminalsByParent: nextTerminals, activeByParent: nextActive, activeTopTabByParent: get().activeTopTabByParent });
  },

  removeTerminal: (parentSessionId, sidebarSessionId) => {
    const current = get().terminalsByParent[parentSessionId] ?? [];
    const remaining = current.filter((id) => id !== sidebarSessionId);
    const nextTerminals = { ...get().terminalsByParent, [parentSessionId]: remaining };
    const wasActive = get().activeByParent[parentSessionId] === sidebarSessionId;
    const nextActive = {
      ...get().activeByParent,
      [parentSessionId]: wasActive ? (remaining[remaining.length - 1] ?? null) : get().activeByParent[parentSessionId] ?? null,
    };
    set({ terminalsByParent: nextTerminals, activeByParent: nextActive });
    savePersisted({ terminalsByParent: nextTerminals, activeByParent: nextActive, activeTopTabByParent: get().activeTopTabByParent });
  },

  setActive: (parentSessionId, sidebarSessionId) => {
    const nextActive = { ...get().activeByParent, [parentSessionId]: sidebarSessionId };
    set({ activeByParent: nextActive });
    savePersisted({ terminalsByParent: get().terminalsByParent, activeByParent: nextActive, activeTopTabByParent: get().activeTopTabByParent });
  },

  setActiveTopTab: (parentSessionId, tabKey) => {
    const nextTop = { ...get().activeTopTabByParent, [parentSessionId]: tabKey };
    set({ activeTopTabByParent: nextTop });
    savePersisted({ terminalsByParent: get().terminalsByParent, activeByParent: get().activeByParent, activeTopTabByParent: nextTop });
  },

  reconcile: (knownSessionIds) => {
    const { terminalsByParent, activeByParent, activeTopTabByParent } = get();
    const nextTerminals: Record<string, string[]> = {};
    let changed = false;
    for (const [parent, ids] of Object.entries(terminalsByParent)) {
      const kept = ids.filter((id) => knownSessionIds.has(id));
      if (kept.length !== ids.length) changed = true;
      nextTerminals[parent] = kept;
    }
    const nextActive: Record<string, string | null> = {};
    for (const [parent, active] of Object.entries(activeByParent)) {
      if (active && knownSessionIds.has(active)) {
        nextActive[parent] = active;
      } else {
        const list = nextTerminals[parent] ?? [];
        nextActive[parent] = list[list.length - 1] ?? null;
        changed = true;
      }
    }
    if (!changed) return;
    set({ terminalsByParent: nextTerminals, activeByParent: nextActive });
    savePersisted({ terminalsByParent: nextTerminals, activeByParent: nextActive, activeTopTabByParent });
  },
}));
