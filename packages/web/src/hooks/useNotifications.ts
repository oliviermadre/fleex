import { useEffect } from 'react';
import { appWs } from '../services/websocket';
import { useNotificationStore } from '../stores/notificationStore';
import { useTicketStore } from '../stores/ticketStore';
import { notificationRegistry } from '../notifications/registry';
import { registerDefaultRenderers } from '../notifications/renderers';
import { toNotification } from '../notifications/pipeline';
import { ticketLink } from '../notifications/links';
import type { RendererContext, WsChannelMessage } from '../notifications/types';

// Register the V1 renderers once, at module load (idempotent).
registerDefaultRenderers(notificationRegistry);

/**
 * Fleex Pulse driver: subscribes to the global `tickets` WS channel, runs each
 * message through the renderer registry, and pushes any resulting notification
 * into the store (which fans it out to the bell + a toast).
 *
 * Mount once, high in the tree (AppLayout). The handler runs regardless of
 * which ticket — if any — the user is currently viewing.
 */
export function useNotifications(): void {
  const push = useNotificationStore((s) => s.push);

  useEffect(() => {
    const ctx: RendererContext = {
      ticketTitle: (id) =>
        useTicketStore.getState().tickets.find((t) => t.id === id)?.title ?? null,
      ticketLink: (id, tab) => {
        const board =
          useTicketStore.getState().tickets.find((t) => t.id === id)?.boardId ?? null;
        return ticketLink(id, tab, board);
      },
    };

    const unsub = appWs.onChannel('tickets', (msg) => {
      const notification = toNotification(msg as WsChannelMessage, notificationRegistry, ctx);
      if (notification) push(notification);
    });
    return unsub;
  }, [push]);
}
