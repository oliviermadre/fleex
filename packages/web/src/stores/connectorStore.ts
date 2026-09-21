import { create } from 'zustand';
import type { SlackConnectorStatus } from '@fleex/shared';
import { connectSlackConnector, disconnectSlackConnector, fetchSlackConnector } from '../services/api';

interface ConnectorState {
  /** `null` until first loaded. Holds WHO is connected — the token never reaches the browser again once saved. */
  slack: SlackConnectorStatus | null;
  /** Loads once; `force` re-asks the server (the Connectors tab does, to show the truth on open). */
  loadSlack: (force?: boolean) => Promise<void>;
  connectSlack: (token: string) => Promise<void>;
  disconnectSlack: () => Promise<void>;
}

export const useConnectorStore = create<ConnectorState>((set, get) => ({
  slack: null,
  loadSlack: async (force = false) => {
    if (!force && get().slack !== null) return;
    try {
      set({ slack: await fetchSlackConnector() });
    } catch {
      // Unknown ≠ disconnected, but every caller only needs "can I promise the
      // fast path?" — and without an answer the honest promise is the slow one.
      set({ slack: { connected: false } });
    }
  },
  connectSlack: async (token) => set({ slack: await connectSlackConnector(token) }),
  disconnectSlack: async () => set({ slack: await disconnectSlackConnector() }),
}));

/**
 * Will a link from `workspace` be read through the Slack API (seconds) rather
 * than through Claude's integration (10–40 s)? The SAME rule as the server's
 * SlackImportRouter — a token only covers its own workspace — because the screens
 * use it to promise a wait, and a promise the server won't keep is a lie.
 */
export function slackReadsDirectly(status: SlackConnectorStatus | null, workspace: string | undefined): boolean {
  if (!status?.connected || !workspace) return false;
  return workspace.toLowerCase() === status.teamDomain.toLowerCase();
}
