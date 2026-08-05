import { create } from 'zustand';
import type { DeliverableFacets, DeliverableListItem } from '@fleex/shared';
import { documentsService, type DocumentFilters } from '../services/documentsService';

/** How many documents a page holds — both the initial load and each "load more". */
export const DOCUMENTS_PAGE_SIZE = 100;

const EMPTY_FACETS: DeliverableFacets = { types: [], agentNames: [], statuses: [], originKinds: [], total: 0 };

interface DocumentsState {
  /** The documents loaded so far — the most recent page(s), never the whole table. */
  deliverables: DeliverableListItem[];
  /** Rows matching the filters in the database, whatever is currently loaded. */
  total: number;
  /** Distinct values + counts computed by the database, for the sidebar. */
  facets: DeliverableFacets;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;

  // Multi-select filters (empty set = no filter), applied server-side
  filterTypes: Set<string>;
  filterAgentNames: Set<string>;
  filterStatuses: Set<string>;
  /** Origin dimension: `ticket` and/or `routine`. */
  filterOriginKinds: Set<string>;
  /** Free text matched against document title, ticket title or routine name. */
  search: string;

  // Actions
  fetchAll: () => Promise<void>;
  loadMore: () => Promise<void>;
  setSearch: (value: string) => void;
  toggleFilter: (
    dimension: 'filterTypes' | 'filterAgentNames' | 'filterStatuses' | 'filterOriginKinds',
    value: string,
  ) => void;
  clearFilters: () => void;
}

/**
 * Guards against out-of-order responses: only the newest request may write to
 * the store, so a slow first page can't overwrite a newer filtered one.
 */
let requestSeq = 0;

/** Search fires on a pause, not on every keystroke. */
const SEARCH_DEBOUNCE_MS = 250;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

export const useDocumentsStore = create<DocumentsState>((set, get) => {
  const currentFilters = (): DocumentFilters => ({
    types: Array.from(get().filterTypes),
    agentNames: Array.from(get().filterAgentNames),
    statuses: Array.from(get().filterStatuses),
    originKinds: Array.from(get().filterOriginKinds),
    search: get().search,
  });

  const fetchAll = async () => {
    const seq = ++requestSeq;
    set({ loading: true, error: null });
    try {
      const filters = currentFilters();
      const [page, facets] = await Promise.all([
        documentsService.list(filters, DOCUMENTS_PAGE_SIZE, 0),
        documentsService.facets(filters),
      ]);
      if (seq !== requestSeq) return;
      set({ deliverables: page.items, total: page.total, facets, loading: false });
    } catch (err) {
      console.error('Failed to load documents:', err);
      if (seq !== requestSeq) return;
      set({ loading: false, error: 'Failed to load documents' });
    }
  };

  return {
    deliverables: [],
    total: 0,
    facets: EMPTY_FACETS,
    loading: false,
    loadingMore: false,
    error: null,

    filterTypes: new Set(),
    filterAgentNames: new Set(),
    filterStatuses: new Set(),
    filterOriginKinds: new Set(),
    search: '',

    fetchAll,

    // Typing stays instant; the query waits for a pause so a search doesn't
    // fire one request per keystroke.
    setSearch: (value) => {
      set({ search: value });
      if (searchTimer !== undefined) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchTimer = undefined;
        void fetchAll();
      }, SEARCH_DEBOUNCE_MS);
    },

    loadMore: async () => {
      const { deliverables, total, loading, loadingMore } = get();
      if (loading || loadingMore || deliverables.length >= total) return;
      const seq = requestSeq;
      set({ loadingMore: true });
      try {
        const page = await documentsService.list(
          currentFilters(),
          DOCUMENTS_PAGE_SIZE,
          deliverables.length,
        );
        // A filter change (which bumps requestSeq) invalidates this offset.
        if (seq !== requestSeq) return;
        const known = new Set(get().deliverables.map((d: DeliverableListItem) => d.id));
        set({
          deliverables: [...get().deliverables, ...page.items.filter((d) => !known.has(d.id))],
          total: page.total,
          loadingMore: false,
        });
      } catch (err) {
        console.error('Failed to load more documents:', err);
        if (seq !== requestSeq) return;
        set({ loadingMore: false, error: 'Failed to load more documents' });
      }
    },

    toggleFilter: (dimension, value) => {
      const current = new Set(get()[dimension]);
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      set({ [dimension]: current });
      void fetchAll();
    },

    clearFilters: () => {
      set({
        filterTypes: new Set(),
        filterAgentNames: new Set(),
        filterStatuses: new Set(),
        filterOriginKinds: new Set(),
        search: '',
      });
      void fetchAll();
    },
  };
});
