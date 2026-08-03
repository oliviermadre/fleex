import { create } from 'zustand';

import type { ServerCapabilities } from '@fleex/shared';

import * as api from '../services/api';

/**
 * Server capabilities — which features the storage driver in use can serve.
 *
 * Fetched ONCE at boot and cached for the whole session (capabilities can only
 * change with a server restart). Consumers read it through `useCapabilities`,
 * which applies the fail-open default: while loading, or if the fetch failed,
 * every feature is considered available. A false negative would hide a working
 * feature; a false positive merely falls through to the server's explicit 503.
 */
interface CapabilitiesState {
  /** null = not loaded (yet), or the fetch failed → callers must fail open. */
  capabilities: ServerCapabilities | null;
  loaded: boolean;

  load: () => Promise<void>;
}

// Module-scoped so concurrent callers (App + every gated surface) share the
// single in-flight request instead of each firing their own.
let inflight: Promise<void> | null = null;

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  capabilities: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    if (!inflight) {
      inflight = api
        .fetchCapabilities()
        .then((capabilities) => {
          set({ capabilities, loaded: true });
        })
        .catch(() => {
          // Older server / offline: leave `capabilities` null so every feature
          // stays enabled (fail open).
          set({ loaded: true });
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  },
}));
