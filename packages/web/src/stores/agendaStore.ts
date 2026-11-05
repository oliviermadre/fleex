import { create } from 'zustand';
import {
  DEFAULT_AGENDA_PREFS,
  EVENT_OCCURRENCE_CAP,
  calendarEventItemId,
  expandCalendarEvent,
  type AgendaItem,
  type CalendarEvent,
  type AgendaGoogleStatus,
  type AgendaPrefs,
  type AgendaResponse,
  type AgendaRsvp,
  type AgendaView,
} from '@fleex/shared';
import * as api from '../services/api';
import { toast } from '../lib/toast';
import { shiftAnchor, startOfDay, windowFor } from '../components/agenda/agendaLayout';

/** What a saved agenda view restores (the date is never saved: views reopen on today). */
export interface AgendaViewFilters {
  labels: AgendaPrefs['labels'];
  routines: AgendaPrefs['routines'];
  filters: AgendaPrefs['filters'];
  showWorkingLocation: boolean;
}
export interface AgendaViewDisplay {
  view: AgendaView;
}
export type AgendaSavedView = api.SavedViewPayload<AgendaViewFilters, AgendaViewDisplay>;

const SAVED_VIEWS_SCOPE = 'agenda';

interface AgendaStore {
  anchor: Date;
  data: AgendaResponse | null;
  loading: boolean;
  error: string | null;
  prefs: AgendaPrefs;
  /** False until the server prefs arrived — the page shows a skeleton, not a flash of defaults. */
  prefsLoaded: boolean;
  /**
   * True only when the prefs really came from the server. When the GET failed
   * we show the defaults but never PUT them: a save would overwrite the user's
   * stored prefs with defaults + one click.
   */
  prefsFromServer: boolean;
  query: string;
  google: AgendaGoogleStatus | null;
  /** null = not loaded yet or unavailable on this storage. */
  savedViews: AgendaSavedView[] | null;
  activeViewId: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * A free event was created, edited (`event`) or deleted (`null`): show it at
   * once from the API answer, without waiting for the full refetch (tickets,
   * runs, event log, Google through gog — seconds on a real instance).
   */
  applyLocalEvent: (eventId: string, event: CalendarEvent | null) => void;
  /** Show my answer to a Google meeting before the agenda reloads. */
  applyLocalRsvp: (itemId: string, rsvp: AgendaRsvp) => void;
  setView: (view: AgendaView) => void;
  go: (dir: 1 | -1) => void;
  goToday: () => void;
  goToDay: (day: Date, view?: AgendaView) => void;
  setQuery: (q: string) => void;
  updatePrefs: (fn: (p: AgendaPrefs) => AgendaPrefs) => void;

  /** `refresh`: re-check gogcli on the server (after running the setup commands). */
  loadGoogle: (refresh?: boolean) => Promise<void>;

  loadSavedViews: () => Promise<void>;
  saveCurrentAsView: (name: string) => Promise<void>;
  applySavedView: (id: string) => void;
  updateSavedView: (id: string) => Promise<void>;
  renameSavedView: (id: string, name: string) => Promise<void>;
  deleteSavedView: (id: string) => Promise<void>;
}

/** Monotonic counter: a slow response for a window we already left must not win. */
let seq = 0;
/** The newest refresh in flight: a superseded refresh waits for it before resolving. */
let latest: Promise<void> = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

/**
 * `data` with the items of free event `eventId` replaced by the occurrences of
 * `event` in the loaded window (removed when `event` is null). Same expansion
 * as the server; attached deliverables and the ticket ref are kept when the
 * occurrence already existed — the next refetch completes the rest.
 */
/** My answer to a Google meeting, shown at once: the item's `rsvp`, its status and my row in the guest list. */
export function withRsvp(data: AgendaResponse, itemId: string, rsvp: AgendaRsvp): AgendaResponse {
  return {
    ...data,
    items: data.items.map((it) => {
      if (it.id !== itemId || !it.external) return it;
      const attendeeList = it.external.attendeeList?.map((a) => (a.self ? { ...a, response: rsvp } : a));
      return { ...it, status: rsvp, external: { ...it.external, rsvp, ...(attendeeList ? { attendeeList } : {}) } };
    }),
  };
}

export function withLocalEvent(data: AgendaResponse, eventId: string, event: CalendarEvent | null): AgendaResponse {
  const isMine = (it: AgendaItem) => it.type === 'event' && it.event?.id === eventId;
  const before = new Map(data.items.filter(isMine).map((it) => [it.id, it]));
  const items = data.items.filter((it) => !isMine(it));
  if (event) {
    for (const occ of expandCalendarEvent(event, new Date(data.from), new Date(data.to), EVENT_OCCURRENCE_CAP)) {
      const id = calendarEventItemId(event, occ.start);
      const prev = before.get(id);
      items.push({
        id, type: 'event', shape: event.allDay ? 'allDay' : 'block', start: occ.start, end: occ.end,
        title: event.title, event,
        ticket: prev?.ticket && prev.ticket.id === event.ticketId ? prev.ticket : null,
        eventLinks: prev?.eventLinks ?? [],
      });
    }
  }
  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  return { ...data, items };
}

/** Stored prefs from an older version lack the newer fields: fill them from the defaults. */
export function mergeAgendaPrefs(stored: Partial<AgendaPrefs> | null | undefined): AgendaPrefs {
  if (!stored) return DEFAULT_AGENDA_PREFS;
  return {
    ...DEFAULT_AGENDA_PREFS,
    ...stored,
    labels: { ...DEFAULT_AGENDA_PREFS.labels, ...stored.labels },
    routines: { ...DEFAULT_AGENDA_PREFS.routines, ...stored.routines },
    filters: { ...DEFAULT_AGENDA_PREFS.filters, ...stored.filters },
    colors: { ...DEFAULT_AGENDA_PREFS.colors, ...stored.colors },
  };
}

const viewFilters = (p: AgendaPrefs): AgendaViewFilters => ({
  labels: p.labels, routines: p.routines, filters: p.filters, showWorkingLocation: p.showWorkingLocation,
});

export const useAgendaStore = create<AgendaStore>((set, get) => {
  const persistViews = async (views: AgendaSavedView[], failure: string) => {
    const before = get().savedViews;
    set({ savedViews: views });
    try {
      const saved = await api.saveSavedViews(SAVED_VIEWS_SCOPE, views);
      set({ savedViews: saved as AgendaSavedView[] });
    } catch {
      set({ savedViews: before });
      toast.error(failure);
    }
  };

  return {
    anchor: startOfDay(new Date()),
    data: null,
    loading: false,
    error: null,
    prefs: DEFAULT_AGENDA_PREFS,
    prefsLoaded: false,
    prefsFromServer: false,
    query: '',
    google: null,
    savedViews: null,
    activeViewId: null,

    init: async () => {
      if (!get().prefsLoaded) {
        try {
          const prefs = await api.fetchAgendaPrefs();
          set({ prefs: mergeAgendaPrefs(prefs), prefsFromServer: prefs !== null });
        } catch {
          toast.error("Couldn't load your agenda preferences — showing the defaults, changes won't be saved");
        }
        set({ prefsLoaded: true });
        void get().loadGoogle();
        void get().loadSavedViews();
      }
      await get().refresh();
    },

    // Resolves once the data on screen is at least as fresh as this call. When a newer
    // refresh supersedes this one (e.g. a websocket refetch), it waits for that one:
    // callers that drop an optimistic override after `await refresh()` must never
    // uncover the stale data underneath (the drag & drop "jump back" bug).
    refresh: () => {
      const { prefs, anchor } = get();
      const { from, to } = windowFor(prefs.view, anchor);
      const mine = ++seq;
      set({ loading: true, error: null });
      const run = (async () => {
        try {
          const data = await api.fetchAgenda(from, to, prefs.googleCalendars);
          if (mine === seq) set({ data, loading: false });
        } catch (e) {
          if (mine === seq) set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        }
        if (mine !== seq) await latest;
      })();
      latest = run;
      return run;
    },

    applyLocalEvent: (eventId, event) => {
      const data = get().data;
      if (data) set({ data: withLocalEvent(data, eventId, event) });
    },

    applyLocalRsvp: (itemId, rsvp) => {
      const data = get().data;
      if (data) set({ data: withRsvp(data, itemId, rsvp) });
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
      set({ prefs, activeViewId: null });
      if (!get().prefsFromServer) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        api.saveAgendaPrefs(get().prefs).catch(() => {
          toast.error("Couldn't save your agenda filters — they are kept for this session only");
        });
      }, SAVE_DEBOUNCE_MS);
    },

    loadGoogle: async (refresh = false) => {
      try {
        set({ google: await api.fetchAgendaGoogleStatus(refresh) });
      } catch {
        set({ google: null });
      }
    },

    loadSavedViews: async () => {
      try {
        set({ savedViews: (await api.fetchSavedViews(SAVED_VIEWS_SCOPE)) as AgendaSavedView[] });
      } catch {
        set({ savedViews: null });
      }
    },
    saveCurrentAsView: async (name) => {
      const now = new Date().toISOString();
      const p = get().prefs;
      const view: AgendaSavedView = {
        id: crypto.randomUUID(), name: name.trim(), emoji: null,
        filters: viewFilters(p), display: { view: p.view }, createdAt: now, updatedAt: now,
      };
      await persistViews([...(get().savedViews ?? []), view], "Couldn't save the view");
      set({ activeViewId: view.id });
    },
    applySavedView: (id) => {
      const v = get().savedViews?.find((x) => x.id === id);
      if (!v) return;
      const viewChanged = v.display.view !== get().prefs.view;
      get().updatePrefs((p) => mergeAgendaPrefs({
        ...p,
        labels: v.filters.labels ?? {},
        routines: v.filters.routines ?? {},
        filters: v.filters.filters,
        showWorkingLocation: v.filters.showWorkingLocation ?? false,
        view: v.display.view ?? p.view,
      }));
      set({ activeViewId: id });
      if (viewChanged) void get().refresh();
    },
    updateSavedView: async (id) => {
      const p = get().prefs;
      const now = new Date().toISOString();
      await persistViews(
        (get().savedViews ?? []).map((v) => (v.id === id ? { ...v, filters: viewFilters(p), display: { view: p.view }, updatedAt: now } : v)),
        "Couldn't update the view",
      );
      set({ activeViewId: id });
    },
    renameSavedView: async (id, name) => {
      const now = new Date().toISOString();
      await persistViews(
        (get().savedViews ?? []).map((v) => (v.id === id ? { ...v, name: name.trim(), updatedAt: now } : v)),
        "Couldn't rename the view",
      );
    },
    deleteSavedView: async (id) => {
      await persistViews((get().savedViews ?? []).filter((v) => v.id !== id), "Couldn't delete the view");
      if (get().activeViewId === id) set({ activeViewId: null });
    },
  };
});
