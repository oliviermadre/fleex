/**
 * The ticket's mentions, kept live over the `tickets` WS channel. The Work
 * stream needs them to tell which agent runs belong to an assistant thread.
 */
import { useEffect, useState } from 'react';
import type { TicketMention, TicketWsMessage } from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';

const EMPTY: TicketMention[] = [];

export function useTicketMentions(ticketId: string | null): TicketMention[] {
  const [mentions, setMentions] = useState<TicketMention[]>(EMPTY);

  useEffect(() => {
    if (!ticketId) {
      setMentions(EMPTY);
      return;
    }
    let alive = true;
    api.fetchTicketMentions(ticketId).then((m) => { if (alive) setMentions(m); }).catch(() => {});
    const unsub = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (!msg.type.startsWith('mention:')) return;
      const m = msg.data as Partial<TicketMention> & { id: string; ticketId?: string };
      if (m.ticketId !== ticketId) return;
      if (msg.type === 'mention:deleted') {
        setMentions((prev) => prev.filter((x) => x.id !== m.id));
      } else if ('commentId' in m) {
        setMentions((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? (m as TicketMention) : x)) : [...prev, m as TicketMention]));
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [ticketId]);

  return mentions;
}
