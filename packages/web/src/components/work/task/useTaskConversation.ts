/**
 * Loads and posts a ticket's comments (and its activity log) for the Work
 * conversation. The ticket is the source of truth (same endpoints the Kanban
 * ticket detail uses); this hook scopes them to the selected task, refetches
 * after a post, and layers live updates over the `tickets` WS channel: comment
 * created/updated/deleted apply in place, and a ticket update/move refetches the
 * activity log (no dedicated activity WS event exists) so event lines stay live.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TicketActivity, TicketComment, TicketWsMessage } from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';

export interface TaskConversation {
  comments: TicketComment[];
  events: TicketActivity[];
  loading: boolean;
  error: string | null;
  posting: boolean;
  post: (body: string) => Promise<void>;
  reload: () => void;
}

export function useTaskConversation(ticketId: string | null): TaskConversation {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [events, setEvents] = useState<TicketActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // Guards against a slow response for a previously-selected ticket overwriting
  // the current one.
  const reqId = useRef(0);

  const load = useCallback(async (id: string) => {
    const mine = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const [nextComments, nextEvents] = await Promise.all([
        api.fetchTicketComments(id),
        api.fetchTicketActivity(id).catch(() => [] as TicketActivity[]),
      ]);
      if (reqId.current === mine) {
        setComments(nextComments);
        setEvents(nextEvents);
      }
    } catch (e) {
      if (reqId.current === mine) setError(e instanceof Error ? e.message : 'Failed to load conversation');
    } finally {
      if (reqId.current === mine) setLoading(false);
    }
  }, []);

  // Refetch just the activity log (event lines), used on ticket update/move.
  const reloadActivity = useCallback((id: string) => {
    api.fetchTicketActivity(id).then(setEvents).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ticketId) {
      setComments([]);
      setEvents([]);
      return;
    }
    void load(ticketId);
  }, [ticketId, load]);

  // Live updates: apply comment mutations for the current ticket in place, so
  // an agent's reply (or an edit/delete from elsewhere) shows without a refetch.
  // A ticket update/move creates activity rows with no dedicated WS event, so we
  // refetch the activity log on those to keep event lines current.
  useEffect(() => {
    if (!ticketId) return;
    const unsub = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      if (msg.type === 'comment:created') {
        const c = msg.data as TicketComment;
        if (c.ticketId === ticketId) {
          setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
        }
      } else if (msg.type === 'comment:updated') {
        const c = msg.data as TicketComment;
        if (c.ticketId === ticketId) {
          setComments((prev) => prev.map((x) => (x.id === c.id ? c : x)));
        }
      } else if (msg.type === 'comment:deleted') {
        const d = msg.data as { id: string; ticketId: string };
        if (d.ticketId === ticketId) {
          setComments((prev) => prev.filter((x) => x.id !== d.id));
        }
      } else if (msg.type === 'ticket:updated' || msg.type === 'ticket:moved') {
        const t = msg.data as { id?: string };
        if (t?.id === ticketId) reloadActivity(ticketId);
      }
    });
    return unsub;
  }, [ticketId, reloadActivity]);

  const post = useCallback(
    async (body: string) => {
      if (!ticketId || !body.trim()) return;
      setPosting(true);
      try {
        await api.postTicketComment(ticketId, body);
        await load(ticketId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to post');
        throw e;
      } finally {
        setPosting(false);
      }
    },
    [ticketId, load],
  );

  const reload = useCallback(() => {
    if (ticketId) void load(ticketId);
  }, [ticketId, load]);

  return { comments, events, loading, error, posting, post, reload };
}
