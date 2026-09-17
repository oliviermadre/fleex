import { useEffect, useMemo, useState } from 'react';
import type { TicketGroup } from '@fleex/shared';
import { useTicketGroupStore } from '../stores/ticketGroupStore';
import * as api from '../services/api';

/**
 * The epics of one board, archived ones included. Fetched per board rather than
 * read from the store, whose `groups` follow the Kanban's selected board; the
 * store still supplies live (WebSocket) updates.
 */
export function useBoardEpics(boardId: string | null): TicketGroup[] {
  const storeGroups = useTicketGroupStore((s) => s.groups);
  const [fetched, setFetched] = useState<{ boardId: string; groups: TicketGroup[] } | null>(null);

  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    api
      .fetchTicketGroups(boardId)
      .then((groups) => {
        if (alive) setFetched({ boardId, groups });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [boardId]);

  return useMemo(() => {
    if (!boardId) return [];
    // Never show the previous board's epics while the new board's are loading.
    const boardGroups = fetched?.boardId === boardId ? fetched.groups : [];
    return mergeBoardEpics(boardGroups, storeGroups, boardId);
  }, [fetched, storeGroups, boardId]);
}

/** The fetched epics, refreshed by — and completed with — the store's epics of that board. */
export function mergeBoardEpics(fetched: TicketGroup[], storeGroups: TicketGroup[], boardId: string): TicketGroup[] {
  const byId = new Map<string, TicketGroup>(fetched.map((g) => [g.id, g]));
  for (const g of storeGroups) {
    if (byId.has(g.id) || g.boardIds.includes(boardId)) {
      byId.set(g.id, g);
    }
  }
  return Array.from(byId.values());
}
