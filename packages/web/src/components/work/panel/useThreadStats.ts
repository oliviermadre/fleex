/**
 * Live counters of every thread of a ticket (see `computeThreadStats`): comments are
 * fetched once then kept live from `comment:*` WS messages, mentions are refetched when
 * the number of thread messages changes (a new turn can raise a new mention), and
 * executions come from the agent event store, already live.
 */
import { useEffect, useMemo, useState } from 'react';
import type { TicketComment, TicketMention, TicketWsMessage } from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { computeThreadStats, type ThreadStats } from './threadStats';

const NO_COMMENTS: TicketComment[] = [];
const NO_MENTIONS: TicketMention[] = [];

export function useThreadStats(ticketId: string): Map<string, ThreadStats> {
  const [comments, setComments] = useState<TicketComment[]>(NO_COMMENTS);
  const [mentions, setMentions] = useState<TicketMention[]>(NO_MENTIONS);
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId]);

  useEffect(() => {
    let alive = true;
    setComments(NO_COMMENTS);
    api.fetchTicketComments(ticketId).then((r) => alive && setComments(r)).catch(() => alive && setComments(NO_COMMENTS));
    const off = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'comment:created' || msg.type === 'comment:updated') {
        const c = msg.data as TicketComment;
        if (c.ticketId !== ticketId) return;
        setComments((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]));
      } else if (msg.type === 'comment:deleted') {
        const d = msg.data as { id: string };
        setComments((prev) => prev.filter((x) => x.id !== d.id));
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [ticketId]);

  const threadMessages = useMemo(() => comments.filter((c) => c.threadId).length, [comments]);
  useEffect(() => {
    let alive = true;
    api.fetchTicketMentions(ticketId).then((r) => alive && setMentions(r)).catch(() => alive && setMentions(NO_MENTIONS));
    return () => {
      alive = false;
    };
  }, [ticketId, threadMessages]);

  return useMemo(() => computeThreadStats(comments, mentions, executions ?? []), [comments, mentions, executions]);
}
