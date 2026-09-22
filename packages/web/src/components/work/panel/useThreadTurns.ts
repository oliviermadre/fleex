/**
 * The turns of one thread for the Threads panel: fetched once per thread, then
 * kept live from `comment:*` WS messages filtered on the thread id.
 */
import { useEffect, useRef, useState } from 'react';
import type { TicketComment, TicketWsMessage } from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';

const EMPTY: TicketComment[] = [];

export function useThreadTurns(threadId: string | null): TicketComment[] {
  const [turns, setTurns] = useState<TicketComment[]>(EMPTY);
  const reqId = useRef(0);

  useEffect(() => {
    if (!threadId) {
      setTurns(EMPTY);
      return;
    }
    const mine = ++reqId.current;
    api
      .fetchThread(threadId)
      .then((r) => {
        if (reqId.current === mine) setTurns(r.turns);
      })
      .catch(() => {
        if (reqId.current === mine) setTurns(EMPTY);
      });

    return appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'comment:created') {
        const c = msg.data as TicketComment;
        if (c.threadId === threadId) setTurns((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
      } else if (msg.type === 'comment:updated') {
        const c = msg.data as TicketComment;
        if (c.threadId === threadId) setTurns((prev) => prev.map((x) => (x.id === c.id ? c : x)));
      } else if (msg.type === 'comment:deleted') {
        const d = msg.data as { id: string };
        setTurns((prev) => prev.filter((x) => x.id !== d.id));
      }
    });
  }, [threadId]);

  return turns;
}
