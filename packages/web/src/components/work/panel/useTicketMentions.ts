/**
 * Fetches a ticket's mentions and keeps them live via the `tickets` WS channel
 * (the same mention:* frames TicketMentions applies). Lifted to WorkView, like
 * useTicketDeliverables, so the tool-strip badge stays current whether or not
 * the Mentions panel is open. `openCount` = mentions not yet resolved — the ones
 * still asking for attention (pending, running, waiting for info, failed).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TicketMention, TicketWsMessage } from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';

const UPSERT_TYPES = new Set([
  'mention:acknowledged',
  'mention:resolved',
  'mention:waiting_for_info',
  'mention:updated',
]);

export function countOpenMentions(mentions: readonly TicketMention[]): number {
  return mentions.filter((m) => m.status !== 'resolved').length;
}

export function useTicketMentions(ticketId: string | null): { mentions: TicketMention[]; openCount: number } {
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    // Never show the previous ticket's mentions while the next ones load.
    setMentions([]);
    if (!ticketId) return;
    const mine = ++reqId.current;
    api
      .fetchTicketMentions(ticketId)
      .then((m) => {
        if (reqId.current === mine) setMentions(m);
      })
      .catch(() => {
        /* badge stays at 0 */
      });

    const unsub = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'mention:created') {
        const m = msg.data as TicketMention;
        if (m.ticketId === ticketId) {
          setMentions((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      } else if (UPSERT_TYPES.has(msg.type)) {
        const m = msg.data as TicketMention;
        if (m.ticketId === ticketId) {
          setMentions((prev) => prev.map((x) => (x.id === m.id ? m : x)));
        }
      } else if (msg.type === 'mention:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (d.ticketId === ticketId) {
          setMentions((prev) => prev.filter((x) => x.id !== d.id));
        }
      }
    });
    return unsub;
  }, [ticketId]);

  const openCount = useMemo(() => countOpenMentions(mentions), [mentions]);
  return { mentions, openCount };
}
