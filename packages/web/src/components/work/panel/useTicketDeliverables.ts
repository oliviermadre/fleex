/**
 * Fetches a ticket's deliverables and keeps the list live via the `tickets` WS
 * channel (deliverable:created / :updated / :deleted) — the same source the
 * ticket detail uses. Lifted to WorkView so both the tool-strip badge count and
 * the Delivs panel share one subscription and stay in sync.
 */
import { useEffect, useRef, useState } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';

export function useTicketDeliverables(ticketId: string | null): {
  deliverables: TicketDeliverable[];
  loading: boolean;
} {
  const [deliverables, setDeliverables] = useState<TicketDeliverable[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!ticketId) {
      setDeliverables([]);
      return;
    }
    const mine = ++reqId.current;
    setLoading(true);
    api
      .fetchTicketDeliverables(ticketId)
      .then((d) => {
        if (reqId.current === mine) setDeliverables(d);
      })
      .catch(() => {
        if (reqId.current === mine) setDeliverables([]);
      })
      .finally(() => {
        if (reqId.current === mine) setLoading(false);
      });

    const unsub = appWs.onChannel('tickets', (raw) => {
      try {
        const msg = raw as TicketWsMessage;
        if (msg.type === 'deliverable:created') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) {
            setDeliverables((prev) => (prev.some((x) => x.id === d.id) ? prev : [...prev, d]));
          }
        } else if (msg.type === 'deliverable:updated') {
          const d = msg.data as TicketDeliverable;
          if (d.ticketId === ticketId) {
            setDeliverables((prev) => prev.map((x) => (x.id === d.id ? d : x)));
          }
        } else if (msg.type === 'deliverable:deleted') {
          const { deliverableId, ticketId: tid } = msg.data as { deliverableId: string; ticketId: string };
          if (tid === ticketId) {
            setDeliverables((prev) => prev.filter((x) => x.id !== deliverableId));
          }
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    return unsub;
  }, [ticketId]);

  return { deliverables, loading };
}
