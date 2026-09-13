/**
 * Loads and posts a ticket's comments for the Work conversation. The ticket is
 * the source of truth (same endpoints the Kanban ticket detail uses); this hook
 * just scopes them to the selected task and refetches after a post. WS-driven
 * live updates can layer on later — for now we refetch on send and on select.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TicketComment } from '@fleex/shared';
import * as api from '../../../services/api';

export interface TaskConversation {
  comments: TicketComment[];
  loading: boolean;
  error: string | null;
  posting: boolean;
  post: (body: string) => Promise<void>;
  reload: () => void;
}

export function useTaskConversation(ticketId: string | null): TaskConversation {
  const [comments, setComments] = useState<TicketComment[]>([]);
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
      const next = await api.fetchTicketComments(id);
      if (reqId.current === mine) setComments(next);
    } catch (e) {
      if (reqId.current === mine) setError(e instanceof Error ? e.message : 'Failed to load conversation');
    } finally {
      if (reqId.current === mine) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ticketId) {
      setComments([]);
      return;
    }
    void load(ticketId);
  }, [ticketId, load]);

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

  return { comments, loading, error, posting, post, reload };
}
