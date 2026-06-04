import { useEffect } from 'react';
import { appWs } from '../services/websocket';
import { fetchEvents } from '../services/api';
import { useNotificationStore } from '../stores/notificationStore';
import { useTicketStore } from '../stores/ticketStore';
import { notificationRegistry } from '../notifications/registry';
import { registerDefaultRenderers } from '../notifications/renderers';
import { toNotification } from '../notifications/pipeline';
import { pulseEventPrefixes, reconstructNotifications } from '../notifications/audit';
import { ticketLink } from '../notifications/links';
import type { RendererContext, WsChannelMessage } from '../notifications/types';

// Register the V1 renderers once, at module load (idempotent).
registerDefaultRenderers(notificationRegistry);

/** Newest entries pulled per event-type prefix when rebuilding history. The
 *  union is later capped to the store's MAX_NOTIFICATIONS; over-fetching per
 *  prefix just ensures enough Pulse-relevant subtypes survive the noise. */
const AUDIT_FETCH_LIMIT = 100;

/** Shared renderer context — resolves ticket titles/links from the live store. */
function buildRendererContext(): RendererContext {
  return {
    ticketTitle: (id) =>
      useTicketStore.getState().tickets.find((t) => t.id === id)?.title ?? null,
    ticketLink: (id, tab) => {
      const board =
        useTicketStore.getState().tickets.find((t) => t.id === id)?.boardId ?? null;
      return ticketLink(id, tab, board);
    },
  };
}

/**
 * Fleex Pulse driver: subscribes to the global `tickets` WS channel, runs each
 * message through the renderer registry, and pushes any resulting notification
 * into the store (which fans it out to the bell + a toast).
 *
 * On mount it also rehydrates the bell from the audit trail so history survives
 * a reload / restart (see notifications/audit.ts).
 *
 * Mount once, high in the tree (AppLayout). The handler runs regardless of
 * which ticket — if any — the user is currently viewing.
 */
export function useNotifications(): void {
  const push = useNotificationStore((s) => s.push);
  const hydrate = useNotificationStore((s) => s.hydrate);

  // Live stream.
  useEffect(() => {
    const ctx = buildRendererContext();
    const unsub = appWs.onChannel('tickets', (msg) => {
      const notification = toNotification(msg as WsChannelMessage, notificationRegistry, ctx);
      if (notification) push(notification);
    });
    return unsub;
  }, [push]);

  // History rebuild from the audit trail (best-effort, runs once on mount).
  useEffect(() => {
    let cancelled = false;
    const ctx = buildRendererContext();
    const prefixes = pulseEventPrefixes(notificationRegistry);
    Promise.all(
      prefixes.map((eventType) =>
        fetchEvents({ eventType, limit: AUDIT_FETCH_LIMIT }).catch(() => []),
      ),
    )
      .then((batches) => {
        if (cancelled) return;
        const reconstructed = reconstructNotifications(batches.flat(), notificationRegistry, ctx);
        if (reconstructed.length > 0) hydrate(reconstructed);
      })
      .catch(() => {
        /* history is a nice-to-have; never break the app over it */
      });
    return () => {
      cancelled = true;
    };
  }, [hydrate]);
}
