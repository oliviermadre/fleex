import { create } from 'zustand';
import { DEFAULT_AGENDA_PREFS, type AgendaPrefs, type AgendaResponse, type AgendaView } from '@fleex/shared';
import * as api from '../services/api';
import { toast } from '../lib/toast';
import { shiftAnchor, startOfDay, windowFor } from '../components/agenda/agendaLayout';

interface AgendaStore {
  anchor: Date;
  data: AgendaResponse | null;
  loading: boolean;
  error: string | null;
  prefs: AgendaPrefs;
  /** False until the server prefs arrived — the page shows a skeleton, not a flash of defaults. */
  prefsLoaded: boolean;
  query: string;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  setView: (view: AgendaView) => void;
  go: (dir: 1 | -1) => void;
  goToday: () => void;
  goToDay: (day: Date, view?: AgendaView) => void;
  setQuery: (q: string) => void;
  updatePrefs: (fn: (p: AgendaPrefs) => AgendaPrefs) => void;
}

/** Monotonic counter: a slow response for a window we already left must not win. */
let seq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

export const useAgendaStore = create<AgendaStore>((set, get) => ({
  anchor: startOfDay(new Date()),
  data: null,
  loading: false,
  error: null,
  prefs: DEFAULT_AGENDA_PREFS,
  prefsLoaded: false,
  query: '',

  init: async () => {
    if (!get().prefsLoaded) {
      try {
        const prefs = await api.fetchAgendaPrefs();
        // Merge over the defaults: a field a later version added is never undefined.
        set({ prefs: prefs ? { ...DEFAULT_AGENDA_PREFS, ...prefs, filters: { ...DEFAULT_AGENDA_PREFS.filters, ...prefs.filters } } : DEFAULT_AGENDA_PREFS });
      } catch {
        toast.error("Couldn't load your agenda preferences — showing the defaults");
      }
      set({ prefsLoaded: true });
    }
    await get().refresh();
  },

  refresh: async () => {
    const { prefs, anchor } = get();
    const { from, to } = windowFor(prefs.view, anchor);
    const mine = ++seq;
    set({ loading: true, error: null });
    try {
      const data = await api.fetchAgenda(from, to);
      if (mine === seq) set({ data, loading: false });
    } catch (e) {
      if (mine === seq) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  setView: (view) => {
    get().updatePrefs((p) => ({ ...p, view }));
    void get().refresh();
  },
  go: (dir) => {
    set({ anchor: shiftAnchor(get().prefs.view, get().anchor, dir) });
    void get().refresh();
  },
  goToday: () => {
    set({ anchor: startOfDay(new Date()) });
    void get().refresh();
  },
  goToDay: (day, view) => {
    set({ anchor: startOfDay(day) });
    if (view && view !== get().prefs.view) get().updatePrefs((p) => ({ ...p, view }));
    void get().refresh();
  },
  setQuery: (query) => set({ query }),

  // Optimistic: the UI follows at once; the PUT is debounced and a failure only
  // warns — the choice stays on screen for this session.
  updatePrefs: (fn) => {
    const prefs = fn(get().prefs);
    set({ prefs });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      api.saveAgendaPrefs(get().prefs).catch(() => {
        toast.error("Couldn't save your agenda filters — they are kept for this session only");
      });
    }, SAVE_DEBOUNCE_MS);
  },
}));
